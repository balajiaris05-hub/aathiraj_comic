import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Mail,
  User,
  Phone,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  sendFirebaseSmsOtp,
  verifyFirebaseSmsOtp,
  clearRecaptchaVerifier,
  listenForDeviceSmsOtp,
  ConfirmationResult,
} from '../firebase';
import { processingClass } from '../utils/buttonLoading';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullReaderPage?: () => void;
}

type AuthMode = 'login' | 'register' | 'verify-otp' | 'change-password';

const DOB_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const DOB_MONTHS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];
const DOB_YEARS = Array.from({ length: 82 }, (_, i) => String(2021 - i));

const MODAL_COUNTRY_CODES = [
  { code: '+91', iso: 'IN', country: 'India' },
  { code: '+1', iso: 'US', country: 'USA / Canada' },
  { code: '+44', iso: 'UK', country: 'United Kingdom' },
  { code: '+65', iso: 'SG', country: 'Singapore' },
  { code: '+60', iso: 'MY', country: 'Malaysia' },
  { code: '+971', iso: 'AE', country: 'UAE' },
  { code: '+61', iso: 'AU', country: 'Australia' },
  { code: '+94', iso: 'LK', country: 'Sri Lanka' },
  { code: '+49', iso: 'DE', country: 'Germany' },
  { code: '+33', iso: 'FR', country: 'France' },
  { code: '+81', iso: 'JP', country: 'Japan' },
];

function formatModalPhone(rawPhone: string, countryCode: string): string {
  const trimmed = rawPhone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  const codeDigits = countryCode.replace(/\D/g, '');
  if (codeDigits && digits.startsWith(codeDigits) && digits.length > codeDigits.length + 5) {
    return `+${codeDigits} ${digits.slice(codeDigits.length)}`;
  }
  return `${countryCode} ${digits}`;
}

