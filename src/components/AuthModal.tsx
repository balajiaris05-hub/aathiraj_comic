import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { X, Mail, Lock, User, ArrowRight, CheckCircle2, KeyRound } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthMode = 'login' | 'register' | 'verify-otp' | 'forgot-password' | 'reset-password';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { login } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setError(null);
    setSuccessMsg(null);
    setSandboxOtp(null);
    setOtp('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await login(email);
    setLoading(false);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Failed to sign in. Verify email or register.');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role: 'reader' }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSuccessMsg(`Verification code sent to ${email}`);
        setSandboxOtp(data.mockOtp || '123456');
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
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        await login(email);
        onClose();
      } else {
        setError(data.error || 'Invalid OTP code');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSandboxOtp(data.mockOtp || '123456');
        setSuccessMsg(`Reset code sent to ${email}`);
        setMode('reset-password');
      } else {
        setError(data.error || 'Could not send reset code');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, newPassword }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSuccessMsg('Password updated! You can now log in.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-900 dark:text-slate-100">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="mb-5">
          <h3 className="text-xl font-bold tracking-tight">
            {mode === 'login' && 'Sign In to Aathirai_Comic'}
            {mode === 'register' && 'Create Reader Account'}
            {mode === 'verify-otp' && 'Verify Email Address'}
            {mode === 'forgot-password' && 'Forgot Password'}
            {mode === 'reset-password' && 'Enter Reset Code & New Password'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {mode === 'login' && 'Access bookmarks, purchases, comments, and high-res episodes.'}
            {mode === 'register' && 'No mobile phone number required. Verified via email OTP.'}
            {mode === 'verify-otp' && `Enter the 6-digit code sent to ${email}`}
            {mode === 'forgot-password' && 'We will send a 6-digit security code to your email.'}
            {mode === 'reset-password' && 'Set a new secure password for your account.'}
          </p>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Sandbox OTP Helper banner if available */}
        {sandboxOtp && (
          <div className="mb-4 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between">
            <span>Demo Verification Code: <strong className="font-mono text-sm tracking-wider">{sandboxOtp}</strong></span>
            <button
              type="button"
              onClick={() => setOtp(sandboxOtp)}
              className="text-[11px] underline font-semibold hover:text-amber-500"
            >
              Auto-fill OTP
            </button>
          </div>
        )}

        {/* FORMS */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="reader@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => { resetState(); setMode('forgot-password'); }}
                  className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>

            <div className="pt-2 text-center text-xs text-slate-500">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => { resetState(); setMode('register'); }}
                className="font-semibold text-rose-600 dark:text-rose-400 hover:underline"
              >
                Register now
              </button>
            </div>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="Your Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="you@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="password"
                  required
                  placeholder="Create strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Continue to OTP Verification'}
            </button>

            <div className="pt-2 text-center text-xs text-slate-500">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { resetState(); setMode('login'); }}
                className="font-semibold text-rose-600 dark:text-rose-400 hover:underline"
              >
                Log In
              </button>
            </div>
          </form>
        )}

        {mode === 'verify-otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Enter 6-Digit Email Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-lg font-mono tracking-widest text-center rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otp.length < 4}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify & Complete Login'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setMode('register')}
                className="text-xs text-slate-500 hover:underline"
              >
                Change registration email
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot-password' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Your Account Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="reader@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50"
            >
              {loading ? 'Sending Code...' : 'Send Reset Code'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => { resetState(); setMode('login'); }}
                className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
              >
                Back to Sign In
              </button>
            </div>
          </form>
        )}

        {mode === 'reset-password' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                6-Digit Reset Code
              </label>
              <input
                type="text"
                required
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tracking-wider text-center rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                New Password
              </label>
              <input
                type="password"
                required
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50"
            >
              {loading ? 'Updating Password...' : 'Save New Password'}
            </button>
          </form>
        )}

      </div>
    </div>
  );
};
