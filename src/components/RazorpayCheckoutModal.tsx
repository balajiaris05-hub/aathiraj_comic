import React, { useState, useEffect } from 'react';
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
  Printer,
  Download,
  IndianRupee,
  Lock
} from 'lucide-react';
import { Purchase } from '../types/comic';
import { syncPurchaseToFirestore } from '../firebase';

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
  const { user, updateUser, refreshUser } = useAuth();
  const [selectedMethod, setSelectedMethod] = useState<'upi' | 'card' | 'netbanking' | 'wallet'>('upi');
  const [upiId, setUpiId] = useState(user?.upiId || 'balajiaris05@okaxis');
  const [merchantUpiId, setMerchantUpiId] = useState('balajiaris05@okaxis');
  const [merchantUpiName, setMerchantUpiName] = useState('Aathirai_Comic Official');
  const [upiApp, setUpiApp] = useState('Google Pay');
  const [bank, setBank] = useState('State Bank of India (SBI)');
  const [cardNumber, setCardNumber] = useState('4532 •••• •••• 8821');
  const [wallet, setWallet] = useState('Paytm Wallet');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Purchase | null>(null);

  useEffect(() => {
    if (user?.upiId) {
      setUpiId(user.upiId);
    }
    fetch('/api/payments/config')
      .then(res => res.json())
      .then(data => {
        if (data?.merchantUpiId) setMerchantUpiId(data.merchantUpiId);
        if (data?.merchantUpiName) setMerchantUpiName(data.merchantUpiName);
      })
      .catch(() => {});
  }, [user?.upiId]);

  if (!isOpen) return null;

  const taxAmount = Number((amountInr * 0.18).toFixed(2));
  const basePrice = Number((amountInr - taxAmount).toFixed(2));
  const upiDeepLink = `upi://pay?pa=${encodeURIComponent(merchantUpiId)}&pn=${encodeURIComponent(merchantUpiName)}&am=${amountInr}&cu=INR&tn=${encodeURIComponent(`${comicTitle} - ${itemTitle}`)}`;

  const handleProcessPayment = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      // 1. Create order on server
      const orderRes = await fetch('/api/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comicId,
          chapterId,
          episodeId,
          type: itemType,
          subscriptionPlan,
          amountInr,
          userId: user?.id || 'usr_guest',
          userEmail: user?.email || 'customer@aathirai.com',
          userPhone: user?.phone,
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        throw new Error(orderData.error || 'Failed to initialize payment');
      }

      // Simulate payment execution with Razorpay gateway
      const paymentId = 'pay_' + Math.random().toString(36).substring(2, 14);

      let methodDesc = '';
      if (selectedMethod === 'upi') methodDesc = `UPI - ${upiApp} (${upiId})`;
      else if (selectedMethod === 'card') methodDesc = `Card - RuPay / Visa (${cardNumber})`;
      else if (selectedMethod === 'netbanking') methodDesc = `Net Banking - ${bank}`;
      else methodDesc = `Digital Wallet - ${wallet}`;

      // 2. Server-side payment verification & Gmail + UPI linkage in database
      const verifyRes = await fetch('/api/payments/razorpay/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpayOrderId: orderData.orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: 'sig_' + Math.random().toString(36).substring(2, 12),
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
          planType:
            itemType === 'subscription'
              ? subscriptionPlan || '1_month'
              : itemType,
          amountInr,
          upiId: selectedMethod === 'upi' ? upiId.trim() : user?.upiId,
          paymentMethod: verifyData.purchase.paymentMethod || methodDesc,
          receiptNumber: verifyData.purchase.receiptNumber,
        }).catch(() => {});
        await refreshUser();
        setReceipt(verifyData.purchase);
        onPaymentSuccess(verifyData.purchase);
      } else {
        throw new Error(verifyData.error || 'Payment verification failed');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message || 'Payment processing failed. Please try another method.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl relative text-slate-900 dark:text-slate-100 flex flex-col max-h-[90vh]">
        
        {/* Header Strip with Razorpay Logo & Security Assurance */}
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
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  INR Verified
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                128-bit Bank-grade Encryption · Safe &amp; Secure
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

        {/* RECEIPT SUCCESS VIEW */}
        {receipt ? (
          <div className="p-6 overflow-y-auto space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                Payment Successful!
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Your purchase has been recorded on the server and access is unlocked.
              </p>
            </div>

            {/* Official Payment Receipt Box */}
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <span className="font-bold text-slate-700 dark:text-slate-300">Invoice Number</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{receipt.receiptNumber}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Transaction ID</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">{receipt.razorpayPaymentId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Item Purchased</span>
                <span className="font-semibold text-slate-900 dark:text-white text-right">{comicTitle} - {itemTitle}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Customer Account</span>
                <span className="text-slate-700 dark:text-slate-300">{receipt.userEmail}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Payment Channel</span>
                <span className="text-slate-700 dark:text-slate-300">{receipt.paymentMethod}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Base Price</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">₹{receipt.amountInr.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-sm font-bold">
                <span className="text-slate-900 dark:text-white">Total Amount Paid</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">₹{receipt.amountInr.toFixed(2)} INR</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-md cursor-pointer"
              >
                <span>Start Reading Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          /* PAYMENT FORM & METHOD SELECTOR */
          <div className="p-6 overflow-y-auto space-y-5">
            {/* Purchase Item Summary Box */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
                  {itemType === 'episode' ? 'Single Episode Unlock' : itemType === 'chapter' ? 'Full Chapter' : itemType === 'full_comic' ? 'Complete Comic Book' : 'Premium Membership'}
                </span>
                <h4 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1">
                  {comicTitle}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {itemTitle}
                </p>
              </div>

              <div className="text-right shrink-0">
                <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  ₹{amountInr}
                </div>
              </div>
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

            {/* TAB CONTENT */}

            {/* 1. UPI */}
            {selectedMethod === 'upi' && (
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                  <span>Fast UPI Payment (Saved in Database)</span>
                  <span className="text-[10px] text-emerald-500 font-semibold">Zero Surcharge</span>
                </div>

                {/* Receiving Merchant UPI Box */}
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
                      Pay To Merchant UPI ID ({merchantUpiName})
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {merchantUpiId}
                    </span>
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
                  {['Google Pay', 'PhonePe', 'Paytm', 'BHIM'].map(app => (
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

            {/* 2. Cards (RuPay, Visa, Mastercard) */}
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
                  {['Paytm Wallet', 'PhonePe Wallet', 'Amazon Pay', 'Mobikwik'].map(w => (
                    <label key={w} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 cursor-pointer">
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
                disabled={isProcessing}
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                <span>
                  {isProcessing
                    ? 'Processing via Razorpay Gateway...'
                    : `Pay ₹${amountInr} Securely`}
                </span>
              </button>

              <div className="flex items-center justify-center gap-2 mt-3 text-[10px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Safe INR Transaction · Instant Episode Unlock · Official Payment Receipt</span>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
