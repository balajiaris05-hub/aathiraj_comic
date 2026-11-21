import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Download,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { Purchase, GstBusinessSettings } from '../types/comic';
import { syncPurchaseToFirestore } from '../firebase';
import {
  DEFAULT_GST_SETTINGS,
  generateTaxInvoicePdfBytes,
  ensurePurchaseGstFields,
} from '../utils/gstUtils';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

interface CheckoutProps {
  isOpen: boolean;
  onClose: () => void;
  comicId: string;
  comicTitle: string;
  chapterId?: string;
  episodeId?: string;
  itemTitle: string;
  itemType: 'full_comic' | 'chapter' | 'episode' | 'subscription';
  subscriptionPlan?: '1_month' | '6_months';
  amountInr: number;
  onPaymentSuccess: (purchase: Purchase) => void;
}

type CheckoutPhase = 'idle' | 'launching' | 'razorpay_open' | 'verifying' | 'error' | 'receipt';

function ensureRazorpayCheckoutScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const onLoad = () => resolve(Boolean(window.Razorpay));
      const onError = () => resolve(false);
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      setTimeout(() => resolve(Boolean(window.Razorpay)), 6000);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export const RazorpayCheckoutModal: React.FC<CheckoutProps> = ({
  isOpen,
  onClose,
  comicId,
  comicTitle,
  chapterId,
  episodeId,
  itemTitle,
  itemType,
  subscriptionPlan,
  amountInr,
  onPaymentSuccess,
}) => {
  const { user, updateUser, refreshUser, getAuthHeaders } = useAuth();
  const [phase, setPhase] = useState<CheckoutPhase>('idle');
  const [statusLabel, setStatusLabel] = useState<string>('Opening Razorpay Checkout...');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Purchase | null>(null);
  const [gstSettings, setGstSettings] = useState<GstBusinessSettings>(DEFAULT_GST_SETTINGS);

  // Prevent duplicate launches (e.g., React StrictMode double effect invocation)
  const launchedSessionKeyRef = useRef<string | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const settledRef = useRef<boolean>(false);

  // Quietly load GST settings in the background for receipt PDF formatting
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetch('/api/payments/config')
      .then((res) => res.json())
      .then((data) => {
        if (active && data?.gstConfig) {
          setGstSettings((prev) => ({ ...prev, ...data.gstConfig }));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen]);

  const launchDirectRazorpayCheckout = useCallback(async () => {
    cancelledRef.current = false;
    settledRef.current = false;
    setError(null);
    setReceipt(null);

    const amountPaise = Math.round(Number(amountInr) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise < 100) {
      setError('Minimum payable amount is ₹1 (100 paise).');
      setPhase('error');
      return;
    }

    setPhase('launching');
    setStatusLabel(
      itemType === 'subscription'
        ? 'Opening Razorpay Subscription Checkout...'
        : 'Opening Razorpay Checkout...'
    );

    try {
      const [sdkReady, headers] = await Promise.all([
        ensureRazorpayCheckoutScript(),
        getAuthHeaders(),
      ]);

      if (cancelledRef.current) return;

      if (!sdkReady || typeof window === 'undefined' || !window.Razorpay) {
        throw new Error(
          'Unable to load Razorpay Checkout script (checkout.razorpay.com). Please check your internet connection and try again.'
        );
      }

      const placeOfSupplyStateCode = gstSettings.stateCode || '33';

      // Create Razorpay Subscription (for 1-month / 6-month plans) or Order directly on backend
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          comicId,
          comicTitle,
          chapterId,
          episodeId,
          itemTitle,
          type: itemType,
          subscriptionPlan,
          amountInr,
          amount: amountPaise,
          currency: 'INR',
          receipt: `rcpt_${Date.now()}`,
          userId: user?.id || 'usr_guest',
          customerName: user?.name || 'Reader',
          userEmail: user?.email || 'customer@aathirai.com',
          userPhone: user?.phone,
          placeOfSupplyStateCode,
        }),
      });

      if (cancelledRef.current) return;

      const orderData = await orderRes.json().catch(() => ({}));
      if (!orderRes.ok) {
        throw new Error(orderData.error || 'Failed to initialize Razorpay checkout on server.');
      }

      const razorpayKeyId = orderData.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID || '';
      const createdOrderId = orderData.order_id || orderData.orderId || '';
      const createdSubscriptionId = orderData.subscription_id || orderData.subscriptionId || '';

      if (!razorpayKeyId || (!createdOrderId && !createdSubscriptionId)) {
        throw new Error('Server returned an incomplete Razorpay checkout payload.');
      }

      const verifyOnBackend = async (params: {
        razorpayOrderId?: string;
        razorpaySubscriptionId?: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
      }) => {
        setPhase('verifying');
        setStatusLabel('Verifying Razorpay payment...');

        const verifyRes = await fetch('/api/verify-payment', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            razorpay_order_id: params.razorpayOrderId || undefined,
            razorpay_subscription_id: params.razorpaySubscriptionId || undefined,
            razorpay_payment_id: params.razorpayPaymentId,
            razorpay_signature: params.razorpaySignature,
            razorpayOrderId: params.razorpayOrderId || undefined,
            razorpaySubscriptionId: params.razorpaySubscriptionId || undefined,
            razorpayPaymentId: params.razorpayPaymentId,
            razorpaySignature: params.razorpaySignature,
            userId: user?.id || 'usr_guest',
            customerName: user?.name || 'Reader',
            userEmail: user?.email || 'customer@aathirai.com',
            userPhone: user?.phone,
            userUpiId: user?.upiId,
            comicId,
            comicTitle,
            chapterId,
            episodeId,
            type: itemType,
            subscriptionPlan,
            amountInr,
            amount: orderData.amount || amountPaise,
            paymentMethod: params.razorpaySubscriptionId
              ? 'Razorpay Subscription Autopay'
              : 'Razorpay Standard Checkout',
            placeOfSupplyStateCode,
          }),
        });

        const verifyData = await verifyRes.json().catch(() => ({}));

        if (verifyRes.ok && verifyData.purchase) {
          if (verifyData.user) {
            updateUser(verifyData.user);
          }
          await syncPurchaseToFirestore({
            purchaseId: verifyData.purchase.id,
            comicId,
            itemTitle,
            planType: itemType === 'subscription' ? subscriptionPlan || '1_month' : itemType,
            amountInr,
            upiId: user?.upiId,
            paymentMethod: verifyData.purchase.paymentMethod || 'Razorpay Checkout',
            receiptNumber: verifyData.purchase.receiptNumber,
          }).catch(() => {});
          await refreshUser();
          setReceipt(verifyData.purchase);
          setPhase('receipt');
          onPaymentSuccess(verifyData.purchase);
        } else {
          throw new Error(verifyData.error || 'Cryptographic payment signature verification failed.');
        }
      };

      const checkoutOptions: Record<string, any> = {
        key: razorpayKeyId,
        name: 'Aathirai_Comic',
        description: `${comicTitle} — ${itemTitle}`,
        prefill: {
          name: user?.name || 'Reader',
          email: user?.email || '',
          contact: user?.phone || '',
        },
        notes: {
          comicId,
          type: itemType,
          ...(subscriptionPlan ? { subscriptionPlan } : {}),
          ...(user?.email ? { userEmail: user.email } : {}),
        },
        theme: {
          color: '#e11d48',
        },
        handler: async (response: {
          razorpay_order_id?: string;
          razorpay_subscription_id?: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          settledRef.current = true;
          try {
            await verifyOnBackend({
              razorpayOrderId: response.razorpay_order_id,
              razorpaySubscriptionId:
                response.razorpay_subscription_id || createdSubscriptionId || undefined,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
          } catch (err: any) {
            setError(err.message || 'Payment verification failed.');
            setPhase('error');
          }
        },
        modal: {
          ondismiss: () => {
            if (!settledRef.current) {
              setPhase('idle');
              onClose();
            }
          },
        },
      };

      if (createdSubscriptionId) {
        checkoutOptions.subscription_id = createdSubscriptionId;
      } else {
        checkoutOptions.amount = orderData.amount || amountPaise;
        checkoutOptions.currency = orderData.currency || 'INR';
        checkoutOptions.order_id = createdOrderId;
      }

      const rzp = new window.Razorpay(checkoutOptions);

      if (typeof rzp.on === 'function') {
        rzp.on('payment.failed', (failureRes: any) => {
          settledRef.current = true;
          const reason =
            failureRes?.error?.description ||
            failureRes?.error?.reason ||
            'Transaction was declined or failed inside Razorpay.';
          setError(`Payment failed: ${reason}`);
          setPhase('error');
        });
      }

      if (cancelledRef.current) return;

      // Hide our launcher completely and hand control directly to Razorpay's official modal
      setPhase('razorpay_open');
      rzp.open();
    } catch (err: any) {
      if (cancelledRef.current) return;
      setError(err.message || 'Unable to launch Razorpay Checkout. Please try again.');
      setPhase('error');
    }
  }, [
    amountInr,
    chapterId,
    comicId,
    comicTitle,
    episodeId,
    getAuthHeaders,
    gstSettings.stateCode,
    itemTitle,
    itemType,
    onClose,
    onPaymentSuccess,
    refreshUser,
    subscriptionPlan,
    updateUser,
    user?.email,
    user?.id,
    user?.name,
    user?.phone,
    user?.upiId,
  ]);

  // Auto-launch Razorpay directly as soon as isOpen becomes true (no intermediate popup)
  useEffect(() => {
    if (!isOpen) {
      cancelledRef.current = true;
      launchedSessionKeyRef.current = null;
      setPhase('idle');
      setError(null);
      setReceipt(null);
      return;
    }

    const sessionKey = `${comicId}:${itemType}:${subscriptionPlan || ''}:${chapterId || ''}:${episodeId || ''}:${amountInr}`;
    if (launchedSessionKeyRef.current === sessionKey) {
      return;
    }
    launchedSessionKeyRef.current = sessionKey;
    void launchDirectRazorpayCheckout();
  }, [
    isOpen,
    comicId,
    itemType,
    subscriptionPlan,
    chapterId,
    episodeId,
    amountInr,
    launchDirectRazorpayCheckout,
  ]);

  if (!isOpen || phase === 'idle' || phase === 'razorpay_open') {
    return null;
  }

  const isCustomerGstEnabled = Boolean(gstSettings.applyGstToDomesticSales);

  const handleDownloadPdfInvoice = (purchaseRecord: Purchase) => {
    try {
      const enriched = ensurePurchaseGstFields(purchaseRecord, gstSettings);
      const pdfBytes = generateTaxInvoicePdfBytes(enriched, gstSettings);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = isCustomerGstEnabled
        ? `Tax-Invoice-${enriched.invoiceNumber || enriched.receiptNumber}.pdf`
        : `Payment-Receipt-${enriched.receiptNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      console.error('Failed to download PDF receipt:', e);
    }
  };

  // Compact launcher / verification spinner while connecting to Razorpay
  if (phase === 'launching' || phase === 'verifying') {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-5 shadow-2xl flex items-center gap-3.5 max-w-sm w-full text-slate-900 dark:text-slate-100">
          <Loader2 className="w-5 h-5 text-rose-500 animate-spin shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">{statusLabel}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {itemTitle} · ₹{amountInr}
            </p>
          </div>
          {phase === 'launching' && (
            <button
              type="button"
              onClick={() => {
                cancelledRef.current = true;
                setPhase('idle');
                onClose();
              }}
              aria-label="Cancel checkout"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Compact error state with direct Retry button
  if (phase === 'error') {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-slate-900 dark:text-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Razorpay Checkout Could Not Complete
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words">
                  {error || 'Unable to complete Razorpay checkout. Please try again.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close error dialog"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void launchDirectRazorpayCheckout()}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Razorpay</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Verified Payment Receipt view after payment succeeds
  const enrichedReceipt = receipt ? ensurePurchaseGstFields(receipt, gstSettings) : null;
  if (!enrichedReceipt) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl relative text-slate-900 dark:text-slate-100 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-[#0c2340] text-white flex items-center justify-center font-black text-xs tracking-tighter">
              Rzp
            </div>
            <span className="font-extrabold text-xs uppercase tracking-wider text-slate-900 dark:text-white">
              Payment Verified
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Payment Verified!
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isCustomerGstEnabled
                ? 'Razorpay payment signature verified on the backend and your GST tax invoice is ready.'
                : 'Razorpay payment signature verified on the backend and your payment receipt is ready.'}
            </p>
          </div>

          <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
            {isCustomerGstEnabled ? (
              <>
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-slate-700 dark:text-slate-300">GST Invoice Number</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {enrichedReceipt.invoiceNumber || enrichedReceipt.receiptNumber}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Receipt Reference</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">{enrichedReceipt.receiptNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Order &amp; Payment ID</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {enrichedReceipt.razorpayOrderId} · {enrichedReceipt.razorpayPaymentId}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Item Purchased (SAC {enrichedReceipt.hsnSacCode})</span>
                  <span className="font-semibold text-slate-900 dark:text-white text-right">
                    {comicTitle} - {itemTitle}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Place of Supply</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {enrichedReceipt.placeOfSupplyStateCode} - {enrichedReceipt.placeOfSupplyStateName}
                  </span>
                </div>

                <div className="pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Base Price (Taxable Value)</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                      ₹{(enrichedReceipt.taxableValue ?? enrichedReceipt.amountInr).toFixed(2)}
                    </span>
                  </div>
                  {enrichedReceipt.taxType === 'CGST_SGST' && (
                    <>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">CGST ({enrichedReceipt.cgstRate}%)</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300">
                          ₹{(enrichedReceipt.cgstAmount || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">SGST ({enrichedReceipt.sgstRate}%)</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300">
                          ₹{(enrichedReceipt.sgstAmount || 0).toFixed(2)}
                        </span>
                      </div>
                    </>
                  )}
                  {enrichedReceipt.taxType === 'IGST' && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">IGST ({enrichedReceipt.igstRate}%)</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        ₹{(enrichedReceipt.igstAmount || 0).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {enrichedReceipt.taxType === 'NONE' && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">GST (0% Export / Exempt)</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">₹0.00</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-sm font-bold">
                  <span className="text-slate-900 dark:text-white">Total Paid (Inclusive of GST)</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                    ₹{enrichedReceipt.amountInr.toFixed(2)} INR
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-slate-700 dark:text-slate-300">Payment Receipt Number</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {enrichedReceipt.receiptNumber}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Order &amp; Payment ID</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {enrichedReceipt.razorpayOrderId} · {enrichedReceipt.razorpayPaymentId}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Item Purchased</span>
                  <span className="font-semibold text-slate-900 dark:text-white text-right">
                    {comicTitle} - {itemTitle}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Payment Method</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {enrichedReceipt.paymentMethod || 'Razorpay'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-sm font-bold">
                  <span className="text-slate-900 dark:text-white">Total Amount Paid</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                    ₹{enrichedReceipt.amountInr.toFixed(2)} INR
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleDownloadPdfInvoice(enrichedReceipt)}
              className="py-2.5 px-4 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4 text-amber-400" />
              <span>
                {isCustomerGstEnabled ? 'Download Tax Invoice (PDF)' : 'Download Payment Receipt (PDF)'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-md cursor-pointer"
            >
              <span>Start Reading Now</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
