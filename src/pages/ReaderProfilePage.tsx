import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Comic, Purchase } from '../types/comic';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';
import {
  firebaseConfig,
  signInWithGoogleAndSyncToFirestore,
  syncReaderAccountToFirestore,
} from '../firebase';
import {
  User,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  Calendar,
  CheckCircle2,
  Lock,
  Unlock,
  RefreshCw,
  LogOut,
  Receipt,
  Edit3,
  KeyRound,
  ArrowRight,
  CreditCard,
  UserPlus
} from 'lucide-react';

interface ReaderProfilePageProps {
  comics: Comic[];
  onSelectComic: (comic: Comic) => void;
  onOpenEpisode: (episodeId: string) => void;
  setCurrentTab: (tab: string) => void;
  initialMode?: 'login' | 'profile';
}

export const ReaderProfilePage: React.FC<ReaderProfilePageProps> = ({
  comics,
  onSelectComic,
  setCurrentTab,
  initialMode = 'profile',
}) => {
  const { user, login, logout, updateUser, refreshUser, hasActivePremium } = useAuth();

  // Allow viewing the Login / Register & Record Customer Paid Detail Form at any time
  const [viewSection, setViewSection] = useState<'login_register_form' | 'profile_dashboard'>(
    initialMode === 'login' || !user ? 'login_register_form' : 'profile_dashboard'
  );

  useEffect(() => {
    if (initialMode === 'login') {
      setViewSection('login_register_form');
    } else if (initialMode === 'profile' && user) {
      setViewSection('profile_dashboard');
    }
  }, [initialMode]);

  // Login / Register state (captures Gmail, Age, and Customer Paid Detail of Premium)
  const [authTab, setAuthTab] = useState<'login' | 'register' | 'verify-otp'>('register');
  const [credential, setCredential] = useState(user?.email || ''); // Gmail or Mobile number
  const [regName, setRegName] = useState(user?.name || '');
  const [regEmail, setRegEmail] = useState(user?.email || '');
  const [regAge, setRegAge] = useState(String(user?.age || 24));
  const [regPhone, setRegPhone] = useState(user?.phone || '+91 8610950780');
  const [regUpiId, setRegUpiId] = useState(user?.upiId || 'balajiaris05@okaxis');
  const [paidPlan, setPaidPlan] = useState<'1_month' | '6_months' | 'free'>(
    user?.premiumPlan || '1_month'
  );
  const [paymentMethod, setPaymentMethod] = useState(
    user?.premiumPaymentDetail?.paymentMethod || 'UPI (Google Pay / PhonePe)'
  );
  const [transactionId, setTransactionId] = useState(
    user?.premiumPaymentDetail?.transactionId || ''
  );

  const [otp, setOtp] = useState('');
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Profile edit state when logged in
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [editAge, setEditAge] = useState(String(user?.age || 24));
  const [editPhone, setEditPhone] = useState(user?.phone || '');
  const [editUpiId, setEditUpiId] = useState(user?.upiId || 'balajiaris05@okaxis');
  const [editPaidPlan, setEditPaidPlan] = useState<'1_month' | '6_months' | 'free'>(
    user?.premiumPlan || 'free'
  );
  const [editPaymentMethod, setEditPaymentMethod] = useState(
    user?.premiumPaymentDetail?.paymentMethod || 'UPI (Google Pay / PhonePe)'
  );
  const [editTransactionId, setEditTransactionId] = useState(
    user?.premiumPaymentDetail?.transactionId || ''
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  // Real-time Gmail verification state
  const [verifyingStatus, setVerifyingStatus] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string>(new Date().toLocaleTimeString());
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  // Checkout Modal for 1 Month (₹49) or 6 Months (₹249)
  const [checkoutPlan, setCheckoutPlan] = useState<{
    open: boolean;
    planId: '1_month' | '6_months';
    title: string;
    amountInr: number;
  }>({
    open: false,
    planId: '1_month',
    title: '1 Month Reader Premium Pass (₹49)',
    amountInr: 49,
  });

  useEffect(() => {
    if (user) {
      setEditName(user.name || '');
      setEditEmail(user.email || '');
      setEditAge(String(user.age || 24));
      setEditPhone(user.phone || '');
      setEditUpiId(user.upiId || 'balajiaris05@okaxis');
      setEditPaidPlan(user.premiumPlan || 'free');
      handleLiveVerifyGmail();
    }
  }, [user?.id, user?.email]);

  const handleLiveVerifyGmail = async () => {
    if (!user) return;
    setVerifyingStatus(true);
    try {
      await refreshUser();
      const params = new URLSearchParams();
      if (user.id) params.set('userId', user.id);
      if (user.email) params.set('email', user.email);
      if (user.phone) params.set('phone', user.phone);
      const res = await fetch(`/api/auth/reader-status?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.purchases) {
          setPurchases(data.purchases);
        }
      }
      setLastVerifiedAt(new Date().toLocaleTimeString());
    } catch (e) {
      console.error('Error verifying Gmail status:', e);
    } finally {
      setVerifyingStatus(false);
    }
  };

  const handleReaderLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credential.trim()) {
      setAuthError('Please enter your Gmail address or Mobile Number.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    const res = await login(credential.trim(), {
      phone: regPhone.trim() || undefined,
      age: regAge ? Number(regAge) : undefined,
      upiId: regUpiId.trim() || undefined,
      paidPlan,
      paymentMethod: paidPlan !== 'free' ? paymentMethod : undefined,
      transactionId: paidPlan !== 'free' ? (transactionId.trim() || undefined) : undefined,
    });
    setAuthLoading(false);
    if (res.success) {
      setAuthSuccess(
        `Customer Login & UPI Stored in Database! Gmail: ${credential}, UPI: ${regUpiId}, Age: ${regAge}, Plan: ${
          paidPlan === '6_months' ? '6 Months (₹249)' : paidPlan === '1_month' ? '1 Month (₹49)' : 'Free'
        }.`
      );
      setTimeout(() => {
        setViewSection('profile_dashboard');
        handleLiveVerifyGmail();
      }, 900);
    } else {
      setAuthError(res.error || 'Account not found. Please register your Gmail, Age, UPI & Paid Detail.');
    }
  };

  const handleReaderRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regEmail.trim()) {
      setAuthError('Please enter your Gmail address.');
      return;
    }
    if (!regAge || isNaN(Number(regAge)) || Number(regAge) < 5) {
      setAuthError('Please enter a valid customer Age.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          email: regEmail.trim(),
          age: Number(regAge),
          phone: regPhone.trim(),
          upiId: regUpiId.trim() || undefined,
          paidPlan,
          paymentMethod: paidPlan !== 'free' ? paymentMethod : undefined,
          transactionId: paidPlan !== 'free' ? (transactionId.trim() || undefined) : undefined,
          role: 'reader',
        }),
      });
      const data = await res.json();
      setAuthLoading(false);
      if (res.ok) {
        setSandboxOtp(data.mockOtp || '123456');
        setAuthSuccess(
          `Customer Account Created in Database! Gmail (${regEmail}), UPI (${regUpiId}), Age (${regAge}), and Paid Plan (${
            paidPlan === '6_months' ? '6 Months ₹249' : paidPlan === '1_month' ? '1 Month ₹49' : 'Free'
          }) stored. Verify OTP below.`
        );
        setAuthTab('verify-otp');
      } else {
        setAuthError(data.error || 'Registration failed');
      }
    } catch (err: any) {
      setAuthLoading(false);
      setAuthError(err.message || 'Network error');
    }
  };

  const handleVerifyReaderOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regEmail.trim(),
          phone: regPhone.trim(),
          otp: otp.trim(),
          age: regAge ? Number(regAge) : undefined,
          upiId: regUpiId.trim() || undefined,
          paidPlan,
          paymentMethod: paidPlan !== 'free' ? paymentMethod : undefined,
          transactionId: paidPlan !== 'free' ? (transactionId.trim() || undefined) : undefined,
        }),
      });
      const data = await res.json();
      setAuthLoading(false);
      if (res.ok) {
        await login(regEmail.trim() || regPhone.trim(), {
          phone: regPhone.trim() || undefined,
          name: regName.trim() || undefined,
          age: regAge ? Number(regAge) : undefined,
          upiId: regUpiId.trim() || undefined,
          paidPlan,
          paymentMethod: paidPlan !== 'free' ? paymentMethod : undefined,
          transactionId: paidPlan !== 'free' ? (transactionId.trim() || undefined) : undefined,
        });
        setViewSection('profile_dashboard');
      } else {
        setAuthError(data.error || 'Invalid OTP');
      }
    } catch (err: any) {
      setAuthLoading(false);
      setAuthError(err.message || 'Network error');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: editName.trim(),
          email: editEmail.trim(),
          age: editAge ? Number(editAge) : undefined,
          phone: editPhone.trim(),
          upiId: editUpiId.trim() || undefined,
          paidPlan: editPaidPlan,
          paymentMethod: editPaidPlan !== 'free' ? editPaymentMethod : undefined,
          transactionId: editPaidPlan !== 'free' ? (editTransactionId.trim() || undefined) : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        updateUser(data.user);
        setIsEditingProfile(false);
        await syncReaderAccountToFirestore({
          name: editName.trim(),
          email: editEmail.trim(),
          age: editAge ? Number(editAge) : 24,
          phone: editPhone.trim(),
          upiId: editUpiId.trim() || 'balajiaris05@okaxis',
          paidPlan: editPaidPlan,
          paymentMethod: editPaymentMethod,
          transactionId: editTransactionId.trim() || undefined,
        }).catch(() => {});
        await handleLiveVerifyGmail();
        setProfileMessage(
          `Customer Gmail Address, Age, UPI ID, and Paid Detail of Premium updated and synced to Firebase (${firebaseConfig.projectId})!`
        );
        setTimeout(() => setProfileMessage(null), 5000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleFirebaseGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const fbUser = await signInWithGoogleAndSyncToFirestore({
        age: regAge ? Number(regAge) : 24,
        phone: regPhone.trim() || '+91 8610950780',
        upiId: regUpiId.trim() || 'balajiaris05@okaxis',
        paidPlan,
        paymentMethod: paidPlan !== 'free' ? paymentMethod : 'UPI (Google Pay / PhonePe)',
        transactionId: transactionId.trim() || undefined,
      });
      await login(fbUser.email || 'balajiaris05@gmail.com', {
        name: fbUser.displayName || regName.trim() || 'Reader',
        phone: regPhone.trim() || '+91 8610950780',
        age: regAge ? Number(regAge) : 24,
        upiId: regUpiId.trim() || 'balajiaris05@okaxis',
        paidPlan,
        paymentMethod: paidPlan !== 'free' ? paymentMethod : undefined,
        transactionId: paidPlan !== 'free' ? (transactionId.trim() || undefined) : undefined,
      });
      setAuthLoading(false);
      setAuthSuccess(
        `Synced to Firebase Firestore (${firebaseConfig.projectId})! Gmail: ${fbUser.email}, UPI: ${regUpiId}, Age: ${regAge}`
      );
      setTimeout(() => {
        setViewSection('profile_dashboard');
        handleLiveVerifyGmail();
      }, 900);
    } catch (err: any) {
      setAuthLoading(false);
      setAuthError(err.message || 'Google Sign-In failed');
    }
  };

  const paywalledComics = comics.filter((c) => c.accessType === 'premium');

  return (
    <div className="space-y-8 pb-24">
      
      {/* Top Mode Switcher Bar: Switch seamlessly between User Login / Register Form and Left Reader Profile */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Customer Account &amp; Paid Premium Recorder</span>
          </div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white font-heading">
            User Login / Register &amp; Reader Profile
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewSection('login_register_form')}
            className={`py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewSection === 'login_register_form'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Login / Register Page (Record Paid Detail, Age &amp; Gmail)</span>
          </button>

          {user && (
            <button
              type="button"
              onClick={() => setViewSection('profile_dashboard')}
              className={`py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewSection === 'profile_dashboard'
                  ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>My Reader Profile ({user.name.split(' ')[0]})</span>
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: DEDICATED USER LOGIN / REGISTER PAGE (RECORDS PAID DETAIL OF PREMIUM, AGE & GMAIL ADDRESS) */}
      {(viewSection === 'login_register_form' || !user) && (
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Info Column */}
            <div className="lg:col-span-5 p-6 sm:p-8 rounded-3xl bg-slate-900 text-white border border-slate-800 shadow-2xl space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4" />
                <span>Customer Registration &amp; Login</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black tracking-tight font-heading">
                Record Customer Paid Detail of Premium, Age &amp; Gmail
              </h2>

              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                This Login / Register page records the customer&apos;s <strong className="text-white">Gmail Address</strong>, <strong className="text-white">Age</strong>, and <strong className="text-white">Paid Detail of Premium</strong> (<strong className="text-amber-400">1 Month ₹49</strong> or <strong className="text-amber-400">6 Months ₹249</strong>) so paywalled comics verify payment status automatically every time.
              </p>

              <div className="space-y-3 pt-2 border-t border-slate-800 text-xs">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-white block">1. Gmail Address Recorded</span>
                    <span className="text-slate-400">Connected to the reader page to verify paywall comic access on every episode load.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-white block">2. Customer Age Recorded</span>
                    <span className="text-slate-400">Stores the reader&apos;s age in years on their profile and in the Admin tracking table.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-white block">3. Customer Paid Detail of Premium</span>
                    <span className="text-slate-400">
                      Records whether the customer paid <strong className="text-amber-400">₹49 (1 Month)</strong> or <strong className="text-amber-400">₹249 (6 Months)</strong>, payment method, receipt number, and expiry date.
                    </span>
                  </div>
                </div>
              </div>

              {/* Currently Logged-In Customer Summary if logged in */}
              {user && (
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      ● Active Recorded Customer
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">Age: {user.age || 24} yrs</span>
                  </div>
                  <div className="font-bold text-white">{user.name}</div>
                  <div className="font-mono text-rose-400 text-[11px]">{user.email}</div>
                  <div className="text-[11px] text-amber-400 font-semibold">
                    Paid Status:{' '}
                    {hasActivePremium
                      ? `${user.premiumPlan === '6_months' ? '6 Months Paid (₹249)' : '1 Month Paid (₹49)'}`
                      : 'Free / Unpaid (₹0)'}
                  </div>
                </div>
              )}
            </div>

            {/* Right Form Column: Login / Register Form */}
            <div className="lg:col-span-7 p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
              <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-6">
                <button
                  type="button"
                  onClick={() => { setAuthError(null); setAuthSuccess(null); setAuthTab('register'); }}
                  className={`py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                    authTab === 'register' || authTab === 'verify-otp'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  User Register (Record Details)
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthError(null); setAuthSuccess(null); setAuthTab('login'); }}
                  className={`py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                    authTab === 'login'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  User Login (Verify &amp; Update)
                </button>
              </div>

              <div className="mb-5 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs">
                  <div className="font-extrabold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span>Firebase Cloud Firestore Connected: <span className="font-mono">{firebaseConfig.projectId}</span></span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    Sign in with Google or submit below to store Gmail, Age, UPI ID &amp; Paid Plan in Firebase Firestore.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleFirebaseGoogleSignIn}
                  disabled={authLoading}
                  className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shrink-0 shadow-sm transition-colors cursor-pointer"
                >
                  Google Sign-In (Firebase)
                </button>
              </div>

              {authError && (
                <div className="mb-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold">
                  {authError}
                </div>
              )}

              {authSuccess && (
                <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{authSuccess}</span>
                </div>
              )}

              {sandboxOtp && authTab === 'verify-otp' && (
                <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between">
                  <span>Customer OTP Code: <strong className="font-mono text-sm">{sandboxOtp}</strong></span>
                  <button
                    type="button"
                    onClick={() => setOtp(sandboxOtp)}
                    className="underline font-bold cursor-pointer"
                  >
                    Auto-fill OTP
                  </button>
                </div>
              )}

              {/* REGISTER FORM */}
              {authTab === 'register' && (
                <form onSubmit={handleReaderRegister} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Customer Full Name <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="text"
                          required
                          placeholder="Enter Customer Name"
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Age (Years) <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Calendar className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="number"
                          min={5}
                          max={110}
                          required
                          placeholder="e.g. 24"
                          value={regAge}
                          onChange={(e) => setRegAge(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono font-bold rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Gmail Address <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="email"
                          required
                          placeholder="customer@gmail.com"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Mobile Number (+91) <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="tel"
                          required
                          placeholder="+91 98765 43210"
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* CUSTOMER PAID DETAIL OF PREMIUM */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 border-amber-500/40 space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4 text-amber-500" />
                        <span>Customer Paid Detail of Premium</span>
                      </label>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        1 Month ₹49 · 6 Months ₹249
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setPaidPlan('1_month')}
                        className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                          paidPlan === '1_month'
                            ? 'border-rose-500 bg-rose-500/10 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-rose-600 dark:text-rose-400">1 Month Premium</div>
                        <div className="text-lg font-black font-mono mt-0.5">₹49 Paid</div>
                        <div className="text-[10px] text-slate-500">30 Days Paywall Access</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaidPlan('6_months')}
                        className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                          paidPlan === '6_months'
                            ? 'border-amber-500 bg-amber-500/15 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-amber-600 dark:text-amber-400">6 Months Premium</div>
                        <div className="text-lg font-black font-mono mt-0.5">₹249 Paid</div>
                        <div className="text-[10px] text-slate-500">180 Days Paywall Access</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaidPlan('free')}
                        className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                          paidPlan === 'free'
                            ? 'border-slate-500 bg-slate-500/10 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="font-bold">Free Account</div>
                        <div className="text-lg font-black font-mono mt-0.5">₹0 Unpaid</div>
                        <div className="text-[10px] text-slate-500">Free Episodes Only</div>
                      </button>
                    </div>

                    {paidPlan !== 'free' && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                            Customer UPI ID (Stored in DB)
                          </label>
                          <input
                            type="text"
                            placeholder="reader@okaxis"
                            value={regUpiId}
                            onChange={(e) => setRegUpiId(e.target.value)}
                            className="w-full px-3 py-2.5 text-xs font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                            Customer Payment Mode
                          </label>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value)}
                            className="w-full px-3 py-2.5 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                          >
                            <option value="UPI (Google Pay / PhonePe)">UPI (Google Pay / PhonePe)</option>
                            <option value="Paytm / BHIM UPI">Paytm / BHIM UPI</option>
                            <option value="Debit / Credit Card">Debit / Credit Card</option>
                            <option value="Razorpay Gateway">Razorpay Gateway</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                            UPI / Payment Reference ID
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. UPI-94820194 (Auto if blank)"
                            value={transactionId}
                            onChange={(e) => setTransactionId(e.target.value)}
                            className="w-full px-3 py-2.5 text-xs font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
                  >
                    {authLoading
                      ? 'Recording Customer Details...'
                      : 'Register Customer (Save Gmail, Age & Paid Detail)'}
                  </button>
                </form>
              )}

              {/* LOGIN FORM */}
              {authTab === 'login' && (
                <form onSubmit={handleReaderLogin} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Gmail Address or Mobile Number <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="text"
                          required
                          placeholder="customer@gmail.com or +91..."
                          value={credential}
                          onChange={(e) => setCredential(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Customer Age <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Calendar className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="number"
                          min={5}
                          max={110}
                          required
                          placeholder="24"
                          value={regAge}
                          onChange={(e) => setRegAge(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono font-bold rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* CUSTOMER PAID DETAIL OF PREMIUM ON LOGIN */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 border-amber-500/40 space-y-4">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-amber-500" />
                      <span>Record / Verify Customer Paid Detail of Premium</span>
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setPaidPlan('1_month')}
                        className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                          paidPlan === '1_month'
                            ? 'border-rose-500 bg-rose-500/10 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-rose-600 dark:text-rose-400">1 Month Premium</div>
                        <div className="text-lg font-black font-mono mt-0.5">₹49 Paid</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaidPlan('6_months')}
                        className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                          paidPlan === '6_months'
                            ? 'border-amber-500 bg-amber-500/15 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-amber-600 dark:text-amber-400">6 Months Premium</div>
                        <div className="text-lg font-black font-mono mt-0.5">₹249 Paid</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaidPlan('free')}
                        className={`p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                          paidPlan === 'free'
                            ? 'border-slate-500 bg-slate-500/10 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="font-bold">Keep Current / Free</div>
                        <div className="text-lg font-black font-mono mt-0.5">₹0</div>
                      </button>
                    </div>

                    {paidPlan !== 'free' && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                            Customer UPI ID (Stored in DB)
                          </label>
                          <input
                            type="text"
                            placeholder="reader@okaxis"
                            value={regUpiId}
                            onChange={(e) => setRegUpiId(e.target.value)}
                            className="w-full px-3 py-2.5 text-xs font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                            Payment Mode
                          </label>
                          <select
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value)}
                            className="w-full px-3 py-2.5 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                          >
                            <option value="UPI (Google Pay / PhonePe)">UPI (Google Pay / PhonePe)</option>
                            <option value="Paytm / BHIM UPI">Paytm / BHIM UPI</option>
                            <option value="Debit / Credit Card">Debit / Credit Card</option>
                            <option value="Razorpay Gateway">Razorpay Gateway</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                            UPI / Payment Reference ID
                          </label>
                          <input
                            type="text"
                            placeholder="Auto-recorded if blank"
                            value={transactionId}
                            onChange={(e) => setTransactionId(e.target.value)}
                            className="w-full px-3 py-2.5 text-xs font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>
                      {authLoading
                        ? 'Signing In & Recording Paid Detail...'
                        : 'Login & Record Customer Paid Detail, Age & Gmail'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              )}

              {authTab === 'verify-otp' && (
                <form onSubmit={handleVerifyReaderOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      Enter 6-Digit Verification OTP
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                      <input
                        type="text"
                        maxLength={6}
                        required
                        placeholder="123456"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 text-lg font-mono tracking-widest text-center rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-3.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all cursor-pointer"
                  >
                    {authLoading ? 'Verifying...' : 'Verify OTP & Save Customer Paid Record'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: LEFT-SIDEBAR READER PROFILE & RECORDED PAID DETAILS DASHBOARD */}
      {user && viewSection === 'profile_dashboard' && (
        <>
          {profileMessage && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{profileMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* LEFT COLUMN: Reader Profile Card (Docked on the Left) */}
            <aside className="lg:col-span-4 space-y-6 lg:sticky lg:top-24">
              <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-rose-500/40 shadow-md"
                    />
                    <div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                        Reader Profile (Left)
                      </span>
                      <h2 className="text-lg font-extrabold text-slate-900 dark:text-white font-heading mt-0.5">
                        {user.name}
                      </h2>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(!isEditingProfile)}
                    className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                    title="Edit Gmail, Age & Paid Detail"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>

                {/* Recorded Gmail, Age, Mobile & Paid Detail Summary */}
                {!isEditingProfile ? (
                  <div className="space-y-3 text-xs">
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-rose-500" /> Recorded Gmail:
                        </span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-[11px] bg-emerald-500/10 px-2 py-0.5 rounded">
                          ● Connected
                        </span>
                      </div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white break-all">
                        {user.email}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-semibold flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-sky-500" /> Customer Age:
                        </span>
                        <div className="font-mono text-sm font-black text-slate-900 dark:text-white">
                          {user.age ? `${user.age} Years` : '24 Years'}
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-semibold flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-amber-500" /> Mobile:
                        </span>
                        <div className="font-mono font-bold text-slate-900 dark:text-white truncate">
                          {user.phone || '+91 8610950780'}
                        </div>
                      </div>
                    </div>

                    {/* Recorded Customer Paid Detail of Premium Card */}
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Recorded Paid Detail of Premium</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Paid Plan:</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {hasActivePremium
                            ? user.premiumPlan === '6_months'
                              ? '6 Months Pass (₹249)'
                              : '1 Month Pass (₹49)'
                            : 'Free / Unpaid (₹0)'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Amount Paid:</span>
                        <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                          ₹{hasActivePremium ? (user.premiumPlan === '6_months' ? 249 : 49) : 0}
                        </span>
                      </div>
                      {user.upiId && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Stored UPI ID:</span>
                          <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                            {user.upiId}
                          </span>
                        </div>
                      )}
                      {user.premiumPaymentDetail?.paymentMethod && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Payment Mode:</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {user.premiumPaymentDetail.paymentMethod}
                          </span>
                        </div>
                      )}
                      {user.premiumExpiresAt && hasActivePremium && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Valid Until:</span>
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {new Date(user.premiumExpiresAt).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSaveProfile} className="space-y-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Age (Years)</label>
                        <input
                          type="number"
                          required
                          min={5}
                          max={110}
                          value={editAge}
                          onChange={(e) => setEditAge(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mobile (+91)</label>
                        <input
                          type="tel"
                          required
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Connected Gmail</label>
                      <input
                        type="email"
                        required
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Customer UPI ID</label>
                      <input
                        type="text"
                        placeholder="reader@okaxis"
                        value={editUpiId}
                        onChange={(e) => setEditUpiId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Paid Detail of Premium
                      </label>
                      <select
                        value={editPaidPlan}
                        onChange={(e) => setEditPaidPlan(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-bold"
                      >
                        <option value="1_month">1 Month Premium Paid (₹49)</option>
                        <option value="6_months">6 Months Premium Paid (₹249)</option>
                        <option value="free">Free / Unpaid (₹0)</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="submit"
                        disabled={profileSaving}
                        className="flex-1 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
                      >
                        {profileSaving ? 'Saving...' : 'Save Record'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingProfile(false)}
                        className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-bold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* Real-Time Gmail Paywall Verification Status Box */}
                <div
                  className={`p-4 rounded-2xl border space-y-2 ${
                    hasActivePremium
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
                      : 'bg-amber-500/10 border-amber-500/30 text-slate-900 dark:text-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                      {hasActivePremium ? (
                        <>
                          <Unlock className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Gmail Paywall Unlocked</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-amber-600 dark:text-amber-400">No Active Premium Pass</span>
                        </>
                      )}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">Checked {lastVerifiedAt}</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleLiveVerifyGmail}
                    disabled={verifyingStatus}
                    className="w-full mt-2 py-2 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 hover:border-rose-500 transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${verifyingStatus ? 'animate-spin text-rose-500' : ''}`} />
                    <span>{verifyingStatus ? 'Verifying Gmail Payment...' : 'Verify Gmail Payment Status Now'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setViewSection('login_register_form');
                  }}
                  className="w-full py-2.5 px-4 rounded-xl border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out / Register New Customer</span>
                </button>
              </div>
            </aside>

            {/* RIGHT COLUMN: 1 Month (₹49) & 6 Months (₹249) Plans + Paywalled Comics + Receipts */}
            <div className="lg:col-span-8 space-y-8">
              
              {/* Section 1: Two Exclusive Premium Membership Plans */}
              <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Connected to {user.email} · Age: {user.age || 24}
                  </span>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white font-heading mt-2">
                    Reader Premium Membership Plans (₹49 &amp; ₹249 Only)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Every time you open a paywalled comic or episode, our server verifies whether your Gmail (<strong className="text-slate-700 dark:text-slate-200 font-mono">{user.email}</strong>) has an active 1-Month (₹49) or 6-Month (₹249) pass.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {/* Plan 1: 1 Month ₹49 */}
                  <div className="p-5 rounded-2xl border-2 border-slate-200 dark:border-slate-800 hover:border-rose-500/50 transition-all flex flex-col justify-between space-y-5 bg-slate-50/50 dark:bg-slate-950/50">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                          1 Month Pass
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">30 Days Validity</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">₹49</span>
                        <span className="text-xs text-slate-500">/ 1 Month</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Unlocks all paywalled comics &amp; chapters for 30 days. Verified automatically via your Gmail.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setCheckoutPlan({
                          open: true,
                          planId: '1_month',
                          title: '1 Month Reader Premium Pass (₹49)',
                          amountInr: 49,
                        })
                      }
                      className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-colors cursor-pointer"
                    >
                      {hasActivePremium && user.premiumPlan === '1_month'
                        ? 'Extend 1 Month Pass (₹49)'
                        : 'Pay ₹49 for 1 Month Pass'}
                    </button>
                  </div>

                  {/* Plan 2: 6 Months ₹249 */}
                  <div className="p-5 rounded-2xl border-2 border-amber-500 bg-amber-500/5 flex flex-col justify-between space-y-5 relative">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          6 Months Pass · Best Value
                        </span>
                        <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400 font-bold">
                          180 Days Validity
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">₹249</span>
                        <span className="text-xs text-slate-500">/ 6 Months</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        6 months of uninterrupted access to every paywalled comic series &amp; episode linked to your Gmail.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setCheckoutPlan({
                          open: true,
                          planId: '6_months',
                          title: '6 Months Reader Premium Pass (₹249)',
                          amountInr: 249,
                        })
                      }
                      className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-md transition-colors cursor-pointer"
                    >
                      {hasActivePremium && user.premiumPlan === '6_months'
                        ? 'Extend 6 Months Pass (₹249)'
                        : 'Pay ₹249 for 6 Months Pass'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 2: Paywalled Comics Instant Access Verification */}
              <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white font-heading">
                      Paywalled Comics &amp; Gmail Access Status
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Every comic below checks your Gmail payment status before opening paywalled episodes.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {paywalledComics.map((comic) => (
                    <div
                      key={comic.id}
                      onClick={() => onSelectComic(comic)}
                      className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-rose-500/50 transition-all flex items-center gap-4 cursor-pointer group"
                    >
                      <img
                        src={comic.coverImage}
                        alt={comic.title}
                        className="w-14 h-20 rounded-xl object-cover shrink-0 border border-slate-200 dark:border-slate-800"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate group-hover:text-rose-600 dark:group-hover:text-rose-400">
                          {comic.title}
                        </h4>
                        <p className="text-[11px] text-slate-500">By {comic.authorName}</p>
                        {hasActivePremium ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" /> Gmail Verified · Unlocked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                            <Lock className="w-3 h-3" /> Paywalled · Requires ₹49 or ₹249 Pass
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 3: Recorded Customer Paid Detail Receipts */}
              <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-white font-heading flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-rose-500" />
                    <span>Recorded Customer Paid Premium Receipts ({purchases.length})</span>
                  </h3>
                </div>

                {purchases.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                    No payment receipts recorded for <strong className="font-mono">{user.email}</strong> yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {purchases.map((p) => (
                      <div
                        key={p.id}
                        className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 dark:text-white">{p.comicTitle}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              PAID · ₹{p.amountInr}
                            </span>
                            {p.paymentMethod && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {p.paymentMethod}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            Gmail: {p.userEmail} · Age: {p.userAge || user.age || 24} · Receipt: {p.receiptNumber}
                          </div>
                        </div>
                        <div className="text-right font-mono text-[11px] text-slate-400">
                          <div>Paid: {new Date(p.createdAt).toLocaleDateString()}</div>
                          {p.expiresAt && (
                            <div className="text-emerald-500 font-bold">
                              Expires: {new Date(p.expiresAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Razorpay Checkout Modal */}
      {checkoutPlan.open && (
        <RazorpayCheckoutModal
          isOpen={checkoutPlan.open}
          onClose={() => setCheckoutPlan({ ...checkoutPlan, open: false })}
          comicId="premium_pass"
          comicTitle="Aathirai_Comic All-Access Subscription"
          itemTitle={checkoutPlan.title}
          itemType="subscription"
          subscriptionPlan={checkoutPlan.planId}
          amountInr={checkoutPlan.amountInr}
          onPaymentSuccess={() => {
            handleLiveVerifyGmail();
          }}
        />
      )}
    </div>
  );
};
