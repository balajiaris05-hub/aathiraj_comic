import crypto from 'crypto';
import Razorpay from 'razorpay';
import { getRazorpayEnvironmentStatus, getRazorpaySecret, computeRazorpayOrderSignature } from './security.ts';

export interface RazorpayGatewayOrderResult {
  orderId: string;
  amount?: number;
  currency?: string;
  createdViaRazorpayApi: boolean;
  statusCode?: number;
  error?: string;
}

export interface RazorpayVerifiedPayment {
  paymentId: string;
  orderId?: string;
  subscriptionId?: string;
  status: string;
  captured: boolean;
  amountPaise: number;
  amountInr: number;
  currency: string;
  email?: string;
  contact?: string;
  method?: string;
  vpa?: string;
  plan: '1_month' | '6_months';
  paidAt: string;
  expiresAt: string;
}

export interface RazorpayCustomerVerificationResult {
  checkedRazorpayApi: boolean;
  configuredWithRealKeys: boolean;
  verified: boolean;
  source: 'razorpay_api' | 'unconfigured_sandbox' | 'not_found';
  payment?: RazorpayVerifiedPayment;
  error?: string;
}

const KNOWN_SUBSCRIPTION_IDS = ['sub_U0DeTe3l42sQ9K', 'sub_U0DEqhM6bgOd0h'];

export function hasRealRazorpayApiKeys(): boolean {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const secret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!keyId || !secret) return false;
  if (keyId === 'your_razorpay_key_id' || secret === 'your_razorpay_key_secret') return false;
  return keyId.startsWith('rzp_live_') || keyId.startsWith('rzp_test_');
}

function createRazorpaySdkClient(): Razorpay | null {
  if (!hasRealRazorpayApiKeys()) return null;
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = getRazorpaySecret();
  if (!keyId || !keySecret) return null;
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function getRazorpayAuthHeader(): string | null {
  if (!hasRealRazorpayApiKeys()) return null;
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const secret = getRazorpaySecret();
  if (!keyId || !secret) return null;
  return 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64');
}

function phonesTailMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (da.length < 7 || db.length < 7) return false;
  const len = Math.min(10, da.length, db.length);
  return da.slice(-len) === db.slice(-len);
}

function resolvePlanFromRazorpayEntity(entity: any): '1_month' | '6_months' {
  const amountPaise = Number(entity?.amount || 0);
  const subId = String(entity?.subscription_id || entity?.notes?.subscription_id || '').trim();
  const planId = String(entity?.plan_id || entity?.notes?.plan_id || '').trim();
  if (
    subId === 'sub_U0DEqhM6bgOd0h' ||
    planId === 'plan_U0DDDaA2ru0PLQ' ||
    amountPaise >= 24900
  ) {
    return '6_months';
  }
  return '1_month';
}

