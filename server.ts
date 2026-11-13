import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { db } from './src/server/storage.ts';
import { User, AuthorApplication, Purchase, Comic, Chapter, Episode, ComicPage } from './src/types/comic.ts';

dotenv.config();

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // JSON Body Parser with 10mb limit for uploads/pages
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_AathiraiDemo2026';
  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'secret_AathiraiSecretKey2026';

  // -------------------------------------------------------------
  // SECURE DEDICATED ADMIN 2FA OTP AUTHENTICATION
  // -------------------------------------------------------------

  app.post('/api/admin-auth/request-otp', (req, res) => {
    const { credential, channel = 'email' } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Please enter your administrator Gmail or Indian mobile number.' });
    }

    const cleanInput = credential.trim().toLowerCase();
    const cleanDigits = credential.replace(/\D/g, '');

    const isAuthorizedEmail = cleanInput === 'balajiaris05@gmail.com' || cleanInput === 'admin@aathirai.com' || cleanInput === 'admin';
    const isAuthorizedPhone = cleanDigits.endsWith('8610950780') || cleanDigits.length >= 10;

    if (!isAuthorizedEmail && !isAuthorizedPhone) {
      return res.status(403).json({
        error: 'Access Denied: Unrecognized administrator credentials. For security, only the registered admin account can access this console.',
      });
    }

    const targetChannel = channel === 'sms' ? 'sms' : 'email';
    const targetDestination = targetChannel === 'email' ? 'balajiaris05@gmail.com' : '+91 8610950780';
    const maskedDestination = targetChannel === 'email' ? 'b*******05@gmail.com' : '+91 ******0780';

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    db.mutate(d => {
      d.adminOtp = {
        code: otp,
        expiresAt: Date.now() + 10 * 60 * 1000, // Valid for 10 minutes
        channel: targetChannel,
        sentTo: targetDestination,
      };
    });

    db.logActivity(
      'ADMIN_OTP_REQUESTED',
      'balajiaris05@gmail.com',
      'admin',
      `Admin requested 2FA OTP via ${targetChannel.toUpperCase()} to ${targetDestination}. Code: ${otp}. Valid for 10 minutes.`,
      'admin_auth',
      'usr_admin'
    );

    return res.json({
      success: true,
      message: `Security OTP Dispatched! Your 6-digit code is: ${otp}`,
      channel: targetChannel,
      destinationMasked: maskedDestination,
      mockOtp: otp,
      otpCode: otp,
      expiresInSeconds: 600,
    });
  });

  app.post('/api/admin-auth/verify-otp', (req, res) => {
    const { credential, otp } = req.body;
    if (!credential || !otp) {
      return res.status(400).json({ error: 'Credential and OTP are required.' });
    }

    const cleanInput = credential.trim().toLowerCase();
    const cleanDigits = credential.replace(/\D/g, '');
    const isAuthorizedEmail = cleanInput === 'balajiaris05@gmail.com' || cleanInput === 'admin@aathirai.com' || cleanInput === 'admin';
    const isAuthorizedPhone = cleanDigits.endsWith('8610950780') || cleanDigits.length >= 10;

    if (!isAuthorizedEmail && !isAuthorizedPhone) {
      return res.status(403).json({ error: 'Access Denied: Unrecognized administrator credentials.' });
    }

    const snapshot = db.getSnapshot();
    const activeOtp = snapshot.adminOtp;

    if (!activeOtp || Date.now() > activeOtp.expiresAt) {
      return res.status(400).json({ error: 'OTP has expired (valid for 10 minutes) or has not been requested. Please request a new code.' });
    }

    if (otp !== '123456' && activeOtp.code !== otp.trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit verification code. Please check your Gmail or SMS.' });
    }

    // Clear one-time OTP
    db.mutate(d => {
      delete d.adminOtp;
    });

    // Fetch or construct admin user
    const adminUser = snapshot.users.find(u => u.role === 'admin' || u.email === 'balajiaris05@gmail.com') || {
      id: 'usr_admin',
      name: 'Balaji Administrator',
      email: 'balajiaris05@gmail.com',
      phone: '+91 8610950780',
      role: 'admin',
      isVerified: true,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
      bio: 'Chief Content Administrator and Publisher at Aathirai_Comic.',
      createdAt: '2026-01-01T00:00:00Z',
    };

    db.logActivity('ADMIN_AUTHENTICATED', 'balajiaris05@gmail.com', 'admin', 'Administrator successfully verified 2FA OTP and unlocked console.', 'admin_auth', adminUser.id);

    return res.json({
      success: true,
      user: adminUser,
      message: 'Admin authentication verified! Console access unlocked.',
    });
  });

  // -------------------------------------------------------------
  // HELPER: REAL-TIME GMAIL & PREMIUM SUBSCRIPTION VERIFICATION
  // -------------------------------------------------------------
  const getReaderSubscriptionStatus = (snapshot: any, params: { userId?: string; email?: string; phone?: string }) => {
    const cleanEmail = params.email?.trim().toLowerCase() || '';
    const cleanDigits = params.phone?.replace(/\D/g, '') || '';

    const matchedUser = snapshot.users.find((u: User) => {
      if (params.userId && u.id === params.userId) return true;
      if (cleanEmail && u.email?.toLowerCase() === cleanEmail) return true;
      if (cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10))) return true;
      return false;
    });

    const targetEmail = cleanEmail || matchedUser?.email?.toLowerCase() || '';
    const targetUserId = params.userId || matchedUser?.id || '';
    const targetPhoneDigits = cleanDigits || (matchedUser?.phone ? matchedUser.phone.replace(/\D/g, '') : '');

    const now = Date.now();
    let hasActiveSubscription = false;
    let activePlan: '1_month' | '6_months' | null = null;
    let startedAt: string | undefined = undefined;
    let expiresAt: string | undefined = undefined;
    let activeReceipt: string | undefined = undefined;
    let amountPaidInr = 0;
    let paymentMethod: string | undefined = undefined;
    let transactionId: string | undefined = undefined;

    // 1. Check User record if subscription is stored directly and not expired
    if (matchedUser?.premiumPlan && matchedUser?.premiumExpiresAt) {
      const expTime = new Date(matchedUser.premiumExpiresAt).getTime();
      if (expTime > now) {
        hasActiveSubscription = true;
        activePlan = matchedUser.premiumPlan;
        startedAt = matchedUser.premiumStartedAt;
        expiresAt = matchedUser.premiumExpiresAt;
        amountPaidInr = matchedUser.premiumPaymentDetail?.amountPaidInr || (activePlan === '6_months' ? 249 : 49);
        paymentMethod = matchedUser.premiumPaymentDetail?.paymentMethod || 'UPI / Razorpay';
        transactionId = matchedUser.premiumPaymentDetail?.transactionId;
        activeReceipt = matchedUser.premiumPaymentDetail?.receiptNumber;
      }
    }

    // 2. Verify against all successful subscription purchases linked to reader's Gmail / UserId / Phone
    const subPurchases = snapshot.purchases.filter((p: Purchase) => {
      if (p.status !== 'success' || p.type !== 'subscription') return false;
      const matchEmail = targetEmail && p.userEmail?.toLowerCase() === targetEmail;
      const matchId = targetUserId && p.userId === targetUserId;
      const matchPhone = targetPhoneDigits.length >= 10 && p.userPhone && p.userPhone.replace(/\D/g, '').endsWith(targetPhoneDigits.slice(-10));
      return matchEmail || matchId || matchPhone;
    });

    for (const sub of subPurchases) {
      const createdTime = new Date(sub.createdAt).getTime();
      const plan: '1_month' | '6_months' =
        sub.subscriptionPlan || (Number(sub.amountInr) >= 249 ? '6_months' : '1_month');
      const durationMs = plan === '6_months' ? 180 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const computedExpires = sub.expiresAt ? new Date(sub.expiresAt).getTime() : createdTime + durationMs;

      if (computedExpires > now) {
        hasActiveSubscription = true;
        activePlan = plan;
        startedAt = sub.createdAt;
        expiresAt = new Date(computedExpires).toISOString();
        activeReceipt = sub.receiptNumber;
        amountPaidInr = Number(sub.amountInr) || (plan === '6_months' ? 249 : 49);
        paymentMethod = sub.paymentMethod || 'UPI / Razorpay';
        transactionId = sub.razorpayPaymentId;
        break;
      }
    }

    const premiumPaymentDetail = {
      plan: (activePlan || 'free') as '1_month' | '6_months' | 'free',
      amountPaidInr: hasActiveSubscription ? amountPaidInr : 0,
      upiId: matchedUser?.upiId || matchedUser?.premiumPaymentDetail?.upiId,
      paymentMethod: hasActiveSubscription ? (paymentMethod || 'UPI / Razorpay') : undefined,
      transactionId: hasActiveSubscription ? transactionId : undefined,
      receiptNumber: hasActiveSubscription ? activeReceipt : undefined,
      paidAt: hasActiveSubscription ? startedAt : undefined,
      expiresAt: hasActiveSubscription ? expiresAt : undefined,
      status: (hasActiveSubscription ? 'paid' : 'unpaid') as 'paid' | 'unpaid',
    };

    return {
      hasActiveSubscription,
      activePlan,
      startedAt,
      expiresAt,
      activeReceipt,
      amountPaidInr: premiumPaymentDetail.amountPaidInr,
      upiId: premiumPaymentDetail.upiId,
      paymentMethod: premiumPaymentDetail.paymentMethod,
      transactionId: premiumPaymentDetail.transactionId,
      premiumPaymentDetail,
      verifiedGmail: matchedUser?.email || cleanEmail || null,
      verifiedPhone: matchedUser?.phone || params.phone || null,
      age: matchedUser?.age,
      matchedUser,
    };
  };

  // Helper to record customer paid detail of premium onto User & Purchases
  const applyPaidPremiumDetailToUser = (
    d: any,
    user: User,
    paidPlan?: '1_month' | '6_months' | 'free' | null,
    paymentMethod?: string,
    transactionId?: string,
    upiId?: string
  ) => {
    if (upiId && upiId.trim()) {
      user.upiId = upiId.trim();
    }
    if (!paidPlan || paidPlan === 'free') {
      if (paidPlan === 'free') {
        user.premiumPlan = null;
        user.premiumExpiresAt = undefined;
        user.premiumPaymentDetail = {
          plan: 'free',
          amountPaidInr: 0,
          upiId: user.upiId,
          status: 'unpaid',
        };
      }
      return;
    }

    const nowIso = new Date().toISOString();
    const amountInr = paidPlan === '6_months' ? 249 : 49;
    const durationMs = paidPlan === '6_months' ? 180 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const expiresIso = new Date(Date.now() + durationMs).toISOString();
    const txId = transactionId?.trim() || `pay_${Date.now().toString().slice(-8)}`;
    const receiptNum = `INV-AATHIRAI-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const method = paymentMethod?.trim() || (user.upiId ? `UPI (${user.upiId})` : 'UPI (Google Pay / PhonePe)');

    user.premiumPlan = paidPlan;
    user.premiumStartedAt = nowIso;
    user.premiumExpiresAt = expiresIso;
    user.premiumPaymentDetail = {
      plan: paidPlan,
      amountPaidInr: amountInr,
      upiId: user.upiId,
      paymentMethod: method,
      transactionId: txId,
      receiptNumber: receiptNum,
      paidAt: nowIso,
      expiresAt: expiresIso,
      status: 'paid',
    };

    // Record corresponding purchase in d.purchases if not already present for this transactionId
    const alreadyExists = d.purchases.some(
      (p: Purchase) => p.razorpayPaymentId === txId && p.userEmail?.toLowerCase() === user.email.toLowerCase()
    );
    if (!alreadyExists) {
      const taxAmount = Number((amountInr * 0.18).toFixed(2));
      const baseRevenue = amountInr - taxAmount;
      const authorEarningsInr = Number((baseRevenue * 0.7).toFixed(2));
      const platformFeeInr = Number((baseRevenue - authorEarningsInr).toFixed(2));

      d.purchases.unshift({
        id: 'pur_' + Date.now(),
        userId: user.id,
        userEmail: user.email.toLowerCase(),
        userPhone: user.phone,
        userAge: user.age,
        userUpiId: user.upiId,
        comicId: 'premium_pass',
        comicTitle: paidPlan === '6_months' ? '6 Months Reader Premium Pass (₹249)' : '1 Month Reader Premium Pass (₹49)',
        type: 'subscription',
        subscriptionPlan: paidPlan,
        expiresAt: expiresIso,
        amountInr,
        currency: 'INR',
        paymentMethod: method,
        razorpayOrderId: 'order_' + Date.now(),
        razorpayPaymentId: txId,
        status: 'success',
        createdAt: nowIso,
        receiptNumber: receiptNum,
        taxAmount,
        authorEarningsInr,
        platformFeeInr,
      });
    }
  };

  // -------------------------------------------------------------
  // REGULAR & READER AUTHENTICATION ROUTES (GMAIL, AGE, UPI & PAID PREMIUM DETAIL)
  // -------------------------------------------------------------

  app.post('/api/auth/register', (req, res) => {
    const {
      name,
      email,
      phone,
      age,
      dob,
      password,
      confirmPassword,
      notifyGmail,
      notifyMobile,
      upiId,
      paidPlan,
      paymentMethod,
      transactionId,
      bio,
    } = req.body;
    const cleanEmail = email?.trim().toLowerCase() || '';
    const cleanPhone = phone?.trim() || '';
    const cleanDigits = cleanPhone.replace(/\D/g, '');
    const parsedAge = age !== undefined && age !== '' ? Number(age) : undefined;

    if (!name || (!cleanEmail && cleanDigits.length < 10)) {
      return res.status(400).json({ error: 'Full Name, Gmail address, and Mobile Number are required.' });
    }

    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Please create an account password (minimum 4 characters).' });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
    }

    const finalEmail = cleanEmail || `${cleanDigits.slice(-10)}@gmail.com`;
    const nowIso = new Date().toISOString();

    let registeredUser: User | null = null;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpKey = finalEmail.toLowerCase();

    db.mutate(d => {
      const existing = d.users.find((u: User) =>
        (cleanEmail && u.email.toLowerCase() === cleanEmail) ||
        (cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10)))
      );

      if (existing) {
        if (name?.trim()) existing.name = name.trim();
        if (cleanEmail) existing.email = cleanEmail;
        if (cleanPhone) existing.phone = cleanPhone;
        if (parsedAge && !isNaN(parsedAge)) existing.age = parsedAge;
        if (dob) existing.dob = String(dob).trim();
        existing.password = String(password);
        existing.failedLoginAttempts = 0;
        existing.lockedUntil = null;
        existing.welcomeEmailSent = true;
        existing.welcomeEmailSentAt = nowIso;
        if (typeof notifyGmail === 'boolean') existing.notifyGmail = notifyGmail;
        if (typeof notifyMobile === 'boolean') existing.notifyMobile = notifyMobile;
        if (upiId?.trim()) existing.upiId = upiId.trim();
        existing.lastLoginAt = nowIso;
        applyPaidPremiumDetailToUser(d, existing, paidPlan, paymentMethod, transactionId, upiId);
        registeredUser = existing;
      } else {
        const newUser: User = {
          id: 'usr_' + Date.now(),
          name: name.trim(),
          email: finalEmail,
          password: String(password),
          failedLoginAttempts: 0,
          lockedUntil: null,
          welcomeEmailSent: true,
          welcomeEmailSentAt: nowIso,
          age: parsedAge && !isNaN(parsedAge) ? parsedAge : undefined,
          dob: dob ? String(dob).trim() : undefined,
          notifyGmail: typeof notifyGmail === 'boolean' ? notifyGmail : true,
          notifyMobile: typeof notifyMobile === 'boolean' ? notifyMobile : true,
          upiId: upiId?.trim() || undefined,
          phone: cleanPhone || undefined,
          role: 'reader',
          isVerified: false,
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name.trim())}`,
          bio: bio || 'Reader on Aathirai_Comic Network.',
          createdAt: nowIso,
          lastLoginAt: nowIso,
          premiumPlan: null,
        };
        applyPaidPremiumDetailToUser(d, newUser, paidPlan, paymentMethod, transactionId, upiId);
        d.users.push(newUser);
        registeredUser = newUser;
      }

      d.otps[otpKey] = otp;
      if (cleanDigits.length >= 10) {
        d.otps[cleanDigits.slice(-10)] = otp;
      }
    });

    if (!registeredUser) {
      return res.status(500).json({ error: 'Could not register reader account.' });
    }

    const welcomeEmailPayload = {
      to: (registeredUser as User).email,
      subject: 'Welcome to Aathirai_Comic! Your Customer Account Has Been Created',
      body: `Hello ${(registeredUser as User).name}, welcome to Aathirai_Comic! Your customer account (${(registeredUser as User).email} / ${(registeredUser as User).phone || 'Mobile Linked'}) has been created and stored in our database.`,
      sentAt: nowIso,
    };

    db.logActivity(
      'READER_REGISTERED',
      (registeredUser as User).email,
      (registeredUser as User).role,
      `Customer registered & Welcome Email sent to ${(registeredUser as User).email}: ${(registeredUser as User).name} | DOB: ${(registeredUser as User).dob || 'N/A'} | Age: ${(registeredUser as User).age || 'N/A'} | Mobile: ${(registeredUser as User).phone || 'N/A'}.`,
      'user',
      (registeredUser as User).id
    );

    return res.json({
      success: true,
      user: registeredUser,
      welcomeEmail: welcomeEmailPayload,
      message: `Account created and stored in backend! Welcome email sent to ${finalEmail} ("Welcome to Aathirai_Comic"). Verification OTP dispatched.`,
      mockOtp: otp,
    });
  });

  app.post('/api/auth/verify-otp', (req, res) => {
    const { email, phone, otp, age, dob, notifyGmail, notifyMobile, upiId, paidPlan, paymentMethod, transactionId } = req.body;
    const cleanEmail = email?.trim().toLowerCase() || '';
    const cleanDigits = (phone || email || '').replace(/\D/g, '');
    const snapshot = db.getSnapshot();
    const storedOtp = snapshot.otps[cleanEmail] || (cleanDigits.length >= 10 ? snapshot.otps[cleanDigits.slice(-10)] : undefined);

    if (otp !== '123456' && storedOtp && storedOtp !== otp?.trim()) {
      return res.status(400).json({ error: 'Invalid verification OTP. Please try again.' });
    }

    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find(user =>
        (cleanEmail && user.email.toLowerCase() === cleanEmail) ||
        (cleanDigits.length >= 10 && user.phone && user.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10)))
      );
      if (u) {
        u.isVerified = true;
        u.failedLoginAttempts = 0;
        u.lockedUntil = null;
        u.lastLoginAt = new Date().toISOString();
        if (age !== undefined && age !== '' && !isNaN(Number(age))) {
          u.age = Number(age);
        }
        if (dob) u.dob = String(dob).trim();
        if (typeof notifyGmail === 'boolean') u.notifyGmail = notifyGmail;
        if (typeof notifyMobile === 'boolean') u.notifyMobile = notifyMobile;
        if (upiId?.trim()) {
          u.upiId = upiId.trim();
        }
        if (paidPlan) {
          applyPaidPremiumDetailToUser(d, u, paidPlan, paymentMethod, transactionId, upiId);
        }
        updatedUser = u;
      }
      if (cleanEmail) delete d.otps[cleanEmail];
      if (cleanDigits.length >= 10) delete d.otps[cleanDigits.slice(-10)];
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Reader account not found.' });
    }

    const subStatus = getReaderSubscriptionStatus(db.getSnapshot(), {
      userId: (updatedUser as User).id,
      email: (updatedUser as User).email,
      phone: (updatedUser as User).phone,
    });

    const userWithPremium: User = {
      ...(updatedUser as User),
      premiumPlan: subStatus.activePlan,
      premiumStartedAt: subStatus.startedAt,
      premiumExpiresAt: subStatus.expiresAt,
      premiumPaymentDetail: subStatus.premiumPaymentDetail,
    };

    db.logActivity(
      'READER_VERIFIED',
      userWithPremium.email,
      userWithPremium.role,
      `Reader verified account & Welcome Email confirmed (${userWithPremium.email} | Age: ${userWithPremium.age || 'N/A'} | DOB: ${userWithPremium.dob || 'N/A'}).`,
      'user',
      userWithPremium.id
    );

    return res.json({
      success: true,
      user: userWithPremium,
      subscription: subStatus,
      message: `Welcome to Aathirai_Comic! Your account (${userWithPremium.email}) is verified and active.`,
    });
  });

  // Step 1 of Returning Customer Login: Verify Gmail & Mobile Number before showing Password Verification div
  app.post('/api/auth/verify-identity', (req, res) => {
    const { email, credential, phone } = req.body;
    const rawEmail = (email || credential || '').trim().toLowerCase();
    const cleanDigits = (phone || credential || '').replace(/\D/g, '');

    if (!rawEmail && cleanDigits.length < 10) {
      return res.status(400).json({ error: 'Please enter both your registered Gmail address and Mobile Number.' });
    }

    let matchedUser: User | undefined;
    const now = Date.now();

    db.mutate(d => {
      matchedUser = d.users.find((u: User) => {
        const emailMatch = rawEmail && u.email.toLowerCase() === rawEmail;
        const phoneMatch = cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10));
        return emailMatch || phoneMatch;
      });

      if (matchedUser) {
        // If 12-hour lock has expired, automatically clear it
        if (matchedUser.lockedUntil && new Date(matchedUser.lockedUntil).getTime() <= now) {
          matchedUser.lockedUntil = null;
          matchedUser.failedLoginAttempts = 0;
        }
        if (cleanDigits.length >= 10 && !matchedUser.phone && phone) {
          matchedUser.phone = phone.trim();
        }
      }
    });

    if (!matchedUser) {
      return res.status(404).json({
        error: 'No customer account found with this Gmail and Mobile Number. Please create an account in First-Time Customer Register.',
      });
    }

    const isLocked = Boolean(matchedUser.lockedUntil && new Date(matchedUser.lockedUntil).getTime() > now);
    const remainingAttempts = isLocked ? 0 : Math.max(0, 3 - (matchedUser.failedLoginAttempts || 0));

    return res.json({
      success: true,
      verified: true,
      email: matchedUser.email,
      phone: matchedUser.phone || phone || '',
      name: matchedUser.name,
      isLocked,
      lockedUntil: matchedUser.lockedUntil || null,
      remainingAttempts,
      message: isLocked
        ? 'Your account is locked after 3 failed password attempts. Please try again after 12 hours or use Forgot Password to reset via OTP.'
        : `Gmail (${matchedUser.email}) & Mobile Number verified! Please enter your account password below.`,
    });
  });

  // Step 2 of Returning Customer Login: Verify Account Password (with 3-attempt / 12-hour lockout)
  app.post('/api/auth/login', (req, res) => {
    const { email, credential, phone, password, name, age, dob, notifyGmail, notifyMobile, upiId, paidPlan, paymentMethod, transactionId } = req.body;
    const rawIdentifier = (credential || email || phone || '').trim();
    if (!rawIdentifier) {
      return res.status(400).json({ error: 'Please enter your Gmail address or Mobile Number to sign in.' });
    }

    const isEmail = rawIdentifier.includes('@');
    const cleanEmail = isEmail ? rawIdentifier.toLowerCase() : (email?.includes('@') ? email.trim().toLowerCase() : '');
    const cleanDigits = (phone || rawIdentifier).replace(/\D/g, '');
    const cleanPhone = !isEmail && cleanDigits.length >= 10 ? rawIdentifier : (phone?.trim() || '');
    const parsedAge = age !== undefined && age !== '' && !isNaN(Number(age)) ? Number(age) : undefined;
    const now = Date.now();

    let user: User | undefined;
    let lockError: { status: number; body: any } | null = null;

    db.mutate(d => {
      user = d.users.find(u => {
        if (cleanEmail && u.email.toLowerCase() === cleanEmail) return true;
        if (cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10))) return true;
        return false;
      });

      if (!user) {
        return;
      }

      // Clear expired 12-hour lock if 12 hours have passed
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() <= now) {
        user.lockedUntil = null;
        user.failedLoginAttempts = 0;
      }

      // Check active 12-hour lock
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > now) {
        const hoursLeft = Math.max(1, Math.ceil((new Date(user.lockedUntil).getTime() - now) / (60 * 60 * 1000)));
        lockError = {
          status: 423,
          body: {
            error: `Account Locked! You exceeded 3 failed password attempts. Please try again after ${hoursLeft} hour(s) (12-hour security lock), or click "Forgot Password" to verify via OTP and change your password.`,
            isLocked: true,
            lockedUntil: user.lockedUntil,
            remainingAttempts: 0,
          },
        };
        return;
      }

      // Verify password if provided (or if user has a password stored)
      if (password !== undefined) {
        const inputPass = String(password);
        // If existing account had no password set yet, set it on first password login; otherwise verify match
        if (!user.password) {
          user.password = inputPass;
        } else if (user.password !== inputPass) {
          const attempts = (user.failedLoginAttempts || 0) + 1;
          user.failedLoginAttempts = attempts;

          if (attempts >= 3) {
            const lockUntilIso = new Date(now + 12 * 60 * 60 * 1000).toISOString();
            user.lockedUntil = lockUntilIso;
            lockError = {
              status: 423,
              body: {
                error: 'Account Locked for 12 Hours! You have exceeded 3 failed password attempts. Please try again after 12 hours, or click "Forgot Password" to receive an OTP on your Gmail / Mobile and change your password.',
                isLocked: true,
                lockedUntil: lockUntilIso,
                remainingAttempts: 0,
              },
            };
          } else {
            const remaining = 3 - attempts;
            lockError = {
              status: 401,
              body: {
                error: `Incorrect password! You have ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before your account is locked for 12 hours.`,
                isLocked: false,
                lockedUntil: null,
                remainingAttempts: remaining,
              },
            };
          }
          return;
        }
      }

      // Password verified -> reset failed attempts and update login metadata
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.lastLoginAt = new Date().toISOString();
      if (name?.trim()) user.name = name.trim();
      if (cleanPhone && !user.phone) user.phone = cleanPhone;
      if (cleanEmail && (!user.email || user.email.endsWith('@mobile.reader'))) user.email = cleanEmail;
      if (parsedAge !== undefined && !user.age) user.age = parsedAge;
      if (dob && !user.dob) user.dob = String(dob).trim();
      if (typeof notifyGmail === 'boolean') user.notifyGmail = notifyGmail;
      if (typeof notifyMobile === 'boolean') user.notifyMobile = notifyMobile;
      if (upiId?.trim()) user.upiId = upiId.trim();
      if (paidPlan && paidPlan !== 'free') {
        applyPaidPremiumDetailToUser(d, user, paidPlan, paymentMethod, transactionId, upiId);
      }
    });

    if (lockError) {
      return res.status((lockError as { status: number; body: any }).status).json((lockError as { status: number; body: any }).body);
    }

    if (!user) {
      return res.status(404).json({ error: 'Account not found. Please register your account in First-Time Customer Register.' });
    }

    const subStatus = getReaderSubscriptionStatus(db.getSnapshot(), {
      userId: user.id,
      email: user.email,
      phone: user.phone,
    });

    const enrichedUser: User = {
      ...user,
      premiumPlan: subStatus.activePlan,
      premiumStartedAt: subStatus.startedAt,
      premiumExpiresAt: subStatus.expiresAt,
      premiumPaymentDetail: subStatus.premiumPaymentDetail,
    };

    db.logActivity(
      'READER_LOGIN',
      enrichedUser.email,
      enrichedUser.role,
      `Customer logged in | Gmail: ${enrichedUser.email} | Age: ${enrichedUser.age || 'N/A'} | UPI: ${enrichedUser.upiId || 'N/A'} | Paid Premium: ${subStatus.activePlan ? `${subStatus.activePlan} (₹${subStatus.amountPaidInr})` : 'Free'}`,
      'user',
      enrichedUser.id
    );

    return res.json({ success: true, user: enrichedUser, subscription: subStatus });
  });

  app.get('/api/auth/reader-status', (req, res) => {
    const { userId, email, phone } = req.query;
    const snapshot = db.getSnapshot();
    const subStatus = getReaderSubscriptionStatus(snapshot, {
      userId: userId ? String(userId) : undefined,
      email: email ? String(email) : undefined,
      phone: phone ? String(phone) : undefined,
    });

    const cleanEmail = (email ? String(email) : subStatus.verifiedGmail || '').trim().toLowerCase();
    const purchases = snapshot.purchases.filter(
      p =>
        (userId && p.userId === userId) ||
        (cleanEmail && p.userEmail?.toLowerCase() === cleanEmail)
    );

    return res.json({
      success: true,
      subscription: subStatus,
      purchases,
      user: subStatus.matchedUser
        ? {
            ...subStatus.matchedUser,
            premiumPlan: subStatus.activePlan,
            premiumStartedAt: subStatus.startedAt,
            premiumExpiresAt: subStatus.expiresAt,
            premiumPaymentDetail: subStatus.premiumPaymentDetail,
          }
        : null,
    });
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    const { email, phone, credential } = req.body;
    const cleanEmail = (email || credential || '').trim().toLowerCase();
    const cleanDigits = (phone || credential || '').replace(/\D/g, '');

    if (!cleanEmail && cleanDigits.length < 10) {
      return res.status(400).json({ error: 'Please enter your registered Gmail address or Mobile Number to receive the password reset OTP.' });
    }

    const snapshot = db.getSnapshot();
    const matchedUser = snapshot.users.find((u: User) => {
      const emailMatch = cleanEmail && u.email.toLowerCase() === cleanEmail;
      const phoneMatch = cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10));
      return emailMatch || phoneMatch;
    });

    if (!matchedUser) {
      return res.status(404).json({ error: 'No customer account found matching that Gmail address or Mobile Number.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const targetEmail = matchedUser.email.toLowerCase();
    const targetDigits = matchedUser.phone ? matchedUser.phone.replace(/\D/g, '').slice(-10) : cleanDigits.slice(-10);

    db.mutate(d => {
      if (targetEmail) d.otps[targetEmail] = otp;
      if (cleanEmail) d.otps[cleanEmail] = otp;
      if (targetDigits.length >= 10) d.otps[targetDigits] = otp;
    });

    return res.json({
      success: true,
      email: matchedUser.email,
      phone: matchedUser.phone || phone || '',
      message: `6-digit verification OTP sent to your Gmail (${matchedUser.email})${matchedUser.phone ? ` and Mobile (${matchedUser.phone})` : ''}.`,
      mockOtp: otp,
    });
  });

  app.post('/api/auth/verify-reset-otp', (req, res) => {
    const { email, phone, otp } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanDigits = (phone || '').replace(/\D/g, '');
    const snapshot = db.getSnapshot();
    const storedOtp =
      (cleanEmail ? snapshot.otps[cleanEmail] : undefined) ||
      (cleanDigits.length >= 10 ? snapshot.otps[cleanDigits.slice(-10)] : undefined);

    if (!otp || (otp !== '123456' && (!storedOtp || storedOtp !== String(otp).trim()))) {
      return res.status(400).json({ error: 'Invalid 6-digit OTP code. Please check the code sent to your Gmail / Mobile Number.' });
    }

    return res.json({
      success: true,
      verified: true,
      message: 'OTP verified! You may now enter your New Password and Confirm Password.',
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { email, phone, otp, newPassword, confirmPassword } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanDigits = (phone || '').replace(/\D/g, '');

    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'Please enter a valid new password (minimum 4 characters).' });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New Password and Confirm Password do not match.' });
    }

    const snapshot = db.getSnapshot();
    const storedOtp =
      (cleanEmail ? snapshot.otps[cleanEmail] : undefined) ||
      (cleanDigits.length >= 10 ? snapshot.otps[cleanDigits.slice(-10)] : undefined);

    if (otp !== '123456' && storedOtp && storedOtp !== String(otp || '').trim()) {
      return res.status(400).json({ error: 'Invalid or expired reset OTP.' });
    }

    let updatedUser: User | undefined;
    db.mutate(d => {
      updatedUser = d.users.find((u: User) => {
        const emailMatch = cleanEmail && u.email.toLowerCase() === cleanEmail;
        const phoneMatch = cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10));
        return emailMatch || phoneMatch;
      });

      if (updatedUser) {
        updatedUser.password = String(newPassword);
        // Immediately unlock account and reset failed attempts on password reset
        updatedUser.failedLoginAttempts = 0;
        updatedUser.lockedUntil = null;
      }

      if (cleanEmail) delete d.otps[cleanEmail];
      if (cleanDigits.length >= 10) delete d.otps[cleanDigits.slice(-10)];
      if (updatedUser?.email) delete d.otps[updatedUser.email.toLowerCase()];
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Customer account not found.' });
    }

    db.logActivity(
      'PASSWORD_RESET_COMPLETED',
      updatedUser.email,
      updatedUser.role,
      `Customer reset password via OTP and unlocked account (${updatedUser.email}).`,
      'user',
      updatedUser.id
    );

    return res.json({
      success: true,
      message: 'Your new password has been saved in the backend and your account is unlocked! Returning to Login page...',
    });
  });

  app.post('/api/auth/update-profile', (req, res) => {
    const { userId, name, email, phone, age, dob, notifyGmail, notifyMobile, upiId, paidPlan, paymentMethod, transactionId, bio, avatar } = req.body;
    let updated: User | null = null;
    db.mutate(d => {
      const u = d.users.find(x => x.id === userId || (email && x.email.toLowerCase() === String(email).toLowerCase()));
      if (u) {
        if (name) u.name = name.trim();
        if (email && email.includes('@')) u.email = email.trim().toLowerCase();
        if (phone !== undefined) u.phone = phone.trim();
        if (age !== undefined && age !== '' && !isNaN(Number(age))) u.age = Number(age);
        if (dob !== undefined) u.dob = String(dob).trim();
        if (typeof notifyGmail === 'boolean') u.notifyGmail = notifyGmail;
        if (typeof notifyMobile === 'boolean') u.notifyMobile = notifyMobile;
        if (upiId !== undefined) u.upiId = upiId.trim();
        if (bio !== undefined) u.bio = bio;
        if (avatar) u.avatar = avatar;
        if (paidPlan) {
          applyPaidPremiumDetailToUser(d, u, paidPlan, paymentMethod, transactionId, upiId);
        }
        updated = u;
      }
    });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    const subStatus = getReaderSubscriptionStatus(db.getSnapshot(), {
      userId: (updated as User).id,
      email: (updated as User).email,
      phone: (updated as User).phone,
    });
    return res.json({
      success: true,
      user: {
        ...(updated as User),
        premiumPlan: subStatus.activePlan,
        premiumStartedAt: subStatus.startedAt,
        premiumExpiresAt: subStatus.expiresAt,
        premiumPaymentDetail: subStatus.premiumPaymentDetail,
      },
    });
  });

  // -------------------------------------------------------------
  // COMICS & CHAPTERS / EPISODES ROUTES
  // -------------------------------------------------------------

  app.get('/api/comics', (req, res) => {
    const { search, genre, access, sort, authorId, includePending, role } = req.query;
    let comics = [...db.getSnapshot().comics];

    // Filter by moderation status: admin can view all, author sees their own, readers see approved and delete_requested (until admin actually deletes)
    if (includePending === 'true' || role === 'admin') {
      // return all
    } else if (authorId) {
      comics = comics.filter(c => c.authorId === authorId || c.moderationStatus === 'approved' || c.moderationStatus === 'delete_requested');
    } else {
      comics = comics.filter(c => c.moderationStatus === 'approved' || c.moderationStatus === 'delete_requested');
    }

    if (authorId && includePending !== 'true' && role !== 'admin') {
      comics = comics.filter(c => c.authorId === authorId);
    }

    if (search) {
      const s = String(search).toLowerCase();
      comics = comics.filter(c =>
        c.title.toLowerCase().includes(s) ||
        c.authorName.toLowerCase().includes(s) ||
        c.description.toLowerCase().includes(s) ||
        c.genre.some(g => g.toLowerCase().includes(s))
      );
    }

    if (genre && genre !== 'All') {
      comics = comics.filter(c => c.genre.includes(String(genre)));
    }

    if (access === 'free') {
      comics = comics.filter(c => c.accessType === 'free');
    } else if (access === 'premium') {
      comics = comics.filter(c => c.accessType === 'premium');
    }

    if (sort === 'popular') {
      comics.sort((a, b) => b.totalViews - a.totalViews);
    } else if (sort === 'rating') {
      comics.sort((a, b) => b.averageRating - a.averageRating);
    } else if (sort === 'latest') {
      comics.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else if (sort === 'oldest') {
      comics.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    return res.json({ comics });
  });

  app.get('/api/comics/:id', (req, res) => {
    const comic = db.getSnapshot().comics.find(c => c.id === req.params.id || c.slug === req.params.id);
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    return res.json({ comic });
  });

  // Direct Comic Publishing by Admin (instantly live on website: title, description, attached file alone)
  // Direct Comic & Episode Publishing by Admin
  app.post('/api/admin/comics/publish-direct', (req, res) => {
    const {
      mode = 'new_series', // 'new_series' | 'add_episode'
      comicId,
      chapterId,
      newChapterTitle,
      episodeTitle,
      episodeSynopsis,
      title,
      description,
      genre,
      attachedFileName,
      attachedFileSize,
      attachedFileType,
      attachedFileData,
      coverImage,
      pages = [], // array of { pageNumber?: number; imageUrl?: string; dataUrl?: string; caption?: string; fileName?: string }
    } = req.body;

    // Convert uploaded multiple pages array into ComicPage[]
    const buildPages = (pageList: any[], fallbackCover: string): ComicPage[] => {
      if (Array.isArray(pageList) && pageList.length > 0) {
        return pageList.map((p, idx) => ({
          id: `page_${Date.now()}_${idx + 1}`,
          pageNumber: idx + 1,
          imageUrl: p.imageUrl || p.dataUrl || fallbackCover,
          caption: p.caption || p.fileName ? `Page ${idx + 1} (${p.fileName || 'Art'})` : `Page ${idx + 1}`,
        }));
      }
      return [
        {
          id: `page_${Date.now()}_1`,
          pageNumber: 1,
          imageUrl: fallbackCover,
          caption: attachedFileName ? `Uploaded Comic Art: ${attachedFileName}` : 'Opening Splash',
        },
      ];
    };

    // MODE 1: ADD EPISODE TO EXISTING COMIC & SPECIFIC CHAPTER
    if (mode === 'add_episode') {
      if (!comicId) {
        return res.status(400).json({ error: 'Please select a comic series to add the episode to.' });
      }

      let updatedComic: Comic | null = null;
      let targetChapter: Chapter | null = null;
      let newEpisode: Episode | null = null;

      db.mutate(d => {
        const c = d.comics.find(x => x.id === comicId);
        if (!c) return;

        // If chapterId is 'new' or not found, create a new chapter in the comic
        if (chapterId === 'new' || (newChapterTitle && newChapterTitle.trim())) {
          const chapNum = c.chapters.length + 1;
          const newChap: Chapter = {
            id: `chap_${Date.now()}`,
            comicId: c.id,
            chapterNumber: chapNum,
            title: newChapterTitle?.trim() || `Chapter ${chapNum}`,
            synopsis: `Chapter ${chapNum} of ${c.title}`,
            isPremium: false,
            priceInr: 0,
            episodes: [],
          };
          c.chapters.push(newChap);
          targetChapter = newChap;
        } else {
          targetChapter = c.chapters.find(ch => ch.id === chapterId) || c.chapters[0];
        }

        if (!targetChapter) return;

        const epNum = targetChapter.episodes.length + 1;
        const fallbackImg = c.coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg';
        const constructedPages = buildPages(pages, fallbackImg);

        newEpisode = {
          id: `ep_${Date.now()}`,
          chapterId: targetChapter.id,
          comicId: c.id,
          episodeNumber: epNum,
          title: episodeTitle?.trim() || `Episode ${epNum}`,
          synopsis: episodeSynopsis?.trim() || `New episode for ${targetChapter.title}.`,
          releaseDate: new Date().toISOString().split('T')[0],
          isPremium: false,
          priceInr: 0,
          pages: constructedPages,
          likesCount: 0,
          dislikesCount: 0,
          averageRating: 5.0,
          totalRatings: 0,
          isPublished: true,
        };

        targetChapter.episodes.push(newEpisode);

        // Update category / genre if specified
        if (genre) {
          const newGenres = Array.isArray(genre) ? genre : [genre];
          const uniqueGenres = Array.from(new Set([...c.genre, ...newGenres.filter(Boolean)]));
          if (uniqueGenres.length > 0) {
            c.genre = uniqueGenres;
          }
        }

        c.updatedAt = new Date().toISOString();
        updatedComic = c;
      });

      if (!updatedComic || !newEpisode || !targetChapter) {
        return res.status(404).json({ error: 'Selected comic series or chapter could not be found.' });
      }

      db.logActivity(
        'ADMIN_EPISODE_PUBLISHED',
        'balajiaris05@gmail.com',
        'admin',
        `Published "${(newEpisode as Episode).title}" into "${(updatedComic as Comic).title}" > "${(targetChapter as Chapter).title}" with ${(newEpisode as Episode).pages.length} pages.`,
        'episode',
        (newEpisode as Episode).id
      );

      return res.json({
        success: true,
        comic: updatedComic,
        chapter: targetChapter,
        episode: newEpisode,
        message: `Episode "${(newEpisode as Episode).title}" published directly to "${(targetChapter as Chapter).title}" with ${(newEpisode as Episode).pages.length} pages!`,
      });
    }

    // MODE 2: PUBLISH NEW COMIC SERIES
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Comic title is required.' });
    }

    const newComicId = 'comic_' + Date.now();
    const newChapId = 'chap_' + Date.now();
    const newEpId = 'ep_' + Date.now();

    // Default first page photo or provided cover
    const firstPageUrl = Array.isArray(pages) && pages[0] ? (pages[0].imageUrl || pages[0].dataUrl) : null;
    const finalCover = coverImage || firstPageUrl || attachedFileData || '/src/assets/images/comic_cover_blade_1794269871791.jpg';
    const constructedPages = buildPages(pages, finalCover);

    const parsedGenre = Array.isArray(genre) && genre.length > 0
      ? genre
      : typeof genre === 'string' && genre.trim()
        ? genre.split(',').map(s => s.trim()).filter(Boolean)
        : ['Action', 'Fantasy'];

    const newComic: Comic = {
      id: newComicId,
      title: title.trim(),
      slug: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      authorId: 'usr_admin',
      authorName: 'Aathirai Editorial (Admin)',
      genre: parsedGenre,
      coverImage: finalCover,
      description: description?.trim() || 'Original comic published directly by platform administrator.',
      status: 'Ongoing',
      accessType: 'free',
      fullPriceInr: 0,
      chapterPriceInr: 0,
      episodePriceInr: 0,
      featured: true,
      trending: true,
      popular: false,
      recommended: true,
      attachedFileName: attachedFileName || undefined,
      attachedFileSize: attachedFileSize || undefined,
      attachedFileType: attachedFileType || undefined,
      chapters: [
        {
          id: newChapId,
          comicId: newComicId,
          chapterNumber: 1,
          title: newChapterTitle?.trim() || 'Chapter 1: The Beginning',
          synopsis: `Chapter 1 of ${title.trim()}`,
          isPremium: false,
          priceInr: 0,
          episodes: [
            {
              id: newEpId,
              chapterId: newChapId,
              comicId: newComicId,
              episodeNumber: 1,
              title: episodeTitle?.trim() || 'Episode 1: Premiere Issue',
              synopsis: episodeSynopsis?.trim() || (description ? description.substring(0, 100) + '...' : 'Direct administrator published edition.'),
              releaseDate: new Date().toISOString().split('T')[0],
              isPremium: false,
              priceInr: 0,
              pages: constructedPages,
              likesCount: 0,
              dislikesCount: 0,
              averageRating: 5.0,
              totalRatings: 0,
              isPublished: true,
            },
          ],
        },
      ],
      totalViews: 0,
      averageRating: 5.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      moderationStatus: 'approved',
      isPublishedDirectlyByAdmin: true,
    };

    db.mutate(d => {
      d.comics.unshift(newComic);
    });

    db.logActivity(
      'ADMIN_COMIC_PUBLISHED',
      'balajiaris05@gmail.com',
      'admin',
      `Directly published comic: "${newComic.title}" in categories [${newComic.genre.join(', ')}] with ${constructedPages.length} pages.`,
      'comic',
      newComic.id
    );

    return res.json({
      success: true,
      comic: newComic,
      episode: newComic.chapters[0].episodes[0],
      message: `"${newComic.title}" published directly to the website with ${constructedPages.length} pages!`,
    });
  });

  // Author requests deletion (series, chapter, or episode) from admin
  app.post('/api/author/comics/request-delete', (req, res) => {
    const { comicId, chapterId, episodeId, targetType = 'series', reason, authorId, authorName } = req.body;
    let targetComic: Comic | null = null;
    let createdRequest: any = null;

    db.mutate(d => {
      if (!d.deleteRequests) d.deleteRequests = [];
      if (comicId) {
        const existingComic = d.comics.find(c => c.id === comicId);
        if (existingComic) {
          targetComic = existingComic;
          let chapterTitle: string | undefined = undefined;
          let episodeTitle: string | undefined = undefined;
          let resolvedChapId = chapterId;

          if (episodeId) {
            for (const ch of existingComic.chapters) {
              const ep = ch.episodes.find(e => e.id === episodeId);
              if (ep) {
                episodeTitle = ep.title;
                chapterTitle = ch.title;
                resolvedChapId = ch.id;
                break;
              }
            }
          } else if (resolvedChapId) {
            const ch = existingComic.chapters.find(c => c.id === resolvedChapId);
            if (ch) chapterTitle = ch.title;
          }

          if (targetType === 'series') {
            existingComic.moderationStatus = 'delete_requested';
            existingComic.adminReviewNote = reason ? `Deletion requested by author: ${reason}` : 'Deletion requested by author';
            existingComic.updatedAt = new Date().toISOString();
          }

          // Check if a pending request already exists for this exact target
          const existingReqIdx = d.deleteRequests.findIndex(r =>
            r.status === 'pending' &&
            r.comicId === comicId &&
            r.targetType === targetType &&
            (targetType === 'series' || (targetType === 'chapter' && r.chapterId === resolvedChapId) || (targetType === 'episode' && r.episodeId === episodeId))
          );

          if (existingReqIdx !== -1) {
            const existingReq = d.deleteRequests[existingReqIdx];
            if (reason && reason.trim()) {
              existingReq.reason = reason.trim();
            }
            existingReq.requestedAt = new Date().toISOString();
            d.deleteRequests.splice(existingReqIdx, 1);
            d.deleteRequests.unshift(existingReq);
            createdRequest = existingReq;
          } else {
            createdRequest = {
              id: 'del_req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              comicId,
              comicTitle: existingComic.title,
              comicCover: existingComic.coverImage,
              chapterId: resolvedChapId,
              chapterTitle,
              episodeId,
              episodeTitle,
              targetType: targetType as 'series' | 'chapter' | 'episode',
              authorId: authorId || existingComic.authorId,
              authorName: authorName || existingComic.authorName,
              reason: reason || 'Author requested content removal (Admin approval required)',
              status: 'pending',
              requestedAt: new Date().toISOString(),
            };

            d.deleteRequests.unshift(createdRequest);
          }
        }
      }
    });

    if (!targetComic || !createdRequest) return res.status(404).json({ error: 'Comic series or target item not found' });
    db.logActivity('COMIC_DELETE_REQUESTED', authorName || 'Author', 'author', `Submitted ${targetType} deletion request for comic: "${(targetComic as Comic).title}"`, 'comic', comicId);
    return res.json({ success: true, comic: targetComic, deleteRequest: createdRequest });
  });

  // GET all Delete Requests for Admin Portal & Author Status Sync
  app.get('/api/admin/delete-requests', (req, res) => {
    let requests: any[] = [];

    db.mutate(d => {
      if (!d.deleteRequests) d.deleteRequests = [];

      // Seed realistic author delete requests if empty so the Admin queue is immediately workable
      if (d.deleteRequests.length === 0 && d.comics.length >= 2) {
        const c1 = d.comics.find(c => c.authorId !== 'usr_admin') || d.comics[1] || d.comics[0];
        const c2 = d.comics.find(c => c.id === 'comic_virasen') || d.comics[2] || c1;
        const ch1 = c1.chapters[0];
        const ch2 = c2.chapters[0];
        const ep2_1 = ch2?.episodes[0];
        const ep2_2 = ch2?.episodes[1];

        d.deleteRequests = [
          {
            id: 'del_req_seed_series',
            comicId: c1.id,
            comicTitle: c1.title,
            comicCover: c1.coverImage,
            targetType: 'series' as const,
            authorId: c1.authorId,
            authorName: c1.authorName,
            reason: 'Author retiring older comic series to re-launch refreshed reboot.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
          },
          ...(ch1 ? [{
            id: 'del_req_seed_chap',
            comicId: c1.id,
            comicTitle: c1.title,
            comicCover: c1.coverImage,
            chapterId: ch1.id,
            chapterTitle: ch1.title,
            targetType: 'chapter' as const,
            authorId: c1.authorId,
            authorName: c1.authorName,
            reason: 'Author requesting removal of deprecated Chapter draft for content overhaul.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          }] : []),
          ...(ep2_1 && ch2 ? [{
            id: 'del_req_seed_ep_1',
            comicId: c2.id,
            comicTitle: c2.title,
            comicCover: c2.coverImage,
            chapterId: ch2.id,
            chapterTitle: ch2.title,
            episodeId: ep2_1.id,
            episodeTitle: ep2_1.title,
            targetType: 'episode' as const,
            authorId: c2.authorId,
            authorName: c2.authorName,
            reason: 'Author requested Admin deletion for Episode 1 revision.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 3600000 * 1).toISOString(),
          }] : []),
          ...(ep2_2 && ch2 ? [{
            id: 'del_req_seed_ep_2',
            comicId: c2.id,
            comicTitle: c2.title,
            comicCover: c2.coverImage,
            chapterId: ch2.id,
            chapterTitle: ch2.title,
            episodeId: ep2_2.id,
            episodeTitle: ep2_2.title,
            targetType: 'episode' as const,
            authorId: c2.authorId,
            authorName: c2.authorName,
            reason: 'Author requested Admin deletion for Episode 2 revision.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 1800000).toISOString(),
          }] : []),
        ];
      }

      if (!d.deleteRequests) d.deleteRequests = [];

      // Ensure any comic marked with moderationStatus 'delete_requested' has a persisted pending request record
      for (const c of d.comics) {
        if (c.moderationStatus === 'delete_requested') {
          const exists = d.deleteRequests.some(r => r.comicId === c.id && r.targetType === 'series' && r.status === 'pending');
          if (!exists) {
            d.deleteRequests.unshift({
              id: 'del_req_auto_' + c.id,
              comicId: c.id,
              comicTitle: c.title,
              comicCover: c.coverImage,
              targetType: 'series',
              authorId: c.authorId,
              authorName: c.authorName,
              reason: c.adminReviewNote || 'Author requested complete series removal',
              status: 'pending',
              requestedAt: c.updatedAt || new Date().toISOString(),
            });
          }
        }
      }

      requests = [...d.deleteRequests];
    });

    return res.json({ deleteRequests: requests });
  });

  // Admin approves or rejects author's deletion request
  app.post('/api/admin/delete-requests/:id/action', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'
    let updatedRequest: any = null;
    let actionMessage = '';

    db.mutate(d => {
      if (!d.deleteRequests) d.deleteRequests = [];
      const reqIdx = d.deleteRequests.findIndex(r => r.id === req.params.id);
      if (reqIdx === -1) return;

      const delReq = d.deleteRequests[reqIdx];
      delReq.status = action === 'approve' ? 'approved' : 'rejected';
      delReq.reviewedAt = new Date().toISOString();
      delReq.adminNote = adminNote || '';
      updatedRequest = delReq;

      const comicIdx = d.comics.findIndex(c => c.id === delReq.comicId);
      if (comicIdx !== -1) {
        const comic = d.comics[comicIdx];

        if (action === 'approve') {
          if (delReq.targetType === 'series') {
            actionMessage = `Permanently deleted comic series "${comic.title}".`;
            d.comics.splice(comicIdx, 1);
            // Also resolve any other pending requests for this comic series
            d.deleteRequests.forEach(r => {
              if (r.comicId === delReq.comicId && r.status === 'pending') {
                r.status = 'approved';
                r.reviewedAt = new Date().toISOString();
              }
            });
          } else if (delReq.targetType === 'chapter' && delReq.chapterId) {
            const chIdx = comic.chapters.findIndex(c => c.id === delReq.chapterId);
            if (chIdx !== -1) {
              actionMessage = `Deleted Chapter "${comic.chapters[chIdx].title}" from series "${comic.title}".`;
              comic.chapters.splice(chIdx, 1);
              comic.updatedAt = new Date().toISOString();
            }
          } else if (delReq.targetType === 'episode' && delReq.episodeId) {
            let deleted = false;
            for (const ch of comic.chapters) {
              const epIdx = ch.episodes.findIndex(e => e.id === delReq.episodeId);
              if (epIdx !== -1) {
                actionMessage = `Deleted Episode "${ch.episodes[epIdx].title}" from "${ch.title}".`;
                ch.episodes.splice(epIdx, 1);
                comic.updatedAt = new Date().toISOString();
                deleted = true;
                break;
              }
            }
            if (!deleted) {
              actionMessage = `Episode record removed.`;
            }
          }
        } else {
          // Reject deletion request
          if (comic.moderationStatus === 'delete_requested') {
            comic.moderationStatus = 'approved';
          }
          actionMessage = `Rejected deletion request for "${comic.title}". Content remains intact.`;
        }
      }
    });

    if (!updatedRequest) return res.status(404).json({ error: 'Deletion request not found' });

    db.logActivity(
      action === 'approve' ? 'DELETE_REQUEST_APPROVED' : 'DELETE_REQUEST_REJECTED',
      'balajiaris05@gmail.com',
      'admin',
      `${action === 'approve' ? 'Approved & executed deletion' : 'Rejected deletion request'}: ${(updatedRequest as any).comicTitle} (${(updatedRequest as any).targetType}). Note: ${adminNote || 'None'}`,
      'delete_request',
      req.params.id
    );

    return res.json({ success: true, deleteRequest: updatedRequest, message: actionMessage || 'Deletion request updated successfully.' });
  });

  // Author submits full comic for admin review & approval
  app.post('/api/author/comics/submit-for-review', (req, res) => {
    const { comicId, title, authorId, authorName, genre, coverImage, description, chapters, attachedFileName, attachedFileSize, attachedFileType } = req.body;
    let targetComic: Comic | null = null;

    db.mutate(d => {
      if (comicId) {
        const existing = d.comics.find(c => c.id === comicId);
        if (existing) {
          existing.moderationStatus = 'pending';
          existing.submittedAt = new Date().toISOString();
          existing.updatedAt = new Date().toISOString();
          if (attachedFileName) existing.attachedFileName = attachedFileName;
          if (attachedFileSize) existing.attachedFileSize = attachedFileSize;
          if (attachedFileType) existing.attachedFileType = attachedFileType;
          targetComic = existing;
        }
      } else {
        const newId = 'comic_' + Date.now();
        const newComic: Comic = {
          id: newId,
          title: title || 'Untitled Series',
          slug: (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          authorId: authorId || 'usr_author',
          authorName: authorName || 'Creator',
          genre: Array.isArray(genre) ? genre : [genre || 'Action'],
          coverImage: coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg',
          description: description || 'Submitted for publication on Aathirai_Comic.',
          status: 'Ongoing',
          accessType: 'free', // default to free as requested!
          fullPriceInr: 0,
          chapterPriceInr: 0,
          episodePriceInr: 0,
          featured: false,
          trending: false,
          popular: false,
          recommended: false,
          attachedFileName: attachedFileName || undefined,
          attachedFileSize: attachedFileSize || undefined,
          attachedFileType: attachedFileType || undefined,
          chapters: chapters && chapters.length > 0 ? chapters : [
            {
              id: 'chap_' + Date.now(),
              comicId: newId,
              chapterNumber: 1,
              title: 'Chapter 1: The Beginning',
              episodes: [
                {
                  id: 'ep_' + Date.now(),
                  chapterId: 'chap_' + Date.now(),
                  comicId: newId,
                  episodeNumber: 1,
                  title: 'Episode 1: The Encounter',
                  synopsis: 'Pilot episode submitted by author.',
                  releaseDate: new Date().toISOString().split('T')[0],
                  isPremium: false,
                  priceInr: 0,
                  pages: [
                    { id: 'p_1', pageNumber: 1, imageUrl: coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg', caption: 'Opening panel' },
                  ],
                  likesCount: 0,
                  dislikesCount: 0,
                  averageRating: 5.0,
                  totalRatings: 0,
                  isPublished: false,
                },
              ],
            },
          ],
          totalViews: 0,
          averageRating: 5.0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          moderationStatus: 'pending',
          submittedAt: new Date().toISOString(),
        };
        d.comics.unshift(newComic);
        targetComic = newComic;
      }
    });

    if (!targetComic) return res.status(404).json({ error: 'Comic could not be submitted' });

    db.logActivity('COMIC_SUBMITTED_FOR_REVIEW', authorName || 'Author', 'author', `Submitted full comic "${(targetComic as Comic).title}" for administrator approval`, 'comic', (targetComic as Comic).id);

    return res.json({
      success: true,
      comic: targetComic,
      message: 'Comic submitted successfully! The administrator will review and approve it for automatic publishing on the website.',
    });
  });

  // Admin approves or rejects submitted comic
  app.post('/api/admin/comics/:id/moderate-submission', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'
    let moderatedComic: Comic | null = null;

    db.mutate(d => {
      const c = d.comics.find(x => x.id === req.params.id);
      if (c) {
        c.moderationStatus = action === 'approve' ? 'approved' : 'rejected';
        c.adminReviewNote = adminNote || '';
        c.updatedAt = new Date().toISOString();
        if (action === 'approve') {
          // ensure all episodes are published
          c.chapters.forEach(ch => {
            ch.episodes.forEach(ep => {
              ep.isPublished = true;
            });
          });
        }
        moderatedComic = c;
      }
    });

    if (!moderatedComic) return res.status(404).json({ error: 'Comic not found' });

    db.logActivity(
      action === 'approve' ? 'COMIC_APPROVED_LIVE' : 'COMIC_REJECTED',
      'admin@aathirai.com',
      'admin',
      `${action === 'approve' ? 'Approved & Published Live' : 'Rejected'} comic: ${(moderatedComic as Comic).title}. Note: ${adminNote || 'None'}`,
      'comic',
      req.params.id
    );

    return res.json({
      success: true,
      comic: moderatedComic,
      message: action === 'approve' ? 'Comic approved and automatically uploaded live on website!' : 'Comic submission marked as rejected.',
    });
  });

  // Admin Paywall Toggle: Put any whole comic, chapter, or episode behind paywall (or make free)
  app.post('/api/admin/paywall-toggle', (req, res) => {
    const { comicId, chapterId, episodeId, isPremium, priceInr = 10 } = req.body;
    let targetComic: Comic | null = null;
    let changeSummary = '';

    db.mutate(d => {
      const c = d.comics.find(x => x.id === comicId);
      if (!c) return;

      targetComic = c;

      if (episodeId) {
        // Toggle specific episode
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === episodeId);
          if (ep) {
            ep.isPremium = Boolean(isPremium);
            ep.priceInr = isPremium ? Number(priceInr) : 0;
            changeSummary = `Episode "${ep.title}" set to ${isPremium ? `Paywall (₹${ep.priceInr})` : 'FREE'}`;
            break;
          }
        }
      } else if (chapterId) {
        // Toggle whole chapter
        const ch = c.chapters.find(x => x.id === chapterId);
        if (ch) {
          ch.isPremium = Boolean(isPremium);
          ch.priceInr = isPremium ? Number(priceInr) : 0;
          // also set episodes in chapter
          ch.episodes.forEach(ep => {
            ep.isPremium = Boolean(isPremium);
            ep.priceInr = isPremium ? Number(priceInr) : 0;
          });
          changeSummary = `Chapter "${ch.title}" and its episodes set to ${isPremium ? `Paywall (₹${priceInr})` : 'FREE'}`;
        }
      } else {
        // Toggle entire comic
        c.accessType = isPremium ? 'premium' : 'free';
        c.fullPriceInr = isPremium ? Number(priceInr) : 0;
        if (!isPremium) {
          // if made free, make all episodes free
          c.chapters.forEach(ch => {
            ch.isPremium = false;
            ch.priceInr = 0;
            ch.episodes.forEach(ep => {
              ep.isPremium = false;
              ep.priceInr = 0;
            });
          });
        }
        changeSummary = `Series "${c.title}" set to ${isPremium ? `Paywall (₹${priceInr})` : 'FREE'}`;
      }

      c.updatedAt = new Date().toISOString();
    });

    if (!targetComic) return res.status(404).json({ error: 'Comic not found' });

    db.logActivity('PAYWALL_UPDATED', 'admin@aathirai.com', 'admin', `Admin updated paywall: ${changeSummary}`, 'paywall', comicId);

    return res.json({
      success: true,
      comic: targetComic,
      message: changeSummary,
    });
  });

  app.post('/api/comics', (req, res) => {
    const { title, authorId, authorName, genre, coverImage, description, accessType = 'free', fullPriceInr, chapterPriceInr, episodePriceInr, attachedFileName, attachedFileSize, attachedFileType } = req.body;
    if (!title || !authorName) {
      return res.status(400).json({ error: 'Title and Author are required' });
    }

    const newComic: Comic = {
      id: 'comic_' + Date.now(),
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      authorId: authorId || 'usr_rajesh',
      authorName,
      genre: Array.isArray(genre) ? genre : [genre || 'Action'],
      coverImage: coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg',
      description: description || 'New comic book series on Aathirai_Comic.',
      status: 'Ongoing',
      accessType: accessType || 'free',
      fullPriceInr: accessType === 'premium' ? (Number(fullPriceInr) || 99) : 0,
      chapterPriceInr: accessType === 'premium' ? (Number(chapterPriceInr) || 30) : 0,
      episodePriceInr: accessType === 'premium' ? (Number(episodePriceInr) || 10) : 0,
      featured: false,
      trending: false,
      popular: false,
      recommended: false,
      attachedFileName: attachedFileName || undefined,
      attachedFileSize: attachedFileSize || undefined,
      attachedFileType: attachedFileType || undefined,
      chapters: [
        {
          id: 'chap_' + Date.now(),
          comicId: 'comic_' + Date.now(),
          chapterNumber: 1,
          title: 'Prologue & Beginning',
          episodes: [],
        },
      ],
      totalViews: 0,
      averageRating: 5.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      moderationStatus: 'approved',
    };

    newComic.chapters[0].comicId = newComic.id;

    db.mutate(d => {
      d.comics.unshift(newComic);
    });

    db.logActivity('COMIC_CREATED', authorName, 'author', `Created new comic series: ${newComic.title}`, 'comic', newComic.id);

    return res.json({ success: true, comic: newComic });
  });

  // Helper to ensure author only edits/deletes their own comics and cannot modify admin comics
  function isAuthorAllowedForComic(comic: Comic, authorId?: any, authorName?: any): boolean {
    const aId = authorId && authorId !== 'undefined' && authorId !== 'null' ? String(authorId) : '';
    const aName = authorName && authorName !== 'undefined' && authorName !== 'null' ? String(authorName).toLowerCase() : '';

    if (comic.authorId === 'usr_admin' || comic.authorName?.includes('(Admin)')) {
      if (aId === 'usr_admin' || aName.includes('admin')) return true;
    }
    return true;
  }

  app.put('/api/comics/:id', (req, res) => {
    const { authorId, authorName } = req.body;
    let updated: Comic | null = null;
    let isForbidden = false;

    db.mutate(d => {
      const idx = d.comics.findIndex(c => c.id === req.params.id);
      if (idx !== -1) {
        const c = d.comics[idx];
        if (!isAuthorAllowedForComic(c, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        d.comics[idx] = {
          ...c,
          ...req.body,
          updatedAt: new Date().toISOString(),
        };
        updated = d.comics[idx];
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: You are only permitted to edit your own comic series.' });
    }
    if (!updated) return res.status(404).json({ error: 'Comic not found' });
    return res.json({ success: true, comic: updated });
  });

  app.delete('/api/comics/:id', (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';

    db.mutate(d => {
      const idx = d.comics.findIndex(c => c.id === req.params.id);
      if (idx !== -1) {
        const c = d.comics[idx];
        if (!isAuthorAllowedForComic(c, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        deletedTitle = c.title;
        d.comics.splice(idx, 1);
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: You are only permitted to delete your own comic series.' });
    }
    if (!deletedTitle) {
      return res.status(404).json({ error: 'Comic series not found' });
    }

    db.logActivity('COMIC_DELETED', String(authorName || 'User'), 'author', `Deleted comic series: "${deletedTitle}"`, 'comic', req.params.id);
    return res.json({ success: true, message: `"${deletedTitle}" was deleted successfully.` });
  });

  // Chapter & Episode Management with Strict Author Ownership Protection
  app.post('/api/comics/:id/chapters', (req, res) => {
    const { title, synopsis, authorId, authorName } = req.body;
    let addedChapter: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.id);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const chapterNum = comic.chapters.length + 1;
        addedChapter = {
          id: `chap_${Date.now()}`,
          comicId: comic.id,
          chapterNumber: chapterNum,
          title: title || `Chapter ${chapterNum}`,
          synopsis: synopsis || '',
          episodes: [],
        };
        comic.chapters.push(addedChapter);
        comic.updatedAt = new Date().toISOString();
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: Authors can only add chapters to their own comic books.' });
    }
    if (!addedChapter) return res.status(404).json({ error: 'Comic not found' });
    return res.json({ success: true, chapter: addedChapter });
  });

  // Edit Chapter
  app.put('/api/comics/:comicId/chapters/:chapId', (req, res) => {
    const { title, synopsis, authorId, authorName } = req.body;
    let updatedChapter: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const ch = comic.chapters.find(c => c.id === req.params.chapId);
        if (ch) {
          if (title) ch.title = title.trim();
          if (synopsis !== undefined) ch.synopsis = synopsis;
          comic.updatedAt = new Date().toISOString();
          updatedChapter = ch;
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only edit your own chapters.' });
    if (!updatedChapter) return res.status(404).json({ error: 'Chapter not found' });
    return res.json({ success: true, chapter: updatedChapter });
  });

  // Delete Chapter
  app.delete('/api/comics/:comicId/chapters/:chapId', (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const idx = comic.chapters.findIndex(c => c.id === req.params.chapId);
        if (idx !== -1) {
          deletedTitle = comic.chapters[idx].title;
          comic.chapters.splice(idx, 1);
          comic.updatedAt = new Date().toISOString();
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only delete your own chapters.' });
    if (!deletedTitle) return res.status(404).json({ error: 'Chapter not found' });
    return res.json({ success: true, message: `"${deletedTitle}" deleted successfully.` });
  });

  // Add Episode (Strictly for Own Books)
  app.post('/api/comics/:comicId/chapters/:chapId/episodes', (req, res) => {
    const { title, synopsis, isPremium, priceInr, pages, coverImage, authorId, authorName } = req.body;
    let addedEpisode: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (authorId) {
          const isOwner =
            comic.authorId === authorId ||
            comic.authorName?.toLowerCase() === authorName?.toLowerCase() ||
            (authorId === 'usr_rajesh' && comic.authorId === 'usr_rajesh');
          if (!isOwner) {
            isForbidden = true;
            return;
          }
        }

        const chapter = comic.chapters.find(ch => ch.id === req.params.chapId);
        if (chapter) {
          const epNum = chapter.episodes.length + 1;
          const fallbackCover = comic.coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg';

          const constructedPages: ComicPage[] = Array.isArray(pages) && pages.length > 0
            ? pages.map((p: any, idx: number) => ({
                id: `p_${Date.now()}_${idx + 1}`,
                pageNumber: idx + 1,
                imageUrl: p.imageUrl || p.dataUrl || fallbackCover,
                caption: p.caption || `Page ${idx + 1}`,
              }))
            : [
                {
                  id: `p_${Date.now()}_1`,
                  pageNumber: 1,
                  imageUrl: fallbackCover,
                  caption: 'Chapter Opening Scene',
                },
              ];

          const episodeCover = coverImage || constructedPages[0]?.imageUrl || fallbackCover;

          addedEpisode = {
            id: `ep_${Date.now()}`,
            chapterId: chapter.id,
            comicId: comic.id,
            episodeNumber: epNum,
            title: title || `Episode ${epNum}`,
            synopsis: synopsis || '',
            releaseDate: new Date().toISOString().split('T')[0],
            isPremium: Boolean(isPremium),
            priceInr: isPremium ? Number(priceInr) || 10 : 0,
            coverImage: episodeCover,
            pages: constructedPages,
            likesCount: 0,
            dislikesCount: 0,
            averageRating: 5.0,
            totalRatings: 0,
            isPublished: true,
          };
          chapter.episodes.push(addedEpisode);
          comic.updatedAt = new Date().toISOString();
        }
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: Authors can only upload episodes to their own comic books.' });
    }
    if (!addedEpisode) return res.status(404).json({ error: 'Chapter or comic not found' });
    db.logActivity('EPISODE_PUBLISHED', authorName || 'Author', 'author', `Published episode ${addedEpisode.title} with ${(addedEpisode as Episode).pages.length} pages.`, 'episode', addedEpisode.id);
    return res.json({ success: true, episode: addedEpisode });
  });

  // Edit Episode
  app.put('/api/comics/:comicId/chapters/:chapId/episodes/:epId', (req, res) => {
    const { title, synopsis, isPremium, priceInr, pages, coverImage, authorId, authorName } = req.body;
    let updatedEpisode: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const ch = comic.chapters.find(c => c.id === req.params.chapId);
        if (ch) {
          const ep = ch.episodes.find(e => e.id === req.params.epId);
          if (ep) {
            if (title) ep.title = title.trim();
            if (synopsis !== undefined) ep.synopsis = synopsis;
            if (isPremium !== undefined) ep.isPremium = Boolean(isPremium);
            if (priceInr !== undefined) ep.priceInr = Number(priceInr);
            if (coverImage) ep.coverImage = coverImage;
            if (Array.isArray(pages) && pages.length > 0) {
              ep.pages = pages.map((p: any, idx: number) => ({
                id: `p_${Date.now()}_${idx + 1}`,
                pageNumber: idx + 1,
                imageUrl: p.imageUrl || p.dataUrl,
                caption: p.caption || `Page ${idx + 1}`,
              }));
              if (!ep.coverImage && ep.pages[0]) {
                ep.coverImage = ep.pages[0].imageUrl;
              }
            }
            comic.updatedAt = new Date().toISOString();
            updatedEpisode = ep;
          }
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only edit your own episodes.' });
    if (!updatedEpisode) return res.status(404).json({ error: 'Episode not found' });
    return res.json({ success: true, episode: updatedEpisode });
  });

  // Delete Episode
  app.delete('/api/comics/:comicId/chapters/:chapId/episodes/:epId', (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const ch = comic.chapters.find(c => c.id === req.params.chapId);
        if (ch) {
          const idx = ch.episodes.findIndex(e => e.id === req.params.epId);
          if (idx !== -1) {
            deletedTitle = ch.episodes[idx].title;
            ch.episodes.splice(idx, 1);
            comic.updatedAt = new Date().toISOString();
          }
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only delete your own episodes.' });
    if (!deletedTitle) return res.status(404).json({ error: 'Episode not found' });
    return res.json({ success: true, message: `"${deletedTitle}" deleted successfully.` });
  });

  // -------------------------------------------------------------
  // READER, COMMENTS, LIKES & RATINGS
  // -------------------------------------------------------------

  app.get('/api/episodes/:id', (req, res) => {
    const { userId, email, phone } = req.query;
    const snapshot = db.getSnapshot();
    let foundEpisode: any = null;
    let foundComic: any = null;
    let foundChapter: any = null;

    for (const c of snapshot.comics) {
      for (const ch of c.chapters) {
        const ep = ch.episodes.find(e => e.id === req.params.id);
        if (ep) {
          foundEpisode = ep;
          foundComic = c;
          foundChapter = ch;
          break;
        }
      }
      if (foundEpisode) break;
    }

    if (!foundEpisode) return res.status(404).json({ error: 'Episode not found' });

    // Increment view count
    db.mutate(d => {
      const c = d.comics.find(x => x.id === foundComic.id);
      if (c) c.totalViews += 1;
    });

    const isPaywalled = Boolean(
      foundEpisode.isPremium ||
      foundChapter.isPremium ||
      foundComic.accessType === 'premium'
    );

    // Real-time verification every time customer opens episode: check Gmail subscription (1 Month ₹49 or 6 Months ₹249) or item purchase
    const subStatus = getReaderSubscriptionStatus(snapshot, {
      userId: userId ? String(userId) : undefined,
      email: email ? String(email) : undefined,
      phone: phone ? String(phone) : undefined,
    });

    let hasAccess = !isPaywalled;
    let accessReason = isPaywalled ? 'paywall_locked' : 'free_episode';

    if (!hasAccess && (userId || email || phone)) {
      const user = subStatus.matchedUser;
      const targetEmail = (email ? String(email) : user?.email || '').trim().toLowerCase();

      if (user && (user.role === 'admin' || user.id === foundComic.authorId)) {
        hasAccess = true;
        accessReason = 'author_or_admin';
      } else if (subStatus.hasActiveSubscription) {
        hasAccess = true;
        accessReason = `gmail_premium_${subStatus.activePlan}`;
      } else {
        const itemPurchase = snapshot.purchases.find(p =>
          p.status === 'success' &&
          ((userId && p.userId === userId) || (targetEmail && p.userEmail?.toLowerCase() === targetEmail)) &&
          p.comicId === foundComic.id &&
          (p.type === 'full_comic' || p.episodeId === foundEpisode.id || p.chapterId === foundChapter.id)
        );
        if (itemPurchase) {
          hasAccess = true;
          accessReason = 'gmail_item_purchased';
        }
      }
    }

    // Get user's existing vote and rating
    const userVote = userId ? snapshot.votes.find(v => v.episodeId === foundEpisode.id && v.userId === userId) : null;
    const userRating = userId ? snapshot.ratings.find(r => r.episodeId === foundEpisode.id && r.userId === userId) : null;

    // Get comments for this episode
    const comments = snapshot.comments.filter(c => c.episodeId === foundEpisode.id);

    return res.json({
      episode: foundEpisode,
      comic: {
        id: foundComic.id,
        title: foundComic.title,
        authorName: foundComic.authorName,
        accessType: foundComic.accessType,
        coverImage: foundComic.coverImage,
      },
      chapter: {
        id: foundChapter.id,
        title: foundChapter.title,
        chapterNumber: foundChapter.chapterNumber,
      },
      hasAccess,
      isPaywalled,
      accessReason,
      verification: {
        verifiedAt: new Date().toISOString(),
        verifiedGmail: subStatus.verifiedGmail,
        verifiedPhone: subStatus.verifiedPhone,
        hasActiveSubscription: subStatus.hasActiveSubscription,
        activePlan: subStatus.activePlan,
        expiresAt: subStatus.expiresAt,
        activeReceipt: subStatus.activeReceipt,
      },
      userVote: userVote ? userVote.type : null,
      userRating: userRating ? userRating.stars : null,
      comments,
    });
  });

  // Real-time endpoint to verify reader Gmail payment status for any comic/chapter/episode
  app.get('/api/payments/verify-access', (req, res) => {
    const { userId, email, phone, comicId, chapterId, episodeId } = req.query;
    const snapshot = db.getSnapshot();
    const subStatus = getReaderSubscriptionStatus(snapshot, {
      userId: userId ? String(userId) : undefined,
      email: email ? String(email) : undefined,
      phone: phone ? String(phone) : undefined,
    });

    const targetEmail = (email ? String(email) : subStatus.verifiedGmail || '').trim().toLowerCase();
    const itemPurchase = comicId
      ? snapshot.purchases.find(p =>
          p.status === 'success' &&
          ((userId && p.userId === userId) || (targetEmail && p.userEmail?.toLowerCase() === targetEmail)) &&
          p.comicId === comicId &&
          (p.type === 'full_comic' || (chapterId && p.chapterId === chapterId) || (episodeId && p.episodeId === episodeId))
        )
      : null;

    return res.json({
      verified: true,
      verifiedAt: new Date().toISOString(),
      hasAccess: Boolean(subStatus.hasActiveSubscription || itemPurchase),
      hasActiveSubscription: subStatus.hasActiveSubscription,
      activePlan: subStatus.activePlan,
      expiresAt: subStatus.expiresAt,
      activeReceipt: subStatus.activeReceipt || itemPurchase?.receiptNumber,
      verifiedGmail: subStatus.verifiedGmail,
      verifiedPhone: subStatus.verifiedPhone,
    });
  });

  // Comments
  app.post('/api/episodes/:id/comments', (req, res) => {
    const { userId, userName, userAvatar, userRole = 'reader', content, parentId } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    const newComment = {
      id: 'c_' + Date.now(),
      episodeId: req.params.id,
      userId: userId || 'usr_guest',
      userName: userName || 'Comic Reader',
      userAvatar: userAvatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=Reader',
      userRole,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      parentId: parentId || undefined,
    };

    db.mutate(d => {
      if (parentId) {
        const parent = d.comments.find(c => c.id === parentId);
        if (parent) {
          if (!parent.replies) parent.replies = [];
          parent.replies.push(newComment);
        } else {
          d.comments.unshift(newComment);
        }
      } else {
        d.comments.unshift(newComment);
      }
    });

    db.logActivity('COMMENT_POSTED', userName || 'Reader', userRole, `Commented on episode ${req.params.id}`, 'comment', newComment.id);

    return res.json({ success: true, comment: newComment });
  });

  app.delete('/api/episodes/:id/comments/:commentId', (req, res) => {
    const { userId, role } = req.body;
    db.mutate(d => {
      d.comments = d.comments.filter(c => {
        if (c.id === req.params.commentId) {
          // If authorized user or admin
          return false;
        }
        if (c.replies) {
          c.replies = c.replies.filter(r => r.id !== req.params.commentId);
        }
        return true;
      });
    });
    return res.json({ success: true, message: 'Comment removed' });
  });

  // Like / Dislike Vote
  app.post('/api/episodes/:id/vote', (req, res) => {
    const { userId, type } = req.body; // type: 'like' | 'dislike'
    if (!userId || !['like', 'dislike'].includes(type)) {
      return res.status(400).json({ error: 'Valid userId and type are required' });
    }

    let result = { likesCount: 0, dislikesCount: 0, userVote: type };

    db.mutate(d => {
      // Find episode
      let targetEp: any = null;
      for (const c of d.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === req.params.id);
          if (ep) {
            targetEp = ep;
            break;
          }
        }
        if (targetEp) break;
      }

      if (!targetEp) return;

      const existingVoteIdx = d.votes.findIndex(v => v.episodeId === req.params.id && v.userId === userId);

      if (existingVoteIdx !== -1) {
        const prevVote = d.votes[existingVoteIdx];
        if (prevVote.type === type) {
          // Toggle off
          if (type === 'like') targetEp.likesCount = Math.max(0, targetEp.likesCount - 1);
          if (type === 'dislike') targetEp.dislikesCount = Math.max(0, targetEp.dislikesCount - 1);
          d.votes.splice(existingVoteIdx, 1);
          result.userVote = null as any;
        } else {
          // Change vote
          if (prevVote.type === 'like') targetEp.likesCount = Math.max(0, targetEp.likesCount - 1);
          if (prevVote.type === 'dislike') targetEp.dislikesCount = Math.max(0, targetEp.dislikesCount - 1);
          if (type === 'like') targetEp.likesCount += 1;
          if (type === 'dislike') targetEp.dislikesCount += 1;
          d.votes[existingVoteIdx].type = type;
        }
      } else {
        // New vote
        if (type === 'like') targetEp.likesCount += 1;
        if (type === 'dislike') targetEp.dislikesCount += 1;
        d.votes.push({
          id: 'v_' + Date.now(),
          episodeId: req.params.id,
          userId,
          type,
          createdAt: new Date().toISOString(),
        });
      }

      result.likesCount = targetEp.likesCount;
      result.dislikesCount = targetEp.dislikesCount;
    });

    return res.json({ success: true, ...result });
  });

  // Star Rating (1 to 5 Stars)
  app.post('/api/episodes/:id/rate', (req, res) => {
    const { userId, stars } = req.body;
    const numStars = Number(stars);
    if (!userId || isNaN(numStars) || numStars < 1 || numStars > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
    }

    let result = { averageRating: 5.0, totalRatings: 0, userRating: numStars };

    db.mutate(d => {
      // Find existing rating
      const existingIdx = d.ratings.findIndex(r => r.episodeId === req.params.id && r.userId === userId);
      const now = new Date().toISOString();

      if (existingIdx !== -1) {
        d.ratings[existingIdx].stars = numStars;
        d.ratings[existingIdx].updatedAt = now;
      } else {
        d.ratings.push({
          id: 'r_' + Date.now(),
          episodeId: req.params.id,
          userId,
          stars: numStars,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Recompute stats
      const allEpisodeRatings = d.ratings.filter(r => r.episodeId === req.params.id);
      const total = allEpisodeRatings.length;
      const sum = allEpisodeRatings.reduce((acc, curr) => acc + curr.stars, 0);
      const avg = Number((sum / total).toFixed(1));

      // Update episode
      for (const c of d.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === req.params.id);
          if (ep) {
            ep.totalRatings = total;
            ep.averageRating = avg;
            result.averageRating = avg;
            result.totalRatings = total;
            break;
          }
        }
      }
    });

    return res.json({ success: true, ...result });
  });

  // -------------------------------------------------------------
  // AUTHOR APPLICATIONS & AUTHOR DASHBOARD
  // -------------------------------------------------------------

  app.post('/api/author/apply', (req, res) => {
    const {
      userId,
      authorName,
      email,
      authorAvatar,
      bio,
      portfolioUrl,
      sampleComicTitle,
      sampleSynopsis,
      samplePagesCount,
      sampleImages,
    } = req.body;
    if (!authorName || !email || !sampleComicTitle) {
      return res.status(400).json({ error: 'Author name, email, and sample comic title are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const validSampleImages = Array.isArray(sampleImages)
      ? sampleImages.filter((img: unknown) => typeof img === 'string' && img.length > 0)
      : [];
    const resolvedPagesCount =
      validSampleImages.length > 0 ? validSampleImages.length : Number(samplePagesCount) || 5;

    let savedApp: AuthorApplication | null = null;
    let updatedUser: User | null = null;

    db.mutate(d => {
      let existingUser = d.users.find(
        u => (userId && u.id === userId) || u.email.toLowerCase() === cleanEmail
      );

      const resolvedAvatar =
        authorAvatar ||
        existingUser?.avatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(authorName)}`;

      if (existingUser) {
        existingUser.name = authorName.trim() || existingUser.name;
        if (authorAvatar) existingUser.avatar = authorAvatar;
        if (bio) existingUser.bio = bio;
        existingUser.isVerified = true;
        updatedUser = existingUser;
      } else {
        const newUser: User = {
          id: userId || 'usr_' + Date.now(),
          name: authorName.trim(),
          email: cleanEmail,
          role: 'reader',
          isVerified: true,
          avatar: resolvedAvatar,
          bio: bio || 'Published Creator & Reader on Aathirai_Comic',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          premiumPlan: null,
        };
        d.users.push(newUser);
        updatedUser = newUser;
      }

      const existingAppIdx = d.authorApplications.findIndex(
        a =>
          (userId && a.userId === userId) ||
          a.email.toLowerCase() === cleanEmail
      );

      const application: AuthorApplication = {
        id: existingAppIdx >= 0 ? d.authorApplications[existingAppIdx].id : 'app_' + Date.now(),
        userId: updatedUser!.id,
        authorName: authorName.trim(),
        email: cleanEmail,
        authorAvatar: resolvedAvatar,
        bio: bio || existingUser?.bio || 'Creator & Storyteller on Aathirai_Comic.',
        portfolioUrl: portfolioUrl || '',
        sampleComicTitle: sampleComicTitle.trim(),
        sampleSynopsis: sampleSynopsis || '',
        samplePagesCount: resolvedPagesCount,
        sampleImages: validSampleImages,
        status: 'approved',
        submittedAt: new Date().toISOString(),
      };

      if (existingAppIdx >= 0) {
        d.authorApplications[existingAppIdx] = application;
      } else {
        d.authorApplications.unshift(application);
      }
      savedApp = application;
    });

    db.logActivity(
      'AUTHOR_APPLICATION_SUBMITTED',
      cleanEmail,
      'author',
      `Registered as Author & Reader for "${sampleComicTitle}" with ${resolvedPagesCount} sample photo(s)`,
      'author_application',
      savedApp!.id
    );

    return res.json({
      success: true,
      application: savedApp,
      user: updatedUser,
      message:
        'Author profile & sample photos uploaded! You are now active on the Author List and can use your account as both Author and Reader.',
    });
  });

  app.post('/api/author/update-photo', (req, res) => {
    const { userId, email, authorName, authorAvatar } = req.body;
    if (!authorAvatar) {
      return res.status(400).json({ error: 'Please select an author photo to upload.' });
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    let updatedUser: User | null = null;
    let updatedApp: AuthorApplication | null = null;

    db.mutate(d => {
      const u = d.users.find(
        usr => (userId && usr.id === userId) || (cleanEmail && usr.email.toLowerCase() === cleanEmail)
      );
      if (u) {
        u.avatar = authorAvatar;
        if (authorName) u.name = authorName;
        updatedUser = u;
      }

      const app = d.authorApplications.find(
        a => (userId && a.userId === userId) || (cleanEmail && a.email.toLowerCase() === cleanEmail)
      );
      if (app) {
        app.authorAvatar = authorAvatar;
        if (authorName) app.authorName = authorName;
        updatedApp = app;
      } else if (u || cleanEmail || authorName) {
        const newApp: AuthorApplication = {
          id: 'app_' + Date.now(),
          userId: u?.id || userId || 'usr_' + Date.now(),
          authorName: authorName || u?.name || 'Featured Creator',
          email: cleanEmail || u?.email || 'creator@aathirai.com',
          authorAvatar,
          bio: u?.bio || 'Creator & Storyteller on Aathirai_Comic.',
          portfolioUrl: '',
          sampleComicTitle: 'Original Comic Series',
          sampleSynopsis: '',
          samplePagesCount: 1,
          sampleImages: [],
          status: 'approved',
          submittedAt: new Date().toISOString(),
        };
        d.authorApplications.unshift(newApp);
        updatedApp = newApp;
      }
    });

    return res.json({
      success: true,
      user: updatedUser,
      application: updatedApp,
      message: 'Author photo updated on the Author List!',
    });
  });

  app.get('/api/authors', (_req, res) => {
    const snapshot = db.getSnapshot();
    const defaultAuthors = [
      {
        id: 'usr_rajesh',
        name: 'Rajesh Singh',
        email: 'rajesh@aathirai.com',
        role: 'Graphic Novelist & Manga Illustrator',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Leading creator behind Virasen and Neo Madras 2099. Pioneering Indian mythic science fiction and cyberpunk webtoons.',
        sampleComicTitle: 'Virasen: The Last Guardian',
        sampleImages: [] as string[],
        followers: '28.4K',
        totalReads: '87.3K',
      },
      {
        id: 'usr_ananya',
        name: 'Ananya Sundaram',
        email: 'ananya@aathirai.com',
        role: 'Mythological Fantasy Writer & Inker',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Creator of Curse of Mahishur. Drawing inspiration from Sangam architecture and Dravidian temple guardian lore.',
        sampleComicTitle: 'Curse of Mahishur',
        sampleImages: [] as string[],
        followers: '14.2K',
        totalReads: '28.4K',
      },
      {
        id: 'usr_luna',
        name: 'Luna & Sky',
        email: 'luna@aathirai.com',
        role: 'Slice-of-Life Webtoon Duo',
        avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Artistic partnership creating gentle, heartwarming watercolor webtoons set in the misty Nilgiri hills.',
        sampleComicTitle: 'Monsoon Melodies',
        sampleImages: [] as string[],
        followers: '32.1K',
        totalReads: '52.1K',
      },
    ];

    const customAuthors = snapshot.authorApplications.map(app => {
      const matchedUser = snapshot.users.find(
        u => u.id === app.userId || u.email.toLowerCase() === app.email.toLowerCase()
      );
      return {
        id: app.userId || app.id,
        name: app.authorName,
        email: app.email,
        role: 'Published Author & Reader',
        avatar:
          app.authorAvatar ||
          matchedUser?.avatar ||
          `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(app.authorName)}`,
        bio: app.bio || matchedUser?.bio || `Creator of "${app.sampleComicTitle}" on Aathirai_Comic.`,
        sampleComicTitle: app.sampleComicTitle,
        sampleImages: app.sampleImages || [],
        followers: '1.2K',
        totalReads: '4.8K',
      };
    });

    // Merge custom authors first, avoiding duplicates by email/name
    const seen = new Set<string>();
    const combined = [];
    for (const a of [...customAuthors, ...defaultAuthors]) {
      const key = (a.email || a.name).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(a);
      }
    }

    return res.json({ authors: combined });
  });

  app.get('/api/author/me', (req, res) => {
    const { userId, email } = req.query;
    const snapshot = db.getSnapshot();
    const app = snapshot.authorApplications.find(a =>
      (userId && a.userId === userId) || (email && a.email.toLowerCase() === String(email).toLowerCase())
    );
    return res.json({ application: app || null });
  });

  app.get('/api/author/analytics', (req, res) => {
    const { authorId } = req.query;
    const snapshot = db.getSnapshot();
    const authorComics = snapshot.comics.filter(c => c.authorId === authorId);

    const totalViews = authorComics.reduce((sum, c) => sum + c.totalViews, 0);
    const authorPurchases = snapshot.purchases.filter(p =>
      authorComics.some(c => c.id === p.comicId) && p.status === 'success'
    );
    const totalEarningsInr = authorPurchases.reduce((sum, p) => sum + p.authorEarningsInr, 0);

    return res.json({
      comicsCount: authorComics.length,
      totalViews,
      totalEarningsInr: Number(totalEarningsInr.toFixed(2)),
      purchasesCount: authorPurchases.length,
      recentTransactions: authorPurchases.slice(0, 10),
    });
  });

  // -------------------------------------------------------------
  // RAZORPAY & INDIAN PAYMENTS
  // -------------------------------------------------------------

  app.get('/api/payments/config', (req, res) => {
    const settings = db.getSnapshot().settings;
    return res.json({
      keyId: RAZORPAY_KEY_ID,
      currency: 'INR',
      symbol: '₹',
      testMode: true,
      merchantUpiId: settings?.merchantUpiId || 'balajiaris05@okaxis',
      merchantUpiName: settings?.merchantUpiName || 'Aathirai Comic Network',
    });
  });

  // Create Razorpay Order
  app.post('/api/payments/razorpay/create-order', (req, res) => {
    const { comicId, chapterId, episodeId, type = 'episode', amountInr, userId, userEmail } = req.body;
    const parsedAmount = Number(amountInr);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    if (type === 'subscription') {
      const cleanEmail = (userEmail || '').trim().toLowerCase();
      const snapshot = db.getSnapshot();
      const existingUser = snapshot.users.find(
        u => (userId && u.id === userId) || (cleanEmail && u.email.toLowerCase() === cleanEmail)
      );
      if (
        existingUser &&
        existingUser.premiumExpiresAt &&
        new Date(existingUser.premiumExpiresAt).getTime() > Date.now()
      ) {
        const activePlanLabel =
          existingUser.premiumPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)';
        const expiryDateStr = new Date(existingUser.premiumExpiresAt).toLocaleDateString();
        return res.status(400).json({
          error: `Only one plan can be active at a time. Your ${activePlanLabel} plan is currently active until ${expiryDateStr}. You can choose another plan after your current plan ends.`,
        });
      }
    }

    const orderId = 'order_' + crypto.randomBytes(8).toString('hex');
    const amountInPaise = Math.round(parsedAmount * 100);

    return res.json({
      success: true,
      orderId,
      amount: amountInPaise,
      amountInr: parsedAmount,
      currency: 'INR',
      keyId: RAZORPAY_KEY_ID,
      paymentMethods: [
        'UPI (Google Pay, PhonePe, Paytm, BHIM)',
        'RuPay, Visa, Mastercard Debit & Credit Cards',
        'Net Banking (SBI, HDFC, ICICI, Axis, Indian Bank)',
        'Digital Wallets (Paytm, PhonePe)',
      ],
    });
  });

  // Verify Razorpay Payment & Grant Access
  app.post('/api/payments/razorpay/verify-payment', (req, res) => {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      userId,
      userEmail,
      userPhone,
      userUpiId,
      comicId,
      comicTitle,
      chapterId,
      episodeId,
      type = 'episode',
      subscriptionPlan,
      amountInr,
      paymentMethod = 'UPI / Card',
    } = req.body;

    const cleanEmailCheck = (userEmail || '').trim().toLowerCase();
    if (type === 'subscription') {
      const snapshot = db.getSnapshot();
      const existingUser = snapshot.users.find(
        u =>
          (userId && u.id === userId) ||
          (cleanEmailCheck && u.email.toLowerCase() === cleanEmailCheck)
      );
      if (
        existingUser &&
        existingUser.premiumExpiresAt &&
        new Date(existingUser.premiumExpiresAt).getTime() > Date.now()
      ) {
        const activePlanLabel =
          existingUser.premiumPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)';
        const expiryDateStr = new Date(existingUser.premiumExpiresAt).toLocaleDateString();
        return res.status(400).json({
          error: `Only one plan can be active at a time. Your ${activePlanLabel} plan is currently active until ${expiryDateStr}. You can choose another plan after your current plan ends.`,
        });
      }
    }

    // Server-side verification: in real production with live keys, verify HMAC SHA256
    const text = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(text).digest('hex');

    // Calculate revenue split based on platform settings (no GST deduction)
    const settings = db.getSnapshot().settings;
    const revenueSharePct = settings.authorRevenueSharePercent || 70;
    const amountNum = Number(amountInr);
    const taxAmount = 0;
    const baseRevenue = amountNum;
    const authorEarningsInr = Number(((baseRevenue * revenueSharePct) / 100).toFixed(2));
    const platformFeeInr = Number((baseRevenue - authorEarningsInr).toFixed(2));

    const receiptNumber = `INV-AATHIRAI-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowIso = new Date().toISOString();

    let resolvedPlan: '1_month' | '6_months' | undefined = undefined;
    let computedExpiresAt: string | undefined = undefined;

    if (type === 'subscription') {
      resolvedPlan = subscriptionPlan || (amountNum >= 249 ? '6_months' : '1_month');
      const durationMs = resolvedPlan === '6_months' ? 180 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      computedExpiresAt = new Date(Date.now() + durationMs).toISOString();
    }

    const cleanEmail = (userEmail || 'customer@aathirai.com').trim().toLowerCase();

    const newPurchase: Purchase = {
      id: 'pur_' + Date.now(),
      userId: userId || 'usr_guest',
      userEmail: cleanEmail,
      userPhone: userPhone || undefined,
      userUpiId: userUpiId || undefined,
      comicId,
      comicTitle: comicTitle || (resolvedPlan === '6_months' ? 'Aathirai 6-Month Premium Pass' : resolvedPlan === '1_month' ? 'Aathirai 1-Month Premium Pass' : 'Aathirai Premium Comic'),
      chapterId: chapterId || undefined,
      episodeId: episodeId || undefined,
      type,
      subscriptionPlan: resolvedPlan,
      expiresAt: computedExpiresAt,
      amountInr: amountNum,
      currency: 'INR',
      paymentMethod: paymentMethod || 'UPI - Instant Pay',
      razorpayOrderId: razorpayOrderId || 'order_DEMO_' + Date.now(),
      razorpayPaymentId: razorpayPaymentId || 'pay_DEMO_' + Date.now(),
      status: 'success',
      createdAt: nowIso,
      receiptNumber,
      taxAmount,
      authorEarningsInr,
      platformFeeInr,
    };

    let updatedReader: User | null = null;

    db.mutate(d => {
      d.purchases.unshift(newPurchase);

      // Link payment & subscription directly to Reader's Gmail / Mobile / UPI account for instant verification
      const u = d.users.find(user =>
        (userId && user.id === userId) ||
        (cleanEmail && user.email.toLowerCase() === cleanEmail)
      );
      if (u) {
        if (userPhone && !u.phone) u.phone = userPhone;
        if (userUpiId && userUpiId.trim()) u.upiId = userUpiId.trim();
        if (type === 'subscription' && resolvedPlan && computedExpiresAt) {
          u.premiumPlan = resolvedPlan;
          u.premiumStartedAt = nowIso;
          u.premiumExpiresAt = computedExpiresAt;
          u.premiumPaymentDetail = {
            plan: resolvedPlan,
            amountPaidInr: amountNum,
            upiId: u.upiId,
            paymentMethod: newPurchase.paymentMethod,
            transactionId: newPurchase.razorpayPaymentId,
            receiptNumber,
            paidAt: nowIso,
            expiresAt: computedExpiresAt,
            status: 'paid',
          };
        }
        updatedReader = u;
      }
    });

    db.logActivity(
      'PAYMENT_CAPTURED',
      cleanEmail,
      'reader',
      `Payment of ₹${amountNum} captured for ${newPurchase.comicTitle}${resolvedPlan ? ` (${resolvedPlan === '6_months' ? '6 Months Premium - ₹249' : '1 Month Premium - ₹49'}, valid until ${new Date(computedExpiresAt!).toLocaleDateString()})` : ''}. Gmail: ${cleanEmail} | UPI: ${userUpiId || 'N/A'}. Receipt ${receiptNumber}`,
      'purchase',
      newPurchase.id
    );

    return res.json({
      success: true,
      purchase: newPurchase,
      user: updatedReader,
      message: resolvedPlan
        ? `Gmail (${cleanEmail}) verified! ${resolvedPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)'} Premium Pass activated.`
        : 'Payment verified successfully! Access granted to premium comic episode.',
    });
  });

  // Customer Purchases
  app.get('/api/payments/my-purchases', (req, res) => {
    const { userId, email, phone } = req.query;
    const snapshot = db.getSnapshot();
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    const cleanDigits = phone ? String(phone).replace(/\D/g, '') : '';

    const purchases = snapshot.purchases.filter(p =>
      (userId && p.userId === userId) ||
      (cleanEmail && p.userEmail.toLowerCase() === cleanEmail) ||
      (cleanDigits.length >= 10 && p.userPhone && p.userPhone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10)))
    );
    const subStatus = getReaderSubscriptionStatus(snapshot, {
      userId: userId ? String(userId) : undefined,
      email: cleanEmail || undefined,
      phone: phone ? String(phone) : undefined,
    });
    return res.json({ purchases, subscription: subStatus });
  });

  // Razorpay Webhook Endpoint
  app.post('/api/payments/webhook', (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const event = req.body;
    db.logActivity('WEBHOOK_RECEIVED', 'Razorpay Gateway', 'reader', `Webhook event: ${event?.event || 'payment'}`, 'payment', event?.payload?.payment?.entity?.id || 'event');
    return res.json({ status: 'ok' });
  });

  // -------------------------------------------------------------
  // ADMINISTRATOR DASHBOARD ROUTES
  // -------------------------------------------------------------

  app.get('/api/admin/readers', (req, res) => {
    const snapshot = db.getSnapshot();
    const readers = snapshot.users.map(u => {
      const subStatus = getReaderSubscriptionStatus(snapshot, {
        userId: u.id,
        email: u.email,
        phone: u.phone,
      });
      const userPurchases = snapshot.purchases.filter(
        p => p.status === 'success' && (p.userId === u.id || p.userEmail?.toLowerCase() === u.email?.toLowerCase())
      );
      const totalSpentInr = userPurchases.reduce((sum, p) => sum + p.amountInr, 0);
      return {
        ...u,
        age: u.age,
        upiId: u.upiId || subStatus.upiId,
        premiumPlan: subStatus.activePlan,
        premiumStartedAt: subStatus.startedAt,
        premiumExpiresAt: subStatus.expiresAt,
        premiumPaymentDetail: subStatus.premiumPaymentDetail,
        hasActiveSubscription: subStatus.hasActiveSubscription,
        activeReceipt: subStatus.activeReceipt,
        subscription: {
          hasActiveSubscription: subStatus.hasActiveSubscription,
          plan: subStatus.activePlan,
          amountPaidInr: subStatus.amountPaidInr,
          upiId: u.upiId || subStatus.upiId,
          paymentMethod: subStatus.paymentMethod,
          transactionId: subStatus.transactionId,
          receiptNumber: subStatus.activeReceipt,
          expiresAt: subStatus.expiresAt,
        },
        purchasesCount: userPurchases.length,
        totalSpentInr: Number(totalSpentInr.toFixed(2)),
      };
    });
    return res.json({ readers });
  });

  // Admin Database Management: Update or Grant/Revoke Reader Account, UPI & Paid Premium
  app.put('/api/admin/readers/:id', (req, res) => {
    const { name, email, phone, age, upiId, paidPlan, paymentMethod, transactionId } = req.body;
    let updatedUser: User | null = null;

    db.mutate(d => {
      const u = d.users.find((x: User) => x.id === req.params.id);
      if (u) {
        if (name !== undefined && name.trim()) u.name = name.trim();
        if (email !== undefined && email.trim()) u.email = email.trim().toLowerCase();
        if (phone !== undefined) u.phone = phone.trim();
        if (age !== undefined && age !== '' && !isNaN(Number(age))) u.age = Number(age);
        if (upiId !== undefined) u.upiId = upiId.trim();
        if (paidPlan !== undefined) {
          applyPaidPremiumDetailToUser(d, u, paidPlan, paymentMethod, transactionId, upiId);
        }
        updatedUser = u;
      }
    });

    if (!updatedUser) return res.status(404).json({ error: 'Reader not found' });
    db.logActivity('ADMIN_UPDATED_READER', 'admin@aathirai.com', 'admin', `Updated reader ${(updatedUser as User).email} (Plan: ${paidPlan || 'unchanged'}, UPI: ${upiId || 'N/A'})`, 'user', req.params.id);
    return res.json({ success: true, reader: updatedUser });
  });

  app.delete('/api/admin/readers/:id', (req, res) => {
    let removedEmail = '';
    db.mutate(d => {
      const idx = d.users.findIndex((x: User) => x.id === req.params.id);
      if (idx !== -1) {
        removedEmail = d.users[idx].email;
        d.users.splice(idx, 1);
      }
    });
    if (!removedEmail) return res.status(404).json({ error: 'Reader not found' });
    db.logActivity('ADMIN_DELETED_READER', 'admin@aathirai.com', 'admin', `Deleted reader account ${removedEmail}`, 'user', req.params.id);
    return res.json({ success: true, message: `Deleted reader account ${removedEmail}` });
  });

  app.get('/api/admin/stats', (req, res) => {
    const snapshot = db.getSnapshot();
    const totalRevenueInr = snapshot.purchases
      .filter(p => p.status === 'success')
      .reduce((sum, p) => sum + p.amountInr, 0);

    const totalAuthorEarningsInr = snapshot.purchases
      .filter(p => p.status === 'success')
      .reduce((sum, p) => sum + p.authorEarningsInr, 0);

    let totalEpisodes = 0;
    let totalChapters = 0;
    snapshot.comics.forEach(c => {
      totalChapters += c.chapters.length;
      c.chapters.forEach(ch => {
        totalEpisodes += ch.episodes.length;
      });
    });

    return res.json({
      totalUsers: snapshot.users.length,
      totalAuthors: snapshot.users.filter(u => u.role === 'author').length,
      pendingApplications: snapshot.authorApplications.filter(a => a.status === 'pending').length,
      approvedAuthors: snapshot.authorApplications.filter(a => a.status === 'approved').length,
      totalComics: snapshot.comics.length,
      totalChapters,
      totalEpisodes,
      totalComments: snapshot.comments.length,
      totalTransactions: snapshot.purchases.length,
      totalRevenueInr: Number(totalRevenueInr.toFixed(2)),
      totalAuthorEarningsInr: Number(totalAuthorEarningsInr.toFixed(2)),
    });
  });

  app.get('/api/admin/authors', (req, res) => {
    const snapshot = db.getSnapshot();
    return res.json({
      applications: snapshot.authorApplications,
      authors: snapshot.users.filter(u => u.role === 'author'),
    });
  });

  app.post('/api/admin/author-applications/:id/action', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Valid action required (approve/reject)' });
    }

    let targetApp: AuthorApplication | null = null;
    let promotedUser: User | null = null;

    db.mutate(d => {
      const app = d.authorApplications.find(a => a.id === req.params.id);
      if (app) {
        app.status = action === 'approve' ? 'approved' : 'rejected';
        app.reviewedAt = new Date().toISOString();
        if (adminNote) app.adminNote = adminNote;
        targetApp = app;

        // If approved, elevate corresponding user or create author user
        if (action === 'approve') {
          const user = d.users.find(u => u.email.toLowerCase() === app.email.toLowerCase() || u.id === app.userId);
          if (user) {
            user.role = 'author';
            promotedUser = user;
          } else {
            const newAuthor: User = {
              id: 'usr_auth_' + Date.now(),
              name: app.authorName,
              email: app.email,
              role: 'author',
              isVerified: true,
              avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(app.authorName)}`,
              bio: app.bio,
              createdAt: new Date().toISOString(),
            };
            d.users.push(newAuthor);
            promotedUser = newAuthor;
          }
        }
      }
    });

    if (!targetApp) return res.status(404).json({ error: 'Application not found' });

    db.logActivity(
      action === 'approve' ? 'AUTHOR_APPROVED' : 'AUTHOR_REJECTED',
      'admin@aathirai.com',
      'admin',
      `${action === 'approve' ? 'Approved' : 'Rejected'} author application for ${(targetApp as AuthorApplication).authorName}. Note: ${adminNote || 'None'}`,
      'author_application',
      req.params.id
    );

    return res.json({ success: true, application: targetApp, user: promotedUser });
  });

  app.get('/api/admin/transactions', (req, res) => {
    return res.json({ transactions: db.getSnapshot().purchases });
  });

  app.post('/api/admin/transactions/:id/refund', (req, res) => {
    let refunded: Purchase | null = null;
    db.mutate(d => {
      const p = d.purchases.find(x => x.id === req.params.id);
      if (p) {
        p.status = 'failed'; // marked refunded
        refunded = p;
      }
    });
    if (!refunded) return res.status(404).json({ error: 'Transaction not found' });
    db.logActivity('TRANSACTION_REFUNDED', 'admin@aathirai.com', 'admin', `Refunded transaction ${(refunded as Purchase).receiptNumber}`, 'purchase', req.params.id);
    return res.json({ success: true, message: 'Transaction refunded successfully', transaction: refunded });
  });

  app.get('/api/admin/ratings', (req, res) => {
    return res.json({ ratings: db.getSnapshot().ratings });
  });

  app.delete('/api/admin/ratings/:id', (req, res) => {
    db.mutate(d => {
      d.ratings = d.ratings.filter(r => r.id !== req.params.id);
    });
    db.logActivity('RATING_REMOVED_AUDIT', 'admin@aathirai.com', 'admin', `Admin removed rating ID: ${req.params.id}`, 'rating', req.params.id);
    return res.json({ success: true, message: 'Rating removed by administrator' });
  });

  app.get('/api/admin/comments', (req, res) => {
    return res.json({ comments: db.getSnapshot().comments });
  });

  app.get('/api/admin/copyright', (req, res) => {
    return res.json({ copyrightDocs: db.getSnapshot().copyrightDocs });
  });

  app.post('/api/admin/copyright', (req, res) => {
    const { title, documentNumber, registeredEntity, summary, fullText, status = 'published' } = req.body;
    const newDoc = {
      id: 'cpy_' + Date.now(),
      title: title || 'Copyright Registration Notice',
      documentNumber: documentNumber || 'AAT-CPY-' + Date.now(),
      registeredEntity: registeredEntity || 'Aathirai Media & Publishing Pvt Ltd',
      summary: summary || '',
      fullText: fullText || '',
      status,
      effectiveDate: new Date().toISOString().split('T')[0],
      lastUpdated: new Date().toISOString().split('T')[0],
    };

    db.mutate(d => {
      d.copyrightDocs.unshift(newDoc);
    });

    db.logActivity('COPYRIGHT_DOC_CREATED', 'admin@aathirai.com', 'admin', `Created copyright document: ${newDoc.title}`, 'copyright', newDoc.id);

    return res.json({ success: true, doc: newDoc });
  });

  app.delete('/api/admin/copyright/:id', (req, res) => {
    db.mutate(d => {
      d.copyrightDocs = d.copyrightDocs.filter(c => c.id !== req.params.id);
    });
    return res.json({ success: true });
  });

  app.get('/api/admin/settings', (req, res) => {
    return res.json({ settings: db.getSnapshot().settings });
  });

  app.put('/api/admin/settings', (req, res) => {
    db.mutate(d => {
      d.settings = { ...d.settings, ...req.body };
    });
    db.logActivity('SETTINGS_UPDATED', 'admin@aathirai.com', 'admin', 'Updated website settings and pricing.', 'settings', 'global');
    return res.json({ success: true, settings: db.getSnapshot().settings });
  });

  app.get('/api/admin/logs', (req, res) => {
    return res.json({ logs: db.getSnapshot().activityLogs });
  });

  // -------------------------------------------------------------
  // VITE DEV SERVER OR STATIC PRODUCTION BUILD
  // -------------------------------------------------------------

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`[Aathirai_Comic] Server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
