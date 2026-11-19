import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Sparkles,
  Check,
  CheckCircle2,
  Lock,
  ExternalLink
} from 'lucide-react';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';
import { Purchase } from '../types/comic';
import { processingClass } from '../utils/buttonLoading';

const RAZORPAY_PLAN_LINKS = {
  '1_month': {
    id: 'sub_U0DeTe3l42sQ9K',
    planId: 'plan_U0CwrDGonjUDN2',
    url: 'https://rzp.io/rzp/eMyTbngF',
  },
  '6_months': {
    id: 'sub_U0DEqhM6bgOd0h',
    planId: 'plan_U0DDDaA2ru0PLQ',
    url: 'https://rzp.io/rzp/E077NNn',
  },
} as const;

interface PremiumPageProps {
  openAuthModal: () => void;
  setCurrentTab: (tab: string) => void;
  redirectNotice?: string | null;
  onClearRedirectNotice?: () => void;
}

export const PremiumPage: React.FC<PremiumPageProps> = ({
  openAuthModal,
  setCurrentTab,
  redirectNotice,
  onClearRedirectNotice,
}) => {
  const { user, hasActivePremium, refreshUser, getAuthHeaders } = useAuth();

  const [verifyingGmail, setVerifyingGmail] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [awaitingPaymentInfo, setAwaitingPaymentInfo] = useState<string | null>(null);
  const [razorpayPaymentIdInput, setRazorpayPaymentIdInput] = useState('');
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<'1_month' | '6_months' | null>(null);
  const isMountedRef = useRef(true);
  const verifyingInFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleVerifyGmailAccess = async (explicitPaymentId?: string) => {
    if (!user) {
      openAuthModal();
      return;
    }
    if (verifyingInFlightRef.current) return;
    verifyingInFlightRef.current = true;
    setVerifyingGmail(true);
    setVerifyNotice(null);

    const payIdParam = (explicitPaymentId ?? razorpayPaymentIdInput).trim();
    const url = `/api/payments/verify-access?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(
      user.email
    )}&phone=${encodeURIComponent(user.phone || '')}${payIdParam ? `&paymentId=${encodeURIComponent(payIdParam)}` : ''}`;

    try {
      const headers = await getAuthHeaders();
      let res: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch(url, { cache: 'no-store', headers });
          break;
        } catch {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 450));
          }
        }
      }

      if (!res) {
        if (isMountedRef.current) {
          setVerifyNotice('Could not reach the verification server just now. Please tap Verify Payment Status again.');
        }
        return;
      }

      if (res.ok && isMountedRef.current) {
        const data = await res.json();
        await refreshUser();
        if (data.hasAccess && data.hasActiveSubscription) {
          setAwaitingPaymentInfo(null);
          if (data.razorpayVerified) {
            setBannerMsg(
              `Razorpay Payment Verified (${data.transactionId || data.activeReceipt || 'Active Pass'})! All paywalled comics are unlocked for ${user.email || user.phone}.`
            );
          }
        } else if (payIdParam) {
          setVerifyNotice(
            data.razorpayError ||
              `No captured Razorpay subscription found yet for Payment ID ${payIdParam}.`
          );
        }
      }
    } finally {
      verifyingInFlightRef.current = false;
      if (isMountedRef.current) {
        setVerifyingGmail(false);
      }
    }
  };

  useEffect(() => {
    if (user && (user.email || user.phone)) {
      handleVerifyGmailAccess();
    }
  }, [user?.id, user?.email, user?.phone]);

  useEffect(() => {
    if (!awaitingPaymentInfo || !user || (!user.email && !user.phone)) return;
    const onFocus = () => {
      handleVerifyGmailAccess();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [awaitingPaymentInfo, user?.id, user?.email, user?.phone]);

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-24">
      {redirectNotice && !hasActivePremium && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-slate-900 dark:text-amber-100 flex items-start justify-between gap-4 max-w-4xl mx-auto">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs sm:text-sm">
              <div className="font-extrabold">Premium Verification Required</div>
              <p className="text-slate-700 dark:text-amber-200/90">{redirectNotice}</p>
            </div>
          </div>
          {onClearRedirectNotice && (
            <button
              type="button"
              onClick={onClearRedirectNotice}
              className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-amber-300 dark:hover:text-white shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
      
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Aathirai Gmail-Verified Premium Membership</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white font-heading">
          1 Month (₹49) &amp; 6 Months (₹249) Premium Pass
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Connect your reader Gmail &amp; mobile number to unlock all paywalled comics, chapters, and episodes. Every time you open a paywalled comic, your Gmail payment status is verified automatically.
        </p>
      </div>

      {verifyNotice && (
        <div className="max-w-4xl mx-auto p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center justify-between gap-3">
          <span>{verifyNotice}</span>
          <button
            type="button"
            disabled={verifyingGmail}
            aria-busy={verifyingGmail}
            data-loading={verifyingGmail ? 'true' : 'false'}
            onClick={() => handleVerifyGmailAccess()}
            className={processingClass(
              verifyingGmail,
              'px-3 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold text-[11px] shrink-0 cursor-pointer disabled:cursor-not-allowed'
            )}
          >
            {verifyingGmail ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}

      {awaitingPaymentInfo && !hasActivePremium && (
        <div className="max-w-4xl mx-auto p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-700 dark:text-sky-300 text-xs font-semibold space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span>{awaitingPaymentInfo}</span>
            <button
              type="button"
              onClick={() => handleVerifyGmailAccess()}
              disabled={verifyingGmail}
              aria-busy={verifyingGmail}
              data-loading={verifyingGmail ? 'true' : 'false'}
              className={processingClass(
                verifyingGmail,
                'px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] shrink-0 cursor-pointer disabled:cursor-not-allowed'
              )}
            >
              {verifyingGmail ? 'Verifying Payment...' : 'Verify Payment Status Now'}
            </button>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-sky-500/20">
            <input
              type="text"
              placeholder="Optional: Paste Razorpay Payment ID (pay_...)"
              value={razorpayPaymentIdInput}
              onChange={(e) => setRazorpayPaymentIdInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-950 border border-sky-500/30 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={() => handleVerifyGmailAccess(razorpayPaymentIdInput)}
              disabled={verifyingGmail || !razorpayPaymentIdInput.trim()}
              aria-busy={verifyingGmail}
              data-loading={verifyingGmail ? 'true' : 'false'}
              className={processingClass(
                verifyingGmail,
                'px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 font-extrabold text-[11px] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0'
              )}
            >
              {verifyingGmail ? 'Verifying ID...' : 'Verify Razorpay ID'}
            </button>
          </div>
        </div>
      )}

      {bannerMsg && (
        <div className="max-w-4xl mx-auto p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{bannerMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setCurrentTab('books')}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold cursor-pointer"
          >
            Read Paywalled Comics Now →
          </button>
        </div>
      )}

      {/* ONLY TWO PREMIUM PLANS: 1 MONTH (₹49) & 6 MONTHS (₹249) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        
        {/* PLAN 1: 1 MONTH PREMIUM — ₹49 */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 hover:border-rose-500/60 shadow-lg space-y-6 flex flex-col justify-between transition-all">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                1 Month Premium Pass
              </span>
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                30 Days Validity
              </span>
            </div>

            <div className="flex items-baseline gap-1.5 font-mono">
              <span className="text-4xl font-black text-slate-900 dark:text-white">₹49</span>
              <span className="text-xs text-slate-500 font-semibold">/ 1 Month</span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Full unlimited access to all paywalled comics, chapters, and episodes for 1 month (30 days), linked directly to your Gmail account.
            </p>

            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-2">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Unlocks 100% of paywalled comics &amp; chapters for 1 Month</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Connected to your Gmail for automatic verification every time</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Instant UPI (Google Pay, PhonePe, Paytm) &amp; Card checkout</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Official payment receipt &amp; 70% creator revenue support</span>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            {hasActivePremium ? (
              <button
                type="button"
                disabled
                className={`w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all ${
                  user?.premiumPlan === '1_month'
                    ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                }`}
              >
                {user?.premiumPlan === '1_month'
                  ? `✓ Active Until ${
                      user?.premiumExpiresAt
                        ? new Date(user.premiumExpiresAt).toLocaleDateString()
                        : 'Expiry'
                    } · Choose After Plan Ends`
                  : `Available After Current Plan Ends (${
                      user?.premiumExpiresAt
                        ? new Date(user.premiumExpiresAt).toLocaleDateString()
                        : ''
                    })`}
              </button>
            ) : !user ? (
              <button
                type="button"
                onClick={openAuthModal}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20 hover:scale-[1.02] cursor-pointer"
              >
                Subscribe 1 Month Premium — ₹49
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setCheckoutPlan('1_month')}
                  className="w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20 hover:scale-[1.02] cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <span>Subscribe 1 Month Premium — ₹49</span>
                </button>
                <div className="text-center">
                  <a
                    href={RAZORPAY_PLAN_LINKS['1_month'].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      setAwaitingPaymentInfo(
                        `Razorpay hosted page opened for 1 Month Pass (₹49). Complete payment using your registered email (${user.email}) or phone, then click "Verify Payment Status Now".`
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-rose-500 dark:text-slate-400"
                  >
                    <span>Prefer Razorpay hosted page?</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PLAN 2: 6 MONTHS PREMIUM — ₹249 */}
        <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-amber-500/10 via-slate-900 to-slate-900 border-2 border-amber-500/70 shadow-2xl space-y-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-4 right-4">
            <span className="px-2.5 py-1 rounded-md text-[10px] font-extrabold bg-amber-500 text-slate-950 uppercase tracking-wider shadow-sm">
              Best Value · Save ₹45
            </span>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                6 Months Premium Pass
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                180 Days Validity
              </span>
            </div>

            <div className="flex items-baseline gap-1.5 font-mono">
              <span className="text-4xl font-black text-white">₹249</span>
              <span className="text-xs text-slate-300 font-semibold">/ 6 Months</span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Half-year all-access pass! Read every paywalled comic, chapter, and premiere episode for 6 full months (180 days), verified via your Gmail.
            </p>

            <ul className="space-y-2.5 text-xs text-slate-200 pt-2">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Unlocks 100% of paywalled comics &amp; chapters for 6 Months</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Real-time Gmail &amp; Mobile verification on every comic load</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>High-definition 4K manga &amp; webtoon reading mode</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Priority VIP Reader badge &amp; official payment receipt</span>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            {hasActivePremium ? (
              <button
                type="button"
                disabled
                className={`w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-xl transition-all ${
                  user?.premiumPlan === '6_months'
                    ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
                    : 'bg-slate-800 text-slate-400 cursor-not-allowed'
                }`}
              >
                {user?.premiumPlan === '6_months'
                  ? `✓ Active Until ${
                      user?.premiumExpiresAt
                        ? new Date(user.premiumExpiresAt).toLocaleDateString()
                        : 'Expiry'
                    } · Choose After Plan Ends`
                  : `Available After Current Plan Ends (${
                      user?.premiumExpiresAt
                        ? new Date(user.premiumExpiresAt).toLocaleDateString()
                        : ''
                    })`}
              </button>
            ) : !user ? (
              <button
                type="button"
                onClick={openAuthModal}
                className="w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-xl transition-all bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 hover:scale-[1.02] cursor-pointer"
              >
                Subscribe 6 Months Premium — ₹249
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setCheckoutPlan('6_months')}
                  className="w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-xl transition-all bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 hover:scale-[1.02] cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <span>Subscribe 6 Months Premium — ₹249</span>
                </button>
                <div className="text-center">
                  <a
                    href={RAZORPAY_PLAN_LINKS['6_months'].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      setAwaitingPaymentInfo(
                        `Razorpay hosted page opened for 6 Months Pass (₹249). Complete payment using your registered email (${user.email}) or phone, then click "Verify Payment Status Now".`
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-amber-300"
                  >
                    <span>Prefer Razorpay hosted page?</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {checkoutPlan && (
        <RazorpayCheckoutModal
          isOpen={Boolean(checkoutPlan)}
          onClose={() => setCheckoutPlan(null)}
          comicId="global_subscription"
          comicTitle="Aathirai_Comic Premium Pass"
          itemTitle={
            checkoutPlan === '6_months'
              ? '6 Months All-Access Premium (180 Days)'
              : '1 Month All-Access Premium (30 Days)'
          }
          itemType="subscription"
          subscriptionPlan={checkoutPlan}
          amountInr={checkoutPlan === '6_months' ? 249 : 49}
          hostedPaymentUrl={RAZORPAY_PLAN_LINKS[checkoutPlan].url}
          onPaymentSuccess={async (purchase: Purchase) => {
            setAwaitingPaymentInfo(null);
            await refreshUser();
            setBannerMsg(
              `Razorpay Payment Verified (${purchase.receiptNumber || purchase.razorpayPaymentId})! All paywalled comics are now unlocked.`
            );
          }}
        />
      )}

    </div>
  );
};
