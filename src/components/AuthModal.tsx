import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Mail,
  Lock,
  User,
  Phone,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Calendar,
  CreditCard
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullReaderPage?: () => void;
}

type AuthMode = 'login' | 'register' | 'verify-otp' | 'forgot-password' | 'reset-password';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onOpenFullReaderPage }) => {
  const { login } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [credential, setCredential] = useState(''); // Gmail or Mobile number for login
  const [email, setEmail] = useState(''); // Gmail for registration
  const [age, setAge] = useState('22'); // Customer Age
  const [phone, setPhone] = useState(''); // Mobile number for tracking
  const [paidPlan, setPaidPlan] = useState<'free' | '1_month' | '6_months'>('1_month');
  const [paymentMethod, setPaymentMethod] = useState('UPI (Google Pay / PhonePe)');
  const [transactionId, setTransactionId] = useState('');
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
    if (!credential.trim()) {
      setError('Please enter your Gmail address or Mobile Number.');
      return;
    }
    setLoading(true);
    setError(null);

    const parsedAge = age ? Number(age) : undefined;
    const res = await login(credential.trim(), {
      phone: phone.trim() || undefined,
      age: parsedAge,
      paidPlan,
      paymentMethod: paidPlan !== 'free' ? paymentMethod : undefined,
      transactionId: paidPlan !== 'free' ? (transactionId.trim() || undefined) : undefined,
    });
    setLoading(false);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Failed to sign in. Please check your Gmail / Mobile Number or Register.');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) {
      setError('Please provide your Gmail address.');
      return;
    }
    if (!age || isNaN(Number(age)) || Number(age) < 5) {
      setError('Please enter a valid age.');
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
          age: Number(age),
          phone: phone.trim(),
          paidPlan,
          paymentMethod: paidPlan !== 'free' ? paymentMethod : undefined,
          transactionId: paidPlan !== 'free' ? (transactionId.trim() || undefined) : undefined,
          role: 'reader',
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSuccessMsg(`Recorded Gmail (${email}), Age (${age}) & Paid Detail! OTP sent.`);
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
        body: JSON.stringify({
          email: email.trim(),
          phone: phone.trim(),
          otp,
          age: age ? Number(age) : undefined,
          paidPlan,
          paymentMethod,
          transactionId: transactionId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        await login(email.trim() || phone.trim(), {
          phone: phone.trim() || undefined,
          name: name.trim() || undefined,
          age: age ? Number(age) : undefined,
          paidPlan,
          paymentMethod,
          transactionId: transactionId.trim() || undefined,
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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() || credential.trim() }),
      });
      const data = await res.json();
      setLoading(false);
      if (res.ok) {
        setSandboxOtp(data.mockOtp || '123456');
        setSuccessMsg(`Reset code sent to ${email || credential}`);
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
        body: JSON.stringify({ email: email.trim() || credential.trim(), otp, newPassword }),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-900 dark:text-slate-100 my-8">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="mb-4">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase tracking-wider mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Customer Gmail · Age · Paid Premium Recorder</span>
          </div>
          <h3 className="text-xl font-bold tracking-tight font-heading">
            {mode === 'login' && 'User Login & Paid Premium Record'}
            {mode === 'register' && 'Register User (Gmail, Age & Paid Detail)'}
            {mode === 'verify-otp' && 'Verify Customer OTP'}
            {mode === 'forgot-password' && 'Reset Password'}
            {mode === 'reset-password' && 'Enter Reset Code'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            Records your <strong>Gmail address</strong>, <strong>Age</strong>, and <strong>Customer Paid Detail of Premium</strong> (<strong>1 Month ₹49</strong> or <strong>6 Months ₹249</strong>) for instant paywall verification and Admin tracking.
          </p>
        </div>

        {/* Mode Switch Tabs (Login vs Register) */}
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
              User Login
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
              User Register
            </button>
          </div>
        )}

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
            <span>Verification Code: <strong className="font-mono text-sm tracking-wider">{sandboxOtp}</strong></span>
            <button
              type="button"
              onClick={() => setOtp(sandboxOtp)}
              className="text-[11px] underline font-semibold hover:text-amber-500 cursor-pointer"
            >
              Auto-fill OTP
            </button>
          </div>
        )}

        {/* LOGIN FORM */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Gmail Address <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="yourname@gmail.com"
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Customer Age <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="number"
                    min={5}
                    max={110}
                    required
                    placeholder="22"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* Customer Paid Detail of Premium Section */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3">
              <label className="block text-xs font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Customer Paid Detail of Premium
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setPaidPlan('1_month')}
                  className={`p-2 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    paidPlan === '1_month'
                      ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div>1 Month</div>
                  <div className="font-mono text-sm font-black">₹49 Paid</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaidPlan('6_months')}
                  className={`p-2 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    paidPlan === '6_months'
                      ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div>6 Months</div>
                  <div className="font-mono text-sm font-black">₹249 Paid</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaidPlan('free')}
                  className={`p-2 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    paidPlan === 'free'
                      ? 'border-slate-500 bg-slate-500/10 text-slate-800 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div>Free Reader</div>
                  <div className="font-mono text-sm">₹0 Unpaid</div>
                </button>
              </div>

              {paidPlan !== 'free' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Payment Mode
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    >
                      <option value="UPI (Google Pay / PhonePe)">UPI (Google Pay / PhonePe)</option>
                      <option value="Paytm / BHIM UPI">Paytm / BHIM UPI</option>
                      <option value="Debit / Credit Card">Debit / Credit Card</option>
                      <option value="Razorpay Instant Pay">Razorpay Instant Pay</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Paid Ref / Transaction ID
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-recorded if blank"
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-md disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Recording & Signing In...' : 'Login & Record Customer Details'}
            </button>

            {onOpenFullReaderPage && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenFullReaderPage();
                  }}
                  className="text-xs text-rose-600 dark:text-rose-400 font-bold hover:underline cursor-pointer"
                >
                  Open Full-Screen User Login / Register Page →
                </button>
              </div>
            )}
          </form>
        )}

        {/* REGISTER FORM */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Customer Full Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="Enter full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Age (Years) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="number"
                    min={5}
                    max={110}
                    required
                    placeholder="22"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
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
                    placeholder="customer@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Mobile Number (+91)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>
            </div>

            {/* Customer Paid Detail of Premium Section */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5">
              <label className="block text-xs font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" />
                <span>Customer Paid Detail of Premium</span>
              </label>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setPaidPlan('1_month')}
                  className={`p-2 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    paidPlan === '1_month'
                      ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div>1 Month</div>
                  <div className="font-mono text-sm font-black">₹49 Paid</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaidPlan('6_months')}
                  className={`p-2 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    paidPlan === '6_months'
                      ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div>6 Months</div>
                  <div className="font-mono text-sm font-black">₹249 Paid</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaidPlan('free')}
                  className={`p-2 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    paidPlan === 'free'
                      ? 'border-slate-500 bg-slate-500/10 text-slate-800 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div>Free Reader</div>
                  <div className="font-mono text-sm">₹0 Unpaid</div>
                </button>
              </div>

              {paidPlan !== 'free' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Payment Mode
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    >
                      <option value="UPI (Google Pay / PhonePe)">UPI (Google Pay / PhonePe)</option>
                      <option value="Paytm / BHIM UPI">Paytm / BHIM UPI</option>
                      <option value="Debit / Credit Card">Debit / Credit Card</option>
                      <option value="Razorpay Instant Pay">Razorpay Instant Pay</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Paid Ref / Transaction ID
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. UPI-84920192"
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-md disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Recording Customer Details...' : 'Register & Save Paid Premium Record'}
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
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Verifying...' : 'Verify & Complete Login'}
            </button>
          </form>
        )}

        {mode === 'forgot-password' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Your Registered Gmail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="reader@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Sending Code...' : 'Send Reset Code'}
            </button>
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
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors shadow-md disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Updating Password...' : 'Save New Password'}
            </button>
          </form>
        )}

      </div>
    </div>
  );
};