function calculateAgeFromDob(day: string, month: string, year: string): number {
  const y = Number(year) || 2002;
  const m = (Number(month) || 5) - 1;
  const d = Number(day) || 15;
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) {
    age--;
  }
  return Math.max(5, Math.min(110, age));
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onOpenFullReaderPage }) => {
  const { login, setAuthenticatedUser, getAuthHeaders } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [credential, setCredential] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [identityVerified, setIdentityVerified] = useState(false);
  const [isAccountLocked, setIsAccountLocked] = useState(false);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number>(3);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);

  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [notifyGmail] = useState(true);
  const [notifyMobile] = useState(true);
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');

  // Change password state (Single Email / Mobile selector + DB check + 30s Resend OTP)
  const [resetMethod, setResetMethod] = useState<'email' | 'mobile'>('email');
  const [resetCredential, setResetCredential] = useState('');
  const [resetCountryCode, setResetCountryCode] = useState('+91');
  const [resetEmail, setResetEmail] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetDbVerified, setResetDbVerified] = useState<'verified' | 'not_found' | null>(null);
  const [resetVerifiedName, setResetVerifiedName] = useState('');
  const [resetTargetChannel, setResetTargetChannel] = useState<'email' | 'sms'>('email');
  const [resetResendCooldown, setResetResendCooldown] = useState(0);
  const [resetOtp, setResetOtp] = useState('');
  const [resetStep, setResetStep] = useState<'request_otp' | 'verify_otp' | 'set_new_password'>('request_otp');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [firebaseRegConfirmation, setFirebaseRegConfirmation] = useState<ConfirmationResult | null>(null);
  const [firebaseResetConfirmation, setFirebaseResetConfirmation] = useState<ConfirmationResult | null>(null);
  const [verifiedResetPhoneIdToken, setVerifiedResetPhoneIdToken] = useState<string | null>(null);
  const [smsNotice, setSmsNotice] = useState<string | null>(null);

  // Separate pre-registration Gmail & Mobile OTP state
  const [emailOtpInput, setEmailOtpInput] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpSending, setEmailOtpSending] = useState(false);
  const [emailOtpVerifying, setEmailOtpVerifying] = useState(false);
  const [emailOtpVerified, setEmailOtpVerified] = useState(false);
  const [emailVerificationToken, setEmailVerificationToken] = useState('');
  const [emailOtpNotice, setEmailOtpNotice] = useState<string | null>(null);
  const [emailOtpError, setEmailOtpError] = useState<string | null>(null);

  const [mobileOtpInput, setMobileOtpInput] = useState('');
  const [mobileOtpSent, setMobileOtpSent] = useState(false);
  const [mobileOtpSending, setMobileOtpSending] = useState(false);
  const [mobileOtpVerifying, setMobileOtpVerifying] = useState(false);
  const [mobileOtpVerified, setMobileOtpVerified] = useState(false);
  const [mobileVerificationToken, setMobileVerificationToken] = useState('');
  const [mobileOtpNotice, setMobileOtpNotice] = useState<string | null>(null);
  const [mobileOtpError, setMobileOtpError] = useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      clearRecaptchaVerifier('firebase-recaptcha-modal-reg');
      clearRecaptchaVerifier('firebase-recaptcha-modal-reset');
    };
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    if (mode === 'verify-otp') {
      return listenForDeviceSmsOtp((code) => setOtp(code));
    }
    if (mode === 'register' && mobileOtpSent && !mobileOtpVerified) {
      return listenForDeviceSmsOtp((code) => setMobileOtpInput(code));
    }
    if (mode === 'change-password' && resetStep === 'verify_otp') {
      return listenForDeviceSmsOtp((code) => setResetOtp(code));
    }
  }, [isOpen, mode, resetStep, mobileOtpSent, mobileOtpVerified]);

  React.useEffect(() => {
    if (resetResendCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResetResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resetResendCooldown]);

  if (!isOpen) return null;

  const hasSelectedDob = Boolean(dobDay && dobMonth && dobYear);
  const calculatedAge = hasSelectedDob ? calculateAgeFromDob(dobDay, dobMonth, dobYear) : 22;
  const formattedDob = hasSelectedDob ? `${dobDay}/${dobMonth}/${dobYear}` : '';

  const resetEmailOtpState = () => {
    setEmailOtpSent(false);
    setEmailOtpVerified(false);
    setEmailOtpInput('');
    setEmailVerificationToken('');
    setEmailOtpNotice(null);
    setEmailOtpError(null);
  };

  const resetMobileOtpState = () => {
    setMobileOtpSent(false);
    setMobileOtpVerified(false);
    setMobileOtpInput('');
    setMobileVerificationToken('');
    setFirebaseRegConfirmation(null);
    setMobileOtpNotice(null);
    setMobileOtpError(null);
  };

  const resetState = () => {
    setError(null);
    setSuccessMsg(null);
    setSmsNotice(null);
    setFirebaseRegConfirmation(null);
    setFirebaseResetConfirmation(null);
    setVerifiedResetPhoneIdToken(null);
    setResetDbVerified(null);
    setResetVerifiedName('');
    setResetResendCooldown(0);
    setOtp('');
    resetEmailOtpState();
    resetMobileOtpState();
  };

  const handleVerifyIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = credential.trim();
    if (!cleanInput) {
      setError('Please enter your registered Email address or Phone number.');
      return;
    }
    const isEmailInput = cleanInput.includes('@');
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/auth/verify-identity', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: isEmailInput ? cleanInput : '',
          credential: cleanInput,
          phone: !isEmailInput ? cleanInput : '',
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok && data.verified) {
        setIdentityVerified(true);
        setIsAccountLocked(Boolean(data.isLocked));
        setLockedUntilIso(data.lockedUntil || null);
        setRemainingAttempts(typeof data.remainingAttempts === 'number' ? data.remainingAttempts : 3);
        if (data.isLocked) {
          setError(data.message || 'Account locked for 12 hours after 3 failed password attempts.');
        } else {
          setSuccessMsg(data.message || 'Account verified! Enter your password below.');
        }
      } else {
        setIdentityVerified(false);
        setError(data.error || 'Account not found.');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identityVerified) {
      await handleVerifyIdentity(e);
      return;
    }
    if (isAccountLocked) {
      setError('Account is locked for 12 hours after 3 failed attempts. Please use Forgot Password.');
      return;
    }
    if (!loginPassword) {
      setError('Please enter your account password.');
      return;
    }
    setLoading(true);
    setError(null);

    const cleanInput = credential.trim();
    const isEmailInput = cleanInput.includes('@');
    const res = await login(cleanInput, {
      phone: !isEmailInput ? cleanInput : undefined,
      password: loginPassword,
      notifyGmail,
      notifyMobile,
    });
    setLoading(false);
    if (res.success) {
      onClose();
    } else {
      if (res.isLocked) {
        setIsAccountLocked(true);
        setLockedUntilIso(res.lockedUntil || null);
        setRemainingAttempts(0);
      } else if (typeof res.remainingAttempts === 'number') {
        setRemainingAttempts(res.remainingAttempts);
      }
      setError(res.error || 'Incorrect password.');
    }
  };

  const handleSendModalEmailOtp = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setEmailOtpError('Enter a valid Gmail address first.');
      return;
    }
    setEmailOtpSending(true);
    setEmailOtpError(null);
    setEmailOtpNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-registration-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, name: name.trim() }),
      });
      const data = await res.json();
      setEmailOtpSending(false);
      if (res.ok && data.success) {
        setEmailOtpSent(true);
        setEmailOtpVerified(false);
        setEmailVerificationToken('');
        setEmailOtpNotice(data.message || `6-digit OTP sent to ${cleanEmail}.`);
      } else {
        setEmailOtpError(data.error || 'Could not send Gmail OTP.');
      }
    } catch (err: any) {
      setEmailOtpSending(false);
      setEmailOtpError(err?.message || 'Network error');
    }
  };

  const handleVerifyModalEmailOtp = async () => {
    const cleanCode = emailOtpInput.trim();
    if (cleanCode.length < 4) {
      setEmailOtpError('Enter the 6-digit Gmail OTP.');
      return;
    }
    setEmailOtpVerifying(true);
    setEmailOtpError(null);
    try {
      const res = await fetch('/api/auth/verify-registration-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp: cleanCode }),
      });
      const data = await res.json();
      setEmailOtpVerifying(false);
      if (res.ok && data.verified && data.emailVerificationToken) {
        setEmailOtpVerified(true);
        setEmailVerificationToken(data.emailVerificationToken);
        setEmailOtpNotice(data.message || 'Gmail verified.');
        setError(null);
      } else {
        setEmailOtpError(data.error || 'Invalid Gmail OTP.');
      }
    } catch (err: any) {
      setEmailOtpVerifying(false);
      setEmailOtpError(err?.message || 'Network error');
    }
  };

  const handleSendModalMobileOtp = async () => {
    const cleanPhone = phone.trim();
    if (cleanPhone.replace(/\D/g, '').length < 6) {
      setMobileOtpError('Enter a valid mobile number first.');
      return;
    }
    setMobileOtpSending(true);
    setMobileOtpError(null);
    setMobileOtpNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-registration-mobile-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, countryCode: '+91', smsChannel: 'firebase' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMobileOtpSending(false);
        setMobileOtpError(data.error || 'Could not send SMS OTP.');
        return;
      }
      if (data.provider === 'firebase') {
        const fbSms = await sendFirebaseSmsOtp(cleanPhone, 'firebase-recaptcha-modal-reg', '+91');
        setMobileOtpSending(false);
        if (fbSms.sent && fbSms.confirmationResult) {
          setFirebaseRegConfirmation(fbSms.confirmationResult);
          setMobileOtpSent(true);
          setMobileOtpVerified(false);
          setMobileVerificationToken('');
          setMobileOtpNotice(`6-digit SMS OTP sent to ${fbSms.phoneE164}.`);
        } else {
          setFirebaseRegConfirmation(null);
          setMobileOtpError(fbSms.errorMessage || 'Failed to send SMS OTP.');
        }
        return;
      }
      setMobileOtpSending(false);
      if (data.smsDelivered) {
        setMobileOtpSent(true);
        setMobileOtpVerified(false);
        setMobileVerificationToken('');
        setMobileOtpNotice(data.message || `6-digit SMS OTP sent to ${cleanPhone}.`);
      } else {
        setMobileOtpError(data.error || 'Could not deliver SMS OTP.');
      }
    } catch (err: any) {
      setMobileOtpSending(false);
      setMobileOtpError(err?.message || 'Network error');
    }
  };

  const handleVerifyModalMobileOtp = async () => {
    const cleanCode = mobileOtpInput.trim();
    if (cleanCode.length < 4) {
      setMobileOtpError('Enter the 6-digit SMS OTP.');
      return;
    }
    setMobileOtpVerifying(true);
    setMobileOtpError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (firebaseRegConfirmation) {
        const fbVerify = await verifyFirebaseSmsOtp(firebaseRegConfirmation, cleanCode);
        if (!fbVerify.verified || !fbVerify.idToken) {
          setMobileOtpVerifying(false);
          setMobileOtpError(fbVerify.error || 'Incorrect SMS OTP.');
          return;
        }
        headers['Authorization'] = `Bearer ${fbVerify.idToken}`;
      }
      const res = await fetch('/api/auth/verify-registration-mobile-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone: phone.trim(), countryCode: '+91', otp: cleanCode }),
      });
      const data = await res.json();
      setMobileOtpVerifying(false);
      if (res.ok && data.verified && data.mobileVerificationToken) {
        setMobileOtpVerified(true);
        setMobileVerificationToken(data.mobileVerificationToken);
        setFirebaseRegConfirmation(null);
        setMobileOtpNotice(data.message || 'Mobile verified.');
        setError(null);
      } else {
        setMobileOtpError(data.error || 'Invalid SMS OTP.');
      }
    } catch (err: any) {
      setMobileOtpVerifying(false);
      setMobileOtpError(err?.message || 'Network error');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !phone.trim()) {
      setError('Please enter both Gmail address and Mobile Number.');
      return;
    }
    if (!dobDay || !dobMonth || !dobYear) {
      setError('Please select your Date of Birth (DD / MM / YYYY).');
      return;
    }
    if (!emailOtpVerified || !emailVerificationToken) {
      setError('Please send and verify the OTP for your Gmail address before creating your account.');
      return;
    }
    if (!mobileOtpVerified || !mobileVerificationToken) {
      setError('Please send and verify the SMS OTP for your Mobile Number before creating your account.');
      return;
    }
    if (!regPassword || regPassword.length < 4) {
      setError('Please create an account password (minimum 4 characters).');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError('Password and Confirm Password do not match.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          age: calculatedAge,
          dob: formattedDob,
          phone: phone.trim(),
          password: regPassword,
          confirmPassword: regConfirmPassword,
          notifyGmail,
          notifyMobile,
          emailVerificationToken,
          mobileVerificationToken,
          role: 'reader',
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok && data.user) {
        setAuthenticatedUser(data.user);
        onClose();
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      let fbVerifyError: string | null = null;
      if (firebaseRegConfirmation) {
        const fbVerify = await verifyFirebaseSmsOtp(firebaseRegConfirmation, otp.trim());
        if (fbVerify.verified && fbVerify.idToken) {
          headers['Authorization'] = `Bearer ${fbVerify.idToken}`;
          setFirebaseRegConfirmation(null);
        } else {
          fbVerifyError = fbVerify.error || null;
        }
      }

      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: email.trim(),
          phone: phone.trim(),
          otp,
          age: calculatedAge,
          dob: formattedDob,
          notifyGmail,
          notifyMobile,
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSmsNotice(null);
        await login(email.trim() || phone.trim(), {
          phone: phone.trim() || undefined,
          password: regPassword || undefined,
          name: name.trim() || undefined,
          age: calculatedAge,
          dob: formattedDob,
          notifyGmail,
          notifyMobile,
        });
        onClose();
      } else {
        setError(fbVerifyError || data.error || 'Invalid OTP code');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const dispatchModalResetOtp = async (isResend: boolean) => {
    if (isResend && resetResendCooldown > 0) return;

    const trimmed = resetCredential.trim();
    const isEmailInput =
      resetMethod === 'email' || trimmed.includes('@') || /[a-zA-Z]/.test(trimmed);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (isEmailInput) {
      if (!trimmed || !emailRegex.test(trimmed)) {
        setError('Please enter a valid registered Email / Gmail address.');
        return;
      }
    } else if (trimmed.replace(/\D/g, '').length < 6) {
      setError('Please enter a valid registered Mobile Number.');
      return;
    }

    const channel: 'email' | 'sms' = isEmailInput ? 'email' : 'sms';
    const fullPhone = !isEmailInput ? formatModalPhone(trimmed, resetCountryCode) : '';

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setSmsNotice(null);
    setVerifiedResetPhoneIdToken(null);

    try {
      // Step 1: Verify input exists in database & backend BEFORE sending OTP
      const verifyRes = await fetch('/api/auth/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: trimmed,
          email: isEmailInput ? trimmed : '',
          phone: fullPhone,
          countryCode: resetCountryCode,
        }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.verified) {
        setLoading(false);
        setResetDbVerified('not_found');
        setResetVerifiedName('');
        setError(
          verifyData.error ||
            (channel === 'email'
              ? `Email "${trimmed}" is not stored in the database. Please register first.`
              : `Mobile Number "${fullPhone}" is not stored in the database. Please register first.`)
        );
        return;
      }

      const verifiedEmail = (verifyData.email || (isEmailInput ? trimmed : '')).trim();
      const verifiedPhone = (verifyData.phone || fullPhone || '').trim();
      const verifiedCode = (verifyData.countryCode || resetCountryCode || '+91').trim();
      setResetDbVerified('verified');
      setResetVerifiedName(verifyData.name || '');
      setResetEmail(verifiedEmail);
      setResetPhone(verifiedPhone);
      setResetCountryCode(verifiedCode);

      // Step 2: Send OTP strictly to the selected input channel
      if (channel === 'email') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: trimmed,
            email: isEmailInput ? trimmed : verifiedEmail,
            targetChannel: 'email',
          }),
        });
        const data = await res.json();
        setLoading(false);

        if (!res.ok || !data.emailDelivered) {
          setError(data.error || 'Could not send OTP to this Email address.');
          return;
        }

        setFirebaseResetConfirmation(null);
        setResetTargetChannel('email');
        if (isResend) setResetOtp('');
        setResetStep('verify_otp');
        setResetResendCooldown(30);
        setSuccessMsg(
          data.message ||
            `Verified in database! 6-digit OTP ${isResend ? 'resent' : 'sent'} to ${trimmed}.`
        );
        return;
      }

      // channel === 'sms'
      const smsInitRes = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: trimmed,
          phone: fullPhone || verifiedPhone,
          countryCode: resetCountryCode,
          targetChannel: 'sms',
          smsChannel: 'firebase',
        }),
      });
      const smsInitData = await smsInitRes.json();
      if (!smsInitRes.ok) {
        setLoading(false);
        setError(smsInitData.error || 'Could not send SMS OTP to this mobile number.');
        return;
      }

      const targetPhone = (smsInitData.phone || fullPhone || verifiedPhone).trim();
      const targetCountry = smsInitData.countryCode || resetCountryCode;
      const fbSms = await sendFirebaseSmsOtp(
        targetPhone,
        'firebase-recaptcha-modal-reset',
        targetCountry
      );

      if (fbSms.sent && fbSms.confirmationResult) {
        setLoading(false);
        setFirebaseResetConfirmation(fbSms.confirmationResult);
        setResetTargetChannel('sms');
        if (isResend) setResetOtp('');
        setResetStep('verify_otp');
        setResetResendCooldown(30);
        const msg = `Verified in database! 6-digit SMS OTP ${isResend ? 'resent' : 'sent'} to ${fbSms.phoneE164}.`;
        setSmsNotice(msg);
        setSuccessMsg(msg);
        return;
      }

      const backendSmsRes = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: trimmed,
          phone: targetPhone,
          countryCode: targetCountry,
          targetChannel: 'sms',
          smsChannel: 'backend',
        }),
      });
      const backendSmsData = await backendSmsRes.json();
      setLoading(false);

      if (backendSmsRes.ok && backendSmsData.smsDelivered) {
        setFirebaseResetConfirmation(null);
        setResetTargetChannel('sms');
        if (isResend) setResetOtp('');
        setResetStep('verify_otp');
        setResetResendCooldown(30);
        const msg =
          backendSmsData.message ||
          `Verified in database! 6-digit SMS OTP ${isResend ? 'resent' : 'sent'} to ${targetPhone}.`;
        setSmsNotice(msg);
        setSuccessMsg(msg);
        return;
      }

      setFirebaseResetConfirmation(null);
      setError(
        fbSms.errorMessage ||
          backendSmsData.error ||
          'Could not deliver SMS OTP to this mobile number. Please check your number or choose Email.'
      );
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error while verifying database and sending OTP.');
    }
  };

  const handleRequestResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatchModalResetOtp(false);
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let fbVerifyError: string | null = null;
      if (firebaseResetConfirmation) {
        const fbVerify = await verifyFirebaseSmsOtp(firebaseResetConfirmation, resetOtp.trim());
        if (fbVerify.verified && fbVerify.idToken) {
          headers['Authorization'] = `Bearer ${fbVerify.idToken}`;
          setVerifiedResetPhoneIdToken(fbVerify.idToken);
          setFirebaseResetConfirmation(null);
        } else {
          fbVerifyError = fbVerify.error || null;
        }
      }

      const res = await fetch('/api/auth/verify-reset-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: resetEmail.trim(),
          phone: resetPhone.trim(),
          countryCode: resetCountryCode,
          otp: resetOtp.trim(),
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok && data.verified) {
        setResetResendCooldown(0);
        setSuccessMsg('OTP Verified! Enter your New Password and Confirm Password.');
        setResetStep('set_new_password');
      } else {
        setError(fbVerifyError || data.error || 'Invalid OTP');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setError('New Password and Confirm Password do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (verifiedResetPhoneIdToken) {
        headers['Authorization'] = `Bearer ${verifiedResetPhoneIdToken}`;
      }
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: resetEmail.trim(),
          phone: resetPhone.trim(),
          countryCode: resetCountryCode,
          otp: resetOtp.trim(),
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setVerifiedResetPhoneIdToken(null);
        setFirebaseResetConfirmation(null);
        setSmsNotice(null);
        setResetResendCooldown(0);
        setIsAccountLocked(false);
        setLockedUntilIso(null);
        setRemainingAttempts(3);
        setCredential(resetEmail.trim() || resetPhone.trim() || resetCredential.trim());
        setIdentityVerified(true);
        setLoginPassword('');
        setSuccessMsg('Password updated in backend and account unlocked! Please log in.');
        setMode('login');
      } else {
        setError(data.error || 'Password reset failed');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-900 dark:text-slate-100 my-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold uppercase tracking-wider mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>● Gmail Connected · ● Mobile Number Connected</span>
          </div>
          <h3 className="text-xl font-bold tracking-tight font-heading">
            {mode === 'login' && 'Returning Customer Login'}
            {mode === 'register' && 'First-Time Customer Register'}
            {mode === 'verify-otp' && 'Verify Customer OTP'}
            {mode === 'change-password' && 'Change Customer Password'}
          </h3>
        </div>

        {(mode === 'login' || mode === 'register') && (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 mb-4">
            <button
              type="button"
              onClick={() => { resetState(); setMode('login'); }}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Returning Customer Login
            </button>
            <button
              type="button"
              onClick={() => { resetState(); setMode('register'); }}
              className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              First-Time Customer Register
            </button>
          </div>
        )}

        <div id="firebase-recaptcha-modal-reg" />
        <div id="firebase-recaptcha-modal-reset" />

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
        {smsNotice && (mode === 'verify-otp' || mode === 'change-password') && (
          <div className="mb-4 p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-300 text-xs font-medium flex items-start gap-2">
            <Phone className="w-4 h-4 shrink-0 mt-0.5 text-sky-500" />
            <span>{smsNotice}</span>
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Email or Phone Number <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  required
                  placeholder="Enter email address or phone number"
                  value={credential}
                  onChange={(e) => {
                    setCredential(e.target.value);
                    setIdentityVerified(false);
                  }}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>

            {!identityVerified ? (
              <button
                type="button"
                onClick={handleVerifyIdentity}
                disabled={loading}
                aria-busy={loading}
                data-loading={loading ? 'true' : 'false'}
                className={processingClass(
                  loading,
                  'w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-md cursor-pointer disabled:cursor-not-allowed'
                )}
              >
                {loading ? 'Verifying...' : 'Verify Email or Phone to Enter Password'}
              </button>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-rose-500" />
                    <span>Verify Account Password</span>
                  </span>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                    {isAccountLocked ? 'Locked (12h)' : `Attempts Left: ${remainingAttempts}/3`}
                  </span>
                </div>

                {isAccountLocked ? (
                  <div className="space-y-2 text-xs text-rose-600 dark:text-rose-400">
                    <p>
                      Account locked for 12 hours{lockedUntilIso ? ` (until ${new Date(lockedUntilIso).toLocaleTimeString()})` : ''} after 3 failed attempts. Try again after 12 hours or reset your password via OTP:
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        resetState();
                        const cleanInput = credential.trim();
                        if (!cleanInput || cleanInput.includes('@')) {
                          setResetMethod('email');
                          setResetCredential(cleanInput);
                          setResetEmail(cleanInput);
                          setResetPhone('');
                        } else {
                          setResetMethod('mobile');
                          setResetCredential(cleanInput);
                          setResetEmail('');
                          setResetPhone(cleanInput);
                        }
                        setResetStep('request_otp');
                        setMode('change-password');
                      }}
                      className="w-full py-2 px-3 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs cursor-pointer"
                    >
                      Forgot Password — Send OTP &amp; Change Password
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        name="password"
                        autoComplete="current-password"
                        required
                        placeholder="Enter account password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full pl-9 pr-9 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute right-2.5 top-2.5 text-slate-400 cursor-pointer"
                      >
                        {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      aria-busy={loading}
                      data-loading={loading ? 'true' : 'false'}
                      className={processingClass(
                        loading,
                        'w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-md cursor-pointer disabled:cursor-not-allowed'
                      )}
                    >
                      {loading ? 'Logging in...' : 'Verify Password & Login'}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  resetState();
                  const cleanInput = credential.trim();
                  if (!cleanInput || cleanInput.includes('@')) {
                    setResetMethod('email');
                    setResetCredential(cleanInput);
                    setResetEmail(cleanInput);
                    setResetPhone('');
                  } else {
                    setResetMethod('mobile');
                    setResetCredential(cleanInput);
                    setResetEmail('');
                    setResetPhone(cleanInput);
                  }
                  setResetStep('request_otp');
                  setMode('change-password');
                }}
                className="text-rose-600 dark:text-rose-400 font-bold hover:underline cursor-pointer"
              >
                Forgot / Change Password?
              </button>
              {onOpenFullReaderPage && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenFullReaderPage();
                  }}
                  className="text-slate-600 dark:text-slate-400 font-bold hover:underline cursor-pointer"
                >
                  Full Login Page →
                </button>
              )}
            </div>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
              <strong className="font-bold">New Reader Offer:</strong> First-time registration unlocks a{' '}
              <strong className="font-bold">30-Day Free 1-Month Premium Trial (₹49 value)</strong>. Duplicate Gmail or mobile accounts are blocked.
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Customer Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Date of Birth <span className="text-rose-500">*</span>
                </label>
                {hasSelectedDob && (
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {calculatedAge} yrs
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  aria-label="Date of Birth Day"
                  required
                  value={dobDay}
                  onChange={(e) => setDobDay(e.target.value)}
                  className={`w-full px-2 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${
                    !dobDay ? 'text-slate-400 dark:text-slate-500' : ''
                  }`}
                >
                  <option value="" disabled>DD</option>
                  {DOB_DAYS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <select
                  aria-label="Date of Birth Month"
                  required
                  value={dobMonth}
                  onChange={(e) => setDobMonth(e.target.value)}
                  className={`w-full px-2 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${
                    !dobMonth ? 'text-slate-400 dark:text-slate-500' : ''
                  }`}
                >
                  <option value="" disabled>MM</option>
                  {DOB_MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <select
                  aria-label="Date of Birth Year"
                  required
                  value={dobYear}
                  onChange={(e) => setDobYear(e.target.value)}
                  className={`w-full px-2 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${
                    !dobYear ? 'text-slate-400 dark:text-slate-500' : ''
                  }`}
                >
                  <option value="" disabled>YYYY</option>
                  {DOB_YEARS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Gmail Address <span className="text-rose-500">*</span>
                  </label>
                  {emailOtpVerified && (
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                      Verified ✓
                    </span>
                  )}
                </div>
                <div className="flex items-stretch gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="email"
                      name="username"
                      autoComplete="username"
                      required
                      placeholder="Enter your Gmail address"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        resetEmailOtpState();
                      }}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendModalEmailOtp}
                    disabled={emailOtpSending || !email.trim()}
                    aria-busy={emailOtpSending}
                    data-loading={emailOtpSending ? 'true' : 'false'}
                    className={processingClass(
                      emailOtpSending,
                      `px-2.5 py-2 rounded-lg text-xs font-bold shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                        emailOtpVerified
                          ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-900 dark:bg-rose-600 text-white disabled:opacity-50'
                      }`
                    )}
                  >
                    {emailOtpSending ? 'Sending...' : emailOtpVerified ? 'Verified ✓' : emailOtpSent ? 'Resend' : 'Send OTP'}
                  </button>
                </div>
                {emailOtpSent && !emailOtpVerified && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      type="text"
                      name="email-otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="6-digit Gmail OTP"
                      value={emailOtpInput}
                      onChange={(e) => {
                        setEmailOtpInput(e.target.value.replace(/\D/g, ''));
                        setEmailOtpError(null);
                      }}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono tracking-widest text-center rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyModalEmailOtp}
                      disabled={emailOtpVerifying || emailOtpInput.length < 4}
                      aria-busy={emailOtpVerifying}
                      data-loading={emailOtpVerifying ? 'true' : 'false'}
                      className={processingClass(
                        emailOtpVerifying,
                        'px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
                      )}
                    >
                      {emailOtpVerifying ? 'Verifying...' : 'Verify'}
                    </button>
                  </div>
                )}
                {emailOtpError && <p className="text-[11px] text-rose-500 mt-1">{emailOtpError}</p>}
                {emailOtpNotice && !emailOtpError && <p className="text-[11px] text-emerald-500 mt-1">{emailOtpNotice}</p>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Mobile Number (+91) <span className="text-rose-500">*</span>
                  </label>
                  {mobileOtpVerified && (
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                      Verified ✓
                    </span>
                  )}
                </div>
                <div className="flex items-stretch gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="tel"
                      required
                      placeholder="Enter your mobile number (+91)"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        resetMobileOtpState();
                      }}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendModalMobileOtp}
                    disabled={mobileOtpSending || phone.replace(/\D/g, '').length < 6}
                    aria-busy={mobileOtpSending}
                    data-loading={mobileOtpSending ? 'true' : 'false'}
                    className={processingClass(
                      mobileOtpSending,
                      `px-2.5 py-2 rounded-lg text-xs font-bold shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                        mobileOtpVerified
                          ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-900 dark:bg-rose-600 text-white disabled:opacity-50'
                      }`
                    )}
                  >
                    {mobileOtpSending ? 'Sending...' : mobileOtpVerified ? 'Verified ✓' : mobileOtpSent ? 'Resend' : 'Send OTP'}
                  </button>
                </div>
                {mobileOtpSent && !mobileOtpVerified && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      type="text"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="6-digit SMS OTP"
                      value={mobileOtpInput}
                      onChange={(e) => {
                        setMobileOtpInput(e.target.value.replace(/\D/g, ''));
                        setMobileOtpError(null);
                      }}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono tracking-widest text-center rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyModalMobileOtp}
                      disabled={mobileOtpVerifying || mobileOtpInput.length < 4}
                      aria-busy={mobileOtpVerifying}
                      data-loading={mobileOtpVerifying ? 'true' : 'false'}
                      className={processingClass(
                        mobileOtpVerifying,
                        'px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
                      )}
                    >
                      {mobileOtpVerifying ? 'Verifying...' : 'Verify'}
                    </button>
                  </div>
                )}
                {mobileOtpError && <p className="text-[11px] text-rose-500 mt-1">{mobileOtpError}</p>}
                {mobileOtpNotice && !mobileOtpError && <p className="text-[11px] text-emerald-500 mt-1">{mobileOtpNotice}</p>}
              </div>
            </div>

            {/* Password & Confirm Password Div */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type={showRegPassword ? 'text' : 'password'}
                    name="new-password"
                    autoComplete="new-password"
                    required
                    placeholder="Create password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword(!showRegPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 cursor-pointer"
                  >
                    {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Confirm Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type={showRegConfirmPassword ? 'text' : 'password'}
                    name="confirm-password"
                    autoComplete="new-password"
                    required
                    placeholder="Confirm password"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 cursor-pointer"
                  >
                    {showRegConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !emailOtpVerified || !mobileOtpVerified}
              aria-busy={loading}
              data-loading={loading ? 'true' : 'false'}
              className={processingClass(
                loading,
                'w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-md cursor-pointer'
              )}
            >
              {loading
                ? 'Creating Account...'
                : !emailOtpVerified || !mobileOtpVerified
                  ? 'Verify Both Gmail & Mobile OTPs First'
                  : 'Create Verified Account'}
            </button>
          </form>
        )}

        {mode === 'verify-otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Enter 6-Digit Verification Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full pl-9 pr-3 py-2 text-lg font-mono tracking-widest text-center rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otp.length < 4}
              aria-busy={loading}
              data-loading={loading ? 'true' : 'false'}
              className={processingClass(
                loading,
                'w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors shadow-md cursor-pointer'
              )}
            >
              {loading ? 'Verifying...' : 'Verify & Complete Login'}
            </button>
          </form>
        )}

        {mode === 'change-password' && (
          <div className="space-y-4">
            {resetStep === 'request_otp' && (
              <form onSubmit={handleRequestResetOtp} className="space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Select Email or Mobile Number <span className="text-rose-500">*</span>
                    </label>
                    <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => {
                          setResetMethod('email');
                          setResetDbVerified(null);
                          setError(null);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                          resetMethod === 'email'
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Mail className="w-3 h-3" />
                        <span>Email</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetMethod('mobile');
                          setResetDbVerified(null);
                          setError(null);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                          resetMethod === 'mobile'
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Phone className="w-3 h-3" />
                        <span>Mobile Number</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-stretch gap-2">
                    {resetMethod === 'mobile' && (
                      <select
                        aria-label="Country Code"
                        value={resetCountryCode}
                        onChange={(e) => {
                          setResetCountryCode(e.target.value);
                          setResetDbVerified(null);
                        }}
                        className="w-24 shrink-0 px-2 py-2 text-xs font-mono font-bold rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white cursor-pointer"
                      >
                        {MODAL_COUNTRY_CODES.map((c) => (
                          <option key={`modal-reset-${c.iso}-${c.code}`} value={c.code}>
                            {c.iso} ({c.code})
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="relative flex-1 min-w-0">
                      {resetMethod === 'email' ? (
                        <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                      ) : (
                        <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                      )}
                      <input
                        type={resetMethod === 'email' ? 'email' : 'tel'}
                        required
                        placeholder={
                          resetMethod === 'email'
                            ? 'Enter your registered Email / Gmail address'
                            : `Enter your registered Mobile Number (${resetCountryCode})`
                        }
                        value={resetCredential}
                        onChange={(e) => {
                          const val = e.target.value;
                          const trimmedVal = val.trim();
                          if (trimmedVal.includes('@') || /[a-zA-Z]/.test(trimmedVal)) {
                            setResetMethod('email');
                          } else if (/^[+\d\s\-()]{3,}$/.test(trimmedVal)) {
                            setResetMethod('mobile');
                          }
                          setResetCredential(val);
                          setResetDbVerified(null);
                          setError(null);
                        }}
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Verified against the backend &amp; database before sending the OTP to your chosen input.
                  </p>
                </div>

                {resetDbVerified === 'not_found' && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Not found in database. OTP was not sent.</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                  data-loading={loading ? 'true' : 'false'}
                  className={processingClass(
                    loading,
                    'w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm cursor-pointer'
                  )}
                >
                  {loading
                    ? 'Verifying Database & Sending OTP...'
                    : `Verify in Database & Send OTP to ${resetMethod === 'email' ? 'Email' : 'Mobile'}`}
                </button>
              </form>
            )}

            {resetStep === 'verify_otp' && (
              <form onSubmit={handleVerifyResetOtp} className="space-y-3">
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0 truncate">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    <span className="truncate">
                      DB Verified{resetVerifiedName ? ` (${resetVerifiedName})` : ''} · Sent to{' '}
                      {resetTargetChannel === 'email'
                        ? resetEmail || resetCredential
                        : resetPhone || formatModalPhone(resetCredential, resetCountryCode)}
                    </span>
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Enter 6-Digit OTP Sent to {resetTargetChannel === 'email' ? 'Email' : 'Mobile Number'}
                  </label>
                  <input
                    type="text"
                    name="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    required
                    maxLength={6}
                    placeholder="Enter 6-digit OTP"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-2 text-sm font-mono tracking-wider text-center rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                  data-loading={loading ? 'true' : 'false'}
                  className={processingClass(
                    loading,
                    'w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm cursor-pointer'
                  )}
                >
                  {loading ? 'Verifying OTP...' : 'Verify OTP'}
                </button>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={loading || resetResendCooldown > 0}
                    aria-busy={loading}
                    data-loading={loading ? 'true' : 'false'}
                    onClick={() => dispatchModalResetOtp(true)}
                    className={processingClass(
                      loading,
                      `px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                        loading || resetResendCooldown > 0
                          ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed'
                          : 'bg-white dark:bg-slate-900 border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer'
                      }`
                    )}
                  >
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    <span>
                      {resetResendCooldown > 0
                        ? `Resend OTP in ${resetResendCooldown}s`
                        : 'Resend OTP'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetStep('request_otp');
                      setResetOtp('');
                      setResetResendCooldown(0);
                      setError(null);
                      setSuccessMsg(null);
                      setSmsNotice(null);
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    Change Email / Mobile
                  </button>
                </div>
              </form>
            )}

            {resetStep === 'set_new_password' && (
              <form onSubmit={handleResetPassword} className="space-y-3">
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={resetEmail || resetPhone || resetCredential}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                />
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    New Password
                  </label>
                  <input
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    required
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    name="confirm-new-password"
                    autoComplete="new-password"
                    required
                    placeholder="Confirm new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                  data-loading={loading ? 'true' : 'false'}
                  className={processingClass(
                    loading,
                    'w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:cursor-not-allowed text-white font-semibold text-sm cursor-pointer'
                  )}
                >
                  {loading ? 'Updating Password...' : 'Save New Password & Return to Login'}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={() => { resetState(); setMode('login'); }}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              ← Back to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
