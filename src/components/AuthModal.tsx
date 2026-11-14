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
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullReaderPage?: () => void;
}

type AuthMode = 'login' | 'register' | 'verify-otp' | 'change-password';

const DOB_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const DOB_MONTHS = [
  { value: '01', label: '01 - Jan' },
  { value: '02', label: '02 - Feb' },
  { value: '03', label: '03 - Mar' },
  { value: '04', label: '04 - Apr' },
  { value: '05', label: '05 - May' },
  { value: '06', label: '06 - Jun' },
  { value: '07', label: '07 - Jul' },
  { value: '08', label: '08 - Aug' },
  { value: '09', label: '09 - Sep' },
  { value: '10', label: '10 - Oct' },
  { value: '11', label: '11 - Nov' },
  { value: '12', label: '12 - Dec' },
];
const DOB_YEARS = Array.from({ length: 82 }, (_, i) => String(2021 - i));

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
  const { login } = useAuth();
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

  // Change password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetStep, setResetStep] = useState<'request_otp' | 'verify_otp' | 'set_new_password'>('request_otp');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);

  if (!isOpen) return null;

  const hasSelectedDob = Boolean(dobDay && dobMonth && dobYear);
  const calculatedAge = hasSelectedDob ? calculateAgeFromDob(dobDay, dobMonth, dobYear) : 22;
  const formattedDob = hasSelectedDob ? `${dobDay}/${dobMonth}/${dobYear}` : '';

  const resetState = () => {
    setError(null);
    setSuccessMsg(null);
    setSandboxOtp(null);
    setOtp('');
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
      const res = await fetch('/api/auth/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) {
      setError('Please provide your Gmail address.');
      return;
    }
    if (!dobDay || !dobMonth || !dobYear) {
      setError('Please select your Date of Birth (Date, Month, and Year).');
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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          role: 'reader',
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSuccessMsg(
          `Welcome to Aathirai_Comic! Account created & welcome email sent to ${email}. Verify OTP below.`
        );
        setSandboxOtp(data.devOtpHint || '');
        setMode('verify-otp');
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
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        setError(data.error || 'Invalid OTP code');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const handleRequestResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim(), phone: resetPhone.trim() }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSandboxOtp(data.devOtpHint || '');
        setSuccessMsg(data.message || `Reset code sent to ${resetEmail}`);
        setResetStep('verify_otp');
      } else {
        setError(data.error || 'Could not send reset code');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim(), phone: resetPhone.trim(), otp: resetOtp.trim() }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok && data.verified) {
        setSuccessMsg('OTP Verified! Enter your New Password and Confirm Password.');
        setResetStep('set_new_password');
      } else {
        setError(data.error || 'Invalid OTP');
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
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: resetEmail.trim(),
          phone: resetPhone.trim(),
          otp: resetOtp.trim(),
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setIsAccountLocked(false);
        setLockedUntilIso(null);
        setRemainingAttempts(3);
        setCredential(resetEmail.trim());
        setIdentityVerified(true);
        setLoginPassword('');
        setSandboxOtp(null);
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

        {sandboxOtp && (
          <div className="mb-4 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between">
            <span>Verification Code: <strong className="font-mono text-sm tracking-wider">{sandboxOtp}</strong></span>
            <button
              type="button"
              onClick={() => {
                if (mode === 'change-password') setResetOtp(sandboxOtp);
                else setOtp(sandboxOtp);
              }}
              className="text-[11px] underline font-semibold hover:text-amber-500 cursor-pointer"
            >
              Auto-fill OTP
            </button>
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
                className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-md cursor-pointer"
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
                        if (cleanInput.includes('@')) {
                          setResetEmail(cleanInput);
                          setResetPhone('');
                        } else {
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
                      className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-md cursor-pointer"
                    >
                      {loading ? 'Signing In...' : 'Verify Password & Login'}
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
                  if (cleanInput.includes('@')) {
                    setResetEmail(cleanInput);
                    setResetPhone('');
                  } else {
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Date of Birth (Date / Month / Year) <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] font-mono font-bold text-rose-600 dark:text-rose-400">
                  {hasSelectedDob ? `Age: ${calculatedAge} yrs` : 'Select DOB'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  required
                  value={dobDay}
                  onChange={(e) => setDobDay(e.target.value)}
                  className={`w-full px-2 py-2 text-xs font-mono font-bold rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${
                    !dobDay ? 'text-slate-400 dark:text-slate-500' : ''
                  }`}
                >
                  <option value="" disabled>Date (DD)</option>
                  {DOB_DAYS.map((d) => (
                    <option key={d} value={d}>Date: {d}</option>
                  ))}
                </select>
                <select
                  required
                  value={dobMonth}
                  onChange={(e) => setDobMonth(e.target.value)}
                  className={`w-full px-2 py-2 text-xs font-mono font-bold rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${
                    !dobMonth ? 'text-slate-400 dark:text-slate-500' : ''
                  }`}
                >
                  <option value="" disabled>Month (MM)</option>
                  {DOB_MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <select
                  required
                  value={dobYear}
                  onChange={(e) => setDobYear(e.target.value)}
                  className={`w-full px-2 py-2 text-xs font-mono font-bold rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 ${
                    !dobYear ? 'text-slate-400 dark:text-slate-500' : ''
                  }`}
                >
                  <option value="" disabled>Year (YYYY)</option>
                  {DOB_YEARS.map((y) => (
                    <option key={y} value={y}>Year: {y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Gmail Address <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="email"
                    required
                    placeholder="Enter your Gmail address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Mobile Number (+91) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="tel"
                    required
                    placeholder="Enter your mobile number (+91)"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
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
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-md cursor-pointer"
            >
              {loading ? 'Creating Account...' : 'Create Account & Send Welcome Email'}
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
                  maxLength={6}
                  required
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-lg font-mono tracking-widest text-center rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otp.length < 4}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors shadow-md cursor-pointer"
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
                  <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Registered Gmail Address
                  </label>
                  <input
                    type="email"
                    required={!resetPhone.trim()}
                    placeholder="Enter your Gmail address"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Registered Mobile Number (+91)
                  </label>
                  <input
                    type="tel"
                    placeholder="Enter your mobile number (+91)"
                    value={resetPhone}
                    onChange={(e) => setResetPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm cursor-pointer"
                >
                  {loading ? 'Sending OTP...' : 'Send OTP to Gmail / Mobile'}
                </button>
              </form>
            )}

            {resetStep === 'verify_otp' && (
              <form onSubmit={handleVerifyResetOtp} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Enter 6-Digit Reset OTP
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="Enter 6-digit OTP"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tracking-wider text-center rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm cursor-pointer"
                >
                  {loading ? 'Verifying OTP...' : 'Verify OTP'}
                </button>
              </form>
            )}

            {resetStep === 'set_new_password' && (
              <form onSubmit={handleResetPassword} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    New Password
                  </label>
                  <input
                    type="password"
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
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm cursor-pointer"
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