function toVerifiedPaymentObject(entity: any): RazorpayVerifiedPayment {
  const plan = resolvePlanFromRazorpayEntity(entity);
  const amountPaise = Number(entity?.amount || (plan === '6_months' ? 24900 : 4900));
  const createdSec = Number(entity?.created_at || 0);
  const paidMs = createdSec > 0 ? createdSec * 1000 : Date.now();
  const durationMs = plan === '6_months' ? 180 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const expiresMs = paidMs + durationMs;
  const methodRaw = String(entity?.method || 'upi').toUpperCase();
  const methodLabel = entity?.vpa
    ? `Razorpay ${methodRaw} (${entity.vpa})`
    : `Razorpay ${methodRaw}`;

  return {
    paymentId: String(entity.id || ''),
    orderId: entity.order_id ? String(entity.order_id) : undefined,
    subscriptionId: entity.subscription_id ? String(entity.subscription_id) : undefined,
    status: String(entity.status || 'captured'),
    captured: entity.status === 'captured' || Boolean(entity.captured),
    amountPaise,
    amountInr: Number((amountPaise / 100).toFixed(2)),
    currency: String(entity.currency || 'INR'),
    email: entity.email ? String(entity.email).trim().toLowerCase() : undefined,
    contact: entity.contact ? String(entity.contact).trim() : undefined,
    method: methodLabel,
    vpa: entity.vpa ? String(entity.vpa).trim() : undefined,
    plan,
    paidAt: new Date(paidMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
  };
}

function isEntityPaidAndActive(entity: any): boolean {
  if (!entity || !entity.id) return false;
  const status = String(entity.status || '').toLowerCase();
  if (status !== 'captured' && status !== 'authorized') return false;
  if (Number(entity.amount_refunded || 0) >= Number(entity.amount || 0) && Number(entity.amount || 0) > 0) {
    return false;
  }
  const amountPaise = Number(entity.amount || 0);
  if (amountPaise < 4900) return false;
  const plan = resolvePlanFromRazorpayEntity(entity);
  const createdSec = Number(entity.created_at || 0);
  const paidMs = createdSec > 0 ? createdSec * 1000 : Date.now();
  const durationMs = plan === '6_months' ? 180 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return paidMs + durationMs > Date.now();
}

/**
 * Create a real order via Razorpay Orders API (official Razorpay Node SDK)
 * for both Test Mode (rzp_test_*) and Live Mode (rzp_live_*).
 */
export async function createGatewayOrderOnRazorpay(params: {
  amountPaise: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayGatewayOrderResult> {
  const rzp = createRazorpaySdkClient();
  const currency = (params.currency || 'INR').toUpperCase();

  if (!rzp) {
    return {
      orderId: '',
      createdViaRazorpayApi: false,
      statusCode: 401,
      error: 'Razorpay credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) are missing or invalid.',
    };
  }

  try {
    const order = await rzp.orders.create({
      amount: Math.round(params.amountPaise),
      currency,
      receipt: params.receipt.slice(0, 40),
      notes: params.notes || {},
    });

    if (order && order.id) {
      return {
        orderId: String(order.id),
        amount: Number(order.amount ?? params.amountPaise),
        currency: String(order.currency || currency),
        createdViaRazorpayApi: true,
      };
    }

    return {
      orderId: '',
      createdViaRazorpayApi: false,
      statusCode: 500,
      error: 'Razorpay Orders API did not return an order ID.',
    };
  } catch (err: any) {
    const httpStatus = Number(err?.statusCode || err?.response?.status || 500);
    const apiDesc =
      err?.error?.description ||
      err?.description ||
      err?.message ||
      'Razorpay Orders API request failed.';
    const isAuthFailure =
      httpStatus === 401 ||
      /authentication failed|invalid key|unauthorized/i.test(String(apiDesc));

    return {
      orderId: '',
      createdViaRazorpayApi: false,
      statusCode: isAuthFailure ? 401 : 500,
      error: String(apiDesc),
    };
  }
}

/**
 * Fetch and validate a single Razorpay payment by payment_id (`pay_...`).
 */
export async function fetchRazorpayPaymentById(paymentId: string): Promise<{
  checked: boolean;
  found: boolean;
  capturedOrAuthorized: boolean;
  payment?: RazorpayVerifiedPayment;
  rawStatus?: string;
  error?: string;
}> {
  const authHeader = getRazorpayAuthHeader();
  if (!authHeader) {
    return { checked: false, found: false, capturedOrAuthorized: false };
  }

  const cleanId = paymentId.trim();
  if (!cleanId) {
    return { checked: true, found: false, capturedOrAuthorized: false, error: 'Missing payment ID' };
  }

  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(cleanId)}`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(7000),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !data?.id) {
      return {
        checked: true,
        found: false,
        capturedOrAuthorized: false,
        error: data?.error?.description || `Razorpay payment lookup HTTP ${res.status}`,
      };
    }

    const status = String(data.status || '').toLowerCase();
    const ok = status === 'captured' || status === 'authorized';
    return {
      checked: true,
      found: true,
      capturedOrAuthorized: ok,
      rawStatus: status,
      payment: toVerifiedPaymentObject(data),
    };
  } catch (err: any) {
    return {
      checked: true,
      found: false,
      capturedOrAuthorized: false,
      error: err?.message || 'Razorpay payment lookup failed',
    };
  }
}

/**
 * Query Razorpay REST API for any active/captured Premium payment matching
 * the customer's Email, Phone, or explicit Razorpay Payment ID (`pay_...`).
 */
export async function findCapturedRazorpayPaymentForCustomer(params: {
  email?: string;
  phone?: string;
  paymentId?: string;
}): Promise<RazorpayCustomerVerificationResult> {
  const configured = hasRealRazorpayApiKeys();
  const authHeader = getRazorpayAuthHeader();
  if (!configured || !authHeader) {
    return {
      checkedRazorpayApi: false,
      configuredWithRealKeys: false,
      verified: false,
      source: 'unconfigured_sandbox',
    };
  }

  const cleanEmail = (params.email || '').trim().toLowerCase();
  const cleanPhone = (params.phone || '').trim();
  const cleanPaymentId = (params.paymentId || '').trim();

  // 1. Direct lookup if a specific Razorpay payment ID (`pay_...`) was supplied
  if (cleanPaymentId) {
    const direct = await fetchRazorpayPaymentById(cleanPaymentId);
    if (direct.found && direct.payment && isEntityPaidAndActive({
      ...direct.payment,
      id: direct.payment.paymentId,
      amount: direct.payment.amountPaise,
      status: direct.payment.status,
      created_at: Math.floor(new Date(direct.payment.paidAt).getTime() / 1000),
    })) {
      const emailMatches = !cleanEmail || !direct.payment.email || direct.payment.email === cleanEmail;
      const phoneMatches = !cleanPhone || !direct.payment.contact || phonesTailMatch(direct.payment.contact, cleanPhone);
      if (emailMatches || phoneMatches) {
        return {
          checkedRazorpayApi: true,
          configuredWithRealKeys: true,
          verified: true,
          source: 'razorpay_api',
          payment: direct.payment,
        };
      }
      return {
        checkedRazorpayApi: true,
        configuredWithRealKeys: true,
        verified: false,
        source: 'not_found',
        error: `Razorpay Payment ${cleanPaymentId} belongs to a different customer (${direct.payment.email || direct.payment.contact || 'unknown'}).`,
      };
    }
    return {
      checkedRazorpayApi: true,
      configuredWithRealKeys: true,
      verified: false,
      source: 'not_found',
      error: direct.error || `Payment ${cleanPaymentId} was not found or has not been captured on Razorpay.`,
    };
  }

  if (!cleanEmail && !cleanPhone) {
    return {
      checkedRazorpayApi: false,
      configuredWithRealKeys: true,
      verified: false,
      source: 'not_found',
    };
  }

  try {
    // 2. Scan recent captured payments from Razorpay Payments API (match by customer Gmail or Mobile Number)
    const paymentsRes = await fetch('https://api.razorpay.com/v1/payments?count=100', {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(8000),
    });

    if (paymentsRes.ok) {
      const json = (await paymentsRes.json().catch(() => ({}))) as { items?: any[] };
      const items = Array.isArray(json.items) ? json.items : [];
      const activeMatches = items
        .filter((item) => {
          if (!isEntityPaidAndActive(item)) return false;
          const itemEmails = [
            item.email,
            item.notes?.email,
            item.notes?.customer_email,
          ]
            .filter(Boolean)
            .map((e: any) => String(e).trim().toLowerCase());
          const itemPhones = [
            item.contact,
            item.notes?.phone,
            item.notes?.customer_phone,
            item.notes?.mobile,
          ]
            .filter(Boolean)
            .map((p: any) => String(p).trim());

          const emailOk = Boolean(cleanEmail && itemEmails.includes(cleanEmail));
          const phoneOk = Boolean(
            cleanPhone && itemPhones.some((p) => phonesTailMatch(p, cleanPhone))
          );
          return emailOk || phoneOk;
        })
        .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));

      if (activeMatches.length > 0) {
        return {
          checkedRazorpayApi: true,
          configuredWithRealKeys: true,
          verified: true,
          source: 'razorpay_api',
          payment: toVerifiedPaymentObject(activeMatches[0]),
        };
      }
    }

    // 3. Check active Razorpay Subscriptions (`/v1/subscriptions`) matching customer Gmail or Mobile Number
    const customerCache = new Map<string, { email?: string; contact?: string } | null>();
    const fetchCustomerDetails = async (customerId: string) => {
      if (customerCache.has(customerId)) return customerCache.get(customerId) || null;
      try {
        const custRes = await fetch(
          `https://api.razorpay.com/v1/customers/${encodeURIComponent(customerId)}`,
          {
            headers: { Authorization: authHeader },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (!custRes.ok) {
          customerCache.set(customerId, null);
          return null;
        }
        const custData = (await custRes.json().catch(() => null)) as any;
        const details = custData
          ? {
              email: custData.email ? String(custData.email).trim().toLowerCase() : undefined,
              contact: custData.contact ? String(custData.contact).trim() : undefined,
            }
          : null;
        customerCache.set(customerId, details);
        return details;
      } catch {
        customerCache.set(customerId, null);
        return null;
      }
    };

    try {
      const subsRes = await fetch('https://api.razorpay.com/v1/subscriptions?count=100', {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(8000),
      });
      if (subsRes.ok) {
        const subsJson = (await subsRes.json().catch(() => ({}))) as { items?: any[] };
        const subs = Array.isArray(subsJson.items) ? subsJson.items : [];
        const activeSubs = subs.filter((sub) => {
          const st = String(sub.status || '').toLowerCase();
          if (st !== 'active' && st !== 'authenticated') return false;
          const currentEndSec = Number(sub.current_end || sub.end_at || 0);
          if (currentEndSec > 0 && currentEndSec * 1000 <= Date.now()) return false;
          if (Number(sub.paid_count || 0) <= 0 && st !== 'active') return false;
          return true;
        });

        let customerLookups = 0;
        for (const sub of activeSubs) {
          const noteEmail = String(sub.notes?.email || sub.notes?.customer_email || '').trim().toLowerCase();
          const notePhone = String(sub.notes?.phone || sub.notes?.customer_phone || sub.notes?.mobile || '').trim();
          let emailOk = Boolean(cleanEmail && noteEmail && noteEmail === cleanEmail);
          let phoneOk = Boolean(cleanPhone && notePhone && phonesTailMatch(notePhone, cleanPhone));

          if (!emailOk && !phoneOk && sub.customer_id && customerLookups < 15) {
            customerLookups++;
            const cust = await fetchCustomerDetails(String(sub.customer_id));
            if (cust) {
              emailOk = Boolean(cleanEmail && cust.email && cust.email === cleanEmail);
              phoneOk = Boolean(cleanPhone && cust.contact && phonesTailMatch(cust.contact, cleanPhone));
            }
          }

          if (emailOk || phoneOk) {
            const plan = resolvePlanFromRazorpayEntity({
              plan_id: sub.plan_id,
              subscription_id: sub.id,
            });
            const startSec = Number(sub.current_start || sub.charge_at || sub.created_at || 0);
            const paidMs = startSec > 0 ? startSec * 1000 : Date.now();
            const durationMs = plan === '6_months' ? 180 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
            const endSec = Number(sub.current_end || 0);
            const expiresMs = endSec > 0 ? endSec * 1000 : paidMs + durationMs;
            if (expiresMs > Date.now()) {
              const amountPaise = plan === '6_months' ? 24900 : 4900;
              return {
                checkedRazorpayApi: true,
                configuredWithRealKeys: true,
                verified: true,
                source: 'razorpay_api',
                payment: {
                  paymentId: String(sub.id),
                  subscriptionId: String(sub.id),
                  status: 'captured',
                  captured: true,
                  amountPaise,
                  amountInr: Number((amountPaise / 100).toFixed(2)),
                  currency: 'INR',
                  email: cleanEmail || noteEmail || undefined,
                  contact: cleanPhone || notePhone || undefined,
                  method: `Razorpay Subscription (${sub.id})`,
                  plan,
                  paidAt: new Date(paidMs).toISOString(),
                  expiresAt: new Date(expiresMs).toISOString(),
                },
              };
            }
          }
        }
      }
    } catch {
      // continue checking known subscription invoices below
    }

    // 4. Also check known Razorpay Subscription Invoices for external rzp.io payment links
    for (const subId of KNOWN_SUBSCRIPTION_IDS) {
      try {
        const invRes = await fetch(
          `https://api.razorpay.com/v1/invoices?subscription_id=${encodeURIComponent(subId)}&count=25`,
          {
            headers: { Authorization: authHeader },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (!invRes.ok) continue;
        const invJson = (await invRes.json().catch(() => ({}))) as { items?: any[] };
        const invoices = Array.isArray(invJson.items) ? invJson.items : [];
        const paidInv = invoices.find((inv) => {
          if (String(inv.status || '').toLowerCase() !== 'paid') return false;
          const custEmail = String(inv.customer_details?.email || inv.customer_details?.customer_email || '')
            .trim()
            .toLowerCase();
          const custPhone = String(inv.customer_details?.contact || inv.customer_details?.customer_phone || '').trim();
          const emailOk = Boolean(cleanEmail && custEmail && custEmail === cleanEmail);
          const phoneOk = Boolean(cleanPhone && custPhone && phonesTailMatch(custPhone, cleanPhone));
          return emailOk || phoneOk;
        });

        if (paidInv) {
          const plan: '1_month' | '6_months' = subId === 'sub_U0DEqhM6bgOd0h' ? '6_months' : '1_month';
          const paidSec = Number(paidInv.paid_at || paidInv.issued_at || 0);
          const paidMs = paidSec > 0 ? paidSec * 1000 : Date.now();
          const durationMs = plan === '6_months' ? 180 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
          if (paidMs + durationMs > Date.now()) {
            const amountPaise = Number(paidInv.amount_paid || paidInv.amount || (plan === '6_months' ? 24900 : 4900));
            return {
              checkedRazorpayApi: true,
              configuredWithRealKeys: true,
              verified: true,
              source: 'razorpay_api',
              payment: {
                paymentId: String(paidInv.payment_id || paidInv.id),
                orderId: paidInv.order_id ? String(paidInv.order_id) : undefined,
                subscriptionId: subId,
                status: 'captured',
                captured: true,
                amountPaise,
                amountInr: Number((amountPaise / 100).toFixed(2)),
                currency: 'INR',
                email: cleanEmail || paidInv.customer_details?.email,
                contact: cleanPhone || paidInv.customer_details?.contact,
                method: `Razorpay Subscription (${subId})`,
                plan,
                paidAt: new Date(paidMs).toISOString(),
                expiresAt: new Date(paidMs + durationMs).toISOString(),
              },
            };
          }
        }
      } catch {
        // continue checking next subscription
      }
    }

    return {
      checkedRazorpayApi: true,
      configuredWithRealKeys: true,
      verified: false,
      source: 'not_found',
    };
  } catch (err: any) {
    return {
      checkedRazorpayApi: true,
      configuredWithRealKeys: true,
      verified: false,
      source: 'not_found',
      error: err?.message || 'Error querying Razorpay API',
    };
  }
}

