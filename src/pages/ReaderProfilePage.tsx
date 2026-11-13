import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Comic, Purchase } from '../types/comic';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';
import {
  signInWithGoogleAndSyncToFirestore,
  syncReaderAccountToFirestore,
} from '../firebase';
import {
  User,
  Mail,
  Phone,
  ShieldCheck,
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
  UserPlus,
  Bell,
  BellOff,
  Eye,
  EyeOff,
  AlertTriangle,
  Download,
  Camera,
} from 'lucide-react';

interface ReaderProfilePageProps {
  comics: Comic[];
  onSelectComic: (comic: Comic) => void;
  onOpenEpisode: (episodeId: string) => void;
  setCurrentTab: (tab: string) => void;
  initialMode?: 'login' | 'profile';
}

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

export const ReaderProfilePage: React.FC<ReaderProfilePageProps> = ({
  comics,
  onSelectComic,
  setCurrentTab,
  initialMode = 'profile',
}) => {
  const { user, login, logout, updateUser, refreshUser, hasActivePremium } = useAuth();

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

  // Parse existing user DOB (DD/MM/YYYY) if present for profile dashboard editing only
  const initialDobParts = (user?.dob || '15/05/2002').split('/');
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');

  const [authTab, setAuthTab] = useState<'login' | 'register' | 'verify-otp' | 'change-password'>('login');
  const [credential, setCredential] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Returning customer 2-step identity & password verification + 3-attempt lockout state
  const [identityVerified, setIdentityVerified] = useState(false);
  const [verifiedCustomerName, setVerifiedCustomerName] = useState('');
  const [remainingAttempts, setRemainingAttempts] = useState<number>(3);
  const [isAccountLocked, setIsAccountLocked] = useState<boolean>(false);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);

  // First-time customer register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regAvatar, setRegAvatar] = useState<string>('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);
  const [welcomeEmailNotice, setWelcomeEmailNotice] = useState<{
    to: string;
    subject: string;
    body?: string;
    message?: string;
  } | null>(null);
  const regAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement | null>(null);

  // Change / Forgot Password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetSandboxOtp, setResetSandboxOtp] = useState<string | null>(null);
  const [resetStep, setResetStep] = useState<'request_otp' | 'verify_otp' | 'set_new_password'>('request_otp');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const [notifyGmail, setNotifyGmail] = useState<boolean>(user?.notifyGmail ?? true);
  const [notifyMobile, setNotifyMobile] = useState<boolean>(user?.notifyMobile ?? true);

  const hasSelectedDob = Boolean(dobDay && dobMonth && dobYear);
  const calculatedAge = hasSelectedDob ? calculateAgeFromDob(dobDay, dobMonth, dobYear) : 22;
  const formattedDob = hasSelectedDob ? `${dobDay}/${dobMonth}/${dobYear}` : '';

  const [otp, setOtp] = useState('');
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Profile edit state when logged in
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [editPhone, setEditPhone] = useState(user?.phone || '');
  const [editAvatar, setEditAvatar] = useState(user?.avatar || '');
  const [editDobDay, setEditDobDay] = useState(initialDobParts[0] || '15');
  const [editDobMonth, setEditDobMonth] = useState(initialDobParts[1] || '05');
  const [editDobYear, setEditDobYear] = useState(initialDobParts[2] || '2002');
  const [editNotifyGmail, setEditNotifyGmail] = useState<boolean>(user?.notifyGmail ?? true);
  const [editNotifyMobile, setEditNotifyMobile] = useState<boolean>(user?.notifyMobile ?? true);
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
      setEditPhone(user.phone || '');
      const parts = (user.dob || '15/05/2002').split('/');
      if (parts.length === 3) {
        setEditDobDay(parts[0]);
        setEditDobMonth(parts[1]);
        setEditDobYear(parts[2]);
      }
      setEditNotifyGmail(user.notifyGmail ?? true);
      setEditNotifyMobile(user.notifyMobile ?? true);
      handleLiveVerifyGmail();
    } else {
      setViewSection('login_register_form');
      setPurchases([]);
    }
  }, [user?.id, user?.email]);

  const [downloadedReceiptId, setDownloadedReceiptId] = useState<string | null>(null);

  const handleDownloadReceipt = (p: Purchase) => {
    const receiptDate = p.createdAt
      ? new Date(p.createdAt).toLocaleString()
      : new Date().toLocaleString();
    const expiryDate = p.expiresAt
      ? new Date(p.expiresAt).toLocaleDateString()
      : null;

    const receiptHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Payment Receipt - ${p.receiptNumber}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      padding: 40px 20px;
      margin: 0;
    }
    .card {
      max-width: 520px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06);
    }
    .brand {
      font-size: 20px;
      font-weight: 800;
      color: #e11d48;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      font-size: 13px;
      border-bottom: 1px dashed #e2e8f0;
    }
    .label {
      color: #64748b;
      font-weight: 500;
    }
    .value {
      color: #0f172a;
      font-weight: 700;
      text-align: right;
      font-family: monospace;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 16px;
      margin-top: 8px;
      font-size: 16px;
      font-weight: 800;
    }
    .total-val {
      color: #059669;
      font-family: monospace;
    }
    .footer {
      margin-top: 28px;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">Aathirai_Comic — Official Payment Receipt</div>
    <div class="subtitle">Verified Digital Purchase Receipt · Date: ${receiptDate}</div>
    <div class="row">
      <span class="label">Receipt Number</span>
      <span class="value">${p.receiptNumber}</span>
    </div>
    <div class="row">
      <span class="label">Transaction ID</span>
      <span class="value">${p.razorpayPaymentId}</span>
    </div>
    <div class="row">
      <span class="label">Plan / Item Purchased</span>
      <span class="value" style="font-family: sans-serif;">${p.comicTitle}</span>
    </div>
    <div class="row">
      <span class="label">Customer Account</span>
      <span class="value">${p.userEmail}</span>
    </div>
    <div class="row">
      <span class="label">Payment Channel</span>
      <span class="value" style="font-family: sans-serif;">${p.paymentMethod || 'UPI / Card'}</span>
    </div>
    ${
      expiryDate
        ? `<div class="row">
      <span class="label">Plan Valid Until</span>
      <span class="value">${expiryDate}</span>
    </div>`
        : ''
    }
    <div class="row">
      <span class="label">Plan Price</span>
      <span class="value">₹${p.amountInr.toFixed(2)}</span>
    </div>
    <div class="total-row">
      <span>Total Amount Paid</span>
      <span class="total-val">₹${p.amountInr.toFixed(2)} INR</span>
    </div>
    <div class="footer">
      Thank you for supporting Aathirai_Comic!
    </div>
  </div>
</body>
</html>`;

    try {
      const blob = new Blob([receiptHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Receipt-${p.receiptNumber || 'Aathirai_Comic'}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setDownloadedReceiptId(p.id);
      setTimeout(() => setDownloadedReceiptId(null), 3000);
    } catch {
      // Ignore if restricted
    }
  };

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
    } catch {
      // Silently ignore transient network error during status refresh
    } finally {
      setVerifyingStatus(false);
    }
  };

  // Step 1 of Returning Customer Login: Verify Gmail & Mobile Number
  const handleVerifyCustomerIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credential.trim() && !loginPhone.trim()) {
      setAuthError('Please enter your Gmail address and/or Mobile Number to verify your account.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await fetch('/api/auth/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credential.trim(),
          phone: loginPhone.trim(),
        }),
      });
      const data = await res.json();
      setAuthLoading(false);
      if (res.ok && data.verified) {
        setIdentityVerified(true);
        setVerifiedCustomerName(data.name || '');
        if (data.email && !credential.trim()) setCredential(data.email);
        if (data.phone && !loginPhone.trim()) setLoginPhone(data.phone);
        setIsAccountLocked(Boolean(data.isLocked));
        setLockedUntilIso(data.lockedUntil || null);
        setRemainingAttempts(typeof data.remainingAttempts === 'number' ? data.remainingAttempts : 3);
        if (data.isLocked) {
          setAuthError(
            data.error ||
              'Account locked due to 3 failed password attempts. Please try again after 12 hours or reset your password via Forgot Password.'
          );
        } else {
          setAuthSuccess(
            `Gmail & Mobile Number verified for ${data.name || data.email}! Please enter your account password below.`
          );
        }
      } else {
        setIdentityVerified(false);
        setAuthError(data.error || 'Customer account not found. Please register in First-Time Customer Register.');
      }
    } catch (err: any) {
      setAuthLoading(false);
      setAuthError(err.message || 'Network error while verifying customer identity.');
    }
  };

  // Step 2 of Returning Customer Login: Verify Account Password (with 3-attempt / 12-hour lock)
  const handleReaderLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identityVerified) {
      await handleVerifyCustomerIdentity(e);
      return;
    }
    if (isAccountLocked) {
      setAuthError(
        'Your account is locked for 12 hours after 3 failed password attempts. Please try again after 12 hours or click Forgot Password to reset via OTP.'
      );
      return;
    }
    if (!loginPassword) {
      setAuthError('Please enter your account password to sign in.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    const res = await login(credential.trim(), {
      phone: loginPhone.trim() || undefined,
      password: loginPassword,
      notifyGmail,
      notifyMobile,
    });
    setAuthLoading(false);
    if (res.success) {
      setIsAccountLocked(false);
      setRemainingAttempts(3);
      setLoginPassword('');
      setAuthSuccess('Password verified! Signed in with your Gmail & Mobile Number.');
      setTimeout(() => {
        setViewSection('profile_dashboard');
        handleLiveVerifyGmail();
      }, 800);
    } else {
      if (res.isLocked) {
        setIsAccountLocked(true);
        setLockedUntilIso(res.lockedUntil || null);
        setRemainingAttempts(0);
      } else if (typeof res.remainingAttempts === 'number') {
        setRemainingAttempts(res.remainingAttempts);
      }
      setAuthError(
        res.error || 'Incorrect password. Please try again or use Forgot Password.'
      );
    }
  };

  const openChangePasswordTab = (prefillEmail?: string, prefillPhone?: string) => {
    setResetEmail((prefillEmail ?? credential).trim() || regEmail.trim());
    setResetPhone((prefillPhone ?? loginPhone).trim() || regPhone.trim());
    setResetOtp('');
    setResetSandboxOtp(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setResetStep('request_otp');
    setAuthError(null);
    setAuthSuccess(null);
    setAuthTab('change-password');
  };

  const handleRequestPasswordResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim() && !resetPhone.trim()) {
      setAuthError('Please enter your registered Gmail address or Mobile Number to receive the OTP.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: resetEmail.trim(),
          phone: resetPhone.trim(),
        }),
      });
      const data = await res.json();
      setAuthLoading(false);
      if (res.ok) {
        setResetSandboxOtp(data.mockOtp || '123456');
        setResetStep('verify_otp');
        setAuthSuccess(
          data.message || 'A 6-digit OTP has been sent to your registered Gmail and Mobile Number.'
        );
      } else {
        setAuthError(data.error || 'Could not send password reset OTP.');
      }
    } catch (err: any) {
      setAuthLoading(false);
      setAuthError(err.message || 'Network error');
    }
  };

  const handleVerifyResetOtpStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetOtp.trim()) {
      setAuthError('Please enter the 6-digit OTP sent to your Gmail or Mobile Number.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await fetch('/api/auth/verify-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: resetEmail.trim(),
          phone: resetPhone.trim(),
          otp: resetOtp.trim(),
        }),
      });
      const data = await res.json();
      setAuthLoading(false);
      if (res.ok && data.verified) {
        setResetStep('set_new_password');
        setAuthSuccess('OTP verified! Please enter your New Password and Confirm Password below.');
      } else {
        setAuthError(data.error || 'Invalid OTP. Please check and try again.');
      }
    } catch (err: any) {
      setAuthLoading(false);
      setAuthError(err.message || 'Network error');
    }
  };

  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 4) {
      setAuthError('Please enter a New Password with at least 4 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setAuthError('New Password and Confirm Password do not match.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
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
      setAuthLoading(false);
      if (res.ok && data.success) {
        // Unlock local login state and return to Returning Customer Login page
        setIsAccountLocked(false);
        setLockedUntilIso(null);
        setRemainingAttempts(3);
        setCredential(resetEmail.trim() || credential);
        setLoginPhone(resetPhone.trim() || loginPhone);
        setIdentityVerified(true);
        setLoginPassword('');
        setAuthTab('login');
        setAuthSuccess(
          data.message ||
            'Password updated in backend & account unlocked! Please enter your new password below to sign in.'
        );
      } else {
        setAuthError(data.error || 'Failed to update password.');
      }
    } catch (err: any) {
      setAuthLoading(false);
      setAuthError(err.message || 'Network error');
    }
  };

  const handleRegAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRegAvatar(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAccountHolderPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const newAvatarDataUrl = reader.result;
        setEditAvatar(newAvatarDataUrl);
        updateUser({ avatar: newAvatarDataUrl });
        try {
          const res = await fetch('/api/auth/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.id,
              avatar: newAvatarDataUrl,
            }),
          });
          const data = await res.json();
          if (res.ok && data.user) {
            updateUser(data.user);
            setProfileMessage('Account holder profile image uploaded and saved to your account!');
            setTimeout(() => setProfileMessage(null), 5000);
          }
        } catch (err) {
          console.error(err);
        }
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleReaderRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regEmail.trim()) {
      setAuthError('Please enter your Gmail address.');
      return;
    }
    if (!dobDay || !dobMonth || !dobYear) {
      setAuthError('Please select your Date of Birth (Date, Month, and Year).');
      return;
    }
    if (!regPassword || regPassword.length < 4) {
      setAuthError('Please create a Password (minimum 4 characters).');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setAuthError('Password and Confirm Password do not match.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          email: regEmail.trim(),
          age: calculatedAge,
          dob: formattedDob,
          phone: regPhone.trim(),
          avatar: regAvatar || undefined,
          password: regPassword,
          confirmPassword: regConfirmPassword,
          notifyGmail,
          notifyMobile,
          role: 'reader',
        }),
      });
      const data = await res.json();
      setAuthLoading(false);
      if (res.ok) {
        if (data.user) {
          await syncReaderAccountToFirestore(data.user);
        }
        if (data.welcomeEmail) {
          setWelcomeEmailNotice(data.welcomeEmail);
        }
        setSandboxOtp(data.mockOtp || '123456');
        setAuthSuccess(
          `Welcome to Aathirai_Comic! Account created & stored in backend database. Confirmation email sent to ${regEmail.trim()}. Please verify OTP below.`
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
          age: calculatedAge,
          dob: formattedDob,
          notifyGmail,
          notifyMobile,
        }),
      });
      const data = await res.json();
      setAuthLoading(false);
      if (res.ok) {
        await login(regEmail.trim() || regPhone.trim(), {
          phone: regPhone.trim() || undefined,
          password: regPassword || undefined,
          name: regName.trim() || undefined,
          age: calculatedAge,
          dob: formattedDob,
          notifyGmail,
          notifyMobile,
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
    const updatedDob = `${editDobDay}/${editDobMonth}/${editDobYear}`;
    const updatedAge = calculateAgeFromDob(editDobDay, editDobMonth, editDobYear);
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: editName.trim(),
          email: editEmail.trim(),
          age: updatedAge,
          dob: updatedDob,
          phone: editPhone.trim(),
          avatar: editAvatar || user.avatar,
          notifyGmail: editNotifyGmail,
          notifyMobile: editNotifyMobile,
        }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        updateUser(data.user);
        setIsEditingProfile(false);
        await syncReaderAccountToFirestore({
          name: editName.trim(),
          email: editEmail.trim(),
          age: updatedAge,
          phone: editPhone.trim(),
          upiId: user.upiId || 'balajiaris05@okaxis',
          paidPlan: user.premiumPlan || 'free',
        }).catch(() => {});
        await handleLiveVerifyGmail();
        setProfileMessage(
          `Account Holder Profile Image, Gmail, Mobile Number, DOB (${updatedDob}), and Notification preferences saved!`
        );
        setTimeout(() => setProfileMessage(null), 5000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleQuickToggleNotification = async (channel: 'gmail' | 'mobile') => {
    if (!user) return;
    const nextGmail = channel === 'gmail' ? !(user.notifyGmail ?? true) : (user.notifyGmail ?? true);
    const nextMobile = channel === 'mobile' ? !(user.notifyMobile ?? true) : (user.notifyMobile ?? true);
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          notifyGmail: nextGmail,
          notifyMobile: nextMobile,
        }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        updateUser(data.user);
        setEditNotifyGmail(nextGmail);
        setEditNotifyMobile(nextMobile);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleGoogleConnectSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const enteredPhone = (authTab === 'login' ? loginPhone : regPhone).trim();
      const fbUser = await signInWithGoogleAndSyncToFirestore({
        age: calculatedAge,
        phone: enteredPhone || undefined,
        upiId: user?.upiId,
        paidPlan: user?.premiumPlan || 'free',
      });
      if (!fbUser.email) {
        setAuthLoading(false);
        setAuthError('Could not retrieve Gmail address from Google Sign-In.');
        return;
      }
      await login(fbUser.email, {
        name: fbUser.displayName || regName.trim() || undefined,
        phone: enteredPhone || undefined,
        age: hasSelectedDob ? calculatedAge : undefined,
        dob: formattedDob || undefined,
        notifyGmail,
        notifyMobile,
      });
      setAuthLoading(false);
      setAuthSuccess(
        `Gmail (${fbUser.email}) Connected${enteredPhone ? ` along with Mobile Number (${enteredPhone})` : ''}!`
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
      
      {/* Top Mode Switcher Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 p-3 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Customer Account · Gmail &amp; Mobile Connected</span>
          </div>
          <h1 className="text-base sm:text-xl font-extrabold text-slate-900 dark:text-white font-heading">
            User Login / Register &amp; Reader Profile
          </h1>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setViewSection('login_register_form')}
            className={`py-1.5 px-2.5 sm:py-2 sm:px-3.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
              viewSection === 'login_register_form'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            <UserPlus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>Login / Register</span>
          </button>

          {user && (
            <button
              type="button"
              onClick={() => setViewSection('profile_dashboard')}
              className={`py-1.5 px-2.5 sm:py-2 sm:px-3.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                viewSection === 'profile_dashboard'
                  ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <User className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>Profile ({user.name.split(' ')[0]})</span>
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: DEDICATED USER LOGIN / REGISTER PAGE */}
      {(viewSection === 'login_register_form' || !user) && (
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
            
            {/* Left Info Column */}
            <div className="lg:col-span-5 p-4 sm:p-8 rounded-3xl bg-slate-900 text-white border border-slate-800 shadow-2xl space-y-4 sm:space-y-6">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Customer Registration &amp; Login</span>
              </div>

              <h2 className="text-xl sm:text-3xl font-black tracking-tight font-heading leading-snug">
                Connect Gmail, Mobile Number &amp; New Comic Alerts
              </h2>

              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Register your <strong className="text-white">Gmail Address</strong>, <strong className="text-white">Mobile Number</strong>, and <strong className="text-white">Date of Birth (Date / Month / Year)</strong> on first registration, and manage notifications when new comics are uploaded.
              </p>

              <div className="space-y-3 pt-2 border-t border-slate-800 text-xs">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-white block">1. Gmail &amp; Mobile Number Connected</span>
                    <span className="text-slate-400">Your Gmail and Mobile Number stay connected to your reader account for instant access.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-white block">2. First-Time Date of Birth (Date / Month / Year)</span>
                    <span className="text-slate-400">Collected once when the customer registers for the first time by choosing Date, Month, and Year.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-white block">3. New Comic Upload Notifications</span>
                    <span className="text-slate-400">
                      Receive alerts on your <strong className="text-amber-400">Gmail</strong> and <strong className="text-amber-400">Mobile Number</strong> whenever a new comic is uploaded, or turn them off anytime.
                    </span>
                  </div>
                </div>
              </div>

              {/* Currently Logged-In Customer Summary if logged in */}
              {user && (
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      ● Gmail &amp; Mobile Connected
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      DOB: {user.dob || '15/05/2002'} ({user.age || 24} yrs)
                    </span>
                  </div>
                  <div className="font-bold text-white">{user.name}</div>
                  <div className="font-mono text-rose-400 text-[11px]">{user.email} · {user.phone || '+91 8610950780'}</div>
                  <div className="text-[11px] text-emerald-400 font-semibold">
                    Notifications: Gmail {(user.notifyGmail ?? true) ? 'ON' : 'OFF'} · Mobile {(user.notifyMobile ?? true) ? 'ON' : 'OFF'}
                  </div>
                </div>
              )}
            </div>

            {/* Right Form Column: Login / Register / Change Password Form */}
            <div className="lg:col-span-7 p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
              <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null);
                    setAuthSuccess(null);
                    setAuthTab('login');
                  }}
                  className={`py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                    authTab === 'login'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Returning Customer Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null);
                    setAuthSuccess(null);
                    setAuthTab('register');
                  }}
                  className={`py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                    authTab === 'register' || authTab === 'verify-otp'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  First-Time Customer Register
                </button>
              </div>

              {/* Clean Gmail + Mobile Number Connected Banner */}
              <div className="mb-5 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs">
                  <div className="font-extrabold text-emerald-700 dark:text-emerald-300 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5 text-emerald-500" />
                      <span>● Gmail Connected</span>
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-emerald-500" />
                      <span>● Mobile Number Connected</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    {(authTab === 'login' ? credential : authTab === 'change-password' ? resetEmail : regEmail) || 'Your Gmail address'} &amp; {(authTab === 'login' ? loginPhone : authTab === 'change-password' ? resetPhone : regPhone) || 'your mobile number'} linked for reader account &amp; new comic alerts.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleConnectSignIn}
                  disabled={authLoading}
                  className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shrink-0 shadow-sm transition-colors cursor-pointer"
                >
                  Connect Gmail Account
                </button>
              </div>

              {authError && (
                <div className="mb-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {authSuccess && (
                <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{authSuccess}</span>
                </div>
              )}

              {welcomeEmailNotice && (authTab === 'verify-otp' || authTab === 'register') && (
                <div className="mb-4 p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                      <Mail className="w-4 h-4" />
                      <span>Welcome Email Sent to {welcomeEmailNotice.to}</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">Saved in Backend DB</span>
                  </div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    {welcomeEmailNotice.subject}
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {welcomeEmailNotice.body || welcomeEmailNotice.message}
                  </p>
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

              {/* TAB 1: RETURNING CUSTOMER LOGIN (Step 1: Verify Gmail & Mobile -> Step 2: Verify Account Password Div with 3-Attempt 12h Lockout) */}
              {authTab === 'login' && (
                <form onSubmit={handleReaderLogin} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Connected Gmail Address <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="email"
                          required
                          placeholder="Enter your Gmail address"
                          value={credential}
                          onChange={(e) => {
                            setCredential(e.target.value);
                            setIdentityVerified(false);
                            setIsAccountLocked(false);
                          }}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Connected Mobile Number (+91) <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="tel"
                          required
                          placeholder="Enter your mobile number (+91)"
                          value={loginPhone}
                          onChange={(e) => {
                            setLoginPhone(e.target.value);
                            setIdentityVerified(false);
                            setIsAccountLocked(false);
                          }}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Step 1 Button: Verify Gmail & Mobile Number if not yet verified */}
                  {!identityVerified && (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={handleVerifyCustomerIdentity}
                        disabled={authLoading}
                        className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                      >
                        <span>
                          {authLoading
                            ? 'Verifying Gmail & Mobile Number...'
                            : 'Verify Gmail & Mobile Number to Enter Password'}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </button>

                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => openChangePasswordTab(credential, loginPhone)}
                          className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                        >
                          Forgot Password / Change Password?
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 2 Div: Account Password Verification Div (Appears after Gmail & Mobile Number are verified) */}
                  {identityVerified && (
                    <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-rose-500" />
                          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                            Verify Account Password {verifiedCustomerName ? `(${verifiedCustomerName})` : ''}
                          </span>
                        </div>
                        <span
                          className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg ${
                            isAccountLocked
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {isAccountLocked
                            ? 'Account Locked (12 Hours)'
                            : `Attempts Left: ${remainingAttempts} / 3`}
                        </span>
                      </div>

                      {isAccountLocked ? (
                        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-3 text-xs">
                          <div className="font-extrabold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>Account Locked — Maximum 3 Password Attempts Exceeded</span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                            Your customer account is locked for <strong>12 hours</strong>{lockedUntilIso ? ` (until ${new Date(lockedUntilIso).toLocaleString()})` : ''} due to 3 incorrect password attempts. Please try again after 12 hours, or click <strong>Forgot Password / Change Password</strong> below to receive an OTP on your Gmail or Mobile Number and unlock your account immediately.
                          </p>
                          <button
                            type="button"
                            onClick={() => openChangePasswordTab(credential, loginPhone)}
                            className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs uppercase tracking-wider shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                          >
                            <KeyRound className="w-4 h-4" />
                            <span>Forgot Password — Send OTP &amp; Change Password</span>
                          </button>
                        </div>
                      ) : (
                        <>
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                Enter Account Password <span className="text-rose-500">*</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => openChangePasswordTab(credential, loginPhone)}
                                className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                              >
                                Forgot Password?
                              </button>
                            </div>
                            <div className="relative">
                              <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                              <input
                                type={showLoginPassword ? 'text' : 'password'}
                                required
                                placeholder="Enter your account password"
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                className="w-full pl-10 pr-10 py-3 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                              />
                              <button
                                type="button"
                                onClick={() => setShowLoginPassword(!showLoginPassword)}
                                className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                              >
                                {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          <button
                            type="submit"
                            disabled={authLoading}
                            className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                          >
                            <span>
                              {authLoading
                                ? 'Verifying Password & Signing In...'
                                : 'Verify Password & Login to Account'}
                            </span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </form>
              )}

              {/* TAB 2: FIRST-TIME CUSTOMER REGISTER (Profile Photo, Name, DOB, Gmail, Mobile + Password & Confirm Password Div -> Backend DB + Welcome Email) */}
              {authTab === 'register' && (
                <form onSubmit={handleReaderRegister} className="space-y-4">
                  {/* Account Holder Profile Photo Upload on Registration */}
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div
                        onClick={() => regAvatarInputRef.current?.click()}
                        className="w-14 h-14 rounded-2xl bg-slate-200 dark:bg-slate-800 border-2 border-rose-500/40 overflow-hidden flex items-center justify-center cursor-pointer shrink-0 shadow-sm hover:border-rose-500 transition-colors"
                        title="Click to upload your account photo"
                      >
                        {regAvatar ? (
                          <img src={regAvatar} alt="Customer Preview" className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-6 h-6 text-rose-500" />
                        )}
                      </div>
                      <div>
                        <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white block">
                          Account Holder Profile Image
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          Upload your personal profile photo for your Aathirai_Comic account
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={regAvatarInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleRegAvatarSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => regAvatarInputRef.current?.click()}
                        className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>{regAvatar ? 'Change Image' : 'Upload Image'}</span>
                      </button>
                      {regAvatar && (
                        <button
                          type="button"
                          onClick={() => setRegAvatar('')}
                          className="px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                    <div className="sm:col-span-5">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Customer Full Name <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                          type="text"
                          required
                          placeholder="Enter your full name"
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    {/* Date of Birth (Date / Month / Year) on First-Time Registration */}
                    <div className="sm:col-span-7">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                          Date of Birth (Date / Month / Year) <span className="text-rose-500">*</span>
                        </label>
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          {hasSelectedDob ? `Age: ${calculatedAge} yrs` : 'Select DOB'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          aria-label="Date of Birth Day"
                          required
                          value={dobDay}
                          onChange={(e) => setDobDay(e.target.value)}
                          className={`w-full px-2.5 py-3 text-xs font-mono font-bold rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer ${
                            !dobDay ? 'text-slate-400 dark:text-slate-500' : ''
                          }`}
                        >
                          <option value="" disabled>
                            Date (DD)
                          </option>
                          {DOB_DAYS.map((d) => (
                            <option key={d} value={d}>
                              Date: {d}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Date of Birth Month"
                          required
                          value={dobMonth}
                          onChange={(e) => setDobMonth(e.target.value)}
                          className={`w-full px-2.5 py-3 text-xs font-mono font-bold rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer ${
                            !dobMonth ? 'text-slate-400 dark:text-slate-500' : ''
                          }`}
                        >
                          <option value="" disabled>
                            Month (MM)
                          </option>
                          {DOB_MONTHS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Date of Birth Year"
                          required
                          value={dobYear}
                          onChange={(e) => setDobYear(e.target.value)}
                          className={`w-full px-2.5 py-3 text-xs font-mono font-bold rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer ${
                            !dobYear ? 'text-slate-400 dark:text-slate-500' : ''
                          }`}
                        >
                          <option value="" disabled>
                            Year (YYYY)
                          </option>
                          {DOB_YEARS.map((y) => (
                            <option key={y} value={y}>
                              Year: {y}
                            </option>
                          ))}
                        </select>
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
                          placeholder="Enter your Gmail address"
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
                          placeholder="Enter your mobile number (+91)"
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Dedicated Password & Confirm Password Div for First-Time Customer Account Creation */}
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-rose-500" />
                        <span>Create Account Password</span>
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500">
                        Stored securely in Backend Customer Database
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                          Password <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                          <input
                            type={showRegPassword ? 'text' : 'password'}
                            required
                            placeholder="Create password"
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            className="w-full pl-10 pr-10 py-3 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPassword(!showRegPassword)}
                            className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          >
                            {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                          Confirm Password <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                          <input
                            type={showRegConfirmPassword ? 'text' : 'password'}
                            required
                            placeholder="Confirm password"
                            value={regConfirmPassword}
                            onChange={(e) => setRegConfirmPassword(e.target.value)}
                            className="w-full pl-10 pr-10 py-3 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
                            className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          >
                            {showRegConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
                  >
                    {authLoading
                      ? 'Creating Customer Account & Sending Welcome Email...'
                      : 'Create Customer Account (Save to Backend & Send Welcome Email)'}
                  </button>
                </form>
              )}

              {/* TAB 3: CHANGE PASSWORD NEW TAB (Send OTP to Gmail/Mobile -> Verify OTP -> New Password & Confirm Password -> Update Backend & Return to Login) */}
              {authTab === 'change-password' && (
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-rose-500" />
                      <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                        Forgot / Change Customer Password
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthError(null);
                        setAuthSuccess(null);
                        setAuthTab('login');
                      }}
                      className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      ← Back to Login
                    </button>
                  </div>

                  {resetSandboxOtp && (resetStep === 'verify_otp' || resetStep === 'set_new_password') && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between">
                      <span>
                        Password Reset OTP Sent to Gmail &amp; Mobile: <strong className="font-mono text-sm">{resetSandboxOtp}</strong>
                      </span>
                      {resetStep === 'verify_otp' && (
                        <button
                          type="button"
                          onClick={() => setResetOtp(resetSandboxOtp)}
                          className="underline font-bold cursor-pointer"
                        >
                          Auto-fill OTP
                        </button>
                      )}
                    </div>
                  )}

                  {/* Step A: Enter Gmail / Mobile Number to Request OTP */}
                  {resetStep === 'request_otp' && (
                    <form onSubmit={handleRequestPasswordResetOtp} className="space-y-4">
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Enter your registered <strong>Gmail Address</strong> or <strong>Mobile Number</strong> to receive a 6-digit verification OTP before changing your password.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                            Registered Gmail Address <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                            <input
                              type="email"
                              required={!resetPhone.trim()}
                              placeholder="Enter your Gmail address"
                              value={resetEmail}
                              onChange={(e) => setResetEmail(e.target.value)}
                              className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                            Registered Mobile Number (+91)
                          </label>
                          <div className="relative">
                            <Phone className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                            <input
                              type="tel"
                              placeholder="Enter your mobile number (+91)"
                              value={resetPhone}
                              onChange={(e) => setResetPhone(e.target.value)}
                              className="w-full pl-10 pr-4 py-3 text-sm font-mono rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                            />
                          </div>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all cursor-pointer"
                      >
                        {authLoading ? 'Sending OTP...' : 'Send Verification OTP to Gmail / Mobile'}
                      </button>
                    </form>
                  )}

                  {/* Step B: Verify OTP sent to Gmail / Mobile before changing password */}
                  {resetStep === 'verify_otp' && (
                    <form onSubmit={handleVerifyResetOtpStep} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                          Enter 6-Digit OTP Sent to Gmail / Mobile <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                          <KeyRound className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                          <input
                            type="text"
                            maxLength={6}
                            required
                            placeholder="Enter 6-digit OTP"
                            value={resetOtp}
                            onChange={(e) => setResetOtp(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 text-lg font-mono tracking-widest text-center rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-3.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all cursor-pointer"
                      >
                        {authLoading ? 'Verifying OTP...' : 'Verify OTP to Enter New Password'}
                      </button>
                    </form>
                  )}

                  {/* Step C: Enter New Password & Confirm Password -> Update Backend & Return to Login */}
                  {resetStep === 'set_new_password' && (
                    <form onSubmit={handleSaveNewPassword} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                            New Password <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                            <input
                              type={showNewPassword ? 'text' : 'password'}
                              required
                              placeholder="Enter new password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="w-full pl-10 pr-10 py-3 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            >
                              {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                            Confirm New Password <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                            <input
                              type={showConfirmNewPassword ? 'text' : 'password'}
                              required
                              placeholder="Confirm new password"
                              value={confirmNewPassword}
                              onChange={(e) => setConfirmNewPassword(e.target.value)}
                              className="w-full pl-10 pr-10 py-3 text-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            >
                              {showConfirmNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-3.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all cursor-pointer"
                      >
                        {authLoading
                          ? 'Updating Password in Backend...'
                          : 'Update New Password & Return to Login Page'}
                      </button>
                    </form>
                  )}
                </div>
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
                        placeholder="Enter 6-digit OTP"
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
                    {authLoading ? 'Verifying...' : 'Verify OTP & Complete Registration'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: LEFT-SIDEBAR READER PROFILE & DASHBOARD */}
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
                      onClick={() => profileAvatarInputRef.current?.click()}
                      title="Click to upload a new profile image"
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-rose-500/40 shadow-md cursor-pointer hover:opacity-85 transition-opacity"
                    />
                    <input
                      ref={profileAvatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAccountHolderPhotoUpload}
                      className="hidden"
                    />
                    <div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                        Reader Profile
                      </span>
                      <h2 className="text-lg font-extrabold text-slate-900 dark:text-white font-heading mt-0.5">
                        {user.name}
                      </h2>
                      <button
                        type="button"
                        onClick={() => profileAvatarInputRef.current?.click()}
                        className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-extrabold transition-colors cursor-pointer shadow-xs"
                      >
                        <Camera className="w-3 h-3" />
                        <span>Upload Photo</span>
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(!isEditingProfile)}
                    className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                    title="Edit Profile Image, Gmail, Mobile, DOB & Notifications"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>

                {/* Connected Gmail, Mobile, DOB/Age & Notification Toggles */}
                {!isEditingProfile ? (
                  <div className="space-y-3 text-xs">
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-rose-500" /> Gmail Connected:
                        </span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-[11px] bg-emerald-500/10 px-2 py-0.5 rounded">
                          ● Connected
                        </span>
                      </div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white break-all">
                        {user.email}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-amber-500" /> Mobile Connected:
                        </span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-[11px] bg-emerald-500/10 px-2 py-0.5 rounded">
                          ● Connected
                        </span>
                      </div>
                      <div className="font-mono font-bold text-slate-900 dark:text-white">
                        {user.phone || '+91 8610950780'}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-semibold flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-sky-500" /> Date of Birth:
                        </span>
                        <div className="font-mono text-xs font-black text-slate-900 dark:text-white">
                          {user.dob || '15/05/2002'}
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-semibold flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-rose-500" /> Customer Age:
                        </span>
                        <div className="font-mono text-xs font-black text-slate-900 dark:text-white">
                          {user.age ? `${user.age} Years` : '24 Years'}
                        </div>
                      </div>
                    </div>

                    {/* New Comic Upload Notifications Card in Profile */}
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
                      <div className="text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1">
                        <Bell className="w-3.5 h-3.5" />
                        <span>New Comic Upload Notifications</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Gmail Alert:</span>
                        <button
                          type="button"
                          onClick={() => handleQuickToggleNotification('gmail')}
                          className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer ${
                            (user.notifyGmail ?? true)
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {(user.notifyGmail ?? true) ? 'ON (Click to Turn Off)' : 'OFF (Click to Turn On)'}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Mobile SMS Alert:</span>
                        <button
                          type="button"
                          onClick={() => handleQuickToggleNotification('mobile')}
                          className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer ${
                            (user.notifyMobile ?? true)
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {(user.notifyMobile ?? true) ? 'ON (Click to Turn Off)' : 'OFF (Click to Turn On)'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSaveProfile} className="space-y-3 text-xs">
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={editAvatar || user.avatar}
                          alt={user.name}
                          className="w-10 h-10 rounded-xl object-cover border border-rose-500/40"
                        />
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-200">Account Holder Image</div>
                          <div className="text-[10px] text-slate-500">Upload JPG, PNG, or WEBP</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => profileAvatarInputRef.current?.click()}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                      >
                        <Camera className="w-3 h-3" />
                        <span>Upload Image</span>
                      </button>
                    </div>
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
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Date of Birth (Date / Month / Year)
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        <select
                          value={editDobDay}
                          onChange={(e) => setEditDobDay(e.target.value)}
                          className="px-2 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                        >
                          {DOB_DAYS.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                        <select
                          value={editDobMonth}
                          onChange={(e) => setEditDobMonth(e.target.value)}
                          className="px-2 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                        >
                          {DOB_MONTHS.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                        <select
                          value={editDobYear}
                          onChange={(e) => setEditDobYear(e.target.value)}
                          className="px-2 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                        >
                          {DOB_YEARS.map((y) => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
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
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mobile (+91)</label>
                      <input
                        type="tel"
                        required
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 font-mono"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="font-bold text-slate-700 dark:text-slate-300">Gmail Notifications</span>
                      <button
                        type="button"
                        onClick={() => setEditNotifyGmail(!editNotifyGmail)}
                        className={`px-2.5 py-1 rounded-lg font-bold ${
                          editNotifyGmail ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-800'
                        }`}
                      >
                        {editNotifyGmail ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700 dark:text-slate-300">Mobile Notifications</span>
                      <button
                        type="button"
                        onClick={() => setEditNotifyMobile(!editNotifyMobile)}
                        className={`px-2.5 py-1 rounded-lg font-bold ${
                          editNotifyMobile ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-800'
                        }`}
                      >
                        {editNotifyMobile ? 'ON' : 'OFF'}
                      </button>
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
                        <span className="text-[11px] font-mono text-slate-400">
                          {hasActivePremium && user.premiumPlan === '1_month'
                            ? 'ACTIVE PLAN'
                            : '30 Days Validity'}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">₹49</span>
                        <span className="text-xs text-slate-500">/ 1 Month</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {hasActivePremium
                          ? user.premiumPlan === '1_month'
                            ? `Currently active until ${
                                user.premiumExpiresAt
                                  ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                  : 'expiry'
                              }. Only one plan can be active at a time — you can choose a new plan after your current plan ends.`
                            : `Your 6 Months (₹249) plan is currently active until ${
                                user.premiumExpiresAt
                                  ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                  : 'expiry'
                              }. Another plan cannot be placed until your current plan ends.`
                          : 'Unlocks all paywalled comics & chapters for 30 days. Verified automatically via your Gmail.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={hasActivePremium}
                      onClick={() => {
                        if (hasActivePremium) return;
                        setCheckoutPlan({
                          open: true,
                          planId: '1_month',
                          title: '1 Month Reader Premium Pass (₹49)',
                          amountInr: 49,
                        });
                      }}
                      className={`w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider shadow-md transition-colors ${
                        hasActivePremium
                          ? user.premiumPlan === '1_month'
                            ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                          : 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer'
                      }`}
                    >
                      {hasActivePremium
                        ? user.premiumPlan === '1_month'
                          ? `✓ Active Until ${
                              user.premiumExpiresAt
                                ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                : 'Expiry'
                            } · Choose After Plan Ends`
                          : `Available After Current Plan Ends (${
                              user.premiumExpiresAt
                                ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                : ''
                            })`
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
                          {hasActivePremium && user.premiumPlan === '6_months'
                            ? 'ACTIVE PLAN'
                            : '180 Days Validity'}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">₹249</span>
                        <span className="text-xs text-slate-500">/ 6 Months</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {hasActivePremium
                          ? user.premiumPlan === '6_months'
                            ? `Currently active until ${
                                user.premiumExpiresAt
                                  ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                  : 'expiry'
                              }. Only one plan can be active at a time — you can choose a new plan after your current plan ends.`
                            : `Your 1 Month (₹49) plan is currently active until ${
                                user.premiumExpiresAt
                                  ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                  : 'expiry'
                              }. Another plan cannot be placed until your current plan ends.`
                          : '6 months of uninterrupted access to every paywalled comic series & episode linked to your Gmail.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={hasActivePremium}
                      onClick={() => {
                        if (hasActivePremium) return;
                        setCheckoutPlan({
                          open: true,
                          planId: '6_months',
                          title: '6 Months Reader Premium Pass (₹249)',
                          amountInr: 249,
                        });
                      }}
                      className={`w-full py-3 px-4 rounded-xl font-black text-xs uppercase tracking-wider shadow-md transition-colors ${
                        hasActivePremium
                          ? user.premiumPlan === '6_months'
                            ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 cursor-not-allowed'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                          : 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                      }`}
                    >
                      {hasActivePremium
                        ? user.premiumPlan === '6_months'
                          ? `✓ Active Until ${
                              user.premiumExpiresAt
                                ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                : 'Expiry'
                            } · Choose After Plan Ends`
                          : `Available After Current Plan Ends (${
                              user.premiumExpiresAt
                                ? new Date(user.premiumExpiresAt).toLocaleDateString()
                                : ''
                            })`
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
                        <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                          <div className="text-right font-mono text-[11px] text-slate-400">
                            <div>Paid: {new Date(p.createdAt).toLocaleDateString()}</div>
                            {p.expiresAt && (
                              <div className="text-emerald-500 font-bold">
                                Expires: {new Date(p.expiresAt).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDownloadReceipt(p)}
                            className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>
                              {downloadedReceiptId === p.id ? 'Downloaded!' : 'Download Receipt'}
                            </span>
                          </button>
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
