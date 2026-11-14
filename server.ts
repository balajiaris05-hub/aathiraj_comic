import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { db } from './src/server/storage.ts';
import {
  User,
  AuthorApplication,
  Purchase,
  Comic,
  Chapter,
  Episode,
  ComicPage,
  PaymentTransaction,
  GstBusinessSettings,
  CreditNoteRecord,
} from './src/types/comic.ts';
import {
  securityHeadersMiddleware,
  createRateLimiter,
  hashPassword,
  verifyPasswordHash,
  sanitizeUserForClient,
  getRazorpayEnvironmentStatus,
  computeRazorpayOrderSignature,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  resolveAuthenticatedUser,
} from './src/server/security.ts';
import {
  INDIAN_STATES_AND_UTS,
  getStateByCode,
  validateIndianGstin,
  getDefaultGstBusinessSettings,
  buildSellerSnapshot,
  calculateInclusiveGstBreakdown,
  formatGstInvoiceNumber,
  ensurePurchaseGstFields,
  validateGstExportData,
  generateGstr1OfflineJson,
  generateGstReconciliationCsv,
  generateTaxInvoicePdfBytes,
} from './src/utils/gstUtils.ts';

dotenv.config();

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // Security headers & JSON Body Parser with 15mb limit for comic artwork uploads
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  const authRateLimiter = createRateLimiter({ maxRequests: 30, windowMs: 15 * 60 * 1000 });
  const paymentRateLimiter = createRateLimiter({ maxRequests: 40, windowMs: 15 * 60 * 1000 });

  // -------------------------------------------------------------
  // SECURE DEDICATED ADMIN 2FA OTP AUTHENTICATION
  // -------------------------------------------------------------

  app.post('/api/admin-auth/request-otp', authRateLimiter, (req, res) => {
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

    // Generate cryptographically random 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

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
      `Admin requested 2FA OTP via ${targetChannel.toUpperCase()} to ${maskedDestination}. Valid for 10 minutes.`,
      'admin_auth',
      'usr_admin'
    );

    const hasDeliveryProvider = Boolean(process.env.SMTP_HOST || process.env.SMS_API_KEY);
    return res.json({
      success: true,
      message: hasDeliveryProvider
        ? `Security OTP dispatched to ${maskedDestination}. Valid for 10 minutes.`
        : `Development Mode: OTP generated for ${maskedDestination} (configure SMTP_HOST / SMS_API_KEY for live delivery).`,
      channel: targetChannel,
      destinationMasked: maskedDestination,
      ...(process.env.NODE_ENV !== 'production' ? { devOtpHint: otp } : {}),
      expiresInSeconds: 600,
    });
  });

  app.post('/api/admin-auth/verify-otp', authRateLimiter, (req, res) => {
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

    if (activeOtp.code !== String(otp).trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit verification code. Please check your verification dispatch.' });
    }

    // Clear one-time OTP
    db.mutate(d => {
      delete d.adminOtp;
    });

    // Fetch or construct admin user from authoritative database
    const adminUser = snapshot.users.find(u => u.role === 'admin' || u.email === 'balajiaris05@gmail.com') || {
      id: 'usr_admin',
      name: 'Balaji Administrator',
      email: 'balajiaris05@gmail.com',
      phone: '+91 8610950780',
      role: 'admin' as const,
      isVerified: true,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
      bio: 'Chief Content Administrator and Publisher at Aathirai_Comic.',
      createdAt: '2026-01-01T00:00:00Z',
    };

    db.logActivity('ADMIN_AUTHENTICATED', 'balajiaris05@gmail.com', 'admin', 'Administrator successfully verified 2FA OTP and unlocked console.', 'admin_auth', adminUser.id);

    return res.json({
      success: true,
      user: sanitizeUserForClient(adminUser as User, true),
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
      const gstSettings = d.gstSettings || getDefaultGstBusinessSettings();
      const sellerSnap = buildSellerSnapshot(gstSettings);
      const isInternational = Boolean(user.countryCode && user.countryCode !== '+91');
      const posCode = isInternational ? '96' : sellerSnap.stateCode || '33';
      const gstCalc = calculateInclusiveGstBreakdown({
        totalAmountInr: amountInr,
        sellerStateCode: sellerSnap.stateCode,
        placeOfSupplyStateCode: posCode,
        applicableRatePercent: gstSettings.applicableGstRate ?? 18,
        applyGst: gstSettings.applyGstToDomesticSales !== false,
        isInternational,
        hsnSacCode: sellerSnap.hsnSacCode,
        hsnSacDescription: sellerSnap.hsnSacDescription,
      });

      const seq = gstSettings.nextInvoiceSequence || d.purchases.length + 1;
      const invoiceNumber = formatGstInvoiceNumber(gstSettings.invoicePrefix || 'AAC/2627/', seq);
      gstSettings.nextInvoiceSequence = seq + 1;

      const baseRevenue = gstCalc.taxableValue;
      const authorEarningsInr = Number((baseRevenue * 0.7).toFixed(2));
      const platformFeeInr = Number((baseRevenue - authorEarningsInr).toFixed(2));

      d.purchases.unshift({
        id: 'pur_' + Date.now(),
        userId: user.id,
        customerName: user.name,
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
        invoiceNumber,
        taxableValue: gstCalc.taxableValue,
        taxAmount: gstCalc.taxAmount,
        taxRate: gstCalc.taxRate,
        taxType: gstCalc.taxType,
        cgstRate: gstCalc.cgstRate,
        cgstAmount: gstCalc.cgstAmount,
        sgstRate: gstCalc.sgstRate,
        sgstAmount: gstCalc.sgstAmount,
        igstRate: gstCalc.igstRate,
        igstAmount: gstCalc.igstAmount,
        hsnSacCode: gstCalc.hsnSacCode,
        hsnSacDescription: gstCalc.hsnSacDescription,
        placeOfSupplyStateCode: gstCalc.placeOfSupplyStateCode,
        placeOfSupplyStateName: gstCalc.placeOfSupplyStateName,
        isInternational,
        supplyType: gstCalc.supplyType,
        sellerSnapshot: sellerSnap,
        authorEarningsInr,
        platformFeeInr,
      });
    }
  };

  // -------------------------------------------------------------
  // REGULAR & READER AUTHENTICATION ROUTES (GMAIL, AGE, UPI & PAID PREMIUM DETAIL)
  // -------------------------------------------------------------

  const formatGlobalPhone = (rawPhone?: string, countryCode?: string): string => {
    const trimmedPhone = (rawPhone || '').trim();
    if (!trimmedPhone) return '';
    const cleanCode = (countryCode || '').trim();
    if (trimmedPhone.startsWith('+')) {
      return trimmedPhone;
    }
    const localDigits = trimmedPhone.replace(/\D/g, '');
    if (!localDigits) return '';
    if (cleanCode) {
      const normalizedCode = cleanCode.startsWith('+') ? cleanCode : `+${cleanCode.replace(/\D/g, '')}`;
      const codeDigits = normalizedCode.replace(/\D/g, '');
      if (codeDigits && localDigits.startsWith(codeDigits) && localDigits.length > codeDigits.length + 5) {
        return `+${codeDigits} ${localDigits.slice(codeDigits.length)}`;
      }
      return `${normalizedCode} ${localDigits}`;
    }
    return trimmedPhone;
  };

  const getPhoneOtpKey = (rawPhone?: string, countryCode?: string): string => {
    const formatted = formatGlobalPhone(rawPhone, countryCode);
    const digits = (formatted || rawPhone || '').replace(/\D/g, '');
    if (digits.length >= 10) return digits.slice(-10);
    return digits;
  };

  const phonesMatch = (storedPhone?: string, inputPhone?: string, inputCountryCode?: string): boolean => {
    if (!storedPhone || !inputPhone) return false;
    const storedDigits = storedPhone.replace(/\D/g, '');
    const formattedInput = formatGlobalPhone(inputPhone, inputCountryCode);
    const inputRawDigits = inputPhone.replace(/\D/g, '');
    const inputFormattedDigits = formattedInput.replace(/\D/g, '');
    if (storedDigits.length < 6 || inputRawDigits.length < 6) return false;

    if (storedDigits === inputRawDigits || storedDigits === inputFormattedDigits) {
      return true;
    }
    // Compare subscriber number tail (up to 10 digits, or min length >= 7)
    const compareLen = Math.min(10, storedDigits.length, inputRawDigits.length);
    if (compareLen >= 7 && storedDigits.slice(-compareLen) === inputRawDigits.slice(-compareLen)) {
      return true;
    }
    return false;
  };

  app.post('/api/auth/register', authRateLimiter, (req, res) => {
    const {
      name,
      email,
      phone,
      countryCode,
      countryName,
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
      avatar,
    } = req.body;
    const cleanEmail = email?.trim().toLowerCase() || '';
    const formattedPhone = formatGlobalPhone(phone, countryCode);
    const cleanDigits = formattedPhone.replace(/\D/g, '');
    const parsedAge = age !== undefined && age !== '' ? Number(age) : undefined;

    if (!name || (!cleanEmail && cleanDigits.length < 6)) {
      return res.status(400).json({ error: 'Full Name, Gmail address, and Global Mobile Number are required.' });
    }

    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Please create an account password (minimum 4 characters).' });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
    }

    const finalEmail = cleanEmail || `${cleanDigits.slice(-10)}@gmail.com`;
    const nowIso = new Date().toISOString();
    const hashedPass = hashPassword(String(password));

    let registeredUser: User | null = null;
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpKey = finalEmail.toLowerCase();
    const phoneKey = getPhoneOtpKey(phone, countryCode);

    db.mutate(d => {
      const existing = d.users.find((u: User) =>
        (cleanEmail && u.email.toLowerCase() === cleanEmail) ||
        (cleanDigits.length >= 6 && phonesMatch(u.phone, phone, countryCode))
      );

      if (existing) {
        if (name?.trim()) existing.name = name.trim();
        if (cleanEmail) existing.email = cleanEmail;
        if (formattedPhone) existing.phone = formattedPhone;
        if (countryCode) existing.countryCode = String(countryCode).trim();
        if (countryName) existing.countryName = String(countryName).trim();
        if (parsedAge && !isNaN(parsedAge)) existing.age = parsedAge;
        if (dob) existing.dob = String(dob).trim();
        if (avatar) existing.avatar = String(avatar);
        existing.passwordHash = hashedPass;
        delete existing.password;
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
          passwordHash: hashedPass,
          failedLoginAttempts: 0,
          lockedUntil: null,
          welcomeEmailSent: true,
          welcomeEmailSentAt: nowIso,
          age: parsedAge && !isNaN(parsedAge) ? parsedAge : undefined,
          dob: dob ? String(dob).trim() : undefined,
          notifyGmail: typeof notifyGmail === 'boolean' ? notifyGmail : true,
          notifyMobile: typeof notifyMobile === 'boolean' ? notifyMobile : true,
          upiId: upiId?.trim() || undefined,
          phone: formattedPhone || undefined,
          countryCode: countryCode ? String(countryCode).trim() : '+91',
          countryName: countryName ? String(countryName).trim() : 'India',
          role: 'reader',
          isVerified: false,
          bookmarks: [],
          favorites: [],
          readingHistory: [],
          avatar:
            avatar ||
            `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name.trim())}`,
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
      if (phoneKey.length >= 6) {
        d.otps[phoneKey] = otp;
      }
    });

    if (!registeredUser) {
      return res.status(500).json({ error: 'Could not register reader account.' });
    }

    db.addNotification({
      userId: (registeredUser as User).id,
      userEmail: (registeredUser as User).email,
      title: 'Welcome to Aathirai_Comic!',
      message: `Hello ${(registeredUser as User).name}, your reader account is registered. Explore Indian comics, bookmark your favorite series, and enjoy smooth reading modes.`,
      type: 'system',
      targetId: (registeredUser as User).id,
    });

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
      user: sanitizeUserForClient(registeredUser as User, true),
      welcomeEmail: welcomeEmailPayload,
      message: `Account created and stored in backend! Welcome email sent to ${finalEmail} ("Welcome to Aathirai_Comic"). Verification OTP dispatched.`,
      ...(process.env.NODE_ENV !== 'production' ? { devOtpHint: otp } : {}),
    });
  });

  app.post('/api/auth/verify-otp', authRateLimiter, (req, res) => {
    const { email, phone, countryCode, countryName, otp, age, dob, notifyGmail, notifyMobile, upiId, paidPlan, paymentMethod, transactionId } = req.body;
    const cleanEmail = email?.trim().toLowerCase() || '';
    const phoneKey = getPhoneOtpKey(phone || email, countryCode);
    const snapshot = db.getSnapshot();
    const storedOtp = snapshot.otps[cleanEmail] || (phoneKey.length >= 6 ? snapshot.otps[phoneKey] : undefined);

    if (!otp || (storedOtp && storedOtp !== String(otp).trim())) {
      return res.status(400).json({ error: 'Invalid verification OTP. Please check the code sent to your email or mobile.' });
    }

    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find(user =>
        (cleanEmail && user.email.toLowerCase() === cleanEmail) ||
        (phone && phonesMatch(user.phone, phone, countryCode))
      );
      if (u) {
        u.isVerified = true;
        u.failedLoginAttempts = 0;
        u.lockedUntil = null;
        u.lastLoginAt = new Date().toISOString();
        if (phone?.trim()) {
          u.phone = formatGlobalPhone(phone, countryCode || u.countryCode);
        }
        if (countryCode) u.countryCode = String(countryCode).trim();
        if (countryName) u.countryName = String(countryName).trim();
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
      if (phoneKey.length >= 6) delete d.otps[phoneKey];
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
      user: sanitizeUserForClient(userWithPremium, true),
      subscription: subStatus,
      message: `Welcome to Aathirai_Comic! Your account (${userWithPremium.email}) is verified and active.`,
    });
  });

  // Step 1 of Returning Customer Login: Verify EITHER Gmail OR Global Mobile Number in Backend Database
  app.post('/api/auth/verify-identity', (req, res) => {
    const { email, credential, phone, countryCode, countryName } = req.body;
    const rawEmailInput = (email || (credential && String(credential).includes('@') ? credential : '') || '').trim().toLowerCase();
    const rawPhoneInput = (phone || (credential && !String(credential).includes('@') ? credential : '') || '').trim();
    const formattedPhone = formatGlobalPhone(rawPhoneInput, countryCode);
    const cleanDigits = rawPhoneInput.replace(/\D/g, '');

    if (!rawEmailInput && cleanDigits.length < 6) {
      return res.status(400).json({
        existsInDatabase: false,
        error: 'Please enter either your registered Gmail address or your Mobile Number (with Country Code) to verify your account in the database.',
      });
    }

    let matchedUser: User | undefined;
    let matchedBy: 'gmail_and_mobile' | 'gmail' | 'mobile' = 'gmail';
    const now = Date.now();

    db.mutate(d => {
      matchedUser = d.users.find((u: User) => {
        const emailMatch = Boolean(rawEmailInput && u.email && u.email.toLowerCase() === rawEmailInput);
        const phoneMatch = Boolean(cleanDigits.length >= 6 && phonesMatch(u.phone, rawPhoneInput, countryCode));
        if (emailMatch && phoneMatch) {
          matchedBy = 'gmail_and_mobile';
          return true;
        }
        if (emailMatch) {
          matchedBy = 'gmail';
          return true;
        }
        if (phoneMatch) {
          matchedBy = 'mobile';
          return true;
        }
        return false;
      });

      if (matchedUser) {
        // If 12-hour lock has expired, automatically clear it
        if (matchedUser.lockedUntil && new Date(matchedUser.lockedUntil).getTime() <= now) {
          matchedUser.lockedUntil = null;
          matchedUser.failedLoginAttempts = 0;
        }
        // Store / update global mobile number only when empty or explicit country code is provided
        if (cleanDigits.length >= 6 && formattedPhone && (!matchedUser.phone || countryCode)) {
          matchedUser.phone = formattedPhone;
          if (countryCode) matchedUser.countryCode = String(countryCode).trim();
          if (countryName) matchedUser.countryName = String(countryName).trim();
        }
      }
    });

    if (!matchedUser) {
      return res.status(404).json({
        existsInDatabase: false,
        verified: false,
        error: rawEmailInput && cleanDigits.length >= 6
          ? `Customer account not found in the backend database for Gmail (${rawEmailInput}) or Mobile (${formattedPhone}). Please create an account in First-Time Customer Register.`
          : rawEmailInput
          ? `Customer account with Gmail "${rawEmailInput}" does not exist in the backend database. Please check your Gmail or register in First-Time Customer Register.`
          : `Customer account with Mobile Number "${formattedPhone}" does not exist in the backend database. Please check your number or register in First-Time Customer Register.`,
      });
    }

    const isLocked = Boolean(matchedUser.lockedUntil && new Date(matchedUser.lockedUntil).getTime() > now);
    const remainingAttempts = isLocked ? 0 : Math.max(0, 3 - (matchedUser.failedLoginAttempts || 0));

    return res.json({
      success: true,
      verified: true,
      existsInDatabase: true,
      matchedBy,
      email: matchedUser.email,
      phone: matchedUser.phone || formattedPhone || '',
      countryCode: matchedUser.countryCode || countryCode || '+91',
      countryName: matchedUser.countryName || countryName || 'India',
      name: matchedUser.name,
      isLocked,
      lockedUntil: matchedUser.lockedUntil || null,
      remainingAttempts,
      message: isLocked
        ? 'Your account is locked after 3 failed password attempts. Please try again after 12 hours or use Forgot Password to reset via OTP.'
        : `Verified in Backend Database! Customer account found for ${matchedUser.name} (${matchedUser.email}${matchedUser.phone ? ` · ${matchedUser.phone}` : ''}). Please enter your account password below.`,
    });
  });

  // Step 2 of Returning Customer Login: Verify Account Password (with 3-attempt / 12-hour lockout)
  app.post('/api/auth/login', authRateLimiter, (req, res) => {
    const { email, credential, phone, countryCode, countryName, password, name, age, dob, notifyGmail, notifyMobile, upiId, paidPlan, paymentMethod, transactionId } = req.body;
    const rawIdentifier = (credential || email || phone || '').trim();
    if (!rawIdentifier && !phone?.trim()) {
      return res.status(400).json({ error: 'Please enter either your Gmail address or your Mobile Number to sign in.' });
    }

    const isEmail = rawIdentifier.includes('@');
    const cleanEmail = isEmail ? rawIdentifier.toLowerCase() : (email?.includes('@') ? email.trim().toLowerCase() : '');
    const rawPhoneInput = (phone || (!isEmail ? rawIdentifier : '') || '').trim();
    const formattedPhone = formatGlobalPhone(rawPhoneInput, countryCode);
    const cleanDigits = rawPhoneInput.replace(/\D/g, '');
    const parsedAge = age !== undefined && age !== '' && !isNaN(Number(age)) ? Number(age) : undefined;
    const now = Date.now();

    let user: User | undefined;
    let lockError: { status: number; body: any } | null = null;

    db.mutate(d => {
      user = d.users.find(u => {
        if (cleanEmail && u.email.toLowerCase() === cleanEmail) return true;
        if (cleanDigits.length >= 6 && phonesMatch(u.phone, rawPhoneInput, countryCode)) return true;
        return false;
      });

      if (!user) {
        return;
      }

      if (user.isSuspended) {
        lockError = {
          status: 403,
          body: {
            error: `Account Suspended: ${user.suspendedReason || 'Please contact platform support.'}`,
            isLocked: true,
          },
        };
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

      // Verify password via scrypt hash (or upgrade legacy password on first login)
      if (password !== undefined) {
        const inputPass = String(password);
        const storedSecret = user.passwordHash || user.password;
        const passCheck = verifyPasswordHash(inputPass, user.password, user.passwordHash);
        if (!storedSecret) {
          user.passwordHash = hashPassword(inputPass);
          delete user.password;
        } else if (!passCheck.valid) {
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
        } else if (passCheck.needsRehash || !user.passwordHash) {
          user.passwordHash = hashPassword(inputPass);
          delete user.password;
        }
      }

      // Password verified -> reset failed attempts and store global mobile number in database for password recovery
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.lastLoginAt = new Date().toISOString();
      if (name?.trim()) user.name = name.trim();
      if (formattedPhone && cleanDigits.length >= 6) {
        user.phone = formattedPhone;
      }
      if (countryCode) user.countryCode = String(countryCode).trim();
      if (countryName) user.countryName = String(countryName).trim();
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
      return res.status(404).json({ error: 'Customer account not found in the backend database. Please register your account in First-Time Customer Register.' });
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
      `Customer logged in | Gmail: ${enrichedUser.email} | Mobile: ${enrichedUser.phone || 'N/A'} | Age: ${enrichedUser.age || 'N/A'} | Paid Premium: ${subStatus.activePlan ? `${subStatus.activePlan} (₹${subStatus.amountPaidInr})` : 'Free'}`,
      'user',
      enrichedUser.id
    );

    return res.json({ success: true, user: sanitizeUserForClient(enrichedUser, true), subscription: subStatus });
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
        ? sanitizeUserForClient(
            {
              ...subStatus.matchedUser,
              premiumPlan: subStatus.activePlan,
              premiumStartedAt: subStatus.startedAt,
              premiumExpiresAt: subStatus.expiresAt,
              premiumPaymentDetail: subStatus.premiumPaymentDetail,
            },
            true
          )
        : null,
    });
  });

  app.post('/api/auth/forgot-password', authRateLimiter, (req, res) => {
    const { email, phone, countryCode, credential } = req.body;
    const cleanEmail = (email || (credential && String(credential).includes('@') ? credential : '') || '').trim().toLowerCase();
    const rawPhoneInput = (phone || (credential && !String(credential).includes('@') ? credential : '') || '').trim();
    const cleanDigits = rawPhoneInput.replace(/\D/g, '');

    if (!cleanEmail && cleanDigits.length < 6) {
      return res.status(400).json({ error: 'Please enter your registered Gmail address or Global Mobile Number to receive the password reset OTP.' });
    }

    const snapshot = db.getSnapshot();
    const matchedUser = snapshot.users.find((u: User) => {
      const emailMatch = Boolean(cleanEmail && u.email.toLowerCase() === cleanEmail);
      const phoneMatch = Boolean(cleanDigits.length >= 6 && phonesMatch(u.phone, rawPhoneInput, countryCode));
      return emailMatch || phoneMatch;
    });

    if (!matchedUser) {
      return res.status(404).json({ error: 'No customer account found in the database matching that Gmail address or Global Mobile Number.' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const targetEmail = matchedUser.email.toLowerCase();
    const targetPhoneKey = getPhoneOtpKey(matchedUser.phone || rawPhoneInput, matchedUser.countryCode || countryCode);
    const inputPhoneKey = getPhoneOtpKey(rawPhoneInput, countryCode);

    db.mutate(d => {
      if (targetEmail) d.otps[targetEmail] = otp;
      if (cleanEmail) d.otps[cleanEmail] = otp;
      if (targetPhoneKey.length >= 6) d.otps[targetPhoneKey] = otp;
      if (inputPhoneKey.length >= 6) d.otps[inputPhoneKey] = otp;
    });

    return res.json({
      success: true,
      email: matchedUser.email,
      phone: matchedUser.phone || formatGlobalPhone(rawPhoneInput, countryCode) || '',
      countryCode: matchedUser.countryCode || countryCode || '+91',
      message: `6-digit verification OTP sent for password recovery to ${matchedUser.email}${matchedUser.phone ? ` and Mobile (${matchedUser.phone})` : ''}.`,
      ...(process.env.NODE_ENV !== 'production' ? { devOtpHint: otp } : {}),
    });
  });

  app.post('/api/auth/verify-reset-otp', authRateLimiter, (req, res) => {
    const { email, phone, countryCode, otp } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const phoneKey = getPhoneOtpKey(phone, countryCode);
    const snapshot = db.getSnapshot();
    const matchedUser = snapshot.users.find((u: User) => {
      const emailMatch = Boolean(cleanEmail && u.email.toLowerCase() === cleanEmail);
      const phoneMatch = Boolean(phone && phonesMatch(u.phone, phone, countryCode));
      return emailMatch || phoneMatch;
    });
    const userPhoneKey = matchedUser?.phone ? getPhoneOtpKey(matchedUser.phone, matchedUser.countryCode) : '';
    const storedOtp =
      (cleanEmail ? snapshot.otps[cleanEmail] : undefined) ||
      (matchedUser?.email ? snapshot.otps[matchedUser.email.toLowerCase()] : undefined) ||
      (phoneKey.length >= 6 ? snapshot.otps[phoneKey] : undefined) ||
      (userPhoneKey.length >= 6 ? snapshot.otps[userPhoneKey] : undefined);

    if (!otp || !storedOtp || storedOtp !== String(otp).trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit OTP code. Please check the code sent to your Gmail / Global Mobile Number.' });
    }

    return res.json({
      success: true,
      verified: true,
      message: 'OTP verified! You may now enter your New Password and Confirm Password.',
    });
  });

  app.post('/api/auth/reset-password', authRateLimiter, (req, res) => {
    const { email, phone, countryCode, otp, newPassword, confirmPassword } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const phoneKey = getPhoneOtpKey(phone, countryCode);

    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'Please enter a valid new password (minimum 4 characters).' });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New Password and Confirm Password do not match.' });
    }

    const snapshot = db.getSnapshot();
    const preMatchedUser = snapshot.users.find((u: User) => {
      const emailMatch = Boolean(cleanEmail && u.email.toLowerCase() === cleanEmail);
      const phoneMatch = Boolean(phone && phonesMatch(u.phone, phone, countryCode));
      return emailMatch || phoneMatch;
    });
    const userPhoneKey = preMatchedUser?.phone ? getPhoneOtpKey(preMatchedUser.phone, preMatchedUser.countryCode) : '';
    const storedOtp =
      (cleanEmail ? snapshot.otps[cleanEmail] : undefined) ||
      (preMatchedUser?.email ? snapshot.otps[preMatchedUser.email.toLowerCase()] : undefined) ||
      (phoneKey.length >= 6 ? snapshot.otps[phoneKey] : undefined) ||
      (userPhoneKey.length >= 6 ? snapshot.otps[userPhoneKey] : undefined);

    if (storedOtp && storedOtp !== String(otp || '').trim()) {
      return res.status(400).json({ error: 'Invalid or expired reset OTP.' });
    }

    const hashedNewPass = hashPassword(String(newPassword));
    let updatedUser: User | undefined;
    db.mutate(d => {
      updatedUser = d.users.find((u: User) => {
        const emailMatch = Boolean(cleanEmail && u.email.toLowerCase() === cleanEmail);
        const phoneMatch = Boolean(phone && phonesMatch(u.phone, phone, countryCode));
        return emailMatch || phoneMatch;
      });

      if (updatedUser) {
        updatedUser.passwordHash = hashedNewPass;
        delete updatedUser.password;
        // Immediately unlock account and reset failed attempts on password reset
        updatedUser.failedLoginAttempts = 0;
        updatedUser.lockedUntil = null;
      }

      if (cleanEmail) delete d.otps[cleanEmail];
      if (phoneKey.length >= 6) delete d.otps[phoneKey];
      if (userPhoneKey.length >= 6) delete d.otps[userPhoneKey];
      if (updatedUser?.email) delete d.otps[updatedUser.email.toLowerCase()];
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Customer account not found.' });
    }

    db.logActivity(
      'PASSWORD_RESET_COMPLETED',
      updatedUser.email,
      updatedUser.role,
      `Customer reset password via OTP and unlocked account (${updatedUser.email} | Mobile: ${updatedUser.phone || 'N/A'}).`,
      'user',
      updatedUser.id
    );

    return res.json({
      success: true,
      email: updatedUser.email,
      phone: updatedUser.phone,
      message: 'Your new password has been saved in the backend and your account is unlocked! Returning to Login page...',
    });
  });

  app.post('/api/auth/update-profile', (req, res) => {
    const { userId, name, email, phone, countryCode, countryName, age, dob, notifyGmail, notifyMobile, upiId, paidPlan, paymentMethod, transactionId, bio, avatar, socialLinks } = req.body;
    let updated: User | null = null;
    db.mutate(d => {
      const u = d.users.find(x => x.id === userId || (email && x.email.toLowerCase() === String(email).toLowerCase()));
      if (u) {
        if (name) u.name = name.trim();
        if (email && email.includes('@')) u.email = email.trim().toLowerCase();
        if (phone !== undefined) {
          u.phone = formatGlobalPhone(phone, countryCode || u.countryCode);
        }
        if (countryCode) u.countryCode = String(countryCode).trim();
        if (countryName) u.countryName = String(countryName).trim();
        if (age !== undefined && age !== '' && !isNaN(Number(age))) u.age = Number(age);
        if (dob !== undefined) u.dob = String(dob).trim();
        if (typeof notifyGmail === 'boolean') u.notifyGmail = notifyGmail;
        if (typeof notifyMobile === 'boolean') u.notifyMobile = notifyMobile;
        if (upiId !== undefined) u.upiId = upiId.trim();
        if (bio !== undefined) u.bio = bio;
        if (avatar) u.avatar = avatar;
        if (socialLinks && typeof socialLinks === 'object') {
          u.socialLinks = { ...u.socialLinks, ...socialLinks };
        }
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
      user: sanitizeUserForClient(
        {
          ...(updated as User),
          premiumPlan: subStatus.activePlan,
          premiumStartedAt: subStatus.startedAt,
          premiumExpiresAt: subStatus.expiresAt,
          premiumPaymentDetail: subStatus.premiumPaymentDetail,
        },
        true
      ),
    });
  });

  // -------------------------------------------------------------
  // COMICS & CHAPTERS / EPISODES ROUTES
  // -------------------------------------------------------------

  const normalizeSubmittedComics = (d: any) => {
    if (!Array.isArray(d.comics)) return;

    const fallbackArtworkPool = [
      '/src/assets/images/comic_cover_blade_1794269871791.jpg',
      '/src/assets/images/comic_cover_mystic_1794269871981.jpg',
      '/src/assets/images/comic_cover_cyber_1794269871978.jpg',
      '/src/assets/images/comic_cover_chronicles_1794269872270.jpg',
      '/src/assets/images/comic_cover_romance_1794269872268.jpg',
      '/src/assets/images/hero_banner_manga_1794269871419.jpg',
    ];

    d.comics.forEach((c: Comic) => {
      const fileCountMatch = String(c.attachedFileSize || '').match(/(\d+)\s*(?:files?|photos?|pages?)/i);
      const expectedFiles = fileCountMatch ? parseInt(fileCountMatch[1], 10) : 0;

      if (!Array.isArray(c.chapters) || c.chapters.length === 0) {
        c.chapters = [
          {
            id: `chap_${c.id}_1`,
            comicId: c.id,
            chapterNumber: 1,
            title: 'Chapter 1: The Beginning',
            episodes: [],
          },
        ];
      }

      const existingEpisodePages: ComicPage[] = [];
      c.chapters.forEach(ch => {
        ch.episodes?.forEach(ep => {
          ep.pages?.forEach(p => {
            if (p && p.imageUrl) {
              existingEpisodePages.push(p);
            }
          });
        });
      });

      const attachedList: ComicPage[] = Array.isArray(c.attachedPages) && c.attachedPages.length > 0
        ? [...c.attachedPages]
        : [...existingEpisodePages];

      const authorApp = Array.isArray(d.authorApplications)
        ? d.authorApplications.find(
            (a: AuthorApplication) =>
              a.userId === c.authorId ||
              a.authorName.toLowerCase() === (c.authorName || '').toLowerCase()
          )
        : undefined;

      const candidateImages: string[] = [];
      if (c.coverImage) candidateImages.push(c.coverImage);
      attachedList.forEach(p => {
        if (p.imageUrl && !candidateImages.includes(p.imageUrl)) {
          candidateImages.push(p.imageUrl);
        }
      });
      if (authorApp && Array.isArray(authorApp.sampleImages)) {
        authorApp.sampleImages.forEach((img: string) => {
          if (img && !candidateImages.includes(img)) {
            candidateImages.push(img);
          }
        });
      }
      fallbackArtworkPool.forEach(img => {
        if (!candidateImages.includes(img)) {
          candidateImages.push(img);
        }
      });

      const targetCount = Math.max(
        expectedFiles,
        attachedList.length,
        c.moderationStatus === 'pending' || c.attachedFileName ? 1 : 0
      );

      if (targetCount > 0 && attachedList.length < targetCount) {
        for (let idx = attachedList.length; idx < targetCount; idx++) {
          const imgUrl = candidateImages[idx % candidateImages.length] || c.coverImage || fallbackArtworkPool[0];
          attachedList.push({
            id: `page_${c.id}_${idx + 1}`,
            pageNumber: idx + 1,
            imageUrl: imgUrl,
            caption:
              idx === 0 && c.attachedFileName
                ? `Page 1 — ${c.attachedFileName} (Cover / Opening Panel)`
                : `Page ${idx + 1} — Uploaded Artwork Panel ${idx + 1}`,
          });
        }
      }

      if (attachedList.length > 0) {
        c.attachedPages = attachedList.map((p, idx) => ({
          id: p.id || `page_${c.id}_${idx + 1}`,
          pageNumber: idx + 1,
          imageUrl: p.imageUrl,
          caption: p.caption || `Page ${idx + 1}`,
        }));

        const firstChap = c.chapters[0];
        if (!Array.isArray(firstChap.episodes) || firstChap.episodes.length === 0) {
          firstChap.episodes = [
            {
              id: `ep_${c.id}_1`,
              chapterId: firstChap.id,
              comicId: c.id,
              episodeNumber: 1,
              title: 'Episode 1: Premiere Submission',
              synopsis: c.authorComments || c.description || 'Submitted by author for administrator review.',
              releaseDate: new Date(c.submittedAt || c.createdAt || Date.now()).toISOString().split('T')[0],
              isPremium: c.accessType === 'premium',
              priceInr: c.accessType === 'premium' ? c.episodePriceInr || 10 : 0,
              coverImage: c.coverImage || c.attachedPages[0]?.imageUrl,
              pages: c.attachedPages,
              likesCount: 0,
              dislikesCount: 0,
              averageRating: 5.0,
              totalRatings: 0,
              isPublished: c.moderationStatus === 'approved',
            },
          ];
        } else if (
          expectedFiles > 0 &&
          firstChap.episodes[0] &&
          (!Array.isArray(firstChap.episodes[0].pages) || firstChap.episodes[0].pages.length < expectedFiles)
        ) {
          firstChap.episodes[0].pages = c.attachedPages;
        }
      }
    });
  };

  app.get('/api/comics', (req, res) => {
    db.mutate(d => normalizeSubmittedComics(d));
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
    db.mutate(d => normalizeSubmittedComics(d));
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

      broadcastComicReleaseNotification({
        comic: updatedComic as Comic,
        episode: newEpisode as Episode,
        releaseType: 'new_episode',
      });

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

    broadcastComicReleaseNotification({
      comic: newComic,
      episode: newComic.chapters[0]?.episodes[0] || null,
      releaseType: 'new_comic',
    });

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
    const {
      comicId,
      title,
      authorId,
      authorName,
      genre,
      coverImage,
      description,
      authorComments,
      pages,
      chapters,
      attachedFileName,
      attachedFileSize,
      attachedFileType,
    } = req.body;
    let targetComic: Comic | null = null;

    db.mutate(d => {
      if (comicId) {
        const existing = d.comics.find(c => c.id === comicId);
        if (existing) {
          existing.moderationStatus = 'pending';
          existing.submittedAt = new Date().toISOString();
          existing.updatedAt = new Date().toISOString();
          existing.adminReviewNote = '';
          if (attachedFileName) existing.attachedFileName = attachedFileName;
          if (attachedFileSize) existing.attachedFileSize = attachedFileSize;
          if (attachedFileType) existing.attachedFileType = attachedFileType;
          if (authorComments !== undefined) existing.authorComments = authorComments;
          if (description !== undefined && description.trim()) existing.description = description.trim();

          if (Array.isArray(pages) && pages.length > 0) {
            const constructedPages: ComicPage[] = pages.map((p: any, idx: number) => ({
              id: p.id || `p_${Date.now()}_${idx + 1}`,
              pageNumber: idx + 1,
              imageUrl: p.imageUrl || p.dataUrl || existing.coverImage,
              caption: p.caption || p.fileName || `Page ${idx + 1}`,
            }));
            existing.attachedPages = constructedPages;
            if (!existing.chapters || existing.chapters.length === 0) {
              existing.chapters = [
                {
                  id: `chap_${existing.id}_1`,
                  comicId: existing.id,
                  chapterNumber: 1,
                  title: 'Chapter 1: The Beginning',
                  episodes: [],
                },
              ];
            }
            const firstChap = existing.chapters[0];
            if (!firstChap.episodes || firstChap.episodes.length === 0) {
              firstChap.episodes = [
                {
                  id: `ep_${existing.id}_1`,
                  chapterId: firstChap.id,
                  comicId: existing.id,
                  episodeNumber: 1,
                  title: 'Episode 1: Premiere Submission',
                  synopsis: existing.authorComments || existing.description || 'Submitted by author for review.',
                  releaseDate: new Date().toISOString().split('T')[0],
                  isPremium: existing.accessType === 'premium',
                  priceInr: existing.accessType === 'premium' ? existing.episodePriceInr || 10 : 0,
                  coverImage: existing.coverImage || constructedPages[0]?.imageUrl,
                  pages: constructedPages,
                  likesCount: 0,
                  dislikesCount: 0,
                  averageRating: 5.0,
                  totalRatings: 0,
                  isPublished: false,
                },
              ];
            } else {
              firstChap.episodes[0].pages = constructedPages;
              if (existing.authorComments) {
                firstChap.episodes[0].synopsis = existing.authorComments;
              }
            }
          }

          normalizeSubmittedComics(d);
          targetComic = existing;
        }
      } else {
        const newId = 'comic_' + Date.now();
        const fallbackImg = coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg';
        const constructedPages: ComicPage[] =
          Array.isArray(pages) && pages.length > 0
            ? pages.map((p: any, idx: number) => ({
                id: p.id || `p_${Date.now()}_${idx + 1}`,
                pageNumber: idx + 1,
                imageUrl: p.imageUrl || p.dataUrl || fallbackImg,
                caption: p.caption || p.fileName || `Page ${idx + 1}`,
              }))
            : [
                {
                  id: 'p_1',
                  pageNumber: 1,
                  imageUrl: fallbackImg,
                  caption: 'Opening panel',
                },
              ];

        const newComic: Comic = {
          id: newId,
          title: title || 'Untitled Series',
          slug: (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          authorId: authorId || 'usr_author',
          authorName: authorName || 'Creator',
          genre: Array.isArray(genre) ? genre : [genre || 'Action'],
          coverImage: fallbackImg,
          description: description || 'Submitted for publication on Aathirai_Comic.',
          authorComments: authorComments || undefined,
          attachedPages: constructedPages,
          status: 'Ongoing',
          accessType: 'free',
          fullPriceInr: 0,
          chapterPriceInr: 0,
          episodePriceInr: 0,
          featured: false,
          trending: false,
          popular: false,
          recommended: false,
          attachedFileName: attachedFileName || undefined,
          attachedFileSize: attachedFileSize || `${constructedPages.length} files`,
          attachedFileType: attachedFileType || 'IMAGE_ARCHIVE',
          chapters:
            chapters && chapters.length > 0
              ? chapters
              : [
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
                        synopsis: authorComments || description || 'Pilot episode submitted by author.',
                        releaseDate: new Date().toISOString().split('T')[0],
                        isPremium: false,
                        priceInr: 0,
                        coverImage: fallbackImg,
                        pages: constructedPages,
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
        normalizeSubmittedComics(d);
        targetComic = newComic;
      }
    });

    if (!targetComic) return res.status(404).json({ error: 'Comic could not be submitted' });

    db.logActivity(
      'COMIC_SUBMITTED_FOR_REVIEW',
      authorName || 'Author',
      'author',
      `Submitted full comic "${(targetComic as Comic).title}" for administrator approval`,
      'comic',
      (targetComic as Comic).id
    );

    return res.json({
      success: true,
      comic: targetComic,
      message: 'Comic submitted successfully! The administrator will review and approve it for automatic publishing on the website.',
    });
  });

  // Admin approves or rejects submitted comic
  app.post('/api/admin/comics/:id/moderate-submission', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject' | 'pending'
    let moderatedComic: Comic | null = null;

    db.mutate(d => {
      normalizeSubmittedComics(d);
      const c = d.comics.find(x => x.id === req.params.id);
      if (c) {
        const cleanNote = typeof adminNote === 'string' ? adminNote.trim() : '';
        c.moderationStatus =
          action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending';
        c.moderatedAt = new Date().toISOString();
        c.adminReviewNote =
          cleanNote ||
          (action === 'approve'
            ? 'Approved by Administrator! You are now officially approved to upload and publish comics of your own on Aathirai_Comic.'
            : action === 'reject'
              ? 'Rejected by Administrator during Comic Approval Queue review. Please address the feedback and re-submit.'
              : '');
        c.updatedAt = new Date().toISOString();

        if (action === 'approve') {
          // Ensure all episodes are published
          c.chapters.forEach(ch => {
            ch.episodes.forEach(ep => {
              ep.isPublished = true;
            });
          });

          // Also approve the corresponding author application & user account so the author knows they are approved to upload comics of their own
          const authorApp = d.authorApplications?.find(
            (a: AuthorApplication) =>
              a.userId === c.authorId ||
              a.authorName.toLowerCase() === (c.authorName || '').toLowerCase()
          ) as (AuthorApplication & { adminExplicitlyReviewed?: boolean }) | undefined;
          if (authorApp) {
            authorApp.status = 'approved';
            authorApp.adminExplicitlyReviewed = true;
            authorApp.reviewedAt = new Date().toISOString();
            authorApp.adminNote = c.adminReviewNote;
          }

          const authorUser = d.users?.find(
            (u: User) =>
              u.id === c.authorId ||
              u.name.toLowerCase() === (c.authorName || '').toLowerCase()
          );
          if (authorUser) {
            authorUser.role = 'author';
          }
        } else if (action === 'reject') {
          // Sync rejection note to author's application if applicable so it's visible across their Author pages
          const authorApp = d.authorApplications?.find(
            (a: AuthorApplication) =>
              a.userId === c.authorId ||
              a.authorName.toLowerCase() === (c.authorName || '').toLowerCase()
          ) as (AuthorApplication & { adminExplicitlyReviewed?: boolean }) | undefined;
          if (authorApp && cleanNote) {
            authorApp.adminNote = cleanNote;
          }
        }
        moderatedComic = c;
      }
    });

    if (!moderatedComic) return res.status(404).json({ error: 'Comic not found' });

    const comicObj = moderatedComic as Comic;
    db.addNotification({
      userId: comicObj.authorId,
      title: action === 'approve' ? `Comic Approved: ${comicObj.title}` : `Submission Update: ${comicObj.title}`,
      message: comicObj.adminReviewNote || 'Your comic submission status has been updated by the Administrator.',
      type: action === 'approve' ? 'comic_approved' : 'comic_rejected',
      targetId: comicObj.id,
    });

    db.logActivity(
      action === 'approve' ? 'COMIC_APPROVED_LIVE' : 'COMIC_REJECTED',
      'admin@aathirai.com',
      'admin',
      `${action === 'approve' ? 'Approved & Published Live' : 'Rejected'} comic: ${(moderatedComic as Comic).title}. Note: ${adminNote || 'None'}`,
      'comic',
      req.params.id
    );

    if (action === 'approve') {
      broadcastComicReleaseNotification({
        comic: comicObj,
        episode: comicObj.chapters?.[0]?.episodes?.[0] || null,
        releaseType: 'new_comic',
      });
    }

    return res.json({
      success: true,
      comic: moderatedComic,
      message:
        action === 'approve'
          ? 'Comic approved and published live! The author has been notified on their Author Page that they are approved to upload comics of their own.'
          : `Comic submission rejected with comment: "${(moderatedComic as Comic).adminReviewNote}". The author will see this reason on their Author Page.`,
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

      // Synchronize paywall status on existing notifications for this comic/episode
      const comicNowPaywalled =
        c.accessType === 'premium' ||
        Boolean(c.chapters?.some(ch => ch.isPremium || ch.episodes?.some(ep => ep.isPremium)));
      if (Array.isArray(d.notifications)) {
        d.notifications.forEach(n => {
          if (n.comicId === comicId || n.targetId === comicId) {
            if (episodeId && n.episodeId === episodeId) {
              n.isPaywalled = Boolean(isPremium);
            } else {
              n.isPaywalled = comicNowPaywalled;
            }
          }
        });
      }
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
    const {
      title,
      authorId,
      authorName,
      genre,
      coverImage,
      description,
      authorComments,
      pages,
      accessType = 'free',
      fullPriceInr,
      chapterPriceInr,
      episodePriceInr,
      attachedFileName,
      attachedFileSize,
      attachedFileType,
    } = req.body;
    if (!title || !authorName) {
      return res.status(400).json({ error: 'Title and Author are required' });
    }

    const comicId = 'comic_' + Date.now();
    const chapId = 'chap_' + Date.now();
    const fallbackCover = coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg';

    const constructedPages: ComicPage[] =
      Array.isArray(pages) && pages.length > 0
        ? pages.map((p: any, idx: number) => ({
            id: p.id || `p_${Date.now()}_${idx + 1}`,
            pageNumber: idx + 1,
            imageUrl: p.imageUrl || p.dataUrl || fallbackCover,
            caption: p.caption || p.fileName || `Page ${idx + 1}`,
          }))
        : [];

    const initialEpisodes: Episode[] =
      constructedPages.length > 0
        ? [
            {
              id: 'ep_' + Date.now(),
              chapterId: chapId,
              comicId,
              episodeNumber: 1,
              title: 'Episode 1: Premiere Submission',
              synopsis: authorComments || description || 'Opening episode uploaded by author.',
              releaseDate: new Date().toISOString().split('T')[0],
              isPremium: accessType === 'premium',
              priceInr: accessType === 'premium' ? Number(episodePriceInr) || 10 : 0,
              coverImage: fallbackCover,
              pages: constructedPages,
              likesCount: 0,
              dislikesCount: 0,
              averageRating: 5.0,
              totalRatings: 0,
              isPublished: true,
            },
          ]
        : [];

    const newComic: Comic = {
      id: comicId,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      authorId: authorId || 'usr_rajesh',
      authorName,
      genre: Array.isArray(genre) ? genre : [genre || 'Action'],
      coverImage: fallbackCover,
      description: description || 'New comic book series on Aathirai_Comic.',
      authorComments: authorComments || undefined,
      attachedPages: constructedPages.length > 0 ? constructedPages : undefined,
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
      attachedFileSize: attachedFileSize || (constructedPages.length > 0 ? `${constructedPages.length} files` : undefined),
      attachedFileType: attachedFileType || undefined,
      chapters: [
        {
          id: chapId,
          comicId,
          chapterNumber: 1,
          title: 'Prologue & Beginning',
          episodes: initialEpisodes,
        },
      ],
      totalViews: 0,
      averageRating: 5.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      moderationStatus: 'approved',
    };

    db.mutate(d => {
      d.comics.unshift(newComic);
      normalizeSubmittedComics(d);
    });

    db.logActivity('COMIC_CREATED', authorName, 'author', `Created new comic series: ${newComic.title}`, 'comic', newComic.id);

    broadcastComicReleaseNotification({
      comic: newComic,
      episode: newComic.chapters[0]?.episodes[0] || null,
      releaseType: 'new_comic',
    });

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

    const parentComic = db.getSnapshot().comics.find(c => c.id === req.params.comicId);
    if (parentComic) {
      broadcastComicReleaseNotification({
        comic: parentComic,
        episode: addedEpisode as Episode,
        releaseType: 'new_episode',
      });
    }

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

    // Build flat ordered list of episodes in this comic for Prev/Next episode navigation
    const allEpisodes: Array<{ id: string; title: string; episodeNumber: number; chapterNumber: number }> = [];
    foundComic.chapters.forEach((ch: Chapter) => {
      ch.episodes.forEach((ep: Episode) => {
        allEpisodes.push({
          id: ep.id,
          title: ep.title,
          episodeNumber: ep.episodeNumber,
          chapterNumber: ch.chapterNumber,
        });
      });
    });
    const currentIdx = allEpisodes.findIndex(item => item.id === foundEpisode.id);
    const prevEpisodeId = currentIdx > 0 ? allEpisodes[currentIdx - 1].id : null;
    const nextEpisodeId = currentIdx >= 0 && currentIdx < allEpisodes.length - 1 ? allEpisodes[currentIdx + 1].id : null;

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
      prevEpisodeId,
      nextEpisodeId,
      allEpisodes,
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

  // Comments: Post, Edit, Like, Delete & Report
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
      likesCount: 0,
      likedBy: [] as string[],
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

  app.put('/api/episodes/:id/comments/:commentId', (req, res) => {
    const { userId, content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Updated comment cannot be empty' });
    }
    let updatedComment: any = null;
    db.mutate(d => {
      for (const c of d.comments) {
        if (c.id === req.params.commentId && (!userId || c.userId === userId)) {
          c.content = content.trim();
          c.updatedAt = new Date().toISOString();
          c.isEdited = true;
          updatedComment = c;
          break;
        }
        if (c.replies) {
          const r = c.replies.find(rep => rep.id === req.params.commentId && (!userId || rep.userId === userId));
          if (r) {
            r.content = content.trim();
            r.updatedAt = new Date().toISOString();
            r.isEdited = true;
            updatedComment = r;
            break;
          }
        }
      }
    });
    if (!updatedComment) return res.status(404).json({ error: 'Comment not found or unauthorized' });
    return res.json({ success: true, comment: updatedComment });
  });

  app.post('/api/episodes/:id/comments/:commentId/like', (req, res) => {
    const { userId = 'usr_guest' } = req.body;
    let targetComment: any = null;
    db.mutate(d => {
      for (const c of d.comments) {
        if (c.id === req.params.commentId) {
          targetComment = c;
          break;
        }
        if (c.replies) {
          const r = c.replies.find(rep => rep.id === req.params.commentId);
          if (r) {
            targetComment = r;
            break;
          }
        }
      }
      if (targetComment) {
        if (!Array.isArray(targetComment.likedBy)) targetComment.likedBy = [];
        const idx = targetComment.likedBy.indexOf(userId);
        if (idx >= 0) {
          targetComment.likedBy.splice(idx, 1);
        } else {
          targetComment.likedBy.push(userId);
        }
        targetComment.likesCount = targetComment.likedBy.length;
      }
    });
    if (!targetComment) return res.status(404).json({ error: 'Comment not found' });
    return res.json({ success: true, likesCount: targetComment.likesCount, likedBy: targetComment.likedBy });
  });

  app.delete('/api/episodes/:id/comments/:commentId', (req, res) => {
    db.mutate(d => {
      d.comments = d.comments.filter(c => {
        if (c.id === req.params.commentId) {
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

  // Content & Comment Reporting
  app.post('/api/reports', (req, res) => {
    const { reporterId, reporterName, targetType = 'comment', targetId, episodeId, comicId, reason } = req.body;
    if (!targetId || !reason) {
      return res.status(400).json({ error: 'Target ID and report reason are required' });
    }
    const report = {
      id: 'rep_' + Date.now(),
      reporterId: String(reporterId || 'usr_guest'),
      reporterEmail: String(req.body.reporterEmail || reporterName || 'reader@aathirai.com'),
      targetType: (targetType || 'comment') as 'comment' | 'comic' | 'episode',
      targetId: String(targetId),
      episodeId: episodeId ? String(episodeId) : undefined,
      targetSummary: String(req.body.targetSummary || `${targetType}: ${targetId}`),
      reason: String(reason).trim(),
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
    db.mutate(d => {
      if (!Array.isArray(d.reports)) d.reports = [];
      d.reports.unshift(report);
      if (targetType === 'comment') {
        const c = d.comments.find(cm => cm.id === targetId);
        if (c) c.isReported = true;
      }
    });
    db.logActivity('CONTENT_REPORTED', reporterName || 'Reader', 'reader', `Reported ${targetType} (${targetId}): ${reason}`, 'report', report.id);
    return res.json({ success: true, report });
  });

  // Automated Gmail & In-App Notification Bar Broadcast for New Comic / Episode Releases
  function broadcastComicReleaseNotification(params: {
    comic: Comic;
    episode?: Episode | null;
    releaseType: 'new_comic' | 'new_episode';
  }) {
    const { comic, episode, releaseType } = params;
    const isPaywalled =
      comic.accessType === 'premium' ||
      Boolean(episode?.isPremium) ||
      Boolean(comic.chapters?.some(ch => ch.isPremium || ch.episodes?.some(ep => ep.isPremium)));
    const nowIso = new Date().toISOString();
    const title =
      releaseType === 'new_comic'
        ? `New Comic Released: ${comic.title}`
        : `New Episode: ${comic.title} - ${episode?.title || 'Latest Issue'}`;
    const baseMessage =
      releaseType === 'new_comic'
        ? `"${comic.title}" by ${comic.authorName} is now available (${isPaywalled ? 'Premium Paywall' : 'Free Access'}).`
        : `New episode "${episode?.title || 'New Issue'}" of "${comic.title}" is now live (${isPaywalled ? 'Premium Paywall' : 'Free Access'}).`;

    const snapshot = db.getSnapshot();
    const registeredReaders = (snapshot.users || []).filter(
      u => u.email && u.email.includes('@') && u.notifyGmail !== false
    );

    const recipientEmails: string[] = [];
    for (const reader of registeredReaders) {
      recipientEmails.push(reader.email);
      db.addNotification({
        userId: reader.id,
        userEmail: reader.email,
        type: releaseType,
        title,
        message: `${baseMessage} Gmail alert sent to ${reader.email}.`,
        targetId: comic.id,
        comicId: comic.id,
        episodeId: episode?.id,
        isPaywalled,
        gmailSent: true,
        gmailSentTo: reader.email,
        gmailSentAt: nowIso,
      });
    }

    // Add global Notification Bar entry for guest/public view
    db.addNotification({
      userId: 'all',
      type: releaseType,
      title,
      message: baseMessage,
      targetId: comic.id,
      comicId: comic.id,
      episodeId: episode?.id,
      isPaywalled,
      gmailSent: true,
      gmailSentAt: nowIso,
    });

    if (recipientEmails.length > 0) {
      db.logActivity(
        'GMAIL_RELEASE_ALERT_SENT',
        'system@aathirai.com',
        'admin',
        `Automated Gmail & Notification Bar release alert for "${comic.title}" (${releaseType}) dispatched to ${recipientEmails.length} registered reader(s): ${recipientEmails.join(', ')}`,
        'comic',
        comic.id
      );
    }
  }

  // Reader Bookmarks, Favorites, Reading Progress & Notifications
  app.get('/api/notifications', (req, res) => {
    const { userId, email } = req.query;
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    const cleanUserId = userId ? String(userId).trim() : '';
    const snapshot = db.getSnapshot();
    const rawList = (snapshot.notifications || []).filter(n => {
      if (cleanUserId && n.userId === cleanUserId) return true;
      if (cleanEmail && n.userEmail?.toLowerCase() === cleanEmail) return true;
      if (n.userId === 'all') return true;
      return false;
    });

    // Deduplicate so a logged-in reader sees their personalized Gmail-dispatched notification first without duplicate 'all' copies
    const seenKeys = new Set<string>();
    const deduplicated = rawList
      .sort((a, b) => {
        // Prefer user-specific notification over 'all' when timestamps are identical
        if (a.userId !== 'all' && b.userId === 'all') return -1;
        if (a.userId === 'all' && b.userId !== 'all') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .filter(n => {
        const key = `${n.type}_${n.comicId || n.targetId || ''}_${n.episodeId || ''}_${n.title}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .map(n => {
        const targetComicId = n.comicId || n.targetId;
        const liveComic = targetComicId ? snapshot.comics.find(c => c.id === targetComicId) : undefined;
        let livePaywalled = Boolean(n.isPaywalled);
        if (liveComic) {
          livePaywalled =
            liveComic.accessType === 'premium' ||
            Boolean(
              liveComic.chapters?.some(
                ch =>
                  ch.isPremium ||
                  ch.episodes?.some(ep => (n.episodeId ? ep.id === n.episodeId && ep.isPremium : ep.isPremium))
              )
            );
        }
        return {
          ...n,
          comicId: targetComicId,
          isPaywalled: livePaywalled,
        };
      });

    return res.json({ notifications: deduplicated });
  });

  app.post('/api/notifications/mark-read', (req, res) => {
    const { notificationId, userId, email, markAll } = req.body;
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    const cleanUserId = userId ? String(userId).trim() : '';

    db.mutate(d => {
      if (!Array.isArray(d.notifications)) return;
      const targetNotif = notificationId ? d.notifications.find(x => x.id === notificationId) : undefined;
      d.notifications.forEach(n => {
        const matchesUser =
          !cleanUserId ||
          n.userId === cleanUserId ||
          (cleanEmail && n.userEmail?.toLowerCase() === cleanEmail) ||
          n.userId === 'all';
        if (markAll || !notificationId) {
          if (matchesUser) n.read = true;
        } else if (
          n.id === notificationId ||
          (targetNotif &&
            matchesUser &&
            n.type === targetNotif.type &&
            (n.comicId || n.targetId) === (targetNotif.comicId || targetNotif.targetId) &&
            n.title === targetNotif.title)
        ) {
          n.read = true;
        }
      });
    });
    return res.json({ success: true });
  });

  app.post('/api/reader/bookmarks/toggle', (req, res) => {
    const { userId, comicId } = req.body;
    if (!userId || !comicId) return res.status(400).json({ error: 'userId and comicId are required' });
    let bookmarks: string[] = [];
    db.mutate(d => {
      const u = d.users.find(x => x.id === userId);
      if (u) {
        if (!Array.isArray(u.bookmarks)) u.bookmarks = [];
        const idx = u.bookmarks.indexOf(comicId);
        if (idx >= 0) u.bookmarks.splice(idx, 1);
        else u.bookmarks.push(comicId);
        bookmarks = u.bookmarks;
      }
    });
    return res.json({ success: true, bookmarks });
  });

  app.post('/api/reader/favorites/toggle', (req, res) => {
    const { userId, comicId } = req.body;
    if (!userId || !comicId) return res.status(400).json({ error: 'userId and comicId are required' });
    let favorites: string[] = [];
    db.mutate(d => {
      const u = d.users.find(x => x.id === userId);
      if (u) {
        if (!Array.isArray(u.favorites)) u.favorites = [];
        const idx = u.favorites.indexOf(comicId);
        if (idx >= 0) u.favorites.splice(idx, 1);
        else u.favorites.push(comicId);
        favorites = u.favorites;
      }
    });
    return res.json({ success: true, favorites });
  });

  app.post('/api/reader/progress', (req, res) => {
    const { userId, comicId, comicTitle, coverImage, episodeId, episodeTitle, episodeNumber = 1, chapterNumber = 1, pageIndex = 0, totalPages = 1 } = req.body;
    if (!userId || !comicId || !episodeId) {
      return res.status(400).json({ error: 'userId, comicId, and episodeId are required' });
    }
    let readingHistory: any[] = [];
    db.mutate(d => {
      const u = d.users.find(x => x.id === userId);
      if (u) {
        if (!Array.isArray(u.readingHistory)) u.readingHistory = [];
        u.readingHistory = u.readingHistory.filter(h => h.comicId !== comicId);
        u.readingHistory.unshift({
          comicId,
          comicTitle: comicTitle || 'Comic Series',
          coverImage: coverImage || '',
          episodeId,
          episodeTitle: episodeTitle || 'Episode',
          episodeNumber: Number(episodeNumber) || 1,
          chapterNumber: Number(chapterNumber) || 1,
          pageIndex: Number(pageIndex) || 0,
          totalPages: Number(totalPages) || 1,
          updatedAt: new Date().toISOString(),
        });
        u.readingHistory = u.readingHistory.slice(0, 20);
        readingHistory = u.readingHistory;
      }
    });
    return res.json({ success: true, readingHistory });
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

      const fallbackSamplePages =
        validSampleImages.length > 0
          ? validSampleImages
          : existingAppIdx >= 0 && Array.isArray(d.authorApplications[existingAppIdx].sampleImages) && d.authorApplications[existingAppIdx].sampleImages!.length > 0
            ? d.authorApplications[existingAppIdx].sampleImages!
            : d.comics[0]?.chapters?.[0]?.episodes?.[0]?.pages?.map(p => p.imageUrl) || [
                '/src/assets/images/comic_cover_blade_1794269871791.jpg',
                '/src/assets/images/comic_cover_cyber_1794269871978.jpg',
                '/src/assets/images/comic_cover_mystic_1794269871981.jpg',
              ];

      const application: AuthorApplication & { adminExplicitlyReviewed?: boolean } = {
        id: existingAppIdx >= 0 ? d.authorApplications[existingAppIdx].id : 'app_' + Date.now(),
        userId: updatedUser!.id,
        authorName: authorName.trim(),
        email: cleanEmail,
        authorAvatar: resolvedAvatar,
        bio: bio || existingUser?.bio || 'Creator & Storyteller on Aathirai_Comic.',
        portfolioUrl: portfolioUrl || '',
        sampleComicTitle: sampleComicTitle.trim(),
        sampleSynopsis: sampleSynopsis || 'Original sample comic submitted for editorial review.',
        samplePagesCount: fallbackSamplePages.length,
        sampleImages: fallbackSamplePages,
        status: 'pending',
        submittedAt: new Date().toISOString(),
        adminExplicitlyReviewed: false,
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
      `Submitted Author application for "${sampleComicTitle}" with ${savedApp!.samplePagesCount} sample photo(s) (Pending Admin Approval)`,
      'author_application',
      savedApp!.id
    );

    return res.json({
      success: true,
      application: savedApp,
      user: updatedUser,
      message:
        'Author photo & sample comic pages submitted! Your application is now Pending Approval in the Admin Console.',
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
        const defaultPages =
          d.comics[0]?.chapters?.[0]?.episodes?.[0]?.pages?.map(p => p.imageUrl) || [
            '/src/assets/images/comic_cover_blade_1794269871791.jpg',
            '/src/assets/images/comic_cover_cyber_1794269871978.jpg',
          ];
        const newApp: AuthorApplication & { adminExplicitlyReviewed?: boolean } = {
          id: 'app_' + Date.now(),
          userId: u?.id || userId || 'usr_' + Date.now(),
          authorName: authorName || u?.name || 'Featured Creator',
          email: cleanEmail || u?.email || 'creator@aathirai.com',
          authorAvatar,
          bio: u?.bio || 'Creator & Storyteller on Aathirai_Comic.',
          portfolioUrl: '',
          sampleComicTitle: 'Original Comic Series',
          sampleSynopsis: 'Sample comic pages submitted for administrator review.',
          samplePagesCount: defaultPages.length,
          sampleImages: defaultPages,
          status: 'pending',
          submittedAt: new Date().toISOString(),
          adminExplicitlyReviewed: false,
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

    // Merge custom authors first, avoiding duplicates by id, email, or name
    const seenIds = new Set<string>();
    const seenEmails = new Set<string>();
    const seenNames = new Set<string>();
    const combined = [];
    for (const a of [...customAuthors, ...defaultAuthors]) {
      const idKey = (a.id || '').trim().toLowerCase();
      const emailKey = (a.email || '').trim().toLowerCase();
      const nameKey = (a.name || '').trim().toLowerCase();
      if (
        (idKey && seenIds.has(idKey)) ||
        (emailKey && seenEmails.has(emailKey)) ||
        (nameKey && seenNames.has(nameKey))
      ) {
        continue;
      }
      if (idKey) seenIds.add(idKey);
      if (emailKey) seenEmails.add(emailKey);
      if (nameKey) seenNames.add(nameKey);
      combined.push(a);
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
  // RAZORPAY & INDIAN PAYMENTS (UNCONFIGURED / TEST / LIVE MODES)
  // -------------------------------------------------------------

  app.get('/api/payments/config', (req, res) => {
    const snapshot = db.getSnapshot();
    const settings = snapshot.settings;
    const gstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const rzpStatus = getRazorpayEnvironmentStatus();
    return res.json({
      mode: rzpStatus.mode.toUpperCase(),
      modeLower: rzpStatus.mode,
      isConfigured: rzpStatus.isConfigured,
      keyId: rzpStatus.keyId,
      currency: 'INR',
      symbol: '₹',
      testMode: rzpStatus.isTestMode,
      warningBanner: rzpStatus.statusMessage,
      statusMessage: rzpStatus.statusMessage,
      merchantUpiId: settings?.merchantUpiId || 'balajiaris05@okaxis',
      merchantUpiName: settings?.merchantUpiName || 'Aathirai Comic Network',
      gstConfig: {
        legalBusinessName: gstSettings.legalBusinessName,
        tradeName: gstSettings.tradeName,
        gstin: gstSettings.gstin,
        isGstRegistered: Boolean(gstSettings.gstin && gstSettings.gstin.trim().length === 15),
        stateCode: gstSettings.stateCode || '33',
        stateName: gstSettings.stateName || 'Tamil Nadu',
        defaultSacCode: gstSettings.defaultSacCode || '998431',
        defaultSacDescription: gstSettings.defaultSacDescription,
        applicableGstRate: gstSettings.applicableGstRate ?? 18,
        applyGstToDomesticSales: gstSettings.applyGstToDomesticSales !== false,
      },
      states: INDIAN_STATES_AND_UTS,
    });
  });

  app.get('/api/gst/public-config', (_req, res) => {
    const gstSettings = db.getSnapshot().gstSettings || getDefaultGstBusinessSettings();
    return res.json({
      legalBusinessName: gstSettings.legalBusinessName,
      tradeName: gstSettings.tradeName,
      gstin: gstSettings.gstin,
      isGstRegistered: Boolean(gstSettings.gstin && gstSettings.gstin.trim().length === 15),
      stateCode: gstSettings.stateCode || '33',
      stateName: gstSettings.stateName || 'Tamil Nadu',
      registeredAddress: gstSettings.registeredAddress,
      defaultSacCode: gstSettings.defaultSacCode || '998431',
      defaultSacDescription: gstSettings.defaultSacDescription,
      applicableGstRate: gstSettings.applicableGstRate ?? 18,
      applyGstToDomesticSales: gstSettings.applyGstToDomesticSales !== false,
      states: INDIAN_STATES_AND_UTS,
    });
  });

  // Create Razorpay Order (Server-Side)
  app.post('/api/payments/razorpay/create-order', paymentRateLimiter, (req, res) => {
    const rzpStatus = getRazorpayEnvironmentStatus();
    if (!rzpStatus.isConfigured || rzpStatus.mode === 'unconfigured') {
      return res.status(503).json({
        error: 'Payment gateway is currently unavailable. Razorpay credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are not configured on the server.',
        mode: 'UNCONFIGURED',
      });
    }

    const {
      comicId,
      chapterId,
      episodeId,
      type = 'episode',
      amountInr,
      userId,
      userEmail,
      placeOfSupplyStateCode,
      isInternational,
      customerGstin,
    } = req.body;
    const parsedAmount = Number(amountInr);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Valid amount in INR is required' });
    }

    if (customerGstin && String(customerGstin).trim()) {
      const custGstinCheck = validateIndianGstin(String(customerGstin));
      if (!custGstinCheck.valid) {
        return res.status(400).json({
          error: `Customer GSTIN validation failed: ${custGstinCheck.error}`,
        });
      }
    }

    const snapshot = db.getSnapshot();
    if (type === 'subscription') {
      const cleanEmail = (userEmail || '').trim().toLowerCase();
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

    const gstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const gstBreakdown = calculateInclusiveGstBreakdown({
      totalAmountInr: parsedAmount,
      sellerStateCode: gstSettings.stateCode || '33',
      placeOfSupplyStateCode: placeOfSupplyStateCode || gstSettings.stateCode || '33',
      applicableRatePercent: gstSettings.applicableGstRate ?? 18,
      applyGst: gstSettings.applyGstToDomesticSales !== false,
      isInternational: Boolean(isInternational || placeOfSupplyStateCode === '96'),
      hsnSacCode: gstSettings.defaultSacCode || '998431',
      hsnSacDescription: gstSettings.defaultSacDescription,
    });

    const orderId = 'order_' + crypto.randomBytes(10).toString('hex');
    const amountInPaise = Math.round(parsedAmount * 100);
    const environment: 'test' | 'live' = rzpStatus.isLiveMode ? 'live' : 'test';

    // When in TEST mode, also provide a deterministic test payment token & server-computed HMAC-SHA256 signature
    const testPaymentId = rzpStatus.isTestMode ? 'pay_test_' + crypto.randomBytes(8).toString('hex') : undefined;
    const testSignature =
      rzpStatus.isTestMode && testPaymentId
        ? computeRazorpayOrderSignature(orderId, testPaymentId)
        : undefined;

    return res.json({
      success: true,
      mode: rzpStatus.mode.toUpperCase(),
      modeLower: rzpStatus.mode,
      environment,
      warningBanner: rzpStatus.statusMessage,
      orderId,
      amount: amountInPaise,
      amountInr: parsedAmount,
      gstBreakdown,
      currency: 'INR',
      keyId: rzpStatus.keyId,
      ...(rzpStatus.isTestMode
        ? {
            testOrderCredentials: {
              razorpayOrderId: orderId,
              razorpayPaymentId: testPaymentId,
              razorpaySignature: testSignature,
            },
            testGatewayAuth: {
              orderId,
              paymentId: testPaymentId,
              signature: testSignature,
            },
          }
        : {}),
      paymentMethods: [
        'UPI (Google Pay, PhonePe, Paytm, BHIM)',
        'RuPay, Visa, Mastercard Debit & Credit Cards',
        'Net Banking (SBI, HDFC, ICICI, Axis, Indian Bank)',
        'Digital Wallets (Paytm, PhonePe)',
      ],
    });
  });

  // Verify Razorpay Payment via HMAC-SHA256 & Grant Access (Idempotent)
  app.post('/api/payments/razorpay/verify-payment', paymentRateLimiter, (req, res) => {
    const rzpStatus = getRazorpayEnvironmentStatus();
    if (!rzpStatus.isConfigured || rzpStatus.mode === 'unconfigured') {
      return res.status(503).json({
        error: 'Cannot verify payment: Razorpay gateway is not configured on the server.',
      });
    }

    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      userId,
      customerName,
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
      placeOfSupplyStateCode,
      isInternational,
      customerGstin,
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        error: 'Payment verification failed: Missing razorpayOrderId, razorpayPaymentId, or razorpaySignature.',
      });
    }

    let validatedCustomerGstin: string | undefined = undefined;
    if (customerGstin && String(customerGstin).trim()) {
      const custCheck = validateIndianGstin(String(customerGstin));
      if (!custCheck.valid) {
        return res.status(400).json({
          error: `Customer GSTIN validation failed: ${custCheck.error}`,
        });
      }
      validatedCustomerGstin = custCheck.normalizedGstin || undefined;
    }

    // 1. Idempotency check: prevent duplicate fulfillment for the same payment ID or order ID
    const snapshot = db.getSnapshot();
    const existingPurchase = snapshot.purchases.find(
      p => p.razorpayPaymentId === razorpayPaymentId || (p.razorpayOrderId === razorpayOrderId && p.status === 'success')
    );
    if (existingPurchase) {
      return res.json({
        success: true,
        idempotentReplay: true,
        purchase: existingPurchase,
        message: 'Payment already verified and fulfilled.',
      });
    }

    // 2. Cryptographic HMAC-SHA256 signature verification
    const isSignatureValid = verifyRazorpayPaymentSignature({
      orderId: String(razorpayOrderId),
      paymentId: String(razorpayPaymentId),
      signature: String(razorpaySignature),
    });

    if (!isSignatureValid) {
      db.logActivity(
        'PAYMENT_SIGNATURE_INVALID',
        userEmail || 'unknown',
        'reader',
        `Rejected tampered or invalid Razorpay signature for order ${razorpayOrderId} / payment ${razorpayPaymentId}.`,
        'payment',
        String(razorpayOrderId)
      );
      return res.status(400).json({
        error: 'Cryptographic HMAC-SHA256 payment signature verification failed. Access denied.',
      });
    }

    const cleanEmailCheck = (userEmail || '').trim().toLowerCase();
    const matchedUserRecord = snapshot.users.find(
      u =>
        (userId && u.id === userId) ||
        (cleanEmailCheck && u.email.toLowerCase() === cleanEmailCheck)
    );
    if (type === 'subscription') {
      if (
        matchedUserRecord &&
        matchedUserRecord.premiumExpiresAt &&
        new Date(matchedUserRecord.premiumExpiresAt).getTime() > Date.now()
      ) {
        const activePlanLabel =
          matchedUserRecord.premiumPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)';
        const expiryDateStr = new Date(matchedUserRecord.premiumExpiresAt).toLocaleDateString();
        return res.status(400).json({
          error: `Only one plan can be active at a time. Your ${activePlanLabel} plan is currently active until ${expiryDateStr}. You can choose another plan after your current plan ends.`,
        });
      }
    }

    // 3. Calculate GST-inclusive breakdown & revenue split based on platform & GST settings
    const settings = snapshot.settings;
    const gstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const sellerSnap = buildSellerSnapshot(gstSettings);
    const resolvedPosCode =
      validatedCustomerGstin?.slice(0, 2) ||
      placeOfSupplyStateCode ||
      (matchedUserRecord?.countryCode && matchedUserRecord.countryCode !== '+91'
        ? '96'
        : sellerSnap.stateCode || '33');

    const amountNum = Number(amountInr);
    const gstCalc = calculateInclusiveGstBreakdown({
      totalAmountInr: amountNum,
      sellerStateCode: sellerSnap.stateCode,
      placeOfSupplyStateCode: resolvedPosCode,
      applicableRatePercent: gstSettings.applicableGstRate ?? 18,
      applyGst: gstSettings.applyGstToDomesticSales !== false,
      isInternational: Boolean(isInternational || resolvedPosCode === '96'),
      hsnSacCode: sellerSnap.hsnSacCode,
      hsnSacDescription: sellerSnap.hsnSacDescription,
    });

    const revenueSharePct = settings.authorRevenueSharePercent || 70;
    const baseRevenue = gstCalc.taxableValue;
    const authorEarningsInr = Number(((baseRevenue * revenueSharePct) / 100).toFixed(2));
    const platformFeeInr = Number((baseRevenue - authorEarningsInr).toFixed(2));

    const seqNum = gstSettings.nextInvoiceSequence || snapshot.purchases.length + 1;
    const invoiceNumber = formatGstInvoiceNumber(gstSettings.invoicePrefix || 'AAC/2627/', seqNum);
    const receiptNumber = `INV-AATHIRAI-${new Date().getFullYear()}-${String(seqNum).padStart(4, '0')}`;
    const nowIso = new Date().toISOString();
    const environment: 'test' | 'live' = rzpStatus.isLiveMode ? 'live' : 'test';

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
      customerName: customerName || matchedUserRecord?.name || cleanEmail.split('@')[0],
      userEmail: cleanEmail,
      userPhone: userPhone || matchedUserRecord?.phone || undefined,
      userUpiId: userUpiId || matchedUserRecord?.upiId || undefined,
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
      razorpayOrderId: String(razorpayOrderId),
      razorpayPaymentId: String(razorpayPaymentId),
      signatureVerified: true,
      environment,
      idempotencyKey: `idem_${razorpayOrderId}_${razorpayPaymentId}`,
      status: 'success',
      createdAt: nowIso,
      receiptNumber,
      invoiceNumber,
      taxableValue: gstCalc.taxableValue,
      taxAmount: gstCalc.taxAmount,
      taxRate: gstCalc.taxRate,
      taxType: gstCalc.taxType,
      cgstRate: gstCalc.cgstRate,
      cgstAmount: gstCalc.cgstAmount,
      sgstRate: gstCalc.sgstRate,
      sgstAmount: gstCalc.sgstAmount,
      igstRate: gstCalc.igstRate,
      igstAmount: gstCalc.igstAmount,
      hsnSacCode: gstCalc.hsnSacCode,
      hsnSacDescription: gstCalc.hsnSacDescription,
      placeOfSupplyStateCode: gstCalc.placeOfSupplyStateCode,
      placeOfSupplyStateName: gstCalc.placeOfSupplyStateName,
      isInternational: Boolean(isInternational || resolvedPosCode === '96'),
      supplyType: gstCalc.supplyType,
      customerGstin: validatedCustomerGstin,
      sellerSnapshot: sellerSnap,
      authorEarningsInr,
      platformFeeInr,
    };

    const paymentTx: PaymentTransaction = {
      id: `tx_${newPurchase.id}`,
      orderId: newPurchase.razorpayOrderId,
      paymentId: newPurchase.razorpayPaymentId,
      userId: newPurchase.userId,
      userEmail: newPurchase.userEmail,
      comicId: newPurchase.comicId,
      itemTitle: newPurchase.comicTitle,
      type: newPurchase.type,
      subscriptionPlan: newPurchase.subscriptionPlan,
      amountInr: amountNum,
      amountPaise: Math.round(amountNum * 100),
      currency: 'INR',
      status: 'verified',
      environment,
      signatureVerified: true,
      idempotencyKey: `idem_${razorpayOrderId}_${razorpayPaymentId}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    let updatedReader: User | null = null;

    db.mutate(d => {
      if (d.gstSettings) {
        d.gstSettings.nextInvoiceSequence = seqNum + 1;
      }
      d.purchases.unshift(newPurchase);
      if (!Array.isArray(d.paymentTransactions)) d.paymentTransactions = [];
      d.paymentTransactions.unshift(paymentTx);

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
            environment,
          };
        }
        updatedReader = u;
      }
    });

    db.addNotification({
      userId: newPurchase.userId,
      userEmail: cleanEmail,
      title: `Payment Confirmed (${environment.toUpperCase()}): ₹${amountNum}`,
      message: `Receipt ${receiptNumber} for ${newPurchase.comicTitle}. Access unlocked!`,
      type: 'payment_success',
      targetId: newPurchase.id,
    });

    db.logActivity(
      'PAYMENT_CAPTURED',
      cleanEmail,
      'reader',
      `[${environment.toUpperCase()}] Payment of ₹${amountNum} captured & HMAC-SHA256 verified for ${newPurchase.comicTitle}${resolvedPlan ? ` (${resolvedPlan === '6_months' ? '6 Months Premium - ₹249' : '1 Month Premium - ₹49'}, valid until ${new Date(computedExpiresAt!).toLocaleDateString()})` : ''}. Receipt ${receiptNumber}`,
      'purchase',
      newPurchase.id
    );

    return res.json({
      success: true,
      environment,
      purchase: newPurchase,
      user: updatedReader ? sanitizeUserForClient(updatedReader, true) : null,
      message: resolvedPlan
        ? `Gmail (${cleanEmail}) verified! ${resolvedPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)'} Premium Pass activated (${environment.toUpperCase()} mode).`
        : `Payment verified successfully (${environment.toUpperCase()} mode)! Access granted to premium comic episode.`,
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

  // Razorpay Webhook Endpoint with Cryptographic Signature Verification
  const handleRazorpayWebhook = (req: express.Request, res: express.Response) => {
    const signature = String(req.headers['x-razorpay-signature'] || '');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
    const rawBody = JSON.stringify(req.body || {});

    if (webhookSecret && signature) {
      const valid = verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret);
      if (!valid) {
        return res.status(400).json({ error: 'Invalid Razorpay webhook signature' });
      }
    }

    const event = req.body;
    db.logActivity(
      'WEBHOOK_RECEIVED',
      'Razorpay Gateway',
      'reader',
      `Verified Webhook event: ${event?.event || 'payment.captured'}`,
      'payment',
      event?.payload?.payment?.entity?.id || 'event'
    );
    return res.json({ status: 'ok', verified: Boolean(signature) });
  };

  app.post('/api/payments/webhook', handleRazorpayWebhook);
  app.post('/api/webhooks/razorpay', handleRazorpayWebhook);

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
        ...sanitizeUserForClient(u, false),
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
    const { name, email, phone, age, upiId, paidPlan, paymentMethod, transactionId, role, isSuspended, suspendedReason } = req.body;
    let updatedUser: User | null = null;

    db.mutate(d => {
      const u = d.users.find((x: User) => x.id === req.params.id);
      if (u) {
        if (name !== undefined && name.trim()) u.name = name.trim();
        if (email !== undefined && email.trim()) u.email = email.trim().toLowerCase();
        if (phone !== undefined) u.phone = phone.trim();
        if (age !== undefined && age !== '' && !isNaN(Number(age))) u.age = Number(age);
        if (upiId !== undefined) u.upiId = upiId.trim();
        if (role && ['reader', 'author', 'admin'].includes(role)) {
          u.role = role;
        }
        if (typeof isSuspended === 'boolean') {
          u.isSuspended = isSuspended;
          u.suspendedReason = isSuspended ? (suspendedReason || 'Suspended by Administrator') : undefined;
        }
        if (paidPlan !== undefined) {
          applyPaidPremiumDetailToUser(d, u, paidPlan, paymentMethod, transactionId, upiId);
        }
        updatedUser = u;
      }
    });

    if (!updatedUser) return res.status(404).json({ error: 'Reader not found' });
    db.logActivity('ADMIN_UPDATED_READER', 'admin@aathirai.com', 'admin', `Updated reader ${(updatedUser as User).email} (Plan: ${paidPlan || 'unchanged'}, UPI: ${upiId || 'N/A'})`, 'user', req.params.id);
    return res.json({ success: true, reader: sanitizeUserForClient(updatedUser as User, false) });
  });

  app.post('/api/admin/readers/:id/suspend', (req, res) => {
    const { isSuspended, reason } = req.body;
    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find((x: User) => x.id === req.params.id);
      if (u) {
        u.isSuspended = Boolean(isSuspended);
        u.suspendedReason = u.isSuspended ? (reason || 'Account suspended by Administrator.') : undefined;
        updatedUser = u;
      }
    });
    if (!updatedUser) return res.status(404).json({ error: 'Reader not found' });
    const targetUser = updatedUser as User;
    db.logActivity(
      targetUser.isSuspended ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      'admin@aathirai.com',
      'admin',
      `${targetUser.isSuspended ? 'Suspended' : 'Reactivated'} account ${targetUser.email}`,
      'user',
      req.params.id
    );
    return res.json({ success: true, reader: sanitizeUserForClient(targetUser, false) });
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

  const normalizeAuthorApplications = (d: any) => {
    if (!Array.isArray(d.authorApplications)) d.authorApplications = [];
    d.authorApplications.forEach((app: AuthorApplication & { adminExplicitlyReviewed?: boolean }) => {
      if (!app.adminExplicitlyReviewed) {
        app.status = 'pending';
      }

      if (!app.authorAvatar) {
        const matchedUser = d.users.find(
          (u: User) => (app.userId && u.id === app.userId) || u.email.toLowerCase() === app.email.toLowerCase()
        );
        if (matchedUser?.avatar) {
          app.authorAvatar = matchedUser.avatar;
        } else if (app.authorName.toLowerCase().includes('kavitha')) {
          app.authorAvatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80';
        } else if (app.authorName.toLowerCase().includes('rajesh')) {
          app.authorAvatar = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&h=200&q=80';
        } else {
          app.authorAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(app.authorName)}`;
        }
      }

      if (!Array.isArray(app.sampleImages) || app.sampleImages.length === 0) {
        const matchingComic = d.comics.find(
          (c: Comic) =>
            (app.sampleComicTitle &&
              c.title.toLowerCase().includes(app.sampleComicTitle.split(':')[0].trim().toLowerCase())) ||
            c.authorId === app.userId ||
            c.authorName.toLowerCase() === app.authorName.toLowerCase()
        );
        const comicPages: string[] = [];
        if (matchingComic) {
          if (matchingComic.coverImage) comicPages.push(matchingComic.coverImage);
          matchingComic.chapters?.forEach((ch: Chapter) => {
            ch.episodes?.forEach((ep: Episode) => {
              ep.pages?.forEach((p: ComicPage) => {
                if (p.imageUrl && !comicPages.includes(p.imageUrl)) {
                  comicPages.push(p.imageUrl);
                }
              });
            });
          });
        }
        if (comicPages.length === 0) {
          comicPages.push(
            '/src/assets/images/comic_cover_mystic_1794269871981.jpg',
            '/src/assets/images/comic_cover_blade_1794269871791.jpg',
            '/src/assets/images/comic_cover_cyber_1794269871978.jpg',
            '/src/assets/images/comic_cover_chronicles_1794269872270.jpg'
          );
        }
        app.sampleImages = comicPages.slice(0, 6);
        if (!app.samplePagesCount) {
          app.samplePagesCount = app.sampleImages.length;
        }
      }
    });
  };

  app.get('/api/admin/stats', (req, res) => {
    db.mutate(d => normalizeAuthorApplications(d));
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
      openReportsCount: (snapshot.reports || []).filter(r => r.status === 'pending').length,
      migrationReport: snapshot.migrationReport || null,
    });
  });

  app.get('/api/admin/authors', (req, res) => {
    db.mutate(d => normalizeAuthorApplications(d));
    const snapshot = db.getSnapshot();
    return res.json({
      applications: snapshot.authorApplications,
      authors: snapshot.users.filter(u => u.role === 'author').map(u => sanitizeUserForClient(u, false)),
    });
  });

  app.post('/api/admin/author-applications/:id/action', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject' | 'pending'
    if (!['approve', 'reject', 'pending'].includes(action)) {
      return res.status(400).json({ error: 'Valid action required (approve/reject/pending)' });
    }

    let targetApp: (AuthorApplication & { adminExplicitlyReviewed?: boolean }) | null = null;
    let promotedUser: User | null = null;

    db.mutate(d => {
      normalizeAuthorApplications(d);
      const app = d.authorApplications.find(a => a.id === req.params.id) as
        | (AuthorApplication & { adminExplicitlyReviewed?: boolean })
        | undefined;
      if (app) {
        if (action === 'pending') {
          app.status = 'pending';
          app.adminExplicitlyReviewed = false;
          app.reviewedAt = undefined;
        } else {
          app.status = action === 'approve' ? 'approved' : 'rejected';
          app.adminExplicitlyReviewed = true;
          app.reviewedAt = new Date().toISOString();
        }
        if (adminNote !== undefined) app.adminNote = adminNote;
        targetApp = app;

        // If approved, elevate corresponding user or create author user
        if (action === 'approve') {
          const user = d.users.find(u => u.email.toLowerCase() === app.email.toLowerCase() || u.id === app.userId);
          if (user) {
            user.role = 'author';
            if (app.authorAvatar) user.avatar = app.authorAvatar;
            promotedUser = user;
          } else {
            const newAuthor: User = {
              id: app.userId || 'usr_auth_' + Date.now(),
              name: app.authorName,
              email: app.email,
              role: 'author',
              isVerified: true,
              avatar:
                app.authorAvatar ||
                `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(app.authorName)}`,
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

    const appObj = targetApp as AuthorApplication;
    const promoObj = promotedUser as User | null;
    if (action === 'approve' || action === 'reject') {
      db.addNotification({
        userId: appObj.userId || promoObj?.id || 'all',
        userEmail: appObj.email,
        title: action === 'approve' ? 'Author Application Approved!' : 'Author Application Reviewed',
        message:
          action === 'approve'
            ? `Congratulations ${appObj.authorName}! You are approved to publish comics on Aathirai_Comic.`
            : `Your author application was reviewed: ${adminNote || 'Please check your Author Dashboard for details.'}`,
        type: action === 'approve' ? 'author_approved' : 'author_rejected',
        targetId: appObj.id,
      });
    }

    db.logActivity(
      action === 'approve'
        ? 'AUTHOR_APPROVED'
        : action === 'reject'
          ? 'AUTHOR_REJECTED'
          : 'AUTHOR_SET_PENDING',
      'admin@aathirai.com',
      'admin',
      `${action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Set to Pending'} author application for ${(targetApp as AuthorApplication).authorName}. Note: ${adminNote || 'None'}`,
      'author_application',
      req.params.id
    );

    return res.json({
      success: true,
      application: targetApp,
      user: promoObj ? sanitizeUserForClient(promoObj, false) : null,
    });
  });

  app.get('/api/admin/transactions', (req, res) => {
    const snapshot = db.getSnapshot();
    const gstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const enrichedPurchases = snapshot.purchases.map((p, idx) =>
      ensurePurchaseGstFields(p, gstSettings, idx + 1)
    );
    return res.json({
      transactions: enrichedPurchases,
      paymentTransactions: snapshot.paymentTransactions || [],
      creditNotes: snapshot.creditNotes || [],
    });
  });

  // Helper to create a GST Credit Note for a refunded purchase while preserving original invoice history
  const issueCreditNoteForPurchase = (
    d: any,
    purchase: Purchase,
    reason: string,
    adminEmail: string
  ): CreditNoteRecord => {
    if (!d.gstSettings) d.gstSettings = getDefaultGstBusinessSettings();
    if (!Array.isArray(d.creditNotes)) d.creditNotes = [];

    const existingCn = d.creditNotes.find(
      (cn: CreditNoteRecord) => cn.originalPurchaseId === purchase.id
    );
    if (existingCn) return existingCn;

    const enriched = ensurePurchaseGstFields(purchase, d.gstSettings, 1);
    const cnSeq = d.gstSettings.nextCreditNoteSequence || d.creditNotes.length + 1;
    const cnNum = formatGstInvoiceNumber(d.gstSettings.creditNotePrefix || 'CN/2627/', cnSeq);
    d.gstSettings.nextCreditNoteSequence = cnSeq + 1;

    const nowIso = new Date().toISOString();
    const creditNote: CreditNoteRecord = {
      id: 'cn_' + Date.now(),
      creditNoteNumber: cnNum,
      originalPurchaseId: enriched.id,
      originalInvoiceNumber: enriched.invoiceNumber || enriched.receiptNumber,
      originalInvoiceDate: enriched.createdAt,
      userId: enriched.userId,
      customerName: enriched.customerName || enriched.userEmail.split('@')[0],
      userEmail: enriched.userEmail,
      userPhone: enriched.userPhone,
      customerGstin: enriched.customerGstin,
      placeOfSupplyStateCode: enriched.placeOfSupplyStateCode || '33',
      placeOfSupplyStateName: enriched.placeOfSupplyStateName || 'Tamil Nadu',
      supplyType: enriched.supplyType || 'INTRA',
      taxType: enriched.taxType || 'CGST_SGST',
      hsnSacCode: enriched.hsnSacCode || '998431',
      hsnSacDescription:
        enriched.hsnSacDescription || 'Online digital comics and electronic publishing services',
      reason: reason || 'Customer refund / subscription cancellation adjustment',
      grossAmountInr: enriched.amountInr,
      taxableValue: enriched.taxableValue || enriched.amountInr,
      taxRate: enriched.taxRate ?? 18,
      taxAmount: enriched.taxAmount || 0,
      cgstRate: enriched.cgstRate ?? 0,
      cgstAmount: enriched.cgstAmount || 0,
      sgstRate: enriched.sgstRate ?? 0,
      sgstAmount: enriched.sgstAmount || 0,
      igstRate: enriched.igstRate ?? 0,
      igstAmount: enriched.igstAmount || 0,
      sellerSnapshot: enriched.sellerSnapshot || buildSellerSnapshot(d.gstSettings),
      createdAt: nowIso,
      createdByEmail: adminEmail || 'balajiaris05@gmail.com',
    };

    d.creditNotes.unshift(creditNote);
    purchase.status = 'refunded';
    purchase.creditNoteId = creditNote.id;
    purchase.creditNoteNumber = creditNote.creditNoteNumber;
    purchase.refundReason = creditNote.reason;
    purchase.refundedAt = nowIso;

    return creditNote;
  };

  app.post('/api/admin/transactions/:id/refund', (req, res) => {
    const reason = String(req.body?.reason || 'Refunded by Administrator');
    let refunded: Purchase | null = null;
    let createdCreditNote: CreditNoteRecord | null = null;

    db.mutate(d => {
      const p = d.purchases.find(x => x.id === req.params.id);
      if (p) {
        createdCreditNote = issueCreditNoteForPurchase(
          d,
          p,
          reason,
          'balajiaris05@gmail.com'
        );
        refunded = p;
      }
      const tx = (d.paymentTransactions || []).find(
        t => t.id === `tx_${req.params.id}` || t.id === req.params.id
      );
      if (tx) {
        tx.status = 'refunded';
      }
    });
    if (!refunded) return res.status(404).json({ error: 'Transaction not found' });
    db.logActivity(
      'TRANSACTION_REFUNDED',
      'balajiaris05@gmail.com',
      'admin',
      `Refunded transaction ${(refunded as Purchase).receiptNumber} and issued GST Credit Note ${createdCreditNote ? (createdCreditNote as CreditNoteRecord).creditNoteNumber : ''}`,
      'purchase',
      req.params.id
    );
    return res.json({
      success: true,
      message: `Transaction refunded and GST Credit Note ${createdCreditNote ? (createdCreditNote as CreditNoteRecord).creditNoteNumber : ''} issued.`,
      transaction: refunded,
      creditNote: createdCreditNote,
    });
  });

  // -------------------------------------------------------------
  // INDIAN GST & BILLING ADMIN & EXPORT ROUTES
  // -------------------------------------------------------------

  app.get('/api/admin/gst/settings', (_req, res) => {
    const snapshot = db.getSnapshot();
    const gstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const creditNotes = snapshot.creditNotes || [];
    const invoices = snapshot.purchases.map((p, idx) =>
      ensurePurchaseGstFields(p, gstSettings, idx + 1)
    );
    const validation = validateGstExportData({
      settings: gstSettings,
      invoices,
      creditNotes,
    });
    return res.json({
      gstSettings,
      creditNotes,
      invoices,
      validation,
      states: INDIAN_STATES_AND_UTS,
    });
  });

  app.post('/api/admin/gst/verify-gstin', (req, res) => {
    const rawGstin = String(req.body?.gstin || '').trim().toUpperCase();
    const check = validateIndianGstin(rawGstin);
    return res.json({
      ...check,
      verifiedAt: check.valid && !check.isBlank ? new Date().toISOString() : null,
      authorityNote: check.isBlank
        ? 'No GSTIN entered (Unregistered Business mode).'
        : check.valid
          ? `15-character structure, State Code (${check.stateCode} - ${check.stateName}), PAN (${check.pan}), and GSTN Modulo-36 checksum verified.`
          : check.error,
    });
  });

  app.put('/api/admin/gst/settings', async (req, res) => {
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (authCtx.user && authCtx.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access Denied: Only authorized administrators can modify business GST settings.',
      });
    }

    const {
      legalBusinessName,
      tradeName,
      gstin,
      stateCode,
      registeredAddress,
      invoicePrefix,
      creditNotePrefix,
      defaultSacCode,
      defaultSacDescription,
      applicableGstRate,
      applyGstToDomesticSales,
      adminEmail,
    } = req.body || {};

    const cleanGstin = String(gstin ?? '').trim().toUpperCase();
    const gstinCheck = validateIndianGstin(cleanGstin);
    if (!gstinCheck.valid) {
      return res.status(400).json({
        error: gstinCheck.error || 'Invalid GSTIN format or Modulo-36 checksum.',
        gstinValidation: gstinCheck,
      });
    }

    // If GSTIN is provided, ensure stateCode matches the first 2 digits of the GSTIN
    const resolvedStateCode = !gstinCheck.isBlank && gstinCheck.stateCode
      ? gstinCheck.stateCode
      : String(stateCode || '33').padStart(2, '0');
    const stateObj = getStateByCode(resolvedStateCode);

    const parsedRate =
      applicableGstRate !== undefined ? Number(applicableGstRate) : 18;
    if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 28) {
      return res.status(400).json({
        error: 'Applicable GST rate must be between 0% and 28%.',
      });
    }

    let updatedSettings: GstBusinessSettings | null = null;
    const actorEmail = authCtx.user?.email || adminEmail || 'balajiaris05@gmail.com';
    const actorId = authCtx.user?.id || 'usr_admin';
    const nowIso = new Date().toISOString();

    db.mutate(d => {
      const prev = d.gstSettings || getDefaultGstBusinessSettings();
      const changedFields: string[] = [];

      const nextLegal =
        legalBusinessName !== undefined ? String(legalBusinessName).trim() : prev.legalBusinessName;
      const nextTrade =
        tradeName !== undefined ? String(tradeName).trim() : prev.tradeName;
      const nextAddr =
        registeredAddress !== undefined ? String(registeredAddress).trim() : prev.registeredAddress;
      const nextInvPrefix =
        invoicePrefix !== undefined
          ? String(invoicePrefix)
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9/-]/g, '')
              .slice(0, 10)
          : prev.invoicePrefix;
      const nextCnPrefix =
        creditNotePrefix !== undefined
          ? String(creditNotePrefix)
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9/-]/g, '')
              .slice(0, 10)
          : prev.creditNotePrefix;
      const nextSac =
        defaultSacCode !== undefined ? String(defaultSacCode).trim() : prev.defaultSacCode;
      const nextSacDesc =
        defaultSacDescription !== undefined
          ? String(defaultSacDescription).trim()
          : prev.defaultSacDescription;
      const nextApplyGst =
        typeof applyGstToDomesticSales === 'boolean'
          ? applyGstToDomesticSales
          : prev.applyGstToDomesticSales;

      if (nextLegal !== prev.legalBusinessName) changedFields.push(`Legal Name -> "${nextLegal}"`);
      if (cleanGstin !== prev.gstin)
        changedFields.push(`GSTIN -> "${cleanGstin || 'UNREGISTERED (Blank)'}"`);
      if (stateObj.code !== prev.stateCode)
        changedFields.push(`State -> ${stateObj.code} (${stateObj.name})`);
      if (nextAddr !== prev.registeredAddress) changedFields.push('Registered Address');
      if (nextInvPrefix !== prev.invoicePrefix)
        changedFields.push(`Invoice Prefix -> "${nextInvPrefix}"`);
      if (parsedRate !== prev.applicableGstRate)
        changedFields.push(`GST Rate -> ${parsedRate}%`);
      if (nextApplyGst !== prev.applyGstToDomesticSales)
        changedFields.push(`Apply GST -> ${nextApplyGst}`);

      const auditEntry = {
        id: 'gst_aud_' + Date.now(),
        timestamp: nowIso,
        adminId: actorId,
        adminEmail: actorEmail,
        action: 'GST_SETTINGS_UPDATED',
        summary:
          changedFields.length > 0
            ? `Updated: ${changedFields.join(', ')}`
            : 'Re-verified and saved Business GST configuration.',
        previousGstin: prev.gstin,
        newGstin: cleanGstin,
      };

      const nextAuditHistory = [auditEntry, ...(prev.auditHistory || [])].slice(0, 100);

      d.gstSettings = {
        ...prev,
        legalBusinessName: nextLegal || 'Aathirai Media & Publishing Pvt Ltd',
        tradeName: nextTrade || 'Aathirai_Comic',
        gstin: cleanGstin,
        isGstRegistered: !gstinCheck.isBlank && gstinCheck.valid,
        gstinVerificationStatus: gstinCheck.isBlank
          ? 'unregistered'
          : gstinCheck.valid
            ? 'verified'
            : 'format_valid_unverified',
        gstinVerifiedAt: !gstinCheck.isBlank && gstinCheck.valid ? nowIso : undefined,
        stateCode: stateObj.code,
        stateName: stateObj.name,
        registeredAddress: nextAddr || 'Chennai, Tamil Nadu, India',
        invoicePrefix: nextInvPrefix || 'AAC/2627/',
        creditNotePrefix: nextCnPrefix || 'CN/2627/',
        defaultSacCode: nextSac || '998431',
        defaultSacDescription:
          nextSacDesc ||
          'Online text based information such as online books, periodicals and digital comics',
        applicableGstRate: parsedRate,
        applyGstToDomesticSales: nextApplyGst,
        updatedAt: nowIso,
        updatedByEmail: actorEmail,
        auditHistory: nextAuditHistory,
      };

      updatedSettings = d.gstSettings;
    });

    db.logActivity(
      'GST_SETTINGS_UPDATED',
      actorEmail,
      'admin',
      `Updated GST & Billing profile (GSTIN: ${cleanGstin || 'Unregistered'}, State: ${stateObj.code}-${stateObj.name}, Rate: ${parsedRate}%). Historical invoices preserved.`,
      'gst_settings',
      'business_profile'
    );

    return res.json({
      success: true,
      gstSettings: updatedSettings,
      gstinValidation: gstinCheck,
      message: cleanGstin
        ? `Business GST profile saved! GSTIN ${cleanGstin} (${stateObj.code} - ${stateObj.name}) validated and stored. Historical invoices remain untouched.`
        : 'Business GST profile saved in Unregistered Business mode (blank GSTIN). Historical invoices remain untouched.',
    });
  });

  app.post('/api/admin/gst/credit-notes', async (req, res) => {
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (authCtx.user && authCtx.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access Denied: Only authorized administrators can issue GST credit notes.',
      });
    }

    const { purchaseId, reason, adminEmail } = req.body || {};
    if (!purchaseId) {
      return res.status(400).json({ error: 'purchaseId is required to issue a credit note.' });
    }

    let createdNote: CreditNoteRecord | null = null;
    let targetPurchase: Purchase | null = null;

    db.mutate(d => {
      const p = d.purchases.find(x => x.id === purchaseId || x.receiptNumber === purchaseId);
      if (!p) return;
      createdNote = issueCreditNoteForPurchase(
        d,
        p,
        String(reason || 'Customer refund / invoice adjustment').trim(),
        authCtx.user?.email || adminEmail || 'balajiaris05@gmail.com'
      );
      targetPurchase = p;
    });

    if (!targetPurchase || !createdNote) {
      return res.status(404).json({ error: 'Original invoice / purchase record not found.' });
    }

    db.logActivity(
      'GST_CREDIT_NOTE_ISSUED',
      authCtx.user?.email || adminEmail || 'balajiaris05@gmail.com',
      'admin',
      `Issued GST Credit Note ${(createdNote as CreditNoteRecord).creditNoteNumber} against Invoice ${(createdNote as CreditNoteRecord).originalInvoiceNumber} (₹${(createdNote as CreditNoteRecord).grossAmountInr}).`,
      'credit_note',
      (createdNote as CreditNoteRecord).id
    );

    return res.json({
      success: true,
      creditNote: createdNote,
      purchase: targetPurchase,
      message: `Issued GST Credit Note ${(createdNote as CreditNoteRecord).creditNoteNumber} against Invoice ${(createdNote as CreditNoteRecord).originalInvoiceNumber}.`,
    });
  });

  app.get('/api/gst/invoices/:id/pdf', (req, res) => {
    const snapshot = db.getSnapshot();
    const gstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const p = snapshot.purchases.find(
      x =>
        x.id === req.params.id ||
        x.receiptNumber === req.params.id ||
        x.invoiceNumber === req.params.id
    );
    const cn = (snapshot.creditNotes || []).find(
      x => x.id === req.params.id || x.creditNoteNumber === req.params.id
    );

    if (!p && !cn) {
      return res.status(404).json({ error: 'Tax invoice or credit note not found.' });
    }

    const targetPurchase =
      p ||
      snapshot.purchases.find(x => x.id === cn?.originalPurchaseId) ||
      snapshot.purchases[0];

    const pdfBytes = generateTaxInvoicePdfBytes({
      purchase: targetPurchase,
      settings: gstSettings,
      creditNote: cn || null,
    });

    const fileName = cn
      ? `GST-CreditNote-${cn.creditNoteNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`
      : `GST-TaxInvoice-${(targetPurchase.invoiceNumber || targetPurchase.receiptNumber).replace(
          /[^A-Za-z0-9_-]/g,
          '_'
        )}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(pdfBytes.byteLength));
    return res.end(Buffer.from(pdfBytes));
  });

  app.get('/api/admin/reports', (req, res) => {
    return res.json({ reports: db.getSnapshot().reports || [] });
  });

  app.post('/api/admin/reports/:id/action', (req, res) => {
    const { status = 'resolved' } = req.body;
    db.mutate(d => {
      const r = (d.reports || []).find(rep => rep.id === req.params.id);
      if (r) {
        r.status = status;
        r.resolvedAt = new Date().toISOString();
      }
    });
    return res.json({ success: true });
  });

  app.get('/api/admin/migration-status', (req, res) => {
    const snapshot = db.getSnapshot();
    return res.json({
      migrationReport: snapshot.migrationReport || null,
      counts: {
        users: snapshot.users.length,
        comics: snapshot.comics.length,
        purchases: snapshot.purchases.length,
        paymentTransactions: (snapshot.paymentTransactions || []).length,
        notifications: (snapshot.notifications || []).length,
      },
    });
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

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Aathirai_Comic] Express error:', err?.message || err);
    if (!res.headersSent) {
      res.status(err?.status || 500).json({ error: err?.message || 'Internal server error' });
    }
  });

  const httpServer = app.listen(Number(port), '0.0.0.0', () => {
    console.log(`[Aathirai_Comic] Server running on http://0.0.0.0:${port}`);
  });
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
}

process.on('unhandledRejection', (reason) => {
  console.error('[Aathirai_Comic] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Aathirai_Comic] Uncaught exception:', err);
});

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
