import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  QrCode,
  Smartphone,
  Building2,
  Wallet,
  ArrowRight,
  Lock,
  AlertTriangle,
  Download,
  FileText,
} from 'lucide-react';
import { Purchase, GstBusinessSettings } from '../types/comic';
import { syncPurchaseToFirestore } from '../firebase';
import {
  INDIAN_STATES_AND_UTS,
  DEFAULT_GST_SETTINGS,
  calculateInclusiveGstBreakdown,
  validateIndianGstin,
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
  const [selectedMethod, setSelectedMethod] = useState<'upi' | 'card' | 'netbanking' | 'wallet'>('upi');
  const [upiId, setUpiId] = useState(user?.upiId || 'balajiaris05@okaxis');
  const [merchantUpiId, setMerchantUpiId] = useState('balajiaris05@okaxis');
  const [merchantUpiName, setMerchantUpiName] = useState('Aathirai_Comic Official');
  const [paymentMode, setPaymentMode] = useState<'unconfigured' | 'test' | 'live'>('test');
  const [gatewayMessage, setGatewayMessage] = useState<string>('');
  const [upiApp, setUpiApp] = useState('Google Pay');
  const [bank, setBank] = useState('State Bank of India (SBI)');
  const [cardNumber, setCardNumber] = useState('4532 •••• •••• 8821');
  const [wallet, setWallet] = useState('Paytm Wallet');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Purchase | null>(null);

  // GST & Place-of-Supply State
  const [gstSettings, setGstSettings] = useState<GstBusinessSettings>(DEFAULT_GST_SETTINGS);
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState<string>('33');
  const [customerGstin, setCustomerGstin] = useState<string>('');

  useEffect(() => {
    if (user?.upiId) {
      setUpiId(user.upiId);
    }
    fetch('/api/payments/config')
      .then((res) => res.json())
      .then((data) => {
        if (data?.merchantUpiId) setMerchantUpiId(data.merchantUpiId);
        if (data?.merchantUpiName) setMerchantUpiName(data.merchantUpiName);
        const normalizedMode = String(data?.modeLower || data?.mode || 'test').toLowerCase();
        if (normalizedMode === 'live' || normalizedMode === 'test' || normalizedMode === 'unconfigured') {
          setPaymentMode(normalizedMode);
        }
        if (data?.statusMessage || data?.message) {
          setGatewayMessage(data.statusMessage || data.message);
        }
        if (data?.gstConfig) {
          setGstSettings((prev) => ({ ...prev, ...data.gstConfig }));
          if (data.gstConfig.stateCode) {
            setPlaceOfSupplyStateCode(data.gstConfig.stateCode);
          }
        }
      })
      .catch(() => {});
  }, [user?.upiId, isOpen]);

  const liveGstBreakdown = useMemo(
    () => calculateInclusiveGstBreakdown(amountInr, placeOfSupplyStateCode, gstSettings),
    [amountInr, placeOfSupplyStateCode, gstSettings]
  );

  const gstinValidation = useMemo(
    () => validateIndianGstin(customerGstin),
    [customerGstin]
  );

  if (!isOpen) return null;

  const upiDeepLink = `upi://pay?pa=${encodeURIComponent(merchantUpiId)}&pn=${encodeURIComponent(
    merchantUpiName
  )}&am=${amountInr}&cu=INR&tn=${encodeURIComponent(`${comicTitle} - ${itemTitle}`)}`;

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

  const handleProcessPayment = async () => {
    if (paymentMode === 'unconfigured') {
      setError(
        gatewayMessage ||
          'Razorpay payment gateway credentials are not configured on the backend. Checkout is disabled.'
      );
      return;
    }

    if (customerGstin.trim() && !gstinValidation.isValid) {
      setError(gstinValidation.error || 'Invalid Customer B2B GSTIN format.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      let methodDesc = '';
      if (selectedMethod === 'upi') methodDesc = `UPI - ${upiApp} (${upiId})`;
      else if (selectedMethod === 'card') methodDesc = `Card - RuPay / Visa (${cardNumber})`;
      else if (selectedMethod === 'netbanking') methodDesc = `Net Banking - ${bank}`;
      else methodDesc = `Digital Wallet - ${wallet}`;

      // 1. Create order on backend (server determines TEST vs LIVE mode and computes GST-inclusive breakdown)
      const orderRes = await fetch('/api/payments/razorpay/create-order', {
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
          userId: user?.id || 'usr_guest',
          userEmail: user?.email || 'customer@aathirai.com',
          userPhone: user?.phone,
          paymentMethod: methodDesc,
          placeOfSupplyStateCode,
          customerGstin: customerGstin.trim() ? gstinValidation.normalized : undefined,
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        throw new Error(orderData.error || 'Failed to initialize Razorpay order on server');
      }

      const verifyOnBackend = async (params: {
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
      }) => {
        const verifyRes = await fetch('/api/payments/razorpay/verify-payment', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            razorpayOrderId: params.razorpayOrderId,
            razorpayPaymentId: params.razorpayPaymentId,
            razorpaySignature: params.razorpaySignature,
            userId: user?.id || 'usr_guest',
            userEmail: user?.email || 'customer@aathirai.com',
            userPhone: user?.phone,
            userUpiId: selectedMethod === 'upi' ? upiId.trim() : user?.upiId,
            comicId,
            comicTitle,
            chapterId,
            episodeId,
            type: itemType,
            subscriptionPlan,
            amountInr,
            paymentMethod: methodDesc,
            placeOfSupplyStateCode,
            customerGstin: customerGstin.trim() ? gstinValidation.normalized : undefined,
          }),
        });

        const verifyData = await verifyRes.json();
        setIsProcessing(false);

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
            upiId: selectedMethod === 'upi' ? upiId.trim() : user?.upiId,
            paymentMethod: verifyData.purchase.paymentMethod || methodDesc,
            receiptNumber: verifyData.purchase.receiptNumber,
          }).catch(() => {});
          await refreshUser();
          setReceipt(verifyData.purchase);
          onPaymentSuccess(verifyData.purchase);
        } else {
          throw new Error(verifyData.error || 'Cryptographic payment signature verification failed');
        }
      };

      const orderMode = String(orderData.modeLower || orderData.mode || 'test').toLowerCase();

      // 2. If LIVE mode and official Razorpay SDK is available, launch real Razorpay Checkout modal
      if (orderMode === 'live' && typeof window !== 'undefined' && window.Razorpay) {
        const rzp = new window.Razorpay({
          key: orderData.keyId,
          amount: orderData.amount,
          currency: 'INR',
          name: 'Aathirai_Comic',
          description: `${comicTitle} - ${itemTitle}`,
          order_id: orderData.orderId,
          prefill: {
            name: user?.name || 'Reader',
            email: user?.email || '',
            contact: user?.phone || '',
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await verifyOnBackend({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
            } catch (err: any) {
              setIsProcessing(false);
              setError(err.message || 'Payment verification failed.');
            }
          },
          modal: {
            ondismiss: () => {
              setIsProcessing(false);
            },
          },
        });
        rzp.open();
        return;
      }

      // 3. In explicit TEST MODE, authorize test order via server-side test gateway endpoint
      if (orderMode === 'test' && orderData.testGatewayAuth) {
        await verifyOnBackend({
          razorpayOrderId: orderData.orderId,
          razorpayPaymentId: orderData.testGatewayAuth.paymentId,
          razorpaySignature: orderData.testGatewayAuth.signature,
        });
        return;
      }

      throw new Error('Razorpay checkout could not be initialized in the current environment.');
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message || 'Payment processing failed. Please try another method.');
    }
  };

  const enrichedReceipt = receipt ? ensurePurchaseGstFields(receipt, gstSettings) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl relative text-slate-900 dark:text-slate-100 flex flex-col max-h-[90vh]">
        {/* Header Strip with Razorpay Logo & Mode Indicator */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[#0c2340] text-white flex items-center justify-center font-black text-xs tracking-tighter">
              Rzp
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-xs uppercase tracking-wider text-slate-900 dark:text-white">
                  Razorpay Checkout
                </span>
                {paymentMode === 'live' ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    LIVE MODE · INR
                  </span>
                ) : paymentMode === 'test' ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    TEST MODE · SANDBOX
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                    UNCONFIGURED
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {isCustomerGstEnabled
                  ? 'HMAC-SHA256 Server Signature Verification · GST-Inclusive Billing (SAC 998431)'
                  : 'HMAC-SHA256 Server Signature Verification · Direct Payment (No GST)'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* EXPLICIT TEST / UNCONFIGURED MODE BANNERS */}
        {paymentMode === 'test' && (
          <div className="px-6 py-2.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              TEST MODE ACTIVE: No real money will be charged. Transactions are recorded in the test environment with HMAC-SHA256 verification.
            </span>
          </div>
        )}

        {paymentMode === 'unconfigured' && (
          <div className="px-6 py-3 bg-rose-500/15 border-b border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>
              Payment Unavailable: Razorpay credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) are not configured on the server.
            </span>
          </div>
        )}

        {/* RECEIPT SUCCESS VIEW */}
        {enrichedReceipt ? (
          <div className="p-6 overflow-y-auto space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                Payment Verified ({enrichedReceipt.environment === 'live' ? 'LIVE' : 'TEST MODE'})!
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isCustomerGstEnabled
                  ? 'HMAC-SHA256 signature verified on the backend and your GST tax invoice is ready.'
                  : 'HMAC-SHA256 signature verified on the backend and your payment receipt (No GST) is ready.'}
              </p>
            </div>

            {/* Official Payment Receipt / GST Tax Invoice Box */}
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
                  {enrichedReceipt.customerGstin && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Customer B2B GSTIN</span>
                      <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                        {enrichedReceipt.customerGstin}
                      </span>
                    </div>
                  )}

                  {/* GST Breakdown inside Receipt */}
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
                      {enrichedReceipt.paymentMethod || 'UPI'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Tax Status</span>
                    <span className="font-mono font-bold text-slate-600 dark:text-slate-400">
                      No GST
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
        ) : (
          /* PAYMENT FORM & METHOD SELECTOR */
          <div className="p-6 overflow-y-auto space-y-5">
            {/* Purchase Item Summary & Optional GST-Inclusive Breakdown Box */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
                    {itemType === 'episode'
                      ? 'Single Episode Unlock'
                      : itemType === 'chapter'
                        ? 'Full Chapter'
                        : itemType === 'full_comic'
                          ? 'Complete Comic Book'
                          : 'Premium Membership'}
                  </span>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1">{comicTitle}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{itemTitle}</p>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">₹{amountInr}</div>
                  {isCustomerGstEnabled ? (
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Inclusive of {liveGstBreakdown.taxRate}% GST
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      Total Payable (No GST)
                    </span>
                  )}
                </div>
              </div>

              {isCustomerGstEnabled && (
                <>
                  {/* Place of Supply & Optional B2B Customer GSTIN */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Place of Supply (State / Territory)
                      </label>
                      <select
                        value={placeOfSupplyStateCode}
                        onChange={(e) => setPlaceOfSupplyStateCode(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                      >
                        {INDIAN_STATES_AND_UTS.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.code} - {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Customer B2B GSTIN (Optional)
                      </label>
                      <input
                        type="text"
                        maxLength={15}
                        value={customerGstin}
                        onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
                        placeholder="Optional 15-digit GSTIN"
                        className="w-full px-2.5 py-1.5 text-xs font-mono uppercase rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                      />
                    </div>
                  </div>

                  {/* Transparent GST-Inclusive Breakdown Box */}
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-slate-500">
                      <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                        <FileText className="w-3 h-3 text-amber-500" />
                        <span>GST Tax Breakdown (SAC {liveGstBreakdown.hsnSacCode})</span>
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {liveGstBreakdown.supplyType} · {liveGstBreakdown.taxType === 'CGST_SGST' ? 'Intra-State (CGST+SGST)' : liveGstBreakdown.taxType === 'IGST' ? 'Inter-State (IGST)' : 'Zero-Rated / Exempt'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Base Price (Taxable Value = Total - GST)</span>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        ₹{liveGstBreakdown.taxableValue.toFixed(2)}
                      </span>
                    </div>
                    {liveGstBreakdown.taxType === 'CGST_SGST' ? (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">
                          Included GST ({liveGstBreakdown.cgstRate}% CGST ₹{liveGstBreakdown.cgstAmount.toFixed(2)} + {liveGstBreakdown.sgstRate}% SGST ₹{liveGstBreakdown.sgstAmount.toFixed(2)})
                        </span>
                        <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                          ₹{liveGstBreakdown.taxAmount.toFixed(2)}
                        </span>
                      </div>
                    ) : liveGstBreakdown.taxType === 'IGST' ? (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">
                          Included IGST ({liveGstBreakdown.igstRate}%)
                        </span>
                        <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                          ₹{liveGstBreakdown.taxAmount.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Included GST (0% Applicable)</span>
                        <span className="font-mono font-semibold text-slate-500">₹0.00</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 font-bold text-slate-900 dark:text-white">
                      <span>Final Payable Amount (Inclusive of GST)</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400">
                        ₹{liveGstBreakdown.totalAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Indian Payment Method Tabs */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                Select Indian Payment Method
              </label>

              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMethod('upi')}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-colors ${
                    selectedMethod === 'upi'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-600 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>UPI Pay</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMethod('card')}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-colors ${
                    selectedMethod === 'card'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-600 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Card</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMethod('netbanking')}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-colors ${
                    selectedMethod === 'netbanking'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-600 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>Net Banking</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMethod('wallet')}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-colors ${
                    selectedMethod === 'wallet'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-600 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Wallet className="w-4 h-4" />
                  <span>Wallets</span>
                </button>
              </div>
            </div>

            {/* 1. UPI */}
            {selectedMethod === 'upi' && (
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                  <span>Fast UPI Payment (Saved in Firestore)</span>
                  <span className="text-[10px] text-emerald-500 font-semibold">Zero Surcharge</span>
                </div>

                {/* Receiving Merchant UPI Box */}
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
                      Pay To Merchant UPI ID ({merchantUpiName})
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">{merchantUpiId}</span>
                  </div>
                  <a
                    href={upiDeepLink}
                    className="py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shrink-0 flex items-center gap-1"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Open UPI App (₹{amountInr})</span>
                  </a>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {['Google Pay', 'PhonePe', 'Paytm', 'BHIM'].map((app) => (
                    <button
                      key={app}
                      type="button"
                      onClick={() => setUpiApp(app)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors ${
                        upiApp === app
                          ? 'bg-white dark:bg-slate-800 border-rose-500 text-rose-600 dark:text-rose-400 shadow-sm'
                          : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {app}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Customer Paying UPI ID / VPA (Stored in Database)
                  </label>
                  <input
                    type="text"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="reader@okaxis or mobile@ybl"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Your UPI ID is linked to your Gmail account in the Admin database for instant paywall verification.
                  </span>
                </div>
              </div>
            )}

            {/* 2. Cards */}
            {selectedMethod === 'card' && (
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                  <span>RuPay, Visa, Mastercard, Maestro</span>
                  <span className="text-[10px] font-semibold text-blue-500">RBI 2FA Secured</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Card Number
                  </label>
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Expiry (MM/YY)
                    </label>
                    <input
                      type="text"
                      defaultValue="08/29"
                      placeholder="MM/YY"
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      CVV
                    </label>
                    <input
                      type="password"
                      defaultValue="821"
                      maxLength={4}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 3. Net Banking */}
            {selectedMethod === 'netbanking' && (
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Select Indian Bank
                </label>
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option>State Bank of India (SBI)</option>
                  <option>HDFC Bank</option>
                  <option>ICICI Bank</option>
                  <option>Axis Bank</option>
                  <option>Indian Bank</option>
                  <option>Punjab National Bank (PNB)</option>
                  <option>Bank of Baroda</option>
                  <option>Kotak Mahindra Bank</option>
                  <option>Canara Bank</option>
                </select>
                <p className="text-[10px] text-slate-400">
                  Redirects to your bank's secure net banking authorization portal.
                </p>
              </div>
            )}

            {/* 4. Digital Wallets */}
            {selectedMethod === 'wallet' && (
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Select Wallet
                </label>
                <div className="space-y-2">
                  {['Paytm Wallet', 'PhonePe Wallet', 'Amazon Pay', 'Mobikwik'].map((w) => (
                    <label
                      key={w}
                      className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="wallet"
                        checked={wallet === w}
                        onChange={() => setWallet(w)}
                        className="text-rose-600 focus:ring-rose-500"
                      />
                      <span className="text-xs font-medium">{w}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Submit Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleProcessPayment}
                disabled={isProcessing || paymentMode === 'unconfigured'}
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>
                  {paymentMode === 'unconfigured'
                    ? 'Payment Gateway Unconfigured'
                    : isProcessing
                      ? 'Verifying HMAC-SHA256 Signature...'
                      : paymentMode === 'test'
                        ? isCustomerGstEnabled
                          ? `Authorize Test Payment ₹${amountInr} (Incl. GST · No Real Charge)`
                          : `Authorize Test Payment ₹${amountInr} (No Real Charge)`
                        : isCustomerGstEnabled
                          ? `Pay ₹${amountInr} Securely (Incl. GST)`
                          : `Pay ₹${amountInr} Securely`}
                </span>
              </button>

              <div className="flex items-center justify-center gap-2 mt-3 text-[10px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>
                  {isCustomerGstEnabled
                    ? 'HMAC-SHA256 Verified · GST Tax Invoice (PDF) · Instant Episode Unlock'
                    : 'HMAC-SHA256 Verified · Official Payment Receipt (PDF) · Instant Episode Unlock'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
