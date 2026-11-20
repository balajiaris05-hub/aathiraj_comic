import React, { useState, useEffect, useRef } from 'react';
import {
  KeyRound,
  Mail,
  Phone,
  ShieldAlert,
  CheckCircle2,
  Clock,
  RotateCcw,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import {
  sendFirebaseSmsOtp,
  verifyFirebaseSmsOtp,
  clearRecaptchaVerifier,
  listenForDeviceSmsOtp,
  ConfirmationResult,
} from '../firebase';
import { processingClass } from '../utils/buttonLoading';
import { User } from '../types/comic';

export interface DualOtpVerifiedPayload {
  purpose: 'admin_login' | 'customer_export';
  user?: User;
  exportToken?: string;
  expiresAt?: number;
  totalCustomers?: number;
  message?: string;
}

interface DualOtpSecurityPanelProps {
  purpose: 'admin_login' | 'customer_export';
  recaptchaContainerId: string;
  onVerified: (result: DualOtpVerifiedPayload) => void;
  onCancel?: () => void;
}

export const DualOtpSecurityPanel: React.FC<DualOtpSecurityPanelProps> = ({
  purpose,
  recaptchaContainerId,
  onVerified,
  onCancel,
}) => {
  const [step, setStep] = useState<'enter_credentials' | 'enter_otps'>('enter_credentials');
  const [emailInput, setEmailInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [emailOtpInput, setEmailOtpInput] = useState('');
  const [smsOtpInput, setSmsOtpInput] = useState('');

  const [firebaseConfirmation, setFirebaseConfirmation] = useState<ConfirmationResult | null>(null);
  const [verifiedFirebaseIdToken, setVerifiedFirebaseIdToken] = useState<string | null>(null);
  const [smsDeliveryLabel, setSmsDeliveryLabel] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [resendingChannel, setResendingChannel] = useState<'email' | 'sms' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const [emailResendCooldown, setEmailResendCooldown] = useState(0);
  const [smsResendCooldown, setSmsResendCooldown] = useState(0);
  const [challengeSecondsLeft, setChallengeSecondsLeft] = useState(0);

  const emailOtpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      clearRecaptchaVerifier(recaptchaContainerId);
    };
  }, [recaptchaContainerId]);

  useEffect(() => {
    if (emailResendCooldown <= 0) return;
    const t = window.setInterval(() => {
      setEmailResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [emailResendCooldown]);

  useEffect(() => {
    if (smsResendCooldown <= 0) return;
    const t = window.setInterval(() => {
      setSmsResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [smsResendCooldown]);

  useEffect(() => {
    if (step !== 'enter_otps' || challengeSecondsLeft <= 0) return;
    const t = window.setInterval(() => {
      setChallengeSecondsLeft((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [step, challengeSecondsLeft]);

  useEffect(() => {
    if (step !== 'enter_otps') return;
    return listenForDeviceSmsOtp((code) => {
      setSmsOtpInput(code.replace(/\D/g, '').slice(0, 6));
    });
  }, [step]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const resetChallengeState = () => {
    setStep('enter_credentials');
    setChallengeId('');
    setEmailOtpInput('');
    setSmsOtpInput('');
    setFirebaseConfirmation(null);
    setVerifiedFirebaseIdToken(null);
    setSmsDeliveryLabel('');
    setError(null);
    setSuccessNotice(null);
    setEmailResendCooldown(0);
    setSmsResendCooldown(0);
    setChallengeSecondsLeft(0);
    clearRecaptchaVerifier(recaptchaContainerId);
  };

  const dispatchDualOtps = async (resendOnly: 'both' | 'email' | 'sms' = 'both') => {
    const cleanEmail = emailInput.trim();
    const cleanPhone = phoneInput.trim();

    if (!cleanEmail || !cleanPhone) {
      setError('Please enter both your registered Administrator Gmail and Mobile Number.');
      return;
    }

    if (resendOnly === 'email' && emailResendCooldown > 0) return;
    if (resendOnly === 'sms' && smsResendCooldown > 0) return;

    if (resendOnly === 'both') {
      setLoading(true);
    } else {
      setResendingChannel(resendOnly);
    }
    setError(null);
    setSuccessNotice(null);

    try {
      // Step 1: Verify BOTH credentials strictly on the backend first.
      // Backend dispatches Gmail OTP immediately (when resendOnly !== 'sms') and authorizes SMS dispatch.
      const res = await fetch('/api/admin-auth/request-dual-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          phone: cleanPhone,
          purpose,
          smsChannel: 'firebase',
          resendOnly,
          existingChallengeId: resendOnly !== 'both' ? challengeId : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setLoading(false);
        setResendingChannel(null);
        setError(
          data.error ||
            'Access Denied: Administrator credentials could not be verified against the backend database.'
        );
        return;
      }

      const activeChallengeId = String(data.challengeId || challengeId);
      setChallengeId(activeChallengeId);
      setEmailMasked(data.emailMasked || '');
      setPhoneMasked(data.phoneMasked || '');
      setChallengeSecondsLeft(Number(data.expiresInSeconds || 600));

      if (resendOnly === 'email') {
        setEmailOtpInput('');
        setEmailResendCooldown(30);
        setResendingChannel(null);
        setSuccessNotice(
          data.message || `Fresh 6-digit Gmail OTP sent to ${data.emailMasked || 'your registered Gmail'}.`
        );
        return;
      }

      // Step 2: Dispatch Mobile SMS OTP (Firebase Phone Auth primary, backend SMS fallback)
      // Uses the admin-typed mobile number only AFTER backend confirmed BOTH credentials match DB.
      setVerifiedFirebaseIdToken(null);
      const fbSms = await sendFirebaseSmsOtp(cleanPhone, recaptchaContainerId, '+91');
      if (fbSms.sent && fbSms.confirmationResult) {
        setFirebaseConfirmation(fbSms.confirmationResult);
        setSmsDeliveryLabel('SMS OTP dispatched');
        if (resendOnly === 'sms') {
          setSmsOtpInput('');
          setSmsResendCooldown(30);
          setResendingChannel(null);
          setSuccessNotice(`Fresh 6-digit Mobile SMS OTP sent to ${data.phoneMasked || 'your registered mobile'}.`);
        } else {
          setStep('enter_otps');
          setEmailResendCooldown(30);
          setSmsResendCooldown(30);
          setLoading(false);
          setSuccessNotice(
            `Identity verified in backend database. Enter BOTH the 6-digit Gmail OTP (${data.emailMasked}) and 6-digit Mobile SMS OTP (${data.phoneMasked}).`
          );
          setTimeout(() => emailOtpRef.current?.focus(), 60);
        }
        return;
      }

      // Automatic fallback to configured backend SMS provider if Firebase SMS unavailable
      const fallbackRes = await fetch('/api/admin-auth/request-dual-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          phone: cleanPhone,
          purpose,
          smsChannel: 'backend',
          resendOnly: 'sms',
          existingChallengeId: activeChallengeId,
        }),
      });
      const fallbackData = await fallbackRes.json();

      if (fallbackRes.ok && fallbackData.smsDelivered) {
        setFirebaseConfirmation(null);
        setSmsDeliveryLabel('Backend SMS OTP dispatched');
        if (resendOnly === 'sms') {
          setSmsOtpInput('');
          setSmsResendCooldown(30);
          setResendingChannel(null);
          setSuccessNotice(`Fresh 6-digit Mobile SMS OTP sent to ${data.phoneMasked || 'your registered mobile'}.`);
        } else {
          setStep('enter_otps');
          setEmailResendCooldown(30);
          setSmsResendCooldown(30);
          setLoading(false);
          setSuccessNotice(
            `Identity verified in backend database. Enter BOTH the 6-digit Gmail OTP (${data.emailMasked}) and 6-digit Mobile SMS OTP (${data.phoneMasked}).`
          );
          setTimeout(() => emailOtpRef.current?.focus(), 60);
        }
        return;
      }

      setLoading(false);
      setResendingChannel(null);
      setFirebaseConfirmation(null);
      setError(
        fbSms.errorMessage ||
          fallbackData.error ||
          'Gmail OTP succeeded, but Mobile SMS OTP could not be delivered. Both OTP channels are required to proceed.'
      );
    } catch {
      setLoading(false);
      setResendingChannel(null);
      setError('Network error while verifying backend identity and dispatching Dual OTPs.');
    }
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatchDualOtps('both');
  };

  const handleVerifyBothOtps = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmailOtp = emailOtpInput.trim();
    const cleanSmsOtp = smsOtpInput.trim();

    if (cleanEmailOtp.length !== 6) {
      setError('Please enter the complete 6-digit OTP from your Admin Gmail.');
      return;
    }
    if (!verifiedFirebaseIdToken && cleanSmsOtp.length !== 6) {
      setError('Please enter the complete 6-digit OTP from your Admin Mobile SMS.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let activeFirebaseToken = verifiedFirebaseIdToken;

      if (!activeFirebaseToken && firebaseConfirmation) {
        const fbVerify = await verifyFirebaseSmsOtp(firebaseConfirmation, cleanSmsOtp);
        if (!fbVerify.verified || !fbVerify.idToken) {
          setLoading(false);
          setError(fbVerify.error || 'Invalid 6-digit Mobile SMS OTP. Please check your SMS and try again.');
          return;
        }
        activeFirebaseToken = fbVerify.idToken;
        setVerifiedFirebaseIdToken(fbVerify.idToken);
        setFirebaseConfirmation(null);
      }

      if (activeFirebaseToken) {
        headers['Authorization'] = `Bearer ${activeFirebaseToken}`;
      }

      const res = await fetch('/api/admin-auth/verify-dual-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          challengeId,
          email: emailInput.trim(),
          phone: phoneInput.trim(),
          emailOtp: cleanEmailOtp,
          smsOtp: cleanSmsOtp,
          purpose,
        }),
      });

      const data = await res.json();
      setLoading(false);

      if (!res.ok || !data.success) {
        setError(data.error || 'Dual-OTP verification failed. Both Gmail OTP and Mobile SMS OTP must be valid.');
        return;
      }

      // Immediately clear sensitive inputs from component memory on success
      setEmailInput('');
      setPhoneInput('');
      setEmailOtpInput('');
      setSmsOtpInput('');
      setChallengeId('');
      setVerifiedFirebaseIdToken(null);
      setFirebaseConfirmation(null);
      clearRecaptchaVerifier(recaptchaContainerId);

      onVerified({
        purpose,
        user: data.user,
        exportToken: data.exportToken,
        expiresAt: data.expiresAt,
        totalCustomers: data.totalCustomers,
        message: data.message,
      });
    } catch {
      setLoading(false);
      setError('Network error while verifying Dual OTPs.');
    }
  };

  const isExportVault = purpose === 'customer_export';
  const bothReady =
    emailOtpInput.length === 6 && (Boolean(verifiedFirebaseIdToken) || smsOtpInput.length === 6);

  return (
    <div className="space-y-5">
      {/* Invisible Firebase reCAPTCHA mount dedicated to this Dual-OTP gateway */}
      <div id={recaptchaContainerId} />

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {successNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-400 text-xs font-semibold flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Step Progress Header */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
        <div
          className={`px-3 py-2 rounded-xl border flex items-center gap-2 ${
            step === 'enter_credentials'
              ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-700 dark:text-indigo-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {step === 'enter_otps' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Lock className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>1. Admin Gmail &amp; Mobile</span>
        </div>
        <div
          className={`px-3 py-2 rounded-xl border flex items-center gap-2 ${
            step === 'enter_otps'
              ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-700 dark:text-indigo-300'
              : 'bg-slate-100/70 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-400'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5 shrink-0" />
          <span>2. Gmail OTP + Mobile OTP</span>
        </div>
      </div>

      {step === 'enter_credentials' ? (
        <form onSubmit={handleRequestSubmit} className="space-y-4" autoComplete="off">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
            <span>
              <strong className="text-slate-900 dark:text-slate-200">Immutable Backend Vault:</strong> Enter both your registered Admin Gmail and Mobile Number below. Credentials are permanently locked on the server and cannot be altered.
            </span>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Enter Admin Gmail
              </label>
              <div className="relative">
                <input
                  type="email"
                  name="vault_admin_gmail"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter your registered Admin Gmail"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <Mail className="w-4 h-4 text-rose-500 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Enter Mobile Number
              </label>
              <div className="relative">
                <input
                  type="tel"
                  name="vault_admin_mobile"
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter your registered Mobile Number (+91 ...)"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <Phone className="w-4 h-4 text-emerald-500 absolute left-3.5 top-3.5" />
              </div>
            </div>
          </div>

          {/* Mandatory Dual-OTP Verification Indicators (Both Always Enforced) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/25 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-rose-500 shrink-0" />
                <div>
                  <span className="block text-[11px] font-extrabold text-slate-900 dark:text-white">
                    Gmail 6-Digit OTP
                  </span>
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                    Dispatched via SMTP
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400">
                Required
              </span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/25 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-emerald-500 shrink-0" />
                <div>
                  <span className="block text-[11px] font-extrabold text-slate-900 dark:text-white">
                    Mobile SMS 6-Digit OTP
                  </span>
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                    Dispatched to Mobile
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                Required
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            {onCancel && (
              <button
                type="button"
                onClick={() => {
                  resetChallengeState();
                  onCancel();
                }}
                className="py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={loading || !emailInput.trim() || !phoneInput.trim()}
              aria-busy={loading}
              data-loading={loading ? 'true' : 'false'}
              className={processingClass(
                loading,
                `flex-1 py-3.5 px-5 rounded-xl ${
                  isExportVault
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                } disabled:opacity-50 disabled:cursor-not-allowed font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer`
              )}
            >
              {loading ? (
                <span>Verifying Backend Vault &amp; Sending Both OTPs...</span>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Verify Gmail &amp; Mobile · Send Both OTPs</span>
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerifyBothOtps} className="space-y-4" autoComplete="off">
          {/* Verified Destinations & Countdown Summary (Zero Raw Credentials Exposed) */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-500">Gmail Channel</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {emailMasked || 'Protected Backend Admin Gmail'} · Verified
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-500">Mobile SMS Channel</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {phoneMasked || 'Protected Backend Admin Mobile'} {smsDeliveryLabel ? `· ${smsDeliveryLabel}` : ''}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">Challenge Expiry</span>
              <span
                className={`font-mono font-bold tabular-nums flex items-center gap-1 ${
                  challengeSecondsLeft <= 60 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                {challengeSecondsLeft > 0 ? formatTimer(challengeSecondsLeft) : 'Expired'}
              </span>
            </div>
          </div>

          {/* Dual OTP Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Factor 1: Gmail OTP */}
            <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-rose-500" />
                  <span>1. Gmail OTP</span>
                </label>
                <button
                  type="button"
                  onClick={() => dispatchDualOtps('email')}
                  disabled={loading || resendingChannel !== null || emailResendCooldown > 0}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 disabled:text-slate-400 disabled:cursor-not-allowed tabular-nums cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>
                    {resendingChannel === 'email'
                      ? 'Sending...'
                      : emailResendCooldown > 0
                        ? `${emailResendCooldown}s`
                        : 'Resend'}
                  </span>
                </button>
              </div>
              <input
                ref={emailOtpRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                maxLength={6}
                value={emailOtpInput}
                onChange={(e) => {
                  setEmailOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                placeholder="• • • • • •"
                className="w-full text-center tracking-[0.4em] text-xl font-black font-mono tabular-nums py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            {/* Factor 2: Mobile SMS OTP */}
            <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-500" />
                  <span>2. Mobile SMS OTP</span>
                </label>
                {verifiedFirebaseIdToken ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Verified</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => dispatchDualOtps('sms')}
                    disabled={loading || resendingChannel !== null || smsResendCooldown > 0}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 disabled:text-slate-400 disabled:cursor-not-allowed tabular-nums cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>
                      {resendingChannel === 'sms'
                        ? 'Sending...'
                        : smsResendCooldown > 0
                          ? `${smsResendCooldown}s`
                          : 'Resend'}
                    </span>
                  </button>
                )}
              </div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                disabled={Boolean(verifiedFirebaseIdToken)}
                value={verifiedFirebaseIdToken ? '••••••' : smsOtpInput}
                onChange={(e) => {
                  setSmsOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                placeholder="• • • • • •"
                className="w-full text-center tracking-[0.4em] text-xl font-black font-mono tabular-nums py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required={!verifiedFirebaseIdToken}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={resetChallengeState}
              className="py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Re-enter IDs
            </button>
            <button
              type="submit"
              disabled={loading || !bothReady || challengeSecondsLeft <= 0}
              aria-busy={loading}
              data-loading={loading ? 'true' : 'false'}
              className={processingClass(
                loading,
                'flex-1 py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer'
              )}
            >
              {loading ? (
                <span>Verifying Both OTPs...</span>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>
                    {isExportVault ? 'Verify Both OTPs & Unlock Vault' : 'Verify Both OTPs & Unlock Console'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
