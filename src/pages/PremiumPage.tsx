import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Sparkles,
  Check,
  IndianRupee,
  ShieldCheck,
  Mail,
  Phone,
  CheckCircle2,
  Clock,
  RefreshCw,
  Lock,
  Unlock,
  UserCheck
} from 'lucide-react';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';

interface PremiumPageProps {
  openAuthModal: () => void;
  setCurrentTab: (tab: string) => void;
}

export const PremiumPage: React.FC<PremiumPageProps> = ({ openAuthModal, setCurrentTab }) => {
  const { user, hasActivePremium, refreshUser } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<{
    open: boolean;
    planKey: '1_month' | '6_months';
    title: string;
    amountInr: number;
  }>({
    open: false,
    planKey: '1_month',
    title: '1 Month Premium Pass (30 Days)',
    amountInr: 49,
  });

  const [verifyingGmail, setVerifyingGmail] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    verifiedAt?: string;
    hasActiveSubscription?: boolean;
    activePlan?: '1_month' | '6_months' | null;
    expiresAt?: string;
    activeReceipt?: string;
    verifiedGmail?: string | null;
  } | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const handleVerifyGmailAccess = async () => {
    if (!user) {
      openAuthModal();
      return;
    }
    setVerifyingGmail(true);
    try {
      const res = await fetch(
        `/api/payments/verify-access?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}&phone=${encodeURIComponent(user.phone || '')}`
      );
      const data = await res.json();
      if (res.ok) {
        setVerificationResult(data);
        await refreshUser();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVerifyingGmail(false);
    }
  };

  useEffect(() => {
    if (user?.email) {
      handleVerifyGmailAccess();
    }
  }, [user?.id, user?.email]);

  const openPlanCheckout = (planKey: '1_month' | '6_months', title: string, amountInr: number) => {
    if (!user) {
      openAuthModal();
      return;
    }
    if (hasActivePremium) {
      return;
    }
    setSelectedPlan({
      open: true,
      planKey,
      title,
      amountInr,
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-24">
      
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

      {/* Connected Reader Gmail & Real-Time Payment Verification Card */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 max-w-4xl mx-auto">
        <div className="flex items-start gap-3.5">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
            hasActivePremium
              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-500 border border-rose-500/30'
          }`}>
            {hasActivePremium ? <Unlock className="w-5 h-5" /> : <Mail className="w-5 h-5" />}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                {user ? 'Connected Reader Account (Gmail Verified)' : 'Reader Account Not Signed In'}
              </span>
              {user && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  hasActivePremium
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                }`}>
                  {hasActivePremium
                    ? `✓ ACTIVE PREMIUM (${user.premiumPlan === '6_months' ? '6 Months · ₹249' : '1 Month · ₹49'})`
                    : 'FREE READER (NO ACTIVE PASS)'}
                </span>
              )}
            </div>

            {user ? (
              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1 font-mono font-semibold text-rose-600 dark:text-rose-400">
                    <Mail className="w-3.5 h-3.5" /> {user.email}
                  </span>
                  {user.phone && (
                    <span className="flex items-center gap-1 font-mono text-slate-500">
                      <Phone className="w-3.5 h-3.5" /> {user.phone}
                    </span>
                  )}
                </div>
                {hasActivePremium && user.premiumExpiresAt ? (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 pt-0.5">
                    <Clock className="w-3 h-3" />
                    <span>
                      Paywall Unlocked! Valid until {new Date(user.premiumExpiresAt).toLocaleDateString()} ({verificationResult?.activeReceipt ? `Receipt: ${verificationResult.activeReceipt}` : 'Verified via Gmail'})
                    </span>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Subscribe to the ₹49 (1 Month) or ₹249 (6 Months) plan below to unlock all paywalled comics on <strong className="text-slate-800 dark:text-slate-200">{user.email}</strong>.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Please log in with your Gmail or Mobile Number so your Premium subscription is linked and tracked.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
          {user ? (
            <>
              <button
                type="button"
                onClick={handleVerifyGmailAccess}
                disabled={verifyingGmail}
                className="py-2 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${verifyingGmail ? 'animate-spin text-rose-500' : ''}`} />
                <span>{verifyingGmail ? 'Verifying Gmail...' : 'Verify Payment Status'}</span>
              </button>
              <button
                type="button"
                onClick={() => setCurrentTab('reader_profile')}
                className="py-2 px-3.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Reader Profile</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentTab('reader_login')}
              className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md"
            >
              Reader Login / Register
            </button>
          )}
        </div>
      </div>

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

          <button
            type="button"
            disabled={hasActivePremium}
            onClick={() => openPlanCheckout('1_month', '1 Month Premium Pass (30 Days)', 49)}
            className={`w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all ${
              hasActivePremium
                ? user?.premiumPlan === '1_month'
                  ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20 hover:scale-[1.02] cursor-pointer'
            }`}
          >
            {hasActivePremium
              ? user?.premiumPlan === '1_month'
                ? `✓ Active Until ${
                    user?.premiumExpiresAt
                      ? new Date(user.premiumExpiresAt).toLocaleDateString()
                      : 'Expiry'
                  } · Choose After Plan Ends`
                : `Available After Current Plan Ends (${
                    user?.premiumExpiresAt
                      ? new Date(user.premiumExpiresAt).toLocaleDateString()
                      : ''
                  })`
              : 'Subscribe 1 Month Premium — ₹49'}
          </button>
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

          <button
            type="button"
            disabled={hasActivePremium}
            onClick={() => openPlanCheckout('6_months', '6 Months Premium Pass (180 Days)', 249)}
            className={`w-full py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-xl transition-all ${
              hasActivePremium
                ? user?.premiumPlan === '6_months'
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
                  : 'bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 hover:scale-[1.02] cursor-pointer'
            }`}
          >
            {hasActivePremium
              ? user?.premiumPlan === '6_months'
                ? `✓ Active Until ${
                    user?.premiumExpiresAt
                      ? new Date(user.premiumExpiresAt).toLocaleDateString()
                      : 'Expiry'
                  } · Choose After Plan Ends`
                : `Available After Current Plan Ends (${
                    user?.premiumExpiresAt
                      ? new Date(user.premiumExpiresAt).toLocaleDateString()
                      : ''
                  })`
              : 'Subscribe 6 Months Premium — ₹249'}
          </button>
        </div>

      </div>

      {/* RAZORPAY CHECKOUT MODAL */}
      {selectedPlan.open && (
        <RazorpayCheckoutModal
          isOpen={selectedPlan.open}
          onClose={() => setSelectedPlan({ ...selectedPlan, open: false })}
          comicId="global_subscription"
          comicTitle={`Aathirai ${selectedPlan.planKey === '6_months' ? '6 Months' : '1 Month'} Premium Pass`}
          itemTitle={selectedPlan.title}
          itemType="subscription"
          subscriptionPlan={selectedPlan.planKey}
          amountInr={selectedPlan.amountInr}
          onPaymentSuccess={async () => {
            await refreshUser();
            await handleVerifyGmailAccess();
            setBannerMsg(
              `Success! Your ${selectedPlan.planKey === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)'} Premium Pass is now linked to ${user?.email} and verified for all paywalled comics!`
            );
          }}
        />
      )}

    </div>
  );
};
