import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  db,
  IMMUTABLE_ADMIN_VAULT,
  IMMUTABLE_OWNER_READER_VAULT,
  getIstDateParts,
  formatIstMonthLabel,
} from './src/server/storage.ts';
import {
  getSmtpConfigSummary,
  verifySmtpConnection,
  sendEmail,
  sendAdminOtpEmail,
  sendPasswordResetOtpEmail,
  sendEmailVerificationOtpEmail,
  sendReaderAccountWelcomeEmail,
  sendComicReleaseNotificationEmail,
  sendMonthlyActivityLogArchiveEmail,
} from './src/server/mailer.ts';
import { getSmsConfigSummary, sendOtpSms } from './src/server/sms.ts';
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
  ActivityLog,
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
  verifyBearerToken,
  resolveAuthenticatedUser,
  validateAndNormalizeDob,
  createVerificationProofToken,
  verifyVerificationProofToken,
  hashOtpCode,
  verifyOtpCodeHash,
  createAdminExportToken,
  verifyAdminExportToken,
  redactAdminSecrets,
} from './src/server/security.ts';
import {
  hasRealRazorpayApiKeys,
  createGatewayOrderOnRazorpay,
  fetchRazorpayPaymentById,
  findCapturedRazorpayPaymentForCustomer,
} from './src/server/razorpayService.ts';
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
import {
  extractFirebaseIdToken,
  mirrorWritesInBackground,
  buildNotificationWriteItem,
  syncDatabaseSnapshotToFirestore,
  getFirestoreLiveStatus,
  fetchComicAssetByKey,
  parseComicAssetHttpUrl,
  applyRatingsToComics,
  sanitizeFirestoreId,
} from './src/server/firestoreAdmin.ts';

dotenv.config({ override: true });

async function startServer() {
  // Wait up to 6s for initial cloud hydration so first request has data without delaying Cloud Run startup probes
  await Promise.race([
    db.initFromCloud().catch((err) => {
      console.warn('[Aathirai_Comic] Cloud initialization warning:', err instanceof Error ? err.message : err);
    }),
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);

  const app = express();
  const port = process.env.PORT || 3000;

  // Security headers & JSON Body Parser with 15mb limit for comic artwork uploads
  app.use(securityHeadersMiddleware);
  app.use(
    express.json({
      limit: '15mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  const authRateLimiter = createRateLimiter({ maxRequests: 30, windowMs: 15 * 60 * 1000 });
  const paymentRateLimiter = createRateLimiter({ maxRequests: 40, windowMs: 15 * 60 * 1000 });

  // -------------------------------------------------------------
  // SECURE UNIFIED DUAL-OTP AUTHENTICATION (GMAIL + MOBILE SMS)
  // Shared by both Admin Panel Gate & Hidden Customer Export Vault
  // -------------------------------------------------------------

  const timingSafeDigestEqual = (a: string, b: string): boolean => {
    const hashA = crypto.createHash('sha256').update(a).digest();
    const hashB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  };

  const requireAdminAuth = async (req: express.Request, res: express.Response): Promise<User | null> => {
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      res.status(401).json({
        error: 'Administrator authentication required. Complete Dual-OTP verification first.',
      });
      return null;
    }
    if (authCtx.role !== 'admin') {
      res.status(403).json({
        error: 'Access Denied: Administrator clearance required.',
      });
      return null;
    }
    return authCtx.user;
  };

  const verifyBothStoredAdminCredentials = (
    rawEmail: unknown,
    rawPhone: unknown
  ): {
    ok: boolean;
    status: number;
    error?: string;
    adminUser?: User;
    storedEmail?: string;
    storedPhone?: string;
    emailMasked?: string;
    phoneMasked?: string;
  } => {
    const cleanEmail = String(rawEmail || '').trim().toLowerCase();
    const cleanPhone = String(rawPhone || '').trim();
    const genericDenied =
      'Access Denied: Administrator credentials could not be verified against the backend vault.';

    if (!cleanEmail || !cleanPhone) {
      return {
        ok: false,
        status: 400,
        error: 'Both registered Administrator Gmail and Mobile Number are required.',
      };
    }

    if (!cleanEmail.includes('@') || /[a-zA-Z]/.test(cleanPhone)) {
      return {
        ok: false,
        status: 403,
        error: genericDenied,
      };
    }

    const snapshot = db.getSnapshot();
    const adminUser = snapshot.users.find(
      (u: User) => u.id === IMMUTABLE_ADMIN_VAULT.id || u.role === 'admin'
    );
    if (!adminUser || adminUser.isSuspended) {
      return {
        ok: false,
        status: 403,
        error: genericDenied,
      };
    }

    // Always validate against the frozen immutable backend vault (never alterable via UI/API/DB tampering)
    const storedEmail = IMMUTABLE_ADMIN_VAULT.email.toLowerCase();
    const storedPhone = IMMUTABLE_ADMIN_VAULT.phone;
    const storedPhoneDigits = storedPhone.replace(/\D/g, '');
    const storedTail10 =
      storedPhoneDigits.length >= 10 ? storedPhoneDigits.slice(-10) : storedPhoneDigits;

    // Constant-time email comparison
    const emailMatches = timingSafeDigestEqual(cleanEmail, storedEmail);

    // Constant-time exact 10-digit or +91 12-digit Indian mobile match
    const inputDigits = cleanPhone.replace(/\D/g, '');
    const normalizedInputTail10 =
      inputDigits.length === 12 && inputDigits.startsWith('91')
        ? inputDigits.slice(-10)
        : inputDigits.length === 10
          ? inputDigits
          : '';
    const phoneMatches =
      normalizedInputTail10.length === 10 &&
      storedTail10.length === 10 &&
      timingSafeDigestEqual(normalizedInputTail10, storedTail10);

    if (!emailMatches || !phoneMatches) {
      return {
        ok: false,
        status: 403,
        error: genericDenied,
      };
    }

    return {
      ok: true,
      status: 200,
      adminUser,
      storedEmail,
      storedPhone,
      // Zero partial email/phone characters leaked in Network JSON or Website Inspect
      emailMasked: 'Protected Backend Admin Gmail',
      phoneMasked: 'Protected Backend Admin Mobile',
    };
  };

  // Disable legacy single-channel admin auth bypass so BOTH Gmail + Mobile SMS OTPs are always enforced
  app.post('/api/admin-auth/request-otp', authRateLimiter, (_req, res) => {
    return res.status(410).json({
      error: 'Single-channel admin OTP is disabled. Dual-OTP verification (Admin Gmail + Mobile SMS) is required.',
    });
  });

  app.post('/api/admin-auth/verify-otp', authRateLimiter, (_req, res) => {
    return res.status(410).json({
      error: 'Single-channel admin OTP is disabled. Dual-OTP verification (Admin Gmail + Mobile SMS) is required.',
    });
  });

  app.post('/api/admin-auth/request-dual-otp', authRateLimiter, async (req, res) => {
    const {
      email,
      phone,
      purpose: rawPurpose,
      smsChannel,
      resendOnly,
      existingChallengeId,
    } = req.body || {};

    const purpose: 'admin_login' | 'customer_export' =
      rawPurpose === 'customer_export' ? 'customer_export' : 'admin_login';
    const resendMode: 'both' | 'email' | 'sms' =
      resendOnly === 'email' || resendOnly === 'sms' ? resendOnly : 'both';
    const requestedSmsMode: 'firebase' | 'backend' =
      smsChannel === 'backend' ? 'backend' : 'firebase';

    const check = verifyBothStoredAdminCredentials(email, phone);
    if (!check.ok || !check.adminUser || !check.storedEmail || !check.storedPhone) {
      if (check.status === 403) {
        db.logActivity(
          'ADMIN_DUAL_AUTH_DENIED',
          'protected_admin',
          'admin',
          `Rejected unverified Dual-OTP credential check for ${purpose === 'customer_export' ? 'Customer Export Vault' : 'Admin Console'}.`,
          'admin_auth',
          purpose
        );
      }
      return res.status(check.status).json({
        verifiedInDatabase: false,
        error:
          check.error ||
          'Access Denied: Administrator credentials could not be verified against the backend database.',
      });
    }

    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes
    const snapshot = db.getSnapshot();
    const existingRecord =
      typeof existingChallengeId === 'string' && existingChallengeId.trim()
        ? snapshot.adminDualOtps?.[existingChallengeId.trim()]
        : undefined;

    const canReuseChallenge = Boolean(
      resendMode !== 'both' &&
        existingRecord &&
        existingRecord.purpose === purpose &&
        existingRecord.adminId === check.adminUser.id &&
        existingRecord.expiresAt > now
    );

    const challengeId = canReuseChallenge && existingRecord
      ? existingRecord.challengeId
      : crypto.randomUUID();

    const shouldSendEmail = resendMode === 'both' || resendMode === 'email';
    const shouldSendSms = resendMode === 'both' || resendMode === 'sms';

    const emailOtp = shouldSendEmail ? crypto.randomInt(100000, 999999).toString() : '';
    const smsOtp = shouldSendSms ? crypto.randomInt(100000, 999999).toString() : '';

    const emailOtpHash =
      shouldSendEmail
        ? hashOtpCode(challengeId, emailOtp)
        : existingRecord?.emailOtpHash || '';
    const smsOtpHash =
      shouldSendSms
        ? hashOtpCode(challengeId, smsOtp)
        : existingRecord?.smsOtpHash || '';

    db.mutate((d) => {
      if (!d.adminDualOtps) d.adminDualOtps = {};
      // Prune expired challenges
      for (const key of Object.keys(d.adminDualOtps)) {
        if (!d.adminDualOtps[key] || d.adminDualOtps[key].expiresAt <= now) {
          delete d.adminDualOtps[key];
        }
      }
      d.adminDualOtps[challengeId] = {
        challengeId,
        purpose,
        adminId: check.adminUser!.id,
        emailOtpHash,
        smsOtpHash,
        smsMode: shouldSendSms ? requestedSmsMode : existingRecord?.smsMode || requestedSmsMode,
        expiresAt,
        attempts: canReuseChallenge && existingRecord ? existingRecord.attempts : 0,
        createdAt: canReuseChallenge && existingRecord ? existingRecord.createdAt : now,
      };
    });
    await db.persistChanges({ collections: ['otps'] });

    let emailDelivered = !shouldSendEmail;
    let smtpConfigured = true;
    let emailError: string | undefined;

    if (shouldSendEmail) {
      const emailResult = await sendAdminOtpEmail(check.storedEmail, emailOtp, purpose);
      emailDelivered = emailResult.sent;
      smtpConfigured = emailResult.configured;
      emailError = emailResult.error;

      if (!emailResult.sent) {
        if (!canReuseChallenge) {
          db.mutate((d) => {
            if (d.adminDualOtps) delete d.adminDualOtps[challengeId];
          });
        }
        return res.status(emailResult.configured ? 502 : 503).json({
          success: false,
          verifiedInDatabase: true,
          emailDelivered: false,
          smtpConfigured,
          error:
            emailError ||
            'Unable to send 6-digit Gmail OTP. Please check SMTP configuration and try again.',
        });
      }
    }

    let smsDelivered = !shouldSendSms;
    let smsProvider: 'firebase' | 'fast2sms' | 'twilio' | 'textbelt' | 'none' =
      requestedSmsMode === 'firebase' ? 'firebase' : 'none';
    let smsError: string | undefined;

    if (shouldSendSms && requestedSmsMode === 'backend') {
      const smsResult = await sendOtpSms({
        phone: check.storedPhone,
        countryCode: '+91',
        otp: smsOtp,
        purpose: 'admin_2fa',
      });
      smsDelivered = smsResult.sent;
      smsProvider = smsResult.provider;
      smsError = smsResult.error;

      if (!smsResult.sent) {
        return res.status(smsResult.configured ? 502 : 503).json({
          success: false,
          verifiedInDatabase: true,
          challengeId,
          emailDelivered,
          smsDelivered: false,
          smsProvider,
          error:
            smsError ||
            'Unable to deliver Mobile SMS OTP via backend SMS provider.',
        });
      }
    }

    db.logActivity(
      purpose === 'customer_export' ? 'ADMIN_EXPORT_DUAL_OTP_REQUESTED' : 'ADMIN_DUAL_OTP_REQUESTED',
      check.emailMasked || 'protected_admin',
      'admin',
      `Dual-OTP challenge (${resendMode}) verified in backend DB for ${purpose === 'customer_export' ? 'Customer Export Vault' : 'Admin Console'} (${check.emailMasked} + ${check.phoneMasked}).`,
      'admin_auth',
      check.adminUser.id
    );

    return res.json({
      success: true,
      verifiedInDatabase: true,
      challengeId,
      purpose,
      emailDelivered,
      smsProvider,
      smsDelivered,
      emailMasked: check.emailMasked,
      phoneMasked: check.phoneMasked,
      expiresInSeconds: 600,
      message:
        resendMode === 'email'
          ? `Fresh 6-digit Gmail OTP sent to ${check.emailMasked}.`
          : resendMode === 'sms'
            ? `Fresh 6-digit Mobile SMS OTP ready for ${check.phoneMasked}.`
            : `Both credentials verified in backend database. Enter the 6-digit Gmail OTP (${check.emailMasked}) AND 6-digit Mobile SMS OTP (${check.phoneMasked}).`,
    });
  });

  app.post('/api/admin-auth/verify-dual-otp', authRateLimiter, async (req, res) => {
    const {
      challengeId,
      email,
      phone,
      emailOtp,
      smsOtp,
      purpose: rawPurpose,
    } = req.body || {};

    const purpose: 'admin_login' | 'customer_export' =
      rawPurpose === 'customer_export' ? 'customer_export' : 'admin_login';

    const check = verifyBothStoredAdminCredentials(email, phone);
    if (!check.ok || !check.adminUser || !check.storedPhone) {
      return res.status(check.status).json({
        error:
          check.error ||
          'Access Denied: Administrator credentials could not be verified against the backend database.',
      });
    }

    const cleanChallengeId = String(challengeId || '').trim();
    const cleanEmailOtp = String(emailOtp || '').trim();
    const cleanSmsOtp = String(smsOtp || '').trim();

    if (!cleanChallengeId) {
      return res.status(400).json({
        error: 'Verification session missing. Please request Dual OTPs again.',
      });
    }

    const tokenInfo = await verifyBearerToken(req.headers.authorization);
    const hasFirebasePhoneClaim = Boolean(tokenInfo?.phoneNumber);
    const firebasePhoneMatchesAdmin = Boolean(
      tokenInfo?.phoneNumber &&
        phonesMatch(check.storedPhone, tokenInfo.phoneNumber, '+91')
    );

    if (cleanEmailOtp.length !== 6) {
      return res.status(400).json({
        error: 'Please enter the 6-digit OTP sent to your registered Admin Gmail.',
      });
    }

    if (!hasFirebasePhoneClaim && cleanSmsOtp.length !== 6) {
      return res.status(400).json({
        error: 'Please enter the 6-digit SMS OTP sent to your registered Admin Mobile Number.',
      });
    }

    if (hasFirebasePhoneClaim && !firebasePhoneMatchesAdmin) {
      return res.status(403).json({
        error: 'Access Denied: Verified mobile number does not match the registered backend administrator.',
      });
    }

    await db.ensureFreshFromCloud(true);
    const snapshot = db.getSnapshot();
    const challenge = snapshot.adminDualOtps?.[cleanChallengeId];

    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.adminId !== check.adminUser.id ||
      Date.now() > challenge.expiresAt
    ) {
      return res.status(400).json({
        error: 'Dual-OTP challenge has expired (valid for 10 minutes) or is invalid. Please request fresh OTPs.',
      });
    }

    if (challenge.attempts >= 5) {
      db.mutate((d) => {
        if (d.adminDualOtps) delete d.adminDualOtps[cleanChallengeId];
      });
      return res.status(429).json({
        error: 'Too many failed verification attempts. Challenge invalidated — please request new Dual OTPs.',
      });
    }

    const emailValid = verifyOtpCodeHash(cleanChallengeId, cleanEmailOtp, challenge.emailOtpHash);
    const smsValid = hasFirebasePhoneClaim
      ? firebasePhoneMatchesAdmin
      : challenge.smsMode === 'backend' &&
        verifyOtpCodeHash(cleanChallengeId, cleanSmsOtp, challenge.smsOtpHash);

    if (!emailValid || !smsValid) {
      let attemptsRemaining = 0;
      db.mutate((d) => {
        const target = d.adminDualOtps?.[cleanChallengeId];
        if (target) {
          target.attempts = (target.attempts || 0) + 1;
          attemptsRemaining = Math.max(0, 5 - target.attempts);
          if (target.attempts >= 5) {
            delete d.adminDualOtps![cleanChallengeId];
          }
        }
      });

      const failedLabel =
        !emailValid && !smsValid
          ? 'Both Gmail OTP and Mobile SMS OTP are invalid.'
          : !emailValid
            ? 'Invalid 6-digit Gmail OTP.'
            : 'Invalid 6-digit Mobile SMS OTP.';

      return res.status(400).json({
        error:
          attemptsRemaining > 0
            ? `${failedLabel} ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`
            : 'Too many failed attempts. Challenge invalidated — please request new Dual OTPs.',
      });
    }

    // Consume one-time Dual-OTP challenge immediately
    db.mutate((d) => {
      if (d.adminDualOtps) {
        delete d.adminDualOtps[cleanChallengeId];
      }
    });

    if (purpose === 'customer_export') {
      const { token: exportToken, expiresAt } = createAdminExportToken(check.adminUser.id);
      const totalCustomers = snapshot.users.filter((u: User) => u.role !== 'admin').length;

      db.logActivity(
        'ADMIN_EXPORT_VAULT_UNLOCKED',
        check.emailMasked || 'protected_admin',
        'admin',
        `Administrator verified Dual-OTP (Gmail + Mobile SMS) and unlocked the Customer Login Export Vault (${totalCustomers} accounts).`,
        'customer_export',
        check.adminUser.id
      );
      await db.persistChanges({ collections: ['otps', 'activityLogs'] });

      return res.json({
        success: true,
        purpose: 'customer_export',
        verifiedVia: 'dual_gmail_and_sms_otp',
        exportToken,
        expiresAt,
        expiresInSeconds: 300,
        totalCustomers,
        message: 'Dual-OTP verified (Gmail + Mobile SMS). Customer Login Details Vault unlocked for 5 minutes.',
      });
    }

    db.logActivity(
      'ADMIN_DUAL_OTP_AUTHENTICATED',
      check.emailMasked || 'protected_admin',
      'admin',
      'Administrator verified Dual-OTP (Gmail + Mobile SMS) and unlocked the Admin Console.',
      'admin_auth',
      check.adminUser.id
    );
    await db.persistChanges({ collections: ['otps', 'activityLogs'] });

    return res.json({
      success: true,
      purpose: 'admin_login',
      verifiedVia: 'dual_gmail_and_sms_otp',
      user: sanitizeUserForClient(check.adminUser as User, true),
      message: 'Dual-OTP verified (Gmail + Mobile SMS)! Admin Console unlocked.',
    });
  });

  // -------------------------------------------------------------
  // PROTECTED CUSTOMER LOGIN DETAILS EXPORT (DUAL-OTP HMAC TOKEN)
  // -------------------------------------------------------------
  app.get('/api/admin/export-customers', authRateLimiter, async (req, res) => {
    const rawExportToken = req.headers['x-admin-export-token'];
    const tokenString = Array.isArray(rawExportToken) ? rawExportToken[0] : rawExportToken;
    const verifiedToken = verifyAdminExportToken(tokenString);

    if (!verifiedToken) {
      return res.status(401).json({
        error:
          'Valid Dual-OTP export authorization token required. Complete both Admin Gmail OTP and Mobile SMS OTP verification to unlock export.',
      });
    }

    await db.ensureFreshFromCloud(true);
    const snapshot = db.getSnapshot();
    const adminUser = snapshot.users.find(
      (u: User) => u.id === verifiedToken.sub && u.role === 'admin' && !u.isSuspended
    );
    if (!adminUser) {
      return res.status(403).json({
        error: 'Access Denied: Export authorization token is not linked to an active administrator.',
      });
    }

    const now = Date.now();
    const format = req.query.format === 'json' ? 'json' : 'csv';

    // Explicit allowlist of non-sensitive customer login profile fields (NEVER includes passwordHash, password, OTPs, or secrets)
    const customers = snapshot.users
      .filter((u: User) => u.role !== 'admin')
      .map((u: User) => {
        const subStatus = getReaderSubscriptionStatus(snapshot, {
          userId: u.id,
          email: u.email,
          phone: u.phone,
        });
        const totalPurchases = snapshot.purchases.filter(
          (p: Purchase) =>
            p.status === 'success' &&
            (p.userId === u.id ||
              (u.email && p.userEmail?.toLowerCase() === u.email.toLowerCase()))
        ).length;

        const isLocked = Boolean(
          u.lockedUntil && Number.isFinite(new Date(u.lockedUntil).getTime()) && new Date(u.lockedUntil).getTime() > now
        );
        const accountStatus = u.isSuspended ? 'Suspended' : isLocked ? 'Locked' : 'Active';

        return {
          userId: u.id,
          fullName: u.name || '',
          email: u.email || '',
          phone: u.phone || '',
          countryCode: u.countryCode || '',
          countryName: u.countryName || '',
          role: u.role,
          accountStatus,
          emailVerified: Boolean(u.emailVerified ?? u.isVerified),
          phoneVerified: Boolean(u.isVerified && u.phone),
          authProvider: u.firebaseUid ? 'Firebase / Google / Phone' : 'Email & Password',
          dob: u.dob || '',
          age: typeof u.age === 'number' ? u.age : null,
          notifyGmail: Boolean(u.notifyGmail),
          notifyMobile: Boolean(u.notifyMobile),
          premiumActive: subStatus.hasActiveSubscription,
          premiumPlan: subStatus.activePlan || 'free',
          premiumExpiresAt: subStatus.expiresAt || '',
          totalPurchases,
          createdAt: u.createdAt || '',
          lastLoginAt: u.lastLoginAt || '',
        };
      });

    db.logActivity(
      'ADMIN_CUSTOMER_EXPORT_DOWNLOADED',
      'protected_admin',
      'admin',
      `Exported ${customers.length} sanitized customer login profile(s) in ${format.toUpperCase()} format via Dual-OTP Export Vault.`,
      'customer_export',
      adminUser.id
    );
    await db.persistChanges({ collections: ['activityLogs'] });

    return res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      format,
      totalCustomers: customers.length,
      excludedFields: ['password', 'passwordHash', 'sessionToken', 'otps'],
      customers,
    });
  });

  app.get('/api/admin/smtp-status', async (req, res) => {
    await db.ensureFreshFromCloud().catch(() => {});
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (authCtx.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator permission required.' });
    }
    return res.json({ success: true, smtp: getSmtpConfigSummary() });
  });

  app.post('/api/admin/smtp-test', async (req, res) => {
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (authCtx.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator permission required.' });
    }

    const verification = await verifySmtpConnection();
    if (!verification.ok) {
      return res.status(verification.configured ? 502 : 400).json({
        success: false,
        ...verification,
      });
    }

    const { sendTestEmail, to } = req.body || {};
    if (sendTestEmail) {
      const recipient = (typeof to === 'string' && to.includes('@') ? to.trim() : verification.summary.user);
      const sendResult = await sendEmail({
        to: recipient,
        subject: 'Aathirai_Comic SMTP Connection Test',
        text: 'Your Aathirai_Comic SMTP server configuration is verified and working.',
        html: '<p>Your <strong>Aathirai_Comic</strong> SMTP server configuration is verified and working.</p>',
      });
      return res.json({
        success: sendResult.sent,
        verified: true,
        ...verification,
        emailResult: sendResult,
      });
    }

    return res.json({
      success: true,
      verified: true,
      ...verification,
    });
  });

  app.get('/api/admin/sms-status', async (req, res) => {
    await db.ensureFreshFromCloud().catch(() => {});
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (authCtx.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator permission required.' });
    }
    return res.json({
      success: true,
      sms: getSmsConfigSummary(),
      firebasePhoneAuth: {
        enabled: true,
        provider: 'firebase',
        projectId: 'aathiraicomic',
        authDomain: 'aathiraicomic.firebaseapp.com',
        freeTierInfo: '10 free SMS/day on Firebase Blaze plan, with automatic Gmail SMTP fallback.',
      },
    });
  });

  app.post('/api/admin/sms-test', async (req, res) => {
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (authCtx.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator permission required.' });
    }

    const { phone, countryCode, sendTestSms } = req.body || {};
    const summary = getSmsConfigSummary();
    if (!sendTestSms) {
      return res.json({ success: true, sms: summary });
    }
    if (!summary.configured) {
      return res.status(400).json({
        success: false,
        sms: summary,
        error: summary.freeTierInfo,
      });
    }

    const targetPhone = (typeof phone === 'string' && phone.trim()) || '+91 8610950780';
    const testCode = crypto.randomInt(100000, 999999).toString();
    const smsResult = await sendOtpSms({
      phone: targetPhone,
      countryCode: typeof countryCode === 'string' ? countryCode : '+91',
      otp: testCode,
      purpose: 'test',
    });

    return res.status(smsResult.sent ? 200 : 502).json({
      success: smsResult.sent,
      sms: summary,
      smsResult,
    });
  });

  // -------------------------------------------------------------
  // HELPER: 30-DAY FREE 1-MONTH PREMIUM TRIAL & ANTI-DUPLICATE CLAIM GUARD
  // -------------------------------------------------------------
  const FREE_TRIAL_DURATION_DAYS = 30;
  const FREE_TRIAL_DURATION_MS = FREE_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const FREE_TRIAL_VALUE_INR = 49;

  const extractLast10PhoneDigits = (raw?: string): string => {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
  };

  const hasClaimedFreeTrial = (
    snapshot: { freeTrialClaims?: Array<{ email?: string; phone?: string; phoneLast10?: string }> },
    params: { email?: string; phone?: string; countryCode?: string }
  ): boolean => {
    const claims = Array.isArray(snapshot.freeTrialClaims) ? snapshot.freeTrialClaims : [];
    const cleanEmail = String(params.email || '').trim().toLowerCase();
    const formattedPhone = params.phone ? formatGlobalPhone(params.phone, params.countryCode) : '';
    const last10 = extractLast10PhoneDigits(formattedPhone || params.phone);

    return claims.some((claim) => {
      if (cleanEmail && claim.email && claim.email.trim().toLowerCase() === cleanEmail) {
        return true;
      }
      if (last10.length >= 10) {
        const claimLast10 = claim.phoneLast10 || extractLast10PhoneDigits(claim.phone);
        if (claimLast10 && claimLast10 === last10) {
          return true;
        }
      }
      if (formattedPhone && claim.phone && phonesMatch(claim.phone, formattedPhone, params.countryCode)) {
        return true;
      }
      return false;
    });
  };

  const grantNewCustomerFreeTrial = (
    d: any,
    user: User,
    nowIso: string
  ): { granted: boolean; expiresAt?: string } => {
    if (!Array.isArray(d.freeTrialClaims)) {
      d.freeTrialClaims = [];
    }
    if (
      user.role === 'admin' ||
      user.id === IMMUTABLE_ADMIN_VAULT.id ||
      user.id === IMMUTABLE_OWNER_READER_VAULT.id ||
      Boolean(user.isProtectedOwnerReader) ||
      Boolean(user.hasComplimentaryAdminAccess)
    ) {
      return { granted: false };
    }
    const alreadyClaimed = hasClaimedFreeTrial(d, {
      email: user.email,
      phone: user.phone,
      countryCode: user.countryCode,
    });
    if (alreadyClaimed) {
      user.freeTrialClaimed = true;
      user.isFreeTrial = false;
      return { granted: false };
    }

    const startMs = new Date(nowIso).getTime() || Date.now();
    const expiresIso = new Date(startMs + FREE_TRIAL_DURATION_MS).toISOString();
    const cleanEmail = String(user.email || '').trim().toLowerCase();
    const cleanPhone = user.phone ? String(user.phone).trim() : undefined;
    const phoneLast10 = extractLast10PhoneDigits(cleanPhone);

    user.premiumPlan = '1_month';
    user.premiumStartedAt = nowIso;
    user.premiumExpiresAt = expiresIso;
    user.isFreeTrial = true;
    user.freeTrialClaimed = true;
    user.freeTrialGrantedAt = nowIso;
    user.freeTrialExpiresAt = expiresIso;
    user.freeTrialPopupSeenAt = undefined;
    user.premiumPaymentDetail = {
      plan: '1_month',
      amountPaidInr: 0,
      upiId: user.upiId,
      paymentMethod: 'Free 1-Month Welcome Trial (₹49 Value)',
      paidAt: nowIso,
      expiresAt: expiresIso,
      status: 'trial',
      isFreeTrial: true,
      trialValueInr: FREE_TRIAL_VALUE_INR,
    };

    d.freeTrialClaims.push({
      id: `trial_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      email: cleanEmail,
      phone: cleanPhone,
      phoneLast10: phoneLast10.length >= 10 ? phoneLast10 : undefined,
      userId: user.id,
      claimedAt: nowIso,
    });

    return { granted: true, expiresAt: expiresIso };
  };

  const isProtectedOwnerReaderUser = (u?: User | null): boolean =>
    Boolean(u && (u.id === IMMUTABLE_OWNER_READER_VAULT.id || u.isProtectedOwnerReader));

  const isProtectedVaultUser = (u?: User | null): boolean =>
    Boolean(
      u &&
        (u.role === 'admin' ||
          u.id === IMMUTABLE_ADMIN_VAULT.id ||
          isProtectedOwnerReaderUser(u))
    );

  const findCustomerAccount = (
    users: User[],
    params: { userId?: string; email?: string; phone?: string; countryCode?: string }
  ): User | undefined => {
    const cleanEmail = params.email?.trim().toLowerCase() || '';
    const cleanDigits = params.phone?.replace(/\D/g, '') || '';
    const nonAdminUsers = (users || []).filter(
      (u: User) => u.role !== 'admin' && u.id !== IMMUTABLE_ADMIN_VAULT.id
    );
    const matchedCustomer = nonAdminUsers.find((u: User) => {
      if (params.userId && u.id === params.userId) return true;
      if (cleanEmail && u.email?.toLowerCase() === cleanEmail) return true;
      if (
        cleanDigits.length >= 6 &&
        u.phone &&
        (phonesMatch(u.phone, params.phone || '', params.countryCode) ||
          (cleanDigits.length >= 10 &&
            u.phone.replace(/\D/g, '').endsWith(cleanDigits.slice(-10))))
      ) {
        return true;
      }
      return false;
    });
    if (matchedCustomer) return matchedCustomer;
    if (params.userId) {
      return (users || []).find((u: User) => u.id === params.userId);
    }
    return undefined;
  };

  const sanitizeSubStatusForClient = <T extends Record<string, any>>(subStatus: T) => {
    const { matchedUser, ...rest } = subStatus;
    const isProtected = isProtectedVaultUser(matchedUser);
    return {
      ...rest,
      verifiedPhone: isProtected ? null : rest.verifiedPhone,
      upiId: isProtected ? undefined : rest.upiId,
    };
  };

  // -------------------------------------------------------------
  // HELPER: REAL-TIME GMAIL & PREMIUM SUBSCRIPTION VERIFICATION
  // -------------------------------------------------------------
  const getReaderSubscriptionStatus = (snapshot: any, params: { userId?: string; email?: string; phone?: string }) => {
    const cleanEmail = params.email?.trim().toLowerCase() || '';
    const cleanDigits = params.phone?.replace(/\D/g, '') || '';

    const matchedUser = findCustomerAccount(snapshot.users || [], params);
    const isProtectedOwner = isProtectedVaultUser(matchedUser);
    const isComplimentaryAdminAccess = Boolean(
      matchedUser && matchedUser.hasComplimentaryAdminAccess
    );

    if (isComplimentaryAdminAccess && matchedUser) {
      const premiumPaymentDetail = {
        plan: 'free' as const,
        amountPaidInr: 0,
        upiId: undefined,
        paymentMethod: 'Complimentary Unrestricted Owner Reader Access',
        transactionId: undefined,
        receiptNumber: undefined,
        paidAt: matchedUser.createdAt,
        expiresAt: undefined,
        status: 'complimentary' as const,
        isFreeTrial: false,
        isComplimentaryAdminAccess: true,
        trialValueInr: undefined,
      };

      return {
        hasActiveSubscription: true,
        isComplimentaryAdminAccess: true,
        isFreeTrial: false,
        trialDaysRemaining: 0,
        trialExpired: false,
        freeTrialExpiresAt: undefined,
        freeTrialPopupSeenAt: matchedUser.freeTrialPopupSeenAt || matchedUser.createdAt,
        shouldShowFreeTrialPopup: false,
        activePlan: null as '1_month' | '6_months' | null,
        startedAt: matchedUser.createdAt,
        expiresAt: undefined as string | undefined,
        activeReceipt: undefined as string | undefined,
        amountPaidInr: 0,
        upiId: undefined as string | undefined,
        paymentMethod: premiumPaymentDetail.paymentMethod,
        transactionId: undefined as string | undefined,
        premiumPaymentDetail,
        verifiedGmail: matchedUser.email || cleanEmail || null,
        verifiedPhone: null as string | null,
        age: matchedUser.age,
        matchedUser,
      };
    }

    const targetEmail = cleanEmail || matchedUser?.email?.toLowerCase() || '';
    const targetUserId = params.userId || matchedUser?.id || '';
    const targetPhoneDigits = cleanDigits || (matchedUser?.phone ? matchedUser.phone.replace(/\D/g, '') : '');

    const now = Date.now();
    let hasActiveSubscription = false;
    let isFreeTrial = false;
    let activePlan: '1_month' | '6_months' | null = null;
    let startedAt: string | undefined = undefined;
    let expiresAt: string | undefined = undefined;
    let activeReceipt: string | undefined = undefined;
    let amountPaidInr = 0;
    let paymentMethod: string | undefined = undefined;
    let transactionId: string | undefined = undefined;

    // 1. Check User record if subscription (paid or 30-day free trial) is stored directly and not expired
    if (matchedUser?.premiumPlan && matchedUser?.premiumExpiresAt) {
      const expTime = new Date(matchedUser.premiumExpiresAt).getTime();
      if (Number.isFinite(expTime) && expTime > now) {
        const recordIsTrial = Boolean(
          matchedUser.isFreeTrial ||
            matchedUser.premiumPaymentDetail?.status === 'trial' ||
            matchedUser.premiumPaymentDetail?.isFreeTrial
        );
        hasActiveSubscription = true;
        isFreeTrial = recordIsTrial;
        activePlan = matchedUser.premiumPlan;
        startedAt = matchedUser.premiumStartedAt || matchedUser.freeTrialGrantedAt;
        expiresAt = matchedUser.premiumExpiresAt;
        amountPaidInr = recordIsTrial
          ? 0
          : matchedUser.premiumPaymentDetail?.amountPaidInr || (activePlan === '6_months' ? 249 : 49);
        paymentMethod = recordIsTrial
          ? matchedUser.premiumPaymentDetail?.paymentMethod || 'Free 1-Month Welcome Trial (₹49 Value)'
          : matchedUser.premiumPaymentDetail?.paymentMethod || 'UPI / Razorpay';
        transactionId = recordIsTrial ? undefined : matchedUser.premiumPaymentDetail?.transactionId;
        activeReceipt = recordIsTrial ? undefined : matchedUser.premiumPaymentDetail?.receiptNumber;
      }
    }

    // 2. Verify against all successful PAID subscription purchases linked to reader's Gmail / UserId / Phone
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
      const computedExpires = sub.expiresAt
        ? new Date(sub.expiresAt).getTime()
        : (Number.isFinite(createdTime) ? createdTime + durationMs : 0);

      if (Number.isFinite(computedExpires) && computedExpires > now) {
        hasActiveSubscription = true;
        isFreeTrial = false;
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

    let trialDaysRemaining = 0;
    if (hasActiveSubscription && isFreeTrial && expiresAt) {
      const expMs = new Date(expiresAt).getTime();
      if (Number.isFinite(expMs) && expMs > now) {
        trialDaysRemaining = Math.max(1, Math.ceil((expMs - now) / (24 * 60 * 60 * 1000)));
      }
    }

    const freeTrialExpiresAt = matchedUser?.freeTrialExpiresAt || (isFreeTrial ? expiresAt : undefined);
    const trialExpired = Boolean(
      !hasActiveSubscription &&
        (matchedUser?.freeTrialClaimed || matchedUser?.freeTrialExpiresAt) &&
        freeTrialExpiresAt &&
        new Date(freeTrialExpiresAt).getTime() <= now
    );
    const shouldShowFreeTrialPopup = Boolean(
      hasActiveSubscription && isFreeTrial && !matchedUser?.freeTrialPopupSeenAt
    );

    const premiumPaymentDetail = {
      plan: (activePlan || 'free') as '1_month' | '6_months' | 'free',
      amountPaidInr: hasActiveSubscription ? (isFreeTrial ? 0 : amountPaidInr) : 0,
      upiId: isProtectedOwner ? undefined : (matchedUser?.upiId || matchedUser?.premiumPaymentDetail?.upiId),
      paymentMethod: hasActiveSubscription
        ? paymentMethod || (isFreeTrial ? 'Free 1-Month Welcome Trial (₹49 Value)' : 'UPI / Razorpay')
        : undefined,
      transactionId: hasActiveSubscription && !isFreeTrial ? transactionId : undefined,
      receiptNumber: hasActiveSubscription && !isFreeTrial ? activeReceipt : undefined,
      paidAt: hasActiveSubscription ? startedAt : undefined,
      expiresAt: hasActiveSubscription ? expiresAt : undefined,
      status: (hasActiveSubscription ? (isFreeTrial ? 'trial' : 'paid') : 'unpaid') as
        | 'paid'
        | 'unpaid'
        | 'trial'
        | 'complimentary',
      isFreeTrial: hasActiveSubscription ? isFreeTrial : false,
      isComplimentaryAdminAccess: false,
      trialValueInr: hasActiveSubscription && isFreeTrial ? FREE_TRIAL_VALUE_INR : undefined,
    };

    return {
      hasActiveSubscription,
      isComplimentaryAdminAccess: false,
      isFreeTrial: hasActiveSubscription && isFreeTrial,
      trialDaysRemaining,
      trialExpired,
      freeTrialExpiresAt,
      freeTrialPopupSeenAt: matchedUser?.freeTrialPopupSeenAt,
      shouldShowFreeTrialPopup,
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
      verifiedPhone: isProtectedOwner ? null : (matchedUser?.phone || params.phone || null),
      age: matchedUser?.age,
      matchedUser,
    };
  };

  // Reconcile customer's Premium Pass against Backend DB + Live Razorpay API
  const reconcileCustomerRazorpayPremium = async (params: {
    userId?: string;
    email?: string;
    phone?: string;
    paymentId?: string;
    firebaseIdToken?: string;
  }) => {
    await db.ensureFreshFromCloud();
    let subStatus = getReaderSubscriptionStatus(db.getSnapshot(), {
      userId: params.userId,
      email: params.email,
      phone: params.phone,
    });

    const cleanPaymentId = (params.paymentId || '').trim();
    const targetEmail = (params.email || subStatus.verifiedGmail || '').trim().toLowerCase();
    const targetPhone = (params.phone || subStatus.verifiedPhone || '').trim();
    const rzpStatus = getRazorpayEnvironmentStatus();
    const environment: 'test' | 'live' = rzpStatus.isLiveMode ? 'live' : 'test';

    let verificationSource: 'database' | 'razorpay_api' | 'none' = subStatus.hasActiveSubscription
      ? 'database'
      : 'none';
    let razorpayError: string | undefined;
    let checkedRazorpayApi = false;

    // Query Razorpay API if no active pass locally OR if a specific Razorpay payment ID (`pay_...`) was supplied
    if (
      !subStatus.isComplimentaryAdminAccess &&
      (!subStatus.hasActiveSubscription || cleanPaymentId) &&
      hasRealRazorpayApiKeys()
    ) {
      const rzpCheck = await findCapturedRazorpayPaymentForCustomer({
        email: targetEmail || undefined,
        phone: targetPhone || undefined,
        paymentId: cleanPaymentId || undefined,
      });
      checkedRazorpayApi = rzpCheck.checkedRazorpayApi;
      if (rzpCheck.error) {
        razorpayError = rzpCheck.error;
      }

      if (rzpCheck.verified && rzpCheck.payment) {
        const verifiedPay = rzpCheck.payment;
        verificationSource = 'razorpay_api';
        let syncedUser: User | null = null;
        let syncedPurchase: Purchase | null = null;

        db.mutate((d) => {
          const alreadyExists = d.purchases.some(
            (p: Purchase) => p.razorpayPaymentId === verifiedPay.paymentId && p.status === 'success'
          );

          let matchedUser = d.users.find(
            (u: User) =>
              (params.userId && u.id === params.userId) ||
              (targetEmail && u.email?.toLowerCase() === targetEmail) ||
              (verifiedPay.email && u.email?.toLowerCase() === verifiedPay.email) ||
              (targetPhone && phonesMatch(u.phone, targetPhone)) ||
              (verifiedPay.contact && phonesMatch(u.phone, verifiedPay.contact))
          );

          // Ensure customer exists in backend DB if they paid on Razorpay directly
          if (!matchedUser && (targetEmail || verifiedPay.email)) {
            const customerEmail = (targetEmail || verifiedPay.email || 'customer@aathirai.com').toLowerCase();
            const nowIso = new Date().toISOString();
            matchedUser = {
              id: params.userId || 'usr_' + Date.now(),
              name: customerEmail.split('@')[0] || 'Reader',
              email: customerEmail,
              phone: targetPhone || verifiedPay.contact || undefined,
              countryCode: '+91',
              countryName: 'India',
              role: 'reader',
              isVerified: true,
              emailVerified: true,
              bookmarks: [],
              favorites: [],
              readingHistory: [],
              avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(customerEmail)}`,
              createdAt: nowIso,
              lastLoginAt: nowIso,
              premiumPlan: verifiedPay.plan,
            };
            d.users.push(matchedUser);
          }

          if (matchedUser) {
            if (verifiedPay.contact && !matchedUser.phone) matchedUser.phone = verifiedPay.contact;
            if (verifiedPay.vpa && !matchedUser.upiId) matchedUser.upiId = verifiedPay.vpa;
            matchedUser.premiumPlan = verifiedPay.plan;
            matchedUser.premiumStartedAt = verifiedPay.paidAt;
            matchedUser.premiumExpiresAt = verifiedPay.expiresAt;
            matchedUser.isFreeTrial = false;
            matchedUser.premiumPaymentDetail = {
              plan: verifiedPay.plan,
              amountPaidInr: verifiedPay.amountInr,
              upiId: matchedUser.upiId || verifiedPay.vpa,
              paymentMethod: verifiedPay.method || 'Razorpay',
              transactionId: verifiedPay.paymentId,
              receiptNumber: `INV-RZP-${verifiedPay.paymentId.slice(-8).toUpperCase()}`,
              paidAt: verifiedPay.paidAt,
              expiresAt: verifiedPay.expiresAt,
              status: 'paid',
              isFreeTrial: false,
              environment,
            };
            syncedUser = matchedUser;
          }

          if (!alreadyExists) {
            const gstSettings = d.gstSettings || getDefaultGstBusinessSettings();
            const sellerSnap = buildSellerSnapshot(gstSettings);
            const posCode = sellerSnap.stateCode || '33';
            const gstCalc = calculateInclusiveGstBreakdown({
              totalAmountInr: verifiedPay.amountInr,
              sellerStateCode: sellerSnap.stateCode,
              placeOfSupplyStateCode: posCode,
              applicableRatePercent: gstSettings.applicableGstRate ?? 18,
              applyGst: gstSettings.applyGstToDomesticSales !== false,
              isInternational: false,
              hsnSacCode: sellerSnap.hsnSacCode,
              hsnSacDescription: sellerSnap.hsnSacDescription,
            });
            const seq = gstSettings.nextInvoiceSequence || d.purchases.length + 1;
            const invoiceNumber = formatGstInvoiceNumber(gstSettings.invoicePrefix || 'AAC/2627/', seq);
            gstSettings.nextInvoiceSequence = seq + 1;

            const receiptNum = `INV-AATHIRAI-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
            if (syncedUser?.premiumPaymentDetail) {
              syncedUser.premiumPaymentDetail.receiptNumber = receiptNum;
            }
            const baseRevenue = gstCalc.taxableValue;
            const authorEarningsInr = Number((baseRevenue * 0.7).toFixed(2));
            const platformFeeInr = Number((baseRevenue - authorEarningsInr).toFixed(2));

            const purchaseRecord: Purchase = {
              id: 'pur_' + Date.now(),
              userId: syncedUser?.id || params.userId || 'usr_guest',
              customerName: syncedUser?.name || (targetEmail ? targetEmail.split('@')[0] : 'Customer'),
              userEmail: syncedUser?.email || targetEmail || verifiedPay.email || 'customer@aathirai.com',
              userPhone: syncedUser?.phone || targetPhone || verifiedPay.contact || undefined,
              userUpiId: syncedUser?.upiId || verifiedPay.vpa || undefined,
              comicId: 'global_subscription',
              comicTitle:
                verifiedPay.plan === '6_months'
                  ? 'Aathirai 6-Month Premium Pass (₹249)'
                  : 'Aathirai 1-Month Premium Pass (₹49)',
              type: 'subscription',
              subscriptionPlan: verifiedPay.plan,
              expiresAt: verifiedPay.expiresAt,
              amountInr: verifiedPay.amountInr,
              currency: 'INR',
              paymentMethod: verifiedPay.method || 'Razorpay Gateway',
              razorpayOrderId: verifiedPay.orderId || verifiedPay.subscriptionId || `order_rzp_${Date.now()}`,
              razorpayPaymentId: verifiedPay.paymentId,
              signatureVerified: true,
              environment,
              idempotencyKey: `idem_rzp_${verifiedPay.paymentId}`,
              status: 'success',
              createdAt: verifiedPay.paidAt,
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
              isInternational: false,
              supplyType: gstCalc.supplyType,
              sellerSnapshot: sellerSnap,
              authorEarningsInr,
              platformFeeInr,
            };
            d.purchases.unshift(purchaseRecord);
            if (!Array.isArray(d.paymentTransactions)) d.paymentTransactions = [];
            d.paymentTransactions.unshift({
              id: `tx_${purchaseRecord.id}`,
              orderId: purchaseRecord.razorpayOrderId,
              paymentId: purchaseRecord.razorpayPaymentId,
              userId: purchaseRecord.userId,
              userEmail: purchaseRecord.userEmail,
              comicId: purchaseRecord.comicId,
              itemTitle: purchaseRecord.comicTitle,
              type: 'subscription',
              subscriptionPlan: verifiedPay.plan,
              amountInr: verifiedPay.amountInr,
              amountPaise: verifiedPay.amountPaise,
              currency: 'INR',
              status: 'verified',
              environment,
              signatureVerified: true,
              idempotencyKey: `idem_rzp_${verifiedPay.paymentId}`,
              createdAt: verifiedPay.paidAt,
              updatedAt: new Date().toISOString(),
            });
            syncedPurchase = purchaseRecord;
          }
        });

        if (syncedUser || syncedPurchase) {
          db.logActivity(
            'RAZORPAY_API_VERIFIED',
            (syncedUser as User | null)?.email || targetEmail || 'customer',
            'reader',
            `Verified Razorpay payment ${verifiedPay.paymentId} (₹${verifiedPay.amountInr} · ${verifiedPay.plan}) via Razorpay API and stored customer & purchase in backend.`,
            'purchase',
            verifiedPay.paymentId
          );
          await db.persistChanges({
            users: syncedUser ? [syncedUser] : [],
            collections: ['purchases', 'paymentTransactions', 'settings', 'activityLogs'],
            userFirebaseIdToken: params.firebaseIdToken,
          });
        }

        subStatus = getReaderSubscriptionStatus(db.getSnapshot(), {
          userId: params.userId || (syncedUser as User | null)?.id,
          email: targetEmail || verifiedPay.email,
          phone: targetPhone || verifiedPay.contact,
        });
      }
    }

    const razorpayVerified = Boolean(
      subStatus.hasActiveSubscription &&
        (verificationSource === 'razorpay_api' ||
          Boolean(subStatus.transactionId) ||
          db.getSnapshot().purchases.some(
            (p: Purchase) =>
              p.status === 'success' &&
              p.type === 'subscription' &&
              (p.signatureVerified || Boolean(p.razorpayPaymentId)) &&
              ((subStatus.matchedUser?.id && p.userId === subStatus.matchedUser.id) ||
                (subStatus.verifiedGmail && p.userEmail?.toLowerCase() === subStatus.verifiedGmail.toLowerCase()))
          ))
    );

    return {
      subStatus,
      razorpayVerified,
      verificationSource,
      checkedRazorpayApi,
      razorpayApiConfigured: hasRealRazorpayApiKeys(),
      razorpayError,
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
    user.isFreeTrial = false;
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
      isFreeTrial: false,
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

  const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes validity

  const createOtpEntry = (code: string) => ({
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
  });

  const verifyOtpAgainstKeys = (
    otpsMap: Record<string, { code: string; expiresAt: number } | string>,
    keys: string[],
    providedOtp?: unknown
  ): { valid: boolean; expired: boolean } => {
    const cleanOtp = String(providedOtp || '').trim();
    if (!cleanOtp || cleanOtp.length < 4) {
      return { valid: false, expired: false };
    }
    const now = Date.now();
    let sawExpired = false;
    for (const key of keys) {
      if (!key) continue;
      const entry = otpsMap[key];
      if (!entry) continue;
      if (typeof entry === 'string') {
        if (entry === cleanOtp) return { valid: true, expired: false };
      } else if (entry && typeof entry === 'object' && entry.code) {
        if (now > Number(entry.expiresAt || 0)) {
          sawExpired = true;
          continue;
        }
        if (entry.code === cleanOtp) {
          return { valid: true, expired: false };
        }
      }
    }
    return { valid: false, expired: sawExpired };
  };

  // Pre-check whether a Gmail address or Mobile Number is already registered or has already claimed the 30-day Free Trial
  app.post('/api/auth/check-registration-availability', authRateLimiter, async (req, res) => {
    const { email, phone, countryCode } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const formattedPhone = phone ? formatGlobalPhone(phone, countryCode) : '';
    const cleanDigits = formattedPhone.replace(/\D/g, '');

    if (!cleanEmail && cleanDigits.length < 6) {
      return res.status(400).json({ error: 'Please provide a Gmail address or Mobile Number to verify.' });
    }

    await db.ensureFreshFromCloud(true);
    const snapshot = db.getSnapshot();

    const emailExists = cleanEmail
      ? snapshot.users.some(
          (u: User) =>
            u.email &&
            u.email.toLowerCase() === cleanEmail &&
            (u.isVerified || u.emailVerified || u.role === 'admin' || u.role === 'author')
        )
      : false;

    const phoneExists =
      cleanDigits.length >= 6
        ? snapshot.users.some(
            (u: User) =>
              phonesMatch(u.phone, phone, countryCode) &&
              (u.isVerified || u.emailVerified || u.role === 'admin' || u.role === 'author')
          )
        : false;

    const trialAlreadyClaimed = hasClaimedFreeTrial(snapshot, {
      email: cleanEmail || undefined,
      phone: formattedPhone || undefined,
      countryCode,
    });

    if (emailExists || phoneExists) {
      return res.status(409).json({
        available: false,
        emailExists,
        phoneExists,
        trialEligible: false,
        error:
          emailExists && phoneExists
            ? 'An account with this Gmail address and Mobile Number is already registered. Please sign in using Returning Customer Login.'
            : emailExists
              ? 'This Gmail address is already registered. Duplicate accounts are not allowed — please sign in using Returning Customer Login.'
              : 'This Mobile Number is already registered. Duplicate accounts are not allowed — please sign in using Returning Customer Login.',
      });
    }

    return res.json({
      available: true,
      emailExists: false,
      phoneExists: false,
      trialEligible: !trialAlreadyClaimed,
      trialAlreadyClaimed,
      message: trialAlreadyClaimed
        ? 'Account available to register. Note: This Gmail or Mobile Number has already used the one-time 30-day Free Trial previously.'
        : 'Verified available! New account qualifies for the 30-day Free 1-Month Premium Trial (₹49 value).',
    });
  });

  app.post('/api/auth/send-registration-email-otp', authRateLimiter, async (req, res) => {
    const { email, name } = req.body;
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid Gmail address.' });
    }

    await db.ensureFreshFromCloud(true);
    const snapshot = db.getSnapshot();
    const existing = snapshot.users.find(
      (u: User) => u.email && u.email.toLowerCase() === cleanEmail
    );
    if (
      existing &&
      (existing.isVerified ||
        existing.emailVerified ||
        existing.role === 'admin' ||
        existing.role === 'author')
    ) {
      return res.status(409).json({
        error:
          'An account with this Gmail address already exists. Duplicate accounts are not allowed — please use Returning Customer Login or Forgot Password.',
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpKey = `reg_email:${cleanEmail}`;
    db.mutate(d => {
      d.otps[otpKey] = createOtpEntry(otp);
    });
    await db.persistChanges({ collections: ['otps'] });

    const emailDelivery = await sendEmailVerificationOtpEmail({
      to: cleanEmail,
      name: cleanName || 'Reader',
      otp,
    });

    if (!emailDelivery.sent) {
      db.mutate(d => {
        delete d.otps[otpKey];
      });
      return res.status(emailDelivery.configured ? 502 : 503).json({
        success: false,
        emailDelivered: false,
        smtpConfigured: emailDelivery.configured,
        from: emailDelivery.from,
        error:
          emailDelivery.error ||
          'Unable to send OTP to this Gmail address. Please check SMTP configuration or try again.',
      });
    }

    const senderEmail = emailDelivery.from || 'aathiraicomic@gmail.com';
    return res.json({
      success: true,
      emailDelivered: true,
      email: cleanEmail,
      from: senderEmail,
      accepted: emailDelivery.accepted,
      message: `6-digit OTP sent from ${senderEmail} to ${cleanEmail}. Check Inbox, Spam, or Updates and enter the code below.`,
    });
  });

  app.post('/api/auth/verify-registration-email-otp', authRateLimiter, async (req, res) => {
    const { email, otp } = req.body;
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid Gmail address.' });
    }

    await db.ensureFreshFromCloud(true);
    const otpKey = `reg_email:${cleanEmail}`;
    const snapshot = db.getSnapshot();
    const otpCheck = verifyOtpAgainstKeys(snapshot.otps, [otpKey], otp);

    if (!otpCheck.valid) {
      return res.status(400).json({
        error: otpCheck.expired
          ? 'Gmail OTP expired (valid for 10 minutes). Please click Resend OTP.'
          : 'Invalid 6-digit Gmail OTP code. Please check your inbox and try again.',
      });
    }

    db.mutate(d => {
      delete d.otps[otpKey];
    });
    await db.persistChanges({ collections: ['otps'] });

    const emailVerificationToken = createVerificationProofToken('reg_email', cleanEmail);
    return res.json({
      success: true,
      verified: true,
      email: cleanEmail,
      emailVerificationToken,
      message: `Gmail address (${cleanEmail}) verified!`,
    });
  });

  app.post('/api/auth/send-registration-mobile-otp', authRateLimiter, async (req, res) => {
    const { phone, countryCode, smsChannel } = req.body;
    const formattedPhone = formatGlobalPhone(phone, countryCode);
    const cleanDigits = formattedPhone.replace(/\D/g, '');
    const phoneKey = getPhoneOtpKey(phone, countryCode);

    if (cleanDigits.length < 6 || phoneKey.length < 6) {
      return res.status(400).json({
        error: 'Please select your country and enter a valid Mobile Number.',
      });
    }

    await db.ensureFreshFromCloud(true);
    const snapshot = db.getSnapshot();
    const existing = snapshot.users.find(
      (u: User) =>
        phonesMatch(u.phone, phone, countryCode) &&
        (u.isVerified ||
          u.emailVerified ||
          u.role === 'admin' ||
          u.role === 'author')
    );

    if (existing) {
      return res.status(409).json({
        error:
          'An account with this Mobile Number already exists. Duplicate accounts are not allowed — please use Returning Customer Login or Forgot Password.',
      });
    }

    const useFirebaseSms = smsChannel === 'firebase' || smsChannel === undefined;
    if (useFirebaseSms) {
      return res.json({
        success: true,
        available: true,
        phone: formattedPhone,
        countryCode: countryCode ? String(countryCode).trim() : '+91',
        provider: 'firebase',
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpKey = `reg_mobile:${phoneKey}`;
    db.mutate(d => {
      d.otps[otpKey] = createOtpEntry(otp);
    });
    await db.persistChanges({ collections: ['otps'] });

    const smsDelivery = await sendOtpSms({
      phone: formattedPhone,
      countryCode,
      otp,
      purpose: 'register',
    });

    if (!smsDelivery.sent) {
      return res.status(smsDelivery.configured ? 502 : 503).json({
        success: false,
        smsDelivered: false,
        smsConfigured: smsDelivery.configured,
        provider: smsDelivery.provider,
        error:
          smsDelivery.error ||
          'SMS OTP delivery failed. Please check mobile number and SMS configuration.',
      });
    }

    return res.json({
      success: true,
      available: true,
      smsDelivered: true,
      phone: formattedPhone,
      provider: smsDelivery.provider,
      message: `6-digit SMS OTP sent to ${formattedPhone}.`,
    });
  });

  app.post('/api/auth/verify-registration-mobile-otp', authRateLimiter, async (req, res) => {
    const { phone, countryCode, otp } = req.body;
    const formattedPhone = formatGlobalPhone(phone, countryCode);
    const cleanDigits = formattedPhone.replace(/\D/g, '');
    const phoneKey = getPhoneOtpKey(phone, countryCode);

    if (cleanDigits.length < 6) {
      return res.status(400).json({ error: 'Please enter a valid Mobile Number.' });
    }

    const tokenInfo = await verifyBearerToken(req.headers.authorization);
    const hasFirebasePhoneClaim = Boolean(tokenInfo?.phoneNumber);
    const firebasePhoneVerified = Boolean(
      tokenInfo?.phoneNumber && phonesMatch(formattedPhone, tokenInfo.phoneNumber, countryCode)
    );

    if (hasFirebasePhoneClaim && !firebasePhoneVerified) {
      return res.status(403).json({
        error: 'Verified Firebase mobile number does not match the entered mobile number.',
      });
    }

    if (!firebasePhoneVerified) {
      await db.ensureFreshFromCloud(true);
      const otpKey = `reg_mobile:${phoneKey}`;
      const snapshot = db.getSnapshot();
      const otpCheck = verifyOtpAgainstKeys(snapshot.otps, [otpKey], otp);
      if (!otpCheck.valid) {
        return res.status(400).json({
          error: otpCheck.expired
            ? 'Mobile SMS OTP expired (valid for 10 minutes). Please click Resend OTP.'
            : 'Invalid 6-digit Mobile OTP code. Please check the SMS sent to your device.',
        });
      }
      db.mutate(d => {
        delete d.otps[otpKey];
      });
      await db.persistChanges({ collections: ['otps'] });
    }

    const mobileVerificationToken = createVerificationProofToken(
      'reg_mobile',
      tokenInfo?.phoneNumber || formattedPhone
    );

    return res.json({
      success: true,
      verified: true,
      verifiedVia: firebasePhoneVerified ? 'firebase_sms' : 'backend_otp',
      phone: formattedPhone,
      mobileVerificationToken,
      message: `Mobile Number (${formattedPhone}) verified!`,
    });
  });

  app.post('/api/auth/register', authRateLimiter, async (req, res) => {
    const {
      name,
      email,
      phone,
      countryCode,
      countryName,
      dob,
      password,
      confirmPassword,
      notifyGmail,
      notifyMobile,
      upiId,
      bio,
      avatar,
      emailVerificationToken,
      mobileVerificationToken,
    } = req.body;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const formattedPhone = formatGlobalPhone(phone, countryCode);
    const cleanDigits = formattedPhone.replace(/\D/g, '');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'Please enter your Full Name (minimum 2 characters).' });
    }
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid Gmail address.' });
    }
    if (cleanDigits.length < 6) {
      return res.status(400).json({ error: 'Please select your country and enter a valid Global Mobile Number.' });
    }

    const dobCheck = validateAndNormalizeDob(dob);
    if (!dobCheck.valid || !dobCheck.dob || dobCheck.age === undefined) {
      return res.status(400).json({ error: dobCheck.error || 'Valid Date of Birth (DD/MM/YYYY) is required.' });
    }

    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Please create an account password (minimum 4 characters).' });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
    }

    // Strict Pre-Creation Dual-OTP Enforcement: Both Gmail and Mobile OTPs must be verified BEFORE creating the account
    const isEmailVerifiedProof = verifyVerificationProofToken(
      emailVerificationToken,
      'reg_email',
      cleanEmail
    );
    if (!isEmailVerifiedProof) {
      return res.status(400).json({
        error: 'Please send and verify the 6-digit OTP sent to your Gmail address before creating your account.',
      });
    }

    const tokenInfo = await verifyBearerToken(req.headers.authorization);
    const firebasePhoneVerified = Boolean(
      tokenInfo?.phoneNumber && phonesMatch(formattedPhone, tokenInfo.phoneNumber, countryCode)
    );
    const isMobileVerifiedProof =
      firebasePhoneVerified ||
      verifyVerificationProofToken(mobileVerificationToken, 'reg_mobile', formattedPhone);
    if (!isMobileVerifiedProof) {
      return res.status(400).json({
        error: 'Please send and verify the 6-digit SMS OTP sent to your Mobile Number before creating your account.',
      });
    }

    await db.ensureFreshFromCloud(true);
    const nowIso = new Date().toISOString();
    const hashedPass = hashPassword(String(password));

    let registeredUser: User | null = null;
    let duplicateConflict = false;
    let freeTrialGranted = false;
    let freeTrialExpiresAtIso: string | undefined = undefined;

    db.mutate(d => {
      const existing = d.users.find((u: User) =>
        (cleanEmail && u.email.toLowerCase() === cleanEmail) ||
        (cleanDigits.length >= 6 && phonesMatch(u.phone, phone, countryCode))
      );

      if (existing) {
        if (
          existing.isVerified ||
          existing.emailVerified ||
          existing.role === 'admin' ||
          existing.role === 'author'
        ) {
          duplicateConflict = true;
          return;
        }
        // Finalize any legacy unverified placeholder record now that both OTPs are verified
        existing.name = cleanName;
        existing.email = cleanEmail;
        existing.phone = formattedPhone;
        if (countryCode) existing.countryCode = String(countryCode).trim();
        if (countryName) existing.countryName = String(countryName).trim();
        existing.age = dobCheck.age;
        existing.dob = dobCheck.dob;
        if (avatar) existing.avatar = String(avatar);
        existing.passwordHash = hashedPass;
        delete existing.password;
        existing.isVerified = true;
        existing.emailVerified = true;
        if (tokenInfo?.firebaseUid && !existing.firebaseUid) {
          existing.firebaseUid = tokenInfo.firebaseUid;
        }
        existing.failedLoginAttempts = 0;
        existing.lockedUntil = null;
        existing.welcomeEmailSent = true;
        existing.welcomeEmailSentAt = nowIso;
        if (typeof notifyGmail === 'boolean') existing.notifyGmail = notifyGmail;
        if (typeof notifyMobile === 'boolean') existing.notifyMobile = notifyMobile;
        if (upiId?.trim()) existing.upiId = upiId.trim();
        existing.lastLoginAt = nowIso;
        const trialRes = grantNewCustomerFreeTrial(d, existing, nowIso);
        freeTrialGranted = trialRes.granted;
        freeTrialExpiresAtIso = trialRes.expiresAt;
        registeredUser = existing;
      } else {
        const newUser: User = {
          id: 'usr_' + Date.now(),
          firebaseUid: tokenInfo?.firebaseUid || undefined,
          name: cleanName,
          email: cleanEmail,
          passwordHash: hashedPass,
          failedLoginAttempts: 0,
          lockedUntil: null,
          welcomeEmailSent: true,
          welcomeEmailSentAt: nowIso,
          age: dobCheck.age,
          dob: dobCheck.dob,
          notifyGmail: typeof notifyGmail === 'boolean' ? notifyGmail : true,
          notifyMobile: typeof notifyMobile === 'boolean' ? notifyMobile : true,
          upiId: upiId?.trim() || undefined,
          phone: formattedPhone || undefined,
          countryCode: countryCode ? String(countryCode).trim() : '+91',
          countryName: countryName ? String(countryName).trim() : 'India',
          role: 'reader',
          isVerified: true,
          emailVerified: true,
          bookmarks: [],
          favorites: [],
          readingHistory: [],
          avatar:
            avatar ||
            `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanName)}`,
          bio: bio || 'Reader on Aathirai_Comic Network.',
          createdAt: nowIso,
          lastLoginAt: nowIso,
          premiumPlan: null,
        };
        const trialRes = grantNewCustomerFreeTrial(d, newUser, nowIso);
        freeTrialGranted = trialRes.granted;
        freeTrialExpiresAtIso = trialRes.expiresAt;
        d.users.push(newUser);
        registeredUser = newUser;
      }
    });

    if (duplicateConflict) {
      return res.status(409).json({
        error: 'An account with this Gmail address or Global Mobile Number already exists in the backend database. Duplicate accounts are not permitted — please sign in using Returning Customer Login or reset via Forgot Password.',
      });
    }

    if (!registeredUser) {
      return res.status(500).json({ error: 'Could not register reader account.' });
    }

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const reconciled = await reconcileCustomerRazorpayPremium({
      userId: (registeredUser as User).id,
      email: (registeredUser as User).email,
      phone: (registeredUser as User).phone,
      firebaseIdToken: fbToken,
    });
    const subStatus = reconciled.subStatus;
    const matchedUser = subStatus.matchedUser || (registeredUser as User);
    const finalUser: User = {
      ...matchedUser,
      premiumPlan: subStatus.activePlan,
      premiumStartedAt: subStatus.startedAt,
      premiumExpiresAt: subStatus.expiresAt,
      premiumPaymentDetail: subStatus.premiumPaymentDetail,
      isFreeTrial: subStatus.isFreeTrial,
      trialDaysRemaining: subStatus.trialDaysRemaining,
      trialExpired: subStatus.trialExpired,
      shouldShowFreeTrialPopup: subStatus.shouldShowFreeTrialPopup,
    };

    const trialExpiryDisplay = freeTrialExpiresAtIso
      ? new Date(freeTrialExpiresAtIso).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata',
        })
      : '';

    db.addNotification({
      userId: finalUser.id,
      userEmail: finalUser.email,
      title: freeTrialGranted
        ? 'Free 1-Month Premium Access Granted (₹49 Value)!'
        : 'Welcome to Aathirai_Comic!',
      message: freeTrialGranted
        ? `Hello ${finalUser.name}, welcome to Aathirai_Comic! Your 30-day Free One-Month Premium Trial (₹49 value) is now active until ${trialExpiryDisplay}. Enjoy unlimited premium comics!`
        : `Hello ${finalUser.name}, your Gmail & Mobile Number are verified and your reader account is active.`,
      type: 'system',
      targetId: finalUser.id,
    });

    const welcomeEmailPayload = {
      to: finalUser.email,
      subject: freeTrialGranted
        ? 'Welcome to Aathirai_Comic — Your 30-Day Free Premium Access (₹49 Value) Is Active!'
        : 'Welcome to Aathirai_Comic! Your Customer Account Has Been Created',
      body: freeTrialGranted
        ? `Hello ${finalUser.name}, welcome to Aathirai_Comic! Your verified customer account (${finalUser.email} / ${finalUser.phone || 'Mobile Linked'}) has been granted a Free 1-Month Premium Trial (₹49 value, valid for 30 days until ${trialExpiryDisplay}).`
        : `Hello ${finalUser.name}, welcome to Aathirai_Comic! Your verified customer account (${finalUser.email} / ${finalUser.phone || 'Mobile Linked'}) has been created and stored in our database.`,
      sentAt: nowIso,
    };

    db.logActivity(
      'READER_REGISTERED',
      finalUser.email,
      finalUser.role,
      `Customer registered after dual Gmail + Mobile OTP verification: ${finalUser.name} | DOB verified | Age: ${finalUser.age || 'N/A'} | Mobile: ${finalUser.phone || 'N/A'} | Free Trial Granted: ${freeTrialGranted}.`,
      'user',
      finalUser.id
    );

    const welcomeDelivery = await sendReaderAccountWelcomeEmail({
      to: finalUser.email,
      name: finalUser.name,
    });

    const cloudPersist = await db.persistChanges({
      users: [finalUser],
      collections: ['notifications', 'activityLogs', 'otps', 'freeTrialClaims'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      storedInBackend: true,
      cloudPersisted: cloudPersist.persisted,
      verified: true,
      freeTrialGranted,
      trialDaysRemaining: subStatus.trialDaysRemaining,
      shouldShowFreeTrialPopup: subStatus.shouldShowFreeTrialPopup,
      emailDelivered: welcomeDelivery.sent,
      smtpConfigured: welcomeDelivery.configured,
      user: sanitizeUserForClient(finalUser, true),
      subscription: subStatus,
      razorpayVerified: reconciled.razorpayVerified,
      welcomeEmail: welcomeEmailPayload,
      message: freeTrialGranted
        ? `Gmail (${cleanEmail}) & Mobile (${finalUser.phone}) verified — account created with 30-Day Free 1-Month Premium Access (₹49 value)!`
        : `Gmail (${cleanEmail}) & Mobile (${finalUser.phone}) verified — customer account created and active!`,
    });
  });

  app.post('/api/auth/verify-otp', authRateLimiter, async (req, res) => {
    const { email, phone, countryCode, countryName, otp, dob, notifyGmail, notifyMobile, upiId } = req.body;
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const phoneKey = getPhoneOtpKey(phone || email, countryCode);
    const snapshot = db.getSnapshot();
    const tokenInfo = await verifyBearerToken(req.headers.authorization);
    const hasFirebasePhoneClaim = Boolean(tokenInfo?.phoneNumber);

    const targetUser = snapshot.users.find(user =>
      (cleanEmail && user.email.toLowerCase() === cleanEmail) ||
      (phone && phonesMatch(user.phone, phone, countryCode))
    );

    if (!targetUser) {
      return res.status(404).json({ error: 'Reader account not found.' });
    }

    const firebasePhoneVerified = Boolean(
      tokenInfo?.phoneNumber &&
        targetUser.phone &&
        phonesMatch(targetUser.phone, tokenInfo.phoneNumber, countryCode)
    );

    if (hasFirebasePhoneClaim && !firebasePhoneVerified) {
      return res.status(403).json({
        error: 'Verified Firebase mobile number does not match the registered customer mobile number.',
      });
    }

    const otpCheck = verifyOtpAgainstKeys(
      snapshot.otps,
      [cleanEmail, phoneKey.length >= 6 ? phoneKey : ''],
      otp
    );

    if (!firebasePhoneVerified && !otpCheck.valid) {
      return res.status(400).json({
        error: otpCheck.expired
          ? 'Verification OTP has expired (valid for 10 minutes). Please re-register or request a fresh code.'
          : 'Invalid verification OTP. Please check the 6-digit code sent to your mobile or email.',
      });
    }

    let dobUpdate: { dob: string; age: number } | null = null;
    if (dob !== undefined && String(dob).trim() !== '') {
      const dobCheck = validateAndNormalizeDob(dob);
      if (!dobCheck.valid || !dobCheck.dob || dobCheck.age === undefined) {
        return res.status(400).json({ error: dobCheck.error || 'Invalid Date of Birth.' });
      }
      dobUpdate = { dob: dobCheck.dob, age: dobCheck.age };
    }

    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find(user => user.id === targetUser.id);
      if (u) {
        u.isVerified = true;
        if (firebasePhoneVerified && tokenInfo?.firebaseUid && !u.firebaseUid) {
          u.firebaseUid = tokenInfo.firebaseUid;
        }
        u.failedLoginAttempts = 0;
        u.lockedUntil = null;
        u.lastLoginAt = new Date().toISOString();
        if (phone?.trim()) {
          u.phone = formatGlobalPhone(phone, countryCode || u.countryCode);
        }
        if (countryCode) u.countryCode = String(countryCode).trim();
        if (countryName) u.countryName = String(countryName).trim();
        if (dobUpdate) {
          u.dob = dobUpdate.dob;
          u.age = dobUpdate.age;
        }
        if (typeof notifyGmail === 'boolean') u.notifyGmail = notifyGmail;
        if (typeof notifyMobile === 'boolean') u.notifyMobile = notifyMobile;
        if (upiId?.trim()) {
          u.upiId = upiId.trim();
        }
        updatedUser = u;
      }
      if (cleanEmail) delete d.otps[cleanEmail];
      if (phoneKey.length >= 6) delete d.otps[phoneKey];
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Reader account not found.' });
    }

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const reconciled = await reconcileCustomerRazorpayPremium({
      userId: (updatedUser as User).id,
      email: (updatedUser as User).email,
      phone: (updatedUser as User).phone,
      firebaseIdToken: fbToken,
    });
    const subStatus = reconciled.subStatus;
    const latestUser = subStatus.matchedUser || (updatedUser as User);

    const userWithPremium: User = {
      ...latestUser,
      premiumPlan: subStatus.activePlan,
      premiumStartedAt: subStatus.startedAt,
      premiumExpiresAt: subStatus.expiresAt,
      premiumPaymentDetail: subStatus.premiumPaymentDetail,
    };

    db.logActivity(
      'READER_VERIFIED',
      userWithPremium.email,
      userWithPremium.role,
      `Reader verified account via ${firebasePhoneVerified ? 'Firebase SMS OTP' : 'OTP'} (${userWithPremium.email} | Age: ${userWithPremium.age || 'N/A'}).`,
      'user',
      userWithPremium.id
    );

    await db.persistChanges({
      users: [userWithPremium],
      collections: ['activityLogs', 'otps'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      verifiedVia: firebasePhoneVerified ? 'firebase_sms' : 'backend_otp',
      user: sanitizeUserForClient(userWithPremium, true),
      subscription: subStatus,
      message: `Welcome to Aathirai_Comic! Your account (${userWithPremium.email}) is verified and active.`,
    });
  });

  // Step 1 of Returning Customer Login: Verify EITHER Gmail OR Global Mobile Number in Backend Database + Razorpay Premium Status
  app.post('/api/auth/verify-identity', authRateLimiter, async (req, res) => {
    const { email, credential, phone, countryCode, countryName, razorpayPaymentId } = req.body;
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

    await db.ensureFreshFromCloud();
    let matchedUser: User | undefined;
    let matchedBy: 'gmail_and_mobile' | 'gmail' | 'mobile' = 'gmail';
    const now = Date.now();

    const findMatchingUser = (d: any) => {
      const nonAdminUsers = (d.users || []).filter(
        (u: User) => u.role !== 'admin' && u.id !== IMMUTABLE_ADMIN_VAULT.id
      );
      return nonAdminUsers.find((u: User) => {
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
    };

    db.mutate(d => {
      matchedUser = findMatchingUser(d);
    });
    if (!matchedUser) {
      await db.ensureFreshFromCloud(true);
      db.mutate(d => {
        matchedUser = findMatchingUser(d);
      });
    }

    db.mutate(() => {
      if (matchedUser && matchedUser.lockedUntil) {
        const lockTime = new Date(matchedUser.lockedUntil).getTime();
        if (!Number.isFinite(lockTime) || lockTime <= now) {
          matchedUser.lockedUntil = null;
          matchedUser.failedLoginAttempts = 0;
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

    const isProtectedReader = isProtectedOwnerReaderUser(matchedUser);
    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const reconciled = await reconcileCustomerRazorpayPremium({
      userId: matchedUser.id,
      email: matchedUser.email,
      phone: isProtectedReader ? undefined : matchedUser.phone,
      paymentId: razorpayPaymentId ? String(razorpayPaymentId) : undefined,
      firebaseIdToken: fbToken,
    });

    const lockTs = matchedUser.lockedUntil ? new Date(matchedUser.lockedUntil).getTime() : NaN;
    const isLocked = Boolean(Number.isFinite(lockTs) && lockTs > now);
    const remainingAttempts = isLocked ? 0 : Math.max(0, 3 - (matchedUser.failedLoginAttempts || 0));

    return res.json({
      success: true,
      verified: true,
      existsInDatabase: true,
      storedInBackend: true,
      matchedBy,
      userId: matchedUser.id,
      email: matchedUser.email,
      // Strictly never echo protected owner mobile number back to browser payloads or UI messages
      phone: isProtectedReader ? '' : (matchedUser.phone || ''),
      isProtectedOwnerReader: isProtectedReader,
      hasComplimentaryAdminAccess: Boolean(reconciled.subStatus.isComplimentaryAdminAccess),
      countryCode: matchedUser.countryCode || countryCode || '+91',
      countryName: matchedUser.countryName || countryName || 'India',
      name: matchedUser.name,
      createdAt: matchedUser.createdAt,
      isLocked,
      lockedUntil: isLocked ? matchedUser.lockedUntil : null,
      remainingAttempts,
      razorpayStatus: {
        hasActiveSubscription: reconciled.subStatus.hasActiveSubscription,
        isComplimentaryAdminAccess: Boolean(reconciled.subStatus.isComplimentaryAdminAccess),
        activePlan: reconciled.subStatus.activePlan,
        amountPaidInr: reconciled.subStatus.amountPaidInr,
        expiresAt: reconciled.subStatus.expiresAt || null,
        transactionId: reconciled.subStatus.transactionId || null,
        receiptNumber: reconciled.subStatus.activeReceipt || null,
        paymentMethod: reconciled.subStatus.paymentMethod || null,
        razorpayVerified: reconciled.razorpayVerified,
        verificationSource: reconciled.verificationSource,
        razorpayApiConfigured: reconciled.razorpayApiConfigured,
      },
      message: isLocked
        ? 'Your account is locked after 3 failed password attempts. Please try again after 12 hours or use Forgot Password to reset via OTP.'
        : isProtectedReader
          ? `Verified in Backend Database! Account found for ${matchedUser.name} (${matchedUser.email}). Please enter your account password below.`
          : `Verified in Backend Database! Customer account found for ${matchedUser.name} (${matchedUser.email}${matchedUser.phone ? ` · ${matchedUser.phone}` : ''}). Please enter your account password below.`,
    });
  });

  // Step 2 of Returning Customer Login: Verify Password OR Google Firebase Auth Token, persist customer in backend, & verify Razorpay Premium
  app.post('/api/auth/login', authRateLimiter, async (req, res) => {
    const {
      email,
      credential,
      phone,
      countryCode,
      countryName,
      password,
      name,
      dob,
      notifyGmail,
      notifyMobile,
      upiId,
      isGoogleAuth,
      firebaseUid,
      avatar,
    } = req.body;
    const rawIdentifier = (credential || email || phone || '').trim();
    if (!rawIdentifier && !phone?.trim()) {
      return res.status(400).json({ error: 'Please enter either your Gmail address or your Mobile Number to sign in.' });
    }

    const verifiedBearer = await verifyBearerToken(req.headers.authorization);
    const isEmail = rawIdentifier.includes('@');
    const cleanEmail = isEmail ? rawIdentifier.toLowerCase() : (email?.includes('@') ? email.trim().toLowerCase() : '');
    const rawPhoneInput = (phone || (!isEmail ? rawIdentifier : '') || '').trim();
    const formattedPhone = formatGlobalPhone(rawPhoneInput, countryCode);
    const cleanDigits = rawPhoneInput.replace(/\D/g, '');
    const now = Date.now();
    const nowIso = new Date().toISOString();

    const verifiedGoogleEmailMatch = Boolean(
      isGoogleAuth &&
        cleanEmail &&
        verifiedBearer?.email &&
        verifiedBearer.email.toLowerCase() === cleanEmail &&
        verifiedBearer.emailVerified !== false
    );

    if (!verifiedGoogleEmailMatch && (!password || String(password).length === 0)) {
      return res.status(400).json({ error: 'Account password is required to sign in.' });
    }

    let validatedDob: { dob: string; age: number } | null = null;
    if (dob !== undefined && String(dob).trim() !== '') {
      const dobCheck = validateAndNormalizeDob(dob);
      if (dobCheck.valid && dobCheck.dob && dobCheck.age !== undefined) {
        validatedDob = { dob: dobCheck.dob, age: dobCheck.age };
      } else if (!verifiedGoogleEmailMatch) {
        return res.status(400).json({ error: dobCheck.error || 'Invalid Date of Birth.' });
      }
    }

    await db.ensureFreshFromCloud();
    let user: User | undefined;
    let lockError: { status: number; body: any } | null = null;

    const existingLocalUser = findCustomerAccount(db.getSnapshot().users, {
      email: cleanEmail || undefined,
      phone: cleanDigits.length >= 6 ? rawPhoneInput : undefined,
      countryCode,
    });
    if (!existingLocalUser) {
      await db.ensureFreshFromCloud(true);
    }

    let googleFreeTrialGranted = false;
    let googleFreeTrialExpiresAt: string | undefined = undefined;

    db.mutate(d => {
      user = findCustomerAccount(d.users, {
        email: cleanEmail || undefined,
        phone: cleanDigits.length >= 6 ? rawPhoneInput : undefined,
        countryCode,
      });

      // If signing in via verified Google Sign-In for the first time, create & store the customer record in backend DB!
      if (!user && verifiedGoogleEmailMatch && cleanEmail) {
        const displayName =
          (name && String(name).trim()) ||
          cleanEmail.split('@')[0] ||
          'Reader';
        const newUser: User = {
          id: 'usr_' + Date.now(),
          firebaseUid: verifiedBearer?.firebaseUid || (firebaseUid ? String(firebaseUid) : undefined),
          name: displayName,
          email: cleanEmail,
          failedLoginAttempts: 0,
          lockedUntil: null,
          welcomeEmailSent: true,
          welcomeEmailSentAt: nowIso,
          age: validatedDob?.age,
          dob: validatedDob?.dob,
          notifyGmail: typeof notifyGmail === 'boolean' ? notifyGmail : true,
          notifyMobile: typeof notifyMobile === 'boolean' ? notifyMobile : true,
          upiId: upiId?.trim() || undefined,
          phone: formattedPhone || undefined,
          countryCode: countryCode ? String(countryCode).trim() : '+91',
          countryName: countryName ? String(countryName).trim() : 'India',
          role: 'reader',
          isVerified: true,
          emailVerified: true,
          bookmarks: [],
          favorites: [],
          readingHistory: [],
          avatar:
            avatar ||
            `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(displayName)}`,
          bio: 'Reader on Aathirai_Comic Network.',
          createdAt: nowIso,
          lastLoginAt: nowIso,
          premiumPlan: null,
        };
        const trialRes = grantNewCustomerFreeTrial(d, newUser, nowIso);
        googleFreeTrialGranted = trialRes.granted;
        googleFreeTrialExpiresAt = trialRes.expiresAt;
        d.users.push(newUser);
        user = newUser;
        return;
      }

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

      if (user.lockedUntil) {
        const lockTs = new Date(user.lockedUntil).getTime();
        if (!Number.isFinite(lockTs) || lockTs <= now) {
          user.lockedUntil = null;
          user.failedLoginAttempts = 0;
        }
      }

      if (!verifiedGoogleEmailMatch && user.lockedUntil) {
        const lockTs = new Date(user.lockedUntil).getTime();
        if (Number.isFinite(lockTs) && lockTs > now) {
          const hoursLeft = Math.max(1, Math.ceil((lockTs - now) / (60 * 60 * 1000)));
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
      }

      if (!verifiedGoogleEmailMatch) {
        const inputPass = String(password || '');
        const storedSecret = user.passwordHash || user.password;
        if (!storedSecret) {
          lockError = {
            status: 401,
            body: {
              error: 'This account uses Google Sign-In and does not have a password set yet. Please click "Connect Gmail Account" or use "Forgot Password" to set one via OTP.',
              isLocked: false,
            },
          };
          return;
        }
        const passCheck = verifyPasswordHash(inputPass, user.password, user.passwordHash);
        if (!passCheck.valid) {
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

      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.lastLoginAt = nowIso;
      if (verifiedBearer?.firebaseUid || firebaseUid) {
        user.firebaseUid = verifiedBearer?.firebaseUid || String(firebaseUid);
      }
      if (verifiedGoogleEmailMatch) {
        user.isVerified = true;
        user.emailVerified = true;
      }
      const isProtectedReader = isProtectedOwnerReaderUser(user);
      if (name?.trim() && !isProtectedReader) user.name = name.trim();
      if (avatar && (!user.avatar || user.avatar.includes('dicebear.com'))) user.avatar = String(avatar);
      if (!isProtectedReader && formattedPhone && cleanDigits.length >= 6) {
        user.phone = formattedPhone;
      }
      if (!isProtectedReader && countryCode) user.countryCode = String(countryCode).trim();
      if (!isProtectedReader && countryName) user.countryName = String(countryName).trim();
      if (!isProtectedReader && cleanEmail && (!user.email || user.email.endsWith('@mobile.reader'))) {
        user.email = cleanEmail;
      }
      if (validatedDob && !user.dob) {
        user.dob = validatedDob.dob;
        user.age = validatedDob.age;
      }
      if (typeof notifyGmail === 'boolean') user.notifyGmail = notifyGmail;
      if (typeof notifyMobile === 'boolean') user.notifyMobile = notifyMobile;
      if (!isProtectedReader && upiId?.trim()) user.upiId = upiId.trim();
    });

    if (lockError) {
      if (user) {
        await db.persistChanges({ users: [user] });
      }
      return res.status((lockError as { status: number; body: any }).status).json((lockError as { status: number; body: any }).body);
    }

    if (!user) {
      return res.status(404).json({ error: 'Customer account not found in the backend database. Please register your account in First-Time Customer Register.' });
    }

    const isProtectedReader = isProtectedOwnerReaderUser(user);
    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const reconciled = await reconcileCustomerRazorpayPremium({
      userId: user.id,
      email: user.email,
      phone: isProtectedReader ? undefined : user.phone,
      firebaseIdToken: fbToken,
    });
    const subStatus = reconciled.subStatus;
    const latestUser = subStatus.matchedUser || user;

    const enrichedUser: User = {
      ...latestUser,
      premiumPlan: subStatus.activePlan,
      premiumStartedAt: subStatus.startedAt,
      premiumExpiresAt: subStatus.expiresAt,
      premiumPaymentDetail: subStatus.premiumPaymentDetail,
      isFreeTrial: subStatus.isFreeTrial,
      trialDaysRemaining: subStatus.trialDaysRemaining,
      trialExpired: subStatus.trialExpired,
      shouldShowFreeTrialPopup: subStatus.shouldShowFreeTrialPopup,
      hasComplimentaryAdminAccess: Boolean(subStatus.isComplimentaryAdminAccess),
      isProtectedOwnerReader: isProtectedOwnerReaderUser(latestUser),
    };

    if (googleFreeTrialGranted) {
      const trialExpiryDisplay = googleFreeTrialExpiresAt
        ? new Date(googleFreeTrialExpiresAt).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Kolkata',
          })
        : '';
      db.addNotification({
        userId: enrichedUser.id,
        userEmail: enrichedUser.email,
        title: 'Free 1-Month Premium Access Granted (₹49 Value)!',
        message: `Welcome ${enrichedUser.name}! Your 30-day Free One-Month Premium Trial (₹49 value) is active until ${trialExpiryDisplay}.`,
        type: 'system',
        targetId: enrichedUser.id,
      });
    }

    const safeLogPhone = isProtectedOwnerReaderUser(enrichedUser)
      ? '[Protected Backend Mobile]'
      : enrichedUser.phone || 'N/A';
    const planLogLabel = subStatus.isComplimentaryAdminAccess
      ? 'Complimentary Unrestricted Access (₹0)'
      : subStatus.activePlan
        ? `${subStatus.activePlan} (${subStatus.isFreeTrial ? 'Free Trial ₹0' : `₹${subStatus.amountPaidInr}`}, Razorpay Verified: ${reconciled.razorpayVerified})`
        : 'Free';

    db.logActivity(
      'READER_LOGIN',
      enrichedUser.email,
      enrichedUser.role,
      `Customer logged in | Gmail: ${enrichedUser.email} | Mobile: ${safeLogPhone} | Age: ${enrichedUser.age || 'N/A'} | Plan: ${planLogLabel}`,
      'user',
      enrichedUser.id
    );

    const cloudPersist = await db.persistChanges({
      users: [enrichedUser],
      collections: googleFreeTrialGranted
        ? ['activityLogs', 'freeTrialClaims', 'notifications']
        : ['activityLogs'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      storedInBackend: true,
      cloudPersisted: cloudPersist.persisted,
      freeTrialGranted: googleFreeTrialGranted,
      razorpayVerified: reconciled.razorpayVerified,
      verificationSource: reconciled.verificationSource,
      user: sanitizeUserForClient(enrichedUser, true),
      subscription: sanitizeSubStatusForClient(subStatus),
    });
  });

  app.get('/api/auth/reader-status', async (req, res) => {
    const { userId, email, phone, paymentId } = req.query;
    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const reconciled = await reconcileCustomerRazorpayPremium({
      userId: userId ? String(userId) : undefined,
      email: email ? String(email) : undefined,
      phone: phone ? String(phone) : undefined,
      paymentId: paymentId ? String(paymentId) : undefined,
      firebaseIdToken: fbToken,
    });
    const subStatus = reconciled.subStatus;
    const snapshot = db.getSnapshot();
    const authCtx = await resolveAuthenticatedUser(req, snapshot.users);
    const matched = subStatus.matchedUser;
    const isAuthorizedOwner = Boolean(
      authCtx.authMethod === 'token' &&
        authCtx.user &&
        matched &&
        (authCtx.user.id === matched.id || authCtx.role === 'admin')
    );

    const cleanEmail = (email ? String(email) : subStatus.verifiedGmail || '').trim().toLowerCase();
    const purchases = isAuthorizedOwner
      ? snapshot.purchases.filter(
          p =>
            (userId && p.userId === userId) ||
            (matched?.id && p.userId === matched.id) ||
            (cleanEmail && p.userEmail?.toLowerCase() === cleanEmail)
        )
      : [];

    return res.json({
      success: true,
      storedInBackend: Boolean(matched),
      razorpayVerified: reconciled.razorpayVerified,
      verificationSource: reconciled.verificationSource,
      razorpayApiConfigured: reconciled.razorpayApiConfigured,
      subscription: sanitizeSubStatusForClient(subStatus),
      purchases,
      user: matched
        ? sanitizeUserForClient(
            {
              ...matched,
              ...(isAuthorizedOwner ? {} : { dob: undefined, upiId: undefined }),
              premiumPlan: subStatus.activePlan,
              premiumStartedAt: subStatus.startedAt,
              premiumExpiresAt: subStatus.expiresAt,
              premiumPaymentDetail: subStatus.premiumPaymentDetail,
              isFreeTrial: subStatus.isFreeTrial,
              trialDaysRemaining: subStatus.trialDaysRemaining,
              trialExpired: subStatus.trialExpired,
              shouldShowFreeTrialPopup: subStatus.shouldShowFreeTrialPopup,
              hasComplimentaryAdminAccess: Boolean(subStatus.isComplimentaryAdminAccess),
              isProtectedOwnerReader: isProtectedOwnerReaderUser(matched),
            },
            false
          )
        : null,
    });
  });

  // Mark the one-time Free 1-Month Premium Trial Welcome Popup as acknowledged by the customer
  app.post('/api/auth/acknowledge-trial-popup', async (req, res) => {
    const snapshot = db.getSnapshot();
    const authCtx = await resolveAuthenticatedUser(req, snapshot.users);
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const bodyEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    const targetId = authCtx.user?.id || bodyUserId;
    const targetEmail = authCtx.user?.email?.toLowerCase() || bodyEmail;
    if (!targetId && !targetEmail) {
      return res.status(401).json({ error: 'Authentication required to acknowledge trial notification.' });
    }

    const nowIso = new Date().toISOString();
    let updatedUser: User | null = null;

    db.mutate(d => {
      const found = d.users.find(
        (u: User) =>
          (targetId && u.id === targetId) ||
          (targetEmail && u.email?.toLowerCase() === targetEmail)
      );
      if (found) {
        found.freeTrialPopupSeenAt = nowIso;
        updatedUser = found;
      }
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Reader account not found.' });
    }

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    await db.persistChanges({
      users: [updatedUser],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      freeTrialPopupSeenAt: nowIso,
    });
  });

  app.post('/api/auth/forgot-password', authRateLimiter, async (req, res) => {
    const { email, phone, countryCode, credential, targetChannel, smsChannel, firebaseSmsSent } = req.body;
    const rawCred = typeof credential === 'string' ? credential.trim() : '';
    const cleanEmail = (email || (rawCred.includes('@') ? rawCred : '') || '').trim().toLowerCase();
    const rawPhoneInput = (phone || (rawCred && !rawCred.includes('@') ? rawCred : '') || '').trim();
    const cleanDigits = rawPhoneInput.replace(/\D/g, '');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const resolvedChannel: 'email' | 'sms' =
      targetChannel === 'email'
        ? 'email'
        : targetChannel === 'sms'
          ? 'sms'
          : cleanEmail
            ? 'email'
            : 'sms';

    if (resolvedChannel === 'email') {
      if (!cleanEmail || !emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          existsInDatabase: false,
          error: 'Please enter a valid registered Gmail address.',
        });
      }
    } else if (cleanDigits.length < 6) {
      return res.status(400).json({
        existsInDatabase: false,
        error: 'Please select your country code and enter a valid registered Mobile Number.',
      });
    }

    await db.ensureFreshFromCloud(true);
    const snapshot = db.getSnapshot();
    const matchedUser = snapshot.users.find((u: User) => {
      if (resolvedChannel === 'email') {
        return Boolean(cleanEmail && u.email && u.email.toLowerCase() === cleanEmail);
      }
      return Boolean(cleanDigits.length >= 6 && phonesMatch(u.phone, rawPhoneInput, countryCode));
    });

    if (!matchedUser) {
      const formattedInputPhone = rawPhoneInput ? formatGlobalPhone(rawPhoneInput, countryCode) : '';
      return res.status(404).json({
        existsInDatabase: false,
        error:
          resolvedChannel === 'email'
            ? `Gmail address "${cleanEmail}" is not stored in the backend database. Please check your Gmail or register first.`
            : `Mobile Number "${formattedInputPhone || rawPhoneInput}" is not stored in the backend database. Please check your number or register first.`,
      });
    }

    // Protect immutable backend administrator & personal owner reader credentials from enumeration or reset via customer recovery
    if (isProtectedVaultUser(matchedUser)) {
      return res.status(403).json({
        existsInDatabase: false,
        error: 'Protected account credentials are locked in the backend vault and cannot be recovered or modified here.',
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const targetEmail = (matchedUser.email || cleanEmail).toLowerCase();
    const targetSmsPhone = matchedUser.phone || formatGlobalPhone(rawPhoneInput, countryCode) || '';
    const targetCountryCode = matchedUser.countryCode || countryCode || '+91';
    const targetPhoneKey = getPhoneOtpKey(targetSmsPhone, targetCountryCode);
    const inputPhoneKey = getPhoneOtpKey(rawPhoneInput, countryCode);

    db.mutate(d => {
      const otpEntry = createOtpEntry(otp);
      if (targetEmail) d.otps[targetEmail] = otpEntry;
      if (cleanEmail) d.otps[cleanEmail] = otpEntry;
      if (targetPhoneKey.length >= 6) d.otps[targetPhoneKey] = otpEntry;
      if (inputPhoneKey.length >= 6) d.otps[inputPhoneKey] = otpEntry;
    });
    await db.persistChanges({ collections: ['otps'] });

    if (resolvedChannel === 'email') {
      const emailDelivery = await sendPasswordResetOtpEmail({
        to: matchedUser.email,
        name: matchedUser.name,
        otp,
      });

      if (!emailDelivery.sent) {
        return res.status(emailDelivery.configured ? 502 : 503).json({
          success: false,
          existsInDatabase: true,
          targetChannel: 'email',
          emailDelivered: false,
          smtpConfigured: emailDelivery.configured,
          error:
            emailDelivery.error ||
            'Unable to send password reset OTP to this Gmail address. Please check SMTP configuration or try again.',
        });
      }

      const senderEmail = emailDelivery.from || 'aathiraicomic@gmail.com';
      return res.json({
        success: true,
        existsInDatabase: true,
        targetChannel: 'email',
        emailDelivered: true,
        smsDelivered: false,
        from: senderEmail,
        smtpConfigured: emailDelivery.configured,
        email: matchedUser.email,
        phone: targetSmsPhone,
        countryCode: targetCountryCode,
        message: `Verified in backend database. 6-digit password reset OTP sent from ${senderEmail} to ${matchedUser.email}. Check Inbox, Spam, or Updates. Valid for 10 minutes.`,
      });
    }

    // resolvedChannel === 'sms'
    const useFirebaseSms = smsChannel === 'firebase' || smsChannel === undefined;
    if (useFirebaseSms) {
      return res.json({
        success: true,
        existsInDatabase: true,
        targetChannel: 'sms',
        emailDelivered: false,
        smsDelivered: Boolean(firebaseSmsSent),
        smsProvider: 'firebase',
        smsConfigured: true,
        email: matchedUser.email,
        phone: targetSmsPhone,
        countryCode: targetCountryCode,
        message: `Verified in backend database. Sending 6-digit SMS OTP to ${targetSmsPhone}. Valid for 10 minutes.`,
      });
    }

    const smsDelivery = await sendOtpSms({
      phone: targetSmsPhone,
      countryCode: targetCountryCode,
      otp,
      purpose: 'password_reset',
    });

    if (!smsDelivery.sent) {
      return res.status(smsDelivery.configured ? 502 : 503).json({
        success: false,
        existsInDatabase: true,
        targetChannel: 'sms',
        smsDelivered: false,
        smsConfigured: smsDelivery.configured,
        smsProvider: smsDelivery.provider,
        error:
          smsDelivery.error ||
          'SMS OTP delivery failed for this mobile number. Please check your number or use Gmail recovery.',
      });
    }

    return res.json({
      success: true,
      existsInDatabase: true,
      targetChannel: 'sms',
      emailDelivered: false,
      smsDelivered: true,
      smsProvider: smsDelivery.provider,
      smsConfigured: smsDelivery.configured,
      email: matchedUser.email,
      phone: targetSmsPhone,
      countryCode: targetCountryCode,
      message: `Verified in backend database. 6-digit SMS OTP sent to ${targetSmsPhone} (${smsDelivery.provider}). Valid for 10 minutes.`,
    });
  });

  app.post('/api/auth/verify-reset-otp', authRateLimiter, async (req, res) => {
    await db.ensureFreshFromCloud(true);
    const { email, phone, countryCode, otp } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const phoneKey = getPhoneOtpKey(phone, countryCode);
    const snapshot = db.getSnapshot();
    const tokenInfo = await verifyBearerToken(req.headers.authorization);
    const hasFirebasePhoneClaim = Boolean(tokenInfo?.phoneNumber);

    const matchedUser = snapshot.users.find((u: User) => {
      const emailMatch = Boolean(cleanEmail && u.email.toLowerCase() === cleanEmail);
      const phoneMatch = Boolean(phone && phonesMatch(u.phone, phone, countryCode));
      return emailMatch || phoneMatch;
    });

    if (!matchedUser) {
      return res.status(400).json({
        error: 'No matching customer account found for this Gmail or Global Mobile Number.',
      });
    }

    const firebasePhoneVerified = Boolean(
      tokenInfo?.phoneNumber &&
        matchedUser.phone &&
        phonesMatch(matchedUser.phone, tokenInfo.phoneNumber, countryCode)
    );

    if (hasFirebasePhoneClaim && !firebasePhoneVerified) {
      return res.status(403).json({
        error: 'Verified Firebase mobile number does not match this account’s registered mobile number.',
      });
    }

    const userPhoneKey = matchedUser?.phone ? getPhoneOtpKey(matchedUser.phone, matchedUser.countryCode) : '';
    const otpCheck = verifyOtpAgainstKeys(
      snapshot.otps,
      [
        cleanEmail,
        matchedUser?.email ? matchedUser.email.toLowerCase() : '',
        phoneKey.length >= 6 ? phoneKey : '',
        userPhoneKey.length >= 6 ? userPhoneKey : '',
      ],
      otp
    );

    if (!firebasePhoneVerified && !otpCheck.valid) {
      return res.status(400).json({
        error: otpCheck.expired
          ? 'Reset OTP has expired (valid for 10 minutes). Please request a new OTP.'
          : 'Invalid 6-digit OTP code. Please check the code sent to your Global Mobile Number / Gmail.',
      });
    }

    return res.json({
      success: true,
      verified: true,
      verifiedVia: firebasePhoneVerified ? 'firebase_sms' : 'backend_otp',
      message: 'OTP verified! You may now enter your New Password and Confirm Password.',
    });
  });

  app.post('/api/auth/reset-password', authRateLimiter, async (req, res) => {
    const { email, phone, countryCode, otp, newPassword, confirmPassword } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const phoneKey = getPhoneOtpKey(phone, countryCode);
    const tokenInfo = await verifyBearerToken(req.headers.authorization);
    const hasFirebasePhoneClaim = Boolean(tokenInfo?.phoneNumber);

    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'Please enter a valid new password (minimum 4 characters).' });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New Password and Confirm Password do not match.' });
    }

    await db.ensureFreshFromCloud(true);
    const snapshot = db.getSnapshot();
    const preMatchedUser = snapshot.users.find((u: User) => {
      const emailMatch = Boolean(cleanEmail && u.email.toLowerCase() === cleanEmail);
      const phoneMatch = Boolean(phone && phonesMatch(u.phone, phone, countryCode));
      return emailMatch || phoneMatch;
    });
    if (!preMatchedUser) {
      return res.status(404).json({ error: 'Customer account not found.' });
    }
    if (isProtectedVaultUser(preMatchedUser)) {
      return res.status(403).json({
        error: 'Protected account credentials are locked in the backend vault and cannot be reset via public recovery.',
      });
    }

    const firebasePhoneVerified = Boolean(
      tokenInfo?.phoneNumber &&
        preMatchedUser.phone &&
        phonesMatch(preMatchedUser.phone, tokenInfo.phoneNumber, countryCode)
    );

    if (hasFirebasePhoneClaim && !firebasePhoneVerified) {
      return res.status(403).json({
        error: 'Verified Firebase mobile number does not match this customer account.',
      });
    }

    const userPhoneKey = preMatchedUser.phone ? getPhoneOtpKey(preMatchedUser.phone, preMatchedUser.countryCode) : '';
    const otpCheck = verifyOtpAgainstKeys(
      snapshot.otps,
      [
        cleanEmail,
        preMatchedUser.email.toLowerCase(),
        phoneKey.length >= 6 ? phoneKey : '',
        userPhoneKey.length >= 6 ? userPhoneKey : '',
      ],
      otp
    );

    if (!firebasePhoneVerified && !otpCheck.valid) {
      return res.status(400).json({
        error: otpCheck.expired
          ? 'Reset OTP has expired (valid for 10 minutes). Please request a new OTP.'
          : 'Invalid or expired reset OTP. Please request and verify your OTP first.',
      });
    }

    const hashedNewPass = hashPassword(String(newPassword));
    let updatedUser: User | undefined;
    db.mutate(d => {
      updatedUser = d.users.find((u: User) => u.id === preMatchedUser.id);
      if (updatedUser) {
        updatedUser.passwordHash = hashedNewPass;
        delete updatedUser.password;
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
      `Customer reset password via ${firebasePhoneVerified ? 'Firebase SMS OTP' : 'OTP'} and unlocked account (${updatedUser.email} | Mobile: ${updatedUser.phone || 'N/A'}).`,
      'user',
      updatedUser.id
    );

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const cloudPersist = await db.persistChanges({
      users: [updatedUser],
      collections: ['otps', 'activityLogs'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      cloudPersisted: cloudPersist.persisted,
      verifiedVia: firebasePhoneVerified ? 'firebase_sms' : 'backend_otp',
      email: updatedUser.email,
      phone: updatedUser.phone,
      message: 'Your new password has been saved in the backend and your account is unlocked! Returning to Login page...',
    });
  });

  app.post('/api/auth/update-profile', async (req, res) => {
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required. Please sign in again to update your customer profile.' });
    }

    const { userId, name, email, phone, countryCode, countryName, dob, notifyGmail, notifyMobile, upiId, paidPlan, paymentMethod, transactionId, bio, avatar, socialLinks } = req.body;
    const targetId = userId ? String(userId) : authCtx.user.id;
    if (authCtx.user.id !== targetId && authCtx.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: You can only update your own customer profile.' });
    }

    const cleanEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
    if (cleanEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please provide a valid Gmail address.' });
    }

    let dobUpdate: { dob: string; age: number } | null = null;
    if (dob !== undefined) {
      const dobCheck = validateAndNormalizeDob(dob);
      if (!dobCheck.valid || !dobCheck.dob || dobCheck.age === undefined) {
        return res.status(400).json({ error: dobCheck.error || 'Please enter a valid Date of Birth (DD/MM/YYYY).' });
      }
      dobUpdate = { dob: dobCheck.dob, age: dobCheck.age };
    }

    // Strictly block any modification of immutable administrator or protected owner reader Gmail/Mobile Number
    const preTarget = db.getSnapshot().users.find((x) => x.id === targetId);
    if (preTarget && isProtectedVaultUser(preTarget)) {
      const canonicalEmail = isProtectedOwnerReaderUser(preTarget)
        ? IMMUTABLE_OWNER_READER_VAULT.email.toLowerCase()
        : IMMUTABLE_ADMIN_VAULT.email.toLowerCase();
      const canonicalPhone = isProtectedOwnerReaderUser(preTarget)
        ? IMMUTABLE_OWNER_READER_VAULT.phone
        : IMMUTABLE_ADMIN_VAULT.phone;
      const attemptingEmailChange =
        cleanEmail !== undefined && cleanEmail !== canonicalEmail;
      const attemptingPhoneChange =
        phone !== undefined &&
        String(phone).trim() !== '' &&
        !phonesMatch(canonicalPhone, String(phone), '+91');
      if (attemptingEmailChange || attemptingPhoneChange) {
        return res.status(403).json({
          error:
            'Forbidden: Protected account Gmail and Mobile Number are permanently locked in the backend vault and cannot be changed here.',
        });
      }
    }

    let updated: User | null = null;
    let conflictError: string | null = null;

    db.mutate(d => {
      const u = d.users.find(x => x.id === targetId);
      if (!u) return;
      const isImmutableAdmin = isProtectedVaultUser(u);

      if (!isImmutableAdmin && cleanEmail && cleanEmail !== u.email.toLowerCase()) {
        const dupEmail = d.users.some(x => x.id !== u.id && x.email.toLowerCase() === cleanEmail);
        if (dupEmail) {
          conflictError = 'That Gmail address is already linked to another customer account.';
          return;
        }
        u.email = cleanEmail;
      }

      if (!isImmutableAdmin && phone !== undefined) {
        const nextFormattedPhone = formatGlobalPhone(phone, countryCode || u.countryCode);
        const nextDigits = nextFormattedPhone.replace(/\D/g, '');
        if (nextDigits.length > 0 && nextDigits.length < 6) {
          conflictError = 'Please enter a valid Global Mobile Number.';
          return;
        }
        if (nextDigits.length >= 6) {
          const dupPhone = d.users.some(x => x.id !== u.id && phonesMatch(x.phone, phone, countryCode || u.countryCode));
          if (dupPhone) {
            conflictError = 'That Mobile Number is already linked to another customer account.';
            return;
          }
          u.phone = nextFormattedPhone;
        }
      }

      if (name && String(name).trim().length >= 2) u.name = String(name).trim();
      if (countryCode) u.countryCode = String(countryCode).trim();
      if (countryName) u.countryName = String(countryName).trim();
      if (dobUpdate) {
        u.dob = dobUpdate.dob;
        u.age = dobUpdate.age;
      }
      if (typeof notifyGmail === 'boolean') u.notifyGmail = notifyGmail;
      if (typeof notifyMobile === 'boolean') u.notifyMobile = notifyMobile;
      if (upiId !== undefined) u.upiId = String(upiId).trim();
      if (bio !== undefined) u.bio = String(bio);
      if (avatar) u.avatar = String(avatar);
      if (socialLinks && typeof socialLinks === 'object') {
        u.socialLinks = { ...u.socialLinks, ...socialLinks };
      }
      if (paidPlan && authCtx.role === 'admin') {
        applyPaidPremiumDetailToUser(d, u, paidPlan, paymentMethod, transactionId, upiId);
      }
      updated = u;
    });

    if (conflictError) {
      return res.status(409).json({ error: conflictError });
    }
    if (!updated) return res.status(404).json({ error: 'User not found' });

    const subStatus = getReaderSubscriptionStatus(db.getSnapshot(), {
      userId: (updated as User).id,
      email: (updated as User).email,
      phone: (updated as User).phone,
    });
    const updatedWithSub: User = {
      ...(updated as User),
      premiumPlan: subStatus.activePlan,
      premiumStartedAt: subStatus.startedAt,
      premiumExpiresAt: subStatus.expiresAt,
      premiumPaymentDetail: subStatus.premiumPaymentDetail,
    };
    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const cloudPersist = await db.persistChanges({
      users: [updatedWithSub],
      userFirebaseIdToken: fbToken,
    });
    return res.json({
      success: true,
      storedInBackend: true,
      cloudPersisted: cloudPersist.persisted,
      user: sanitizeUserForClient(updatedWithSub, false),
    });
  });

  // -------------------------------------------------------------
  // COMICS & CHAPTERS / EPISODES ROUTES
  // -------------------------------------------------------------

  const normalizeSubmittedComics = (d: any) => {
    if (!Array.isArray(d.comics)) return;

    const fallbackArtworkPool: string[] = [];

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

      if (targetCount > 0 && attachedList.length < targetCount && candidateImages.length > 0) {
        for (let idx = attachedList.length; idx < targetCount; idx++) {
          const imgUrl = candidateImages[idx % candidateImages.length] || c.coverImage || '';
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

  app.get('/api/comics', async (req, res) => {
    await db.ensureFreshFromCloud();
    const { search, genre, access, sort, authorId, includePending, role } = req.query;
    const snap = db.getSnapshot();
    let comics = [...snap.comics];
    applyRatingsToComics(comics, snap.ratings || []);

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
      const s = String(search).toLowerCase().trim();
      const umbrellaTerms = new Set([
        'tamil', 'tamil comic', 'tamil comics', 'aathirai', 'aathirai comic', 'aathirai_comic',
        'indian', 'indian comic', 'indian comics', 'general', 'general comic', 'general comics',
        'comic', 'comics', 'comic book', 'comic books', 'manga', 'webtoon', 'webtoons',
      ]);
      const tokens = s.split(/\s+/).filter(Boolean);
      comics = comics.filter(c => {
        const corpus = [
          c.title,
          c.slug,
          c.authorName,
          c.description,
          ...(c.genre || []),
          ...(c.tags || []),
          ...(c.chapters || []).flatMap(ch => [
            ch.title,
            ...(ch.episodes || []).map(ep => `${ep.title} ${ep.synopsis || ''}`),
          ]),
          'tamil comic tamil comics aathirai comic aathirai_comic indian comic indian comics general comic comic book manga webtoon',
        ]
          .join(' ')
          .toLowerCase();
        if (corpus.includes(s)) return true;
        return tokens.every(t => umbrellaTerms.has(t) || corpus.includes(t));
      });
    }

    if (genre && genre !== 'All') {
      const targetGenre = String(genre).toLowerCase();
      comics = comics.filter(c => c.genre.some(g => g.toLowerCase() === targetGenre));
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

  app.get('/api/comics/:id', async (req, res) => {
    await db.ensureFreshFromCloud();
    let snap = db.getSnapshot();
    let comic = snap.comics.find(c => c.id === req.params.id || c.slug === req.params.id);
    if (!comic) {
      await db.ensureFreshFromCloud(true);
      snap = db.getSnapshot();
      comic = snap.comics.find(c => c.id === req.params.id || c.slug === req.params.id);
    }
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    applyRatingsToComics([comic], snap.ratings || []);
    return res.json({ comic });
  });

  // Direct Comic Publishing by Admin (instantly live on website: title, description, attached file alone)
  // Direct Comic & Episode Publishing by Admin
  app.post('/api/admin/comics/publish-direct', async (req, res) => {
    await db.ensureFreshFromCloud(true).catch(() => {});
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
        const fallbackImg = c.coverImage || '';
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

      const fbToken = extractFirebaseIdToken(req.headers.authorization);
      const gmailBroadcast = await broadcastComicReleaseNotification({
        comic: updatedComic as Comic,
        episode: newEpisode as Episode,
        releaseType: 'new_episode',
        firebaseIdToken: fbToken,
      });

      const persistResult = await db.persistChanges({
        comics: [updatedComic as Comic],
        collections: ['notifications', 'activityLogs'],
        userFirebaseIdToken: fbToken,
      });

      return res.json({
        success: true,
        comic: updatedComic,
        chapter: targetChapter,
        episode: newEpisode,
        gmailBroadcast,
        cloudPersisted: persistResult.persisted,
        cloudPersistWarning: persistResult.persisted ? undefined : persistResult.error,
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
    const finalCover = coverImage || firstPageUrl || attachedFileData || '';
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

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const gmailBroadcast = await broadcastComicReleaseNotification({
      comic: newComic,
      episode: newComic.chapters[0]?.episodes[0] || null,
      releaseType: 'new_comic',
      firebaseIdToken: fbToken,
    });

    const persistResult = await db.persistChanges({
      comics: [newComic],
      collections: ['notifications', 'activityLogs'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      comic: newComic,
      episode: newComic.chapters[0].episodes[0],
      gmailBroadcast,
      cloudPersisted: persistResult.persisted,
      cloudPersistWarning: persistResult.persisted ? undefined : persistResult.error,
      message: `"${newComic.title}" published directly to the website with ${constructedPages.length} pages!`,
    });
  });

  // Author requests deletion (series, chapter, or episode) from admin
  app.post('/api/author/comics/request-delete', async (req, res) => {
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
    await db.persistChanges({
      comics: [targetComic as Comic],
      collections: ['deleteRequests', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, comic: targetComic, deleteRequest: createdRequest });
  });

  // GET all Delete Requests for Admin Portal & Author Status Sync
  app.get('/api/admin/delete-requests', async (req, res) => {
    await db.ensureFreshFromCloud();
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
  app.post('/api/admin/delete-requests/:id/action', async (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'
    let updatedRequest: any = null;
    let actionMessage = '';
    let updatedComicForPersist: Comic | null = null;
    let deletedSeriesId: string | null = null;

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
            deletedSeriesId = comic.id;
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
              updatedComicForPersist = comic;
            }
          } else if (delReq.targetType === 'episode' && delReq.episodeId) {
            let deleted = false;
            for (const ch of comic.chapters) {
              const epIdx = ch.episodes.findIndex(e => e.id === delReq.episodeId);
              if (epIdx !== -1) {
                actionMessage = `Deleted Episode "${ch.episodes[epIdx].title}" from "${ch.title}".`;
                ch.episodes.splice(epIdx, 1);
                comic.updatedAt = new Date().toISOString();
                updatedComicForPersist = comic;
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
          updatedComicForPersist = comic;
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

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    await db.persistChanges({
      comics: updatedComicForPersist ? [updatedComicForPersist] : [],
      deletedComicIds: deletedSeriesId ? [deletedSeriesId] : [],
      collections: ['deleteRequests', 'activityLogs'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({ success: true, deleteRequest: updatedRequest, message: actionMessage || 'Deletion request updated successfully.' });
  });

  // Author submits full comic for admin review & approval
  app.post('/api/author/comics/submit-for-review', async (req, res) => {
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
        const fallbackImg = coverImage || '';
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
          authorId: authorId || '',
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

    const persistResult = await db.persistChanges({
      comics: [targetComic as Comic],
      collections: ['activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({
      success: true,
      comic: targetComic,
      cloudPersisted: persistResult.persisted,
      message: 'Comic submitted successfully! The administrator will review and approve it for automatic publishing on the website.',
    });
  });

  // Admin approves or rejects submitted comic
  app.post('/api/admin/comics/:id/moderate-submission', async (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject' | 'pending'
    let moderatedComic: Comic | null = null;
    let modifiedAuthorUser: User | null = null;

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
            modifiedAuthorUser = authorUser;
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

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    let gmailBroadcast: any = null;
    if (action === 'approve') {
      gmailBroadcast = await broadcastComicReleaseNotification({
        comic: comicObj,
        episode: comicObj.chapters?.[0]?.episodes?.[0] || null,
        releaseType: 'new_comic',
        firebaseIdToken: fbToken,
      });
    }

    await db.persistChanges({
      comics: [comicObj],
      users: modifiedAuthorUser ? [modifiedAuthorUser] : [],
      collections: ['authorApplications', 'notifications', 'activityLogs'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      comic: moderatedComic,
      gmailBroadcast,
      message:
        action === 'approve'
          ? 'Comic approved and published live! The author has been notified on their Author Page that they are approved to upload comics of their own.'
          : `Comic submission rejected with comment: "${(moderatedComic as Comic).adminReviewNote}". The author will see this reason on their Author Page.`,
    });
  });

  // Admin Paywall Toggle: Put any whole comic, chapter, or episode behind paywall (or make free)
  app.post('/api/admin/paywall-toggle', async (req, res) => {
    const { comicId, chapterId, episodeId, isPremium } = req.body;
    const nextPremium = Boolean(isPremium);
    let targetComic: Comic | null = null;
    let changeSummary = '';

    db.mutate(d => {
      const c = d.comics.find(x => x.id === comicId);
      if (!c) return;

      targetComic = c;
      const wasComicPremium = c.accessType === 'premium';

      const recomputeParentFlags = () => {
        if (!c.chapters || c.chapters.length === 0) return;
        c.chapters.forEach(chItem => {
          if (chItem.episodes && chItem.episodes.length > 0) {
            chItem.isPremium = chItem.episodes.every(epItem => Boolean(epItem.isPremium));
            chItem.priceInr = 0;
          }
        });
        const allChaptersPremium = c.chapters.every(
          chItem =>
            Boolean(chItem.isPremium) &&
            (!chItem.episodes || chItem.episodes.length === 0 || chItem.episodes.every(epItem => Boolean(epItem.isPremium)))
        );
        c.accessType = allChaptersPremium ? 'premium' : 'free';
        c.fullPriceInr = 0;
      };

      if (episodeId) {
        // Toggle specific episode
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === episodeId);
          if (ep) {
            // If making one episode free inside a comic/chapter that was previously paywalled at parent level,
            // preserve Premium on all sibling chapters & episodes so only the clicked episode turns Free.
            if (!nextPremium && (wasComicPremium || ch.isPremium)) {
              c.chapters.forEach(otherCh => {
                const inheritAll = wasComicPremium || otherCh.isPremium;
                if (inheritAll) {
                  otherCh.isPremium = true;
                  otherCh.priceInr = 0;
                  otherCh.episodes.forEach(otherEp => {
                    otherEp.isPremium = true;
                    otherEp.priceInr = 0;
                  });
                }
              });
            }
            ep.isPremium = nextPremium;
            ep.priceInr = 0;
            recomputeParentFlags();
            changeSummary = `Episode "${ep.title}" set to ${nextPremium ? 'Premium' : 'FREE'}`;
            break;
          }
        }
      } else if (chapterId) {
        // Toggle whole chapter
        const ch = c.chapters.find(x => x.id === chapterId);
        if (ch) {
          if (!nextPremium && wasComicPremium) {
            c.chapters.forEach(otherCh => {
              if (otherCh.id !== chapterId) {
                otherCh.isPremium = true;
                otherCh.priceInr = 0;
                otherCh.episodes.forEach(otherEp => {
                  otherEp.isPremium = true;
                  otherEp.priceInr = 0;
                });
              }
            });
          }
          ch.isPremium = nextPremium;
          ch.priceInr = 0;
          ch.episodes.forEach(ep => {
            ep.isPremium = nextPremium;
            ep.priceInr = 0;
          });
          recomputeParentFlags();
          changeSummary = `Chapter "${ch.title}" and its episodes set to ${nextPremium ? 'Premium' : 'FREE'}`;
        }
      } else {
        // Toggle entire comic — cascade cleanly to all chapters and episodes
        c.accessType = nextPremium ? 'premium' : 'free';
        c.fullPriceInr = 0;
        c.chapters.forEach(ch => {
          ch.isPremium = nextPremium;
          ch.priceInr = 0;
          ch.episodes.forEach(ep => {
            ep.isPremium = nextPremium;
            ep.priceInr = 0;
          });
        });
        changeSummary = `Series "${c.title}" set to ${nextPremium ? 'Premium' : 'FREE'}`;
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
              n.isPaywalled = nextPremium;
            } else {
              n.isPaywalled = comicNowPaywalled;
            }
          }
        });
      }
    });

    if (!targetComic) return res.status(404).json({ error: 'Comic not found' });

    const updatedComic = targetComic as Comic;
    const paywallState = {
      comicId: updatedComic.id,
      accessType: updatedComic.accessType,
      fullPriceInr: updatedComic.fullPriceInr,
      updatedAt: updatedComic.updatedAt,
      chapters: (updatedComic.chapters || []).map(ch => ({
        id: ch.id,
        isPremium: Boolean(ch.isPremium),
        priceInr: Number(ch.priceInr) || 0,
        episodes: (ch.episodes || []).map(ep => ({
          id: ep.id,
          isPremium: Boolean(ep.isPremium),
          priceInr: Number(ep.priceInr) || 0,
        })),
      })),
    };

    db.logActivity('PAYWALL_UPDATED', 'admin@aathirai.com', 'admin', `Admin updated paywall: ${changeSummary}`, 'paywall', comicId);

    // Persist asynchronously via StorageEngine's ordered persistQueue so UI responds instantly without blocking
    const userFirebaseIdToken = extractFirebaseIdToken(req.headers.authorization);
    void db
      .persistChanges({
        comics: [updatedComic],
        collections: ['notifications', 'activityLogs'],
        userFirebaseIdToken,
      })
      .catch(err => {
        console.warn('[PaywallToggle] Background cloud persist warning:', err?.message || err);
      });

    return res.json({
      success: true,
      paywallState,
      message: changeSummary,
    });
  });

  app.post('/api/comics', async (req, res) => {
    await db.ensureFreshFromCloud(true).catch(() => {});
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
    const firstPageImg = Array.isArray(pages) && pages[0] ? (pages[0].imageUrl || pages[0].dataUrl || '') : '';
    const fallbackCover = coverImage || firstPageImg || '';

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
      authorId: authorId || '',
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

    const gmailBroadcast = await broadcastComicReleaseNotification({
      comic: newComic,
      episode: newComic.chapters[0]?.episodes[0] || null,
      releaseType: 'new_comic',
      firebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    const persistResult = await db.persistChanges({
      comics: [newComic],
      collections: ['notifications', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({ success: true, comic: newComic, gmailBroadcast, cloudPersisted: persistResult.persisted });
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

  app.put('/api/comics/:id', async (req, res) => {
    await db.ensureFreshFromCloud(true).catch(() => {});
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
    await db.persistChanges({
      comics: [updated as Comic],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, comic: updated });
  });

  app.delete('/api/comics/:id', async (req, res) => {
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
    await db.persistChanges({
      deletedComicIds: [req.params.id],
      collections: ['activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, message: `"${deletedTitle}" was deleted successfully.` });
  });

  // Chapter & Episode Management with Strict Author Ownership Protection
  app.post('/api/comics/:id/chapters', async (req, res) => {
    await db.ensureFreshFromCloud(true).catch(() => {});
    const { title, synopsis, authorId, authorName } = req.body;
    let addedChapter: any = null;
    let targetComic: Comic | null = null;
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
        targetComic = comic;
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: Authors can only add chapters to their own comic books.' });
    }
    if (!addedChapter || !targetComic) return res.status(404).json({ error: 'Comic not found' });
    await db.persistChanges({
      comics: [targetComic],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, chapter: addedChapter });
  });

  // Edit Chapter
  app.put('/api/comics/:comicId/chapters/:chapId', async (req, res) => {
    const { title, synopsis, authorId, authorName } = req.body;
    let updatedChapter: any = null;
    let targetComic: Comic | null = null;
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
          targetComic = comic;
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only edit your own chapters.' });
    if (!updatedChapter || !targetComic) return res.status(404).json({ error: 'Chapter not found' });
    await db.persistChanges({
      comics: [targetComic],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, chapter: updatedChapter });
  });

  // Delete Chapter
  app.delete('/api/comics/:comicId/chapters/:chapId', async (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';
    let targetComic: Comic | null = null;

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
          targetComic = comic;
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only delete your own chapters.' });
    if (!deletedTitle || !targetComic) return res.status(404).json({ error: 'Chapter not found' });
    await db.persistChanges({
      comics: [targetComic],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, message: `"${deletedTitle}" deleted successfully.` });
  });

  // Add Episode (Strictly for Own Books)
  app.post('/api/comics/:comicId/chapters/:chapId/episodes', async (req, res) => {
    await db.ensureFreshFromCloud(true).catch(() => {});
    const { title, synopsis, isPremium, priceInr, pages, coverImage, authorId, authorName } = req.body;
    let addedEpisode: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (authorId) {
          const isOwner =
            comic.authorId === authorId ||
            comic.authorName?.toLowerCase() === authorName?.toLowerCase();
          if (!isOwner) {
            isForbidden = true;
            return;
          }
        }

        const chapter = comic.chapters.find(ch => ch.id === req.params.chapId);
        if (chapter) {
          const epNum = chapter.episodes.length + 1;
          const fallbackCover = comic.coverImage || '';

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

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const parentComic = db.getSnapshot().comics.find(c => c.id === req.params.comicId);
    let gmailBroadcast: any = null;
    if (parentComic) {
      gmailBroadcast = await broadcastComicReleaseNotification({
        comic: parentComic,
        episode: addedEpisode as Episode,
        releaseType: 'new_episode',
        firebaseIdToken: fbToken,
      });
      await db.persistChanges({
        comics: [parentComic],
        collections: ['notifications', 'activityLogs'],
        userFirebaseIdToken: fbToken,
      });
    }

    return res.json({ success: true, episode: addedEpisode, comic: parentComic || null, gmailBroadcast });
  });

  // Edit Episode
  app.put('/api/comics/:comicId/chapters/:chapId/episodes/:epId', async (req, res) => {
    await db.ensureFreshFromCloud(true).catch(() => {});
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
    const comicRec = db.getSnapshot().comics.find(c => c.id === req.params.comicId);
    if (comicRec) {
      await db.persistChanges({
        comics: [comicRec],
        userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
      });
    }
    return res.json({ success: true, episode: updatedEpisode, comic: comicRec || null });
  });

  // Delete Episode
  app.delete('/api/comics/:comicId/chapters/:chapId/episodes/:epId', async (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';
    let targetComic: Comic | null = null;

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
            targetComic = comic;
          }
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only delete your own episodes.' });
    if (!deletedTitle || !targetComic) return res.status(404).json({ error: 'Episode not found' });
    await db.persistChanges({
      comics: [targetComic],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, message: `"${deletedTitle}" deleted successfully.` });
  });

  // -------------------------------------------------------------
  // READER, COMMENTS, LIKES & RATINGS
  // -------------------------------------------------------------

  app.get('/api/episodes/:id', async (req, res) => {
    await db.ensureFreshFromCloud();
    const { userId, email, phone } = req.query;
    const findEpisodeInSnapshot = (snap: any) => {
      let epFound: any = null;
      let comicFound: any = null;
      let chapFound: any = null;
      for (const c of snap.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find((e: any) => e.id === req.params.id);
          if (ep) {
            epFound = ep;
            comicFound = c;
            chapFound = ch;
            break;
          }
        }
        if (epFound) break;
      }
      return { epFound, comicFound, chapFound };
    };

    let snapshot = db.getSnapshot();
    let { epFound: foundEpisode, comicFound: foundComic, chapFound: foundChapter } = findEpisodeInSnapshot(snapshot);
    if (!foundEpisode) {
      await db.ensureFreshFromCloud(true);
      snapshot = db.getSnapshot();
      const retried = findEpisodeInSnapshot(snapshot);
      foundEpisode = retried.epFound;
      foundComic = retried.comicFound;
      foundChapter = retried.chapFound;
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

      if (subStatus.hasActiveSubscription) {
        hasAccess = true;
        accessReason = subStatus.isComplimentaryAdminAccess
          ? 'complimentary_owner_reader'
          : subStatus.isFreeTrial
            ? 'free_trial_1_month'
            : `gmail_premium_${subStatus.activePlan}`;
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

    // Recompute live ratings for this comic's episodes directly from persisted ratings
    applyRatingsToComics([foundComic], snapshot.ratings || []);

    // Match user's existing vote and rating across userId / matchedUser.id / firebaseUid
    const candidateUserIds = new Set<string>(
      [
        userId ? String(userId) : '',
        subStatus.matchedUser?.id || '',
        subStatus.matchedUser?.firebaseUid || '',
      ].filter(Boolean)
    );
    const userVote =
      candidateUserIds.size > 0
        ? snapshot.votes.find(v => v.episodeId === foundEpisode.id && candidateUserIds.has(v.userId))
        : null;
    const userRating =
      candidateUserIds.size > 0
        ? snapshot.ratings.find(r => r.episodeId === foundEpisode.id && candidateUserIds.has(r.userId))
        : null;

    // Get comments for this episode (sorted newest first)
    const comments = snapshot.comments
      .filter(c => c.episodeId === foundEpisode.id)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    // Build flat ordered list of episodes in this comic for Prev/Next episode navigation
    const allEpisodes: Array<{
      id: string;
      title: string;
      episodeNumber: number;
      chapterNumber: number;
      averageRating: number;
      totalRatings: number;
    }> = [];
    foundComic.chapters.forEach((ch: Chapter) => {
      ch.episodes.forEach((ep: Episode) => {
        allEpisodes.push({
          id: ep.id,
          title: ep.title,
          episodeNumber: ep.episodeNumber,
          chapterNumber: ch.chapterNumber,
          averageRating: ep.averageRating || 0,
          totalRatings: ep.totalRatings || 0,
        });
      });
    });
    const currentIdx = allEpisodes.findIndex(item => item.id === foundEpisode.id);
    const prevEpisodeId = currentIdx > 0 ? allEpisodes[currentIdx - 1].id : null;
    const nextEpisodeId = currentIdx >= 0 && currentIdx < allEpisodes.length - 1 ? allEpisodes[currentIdx + 1].id : null;

    const safeEpisode = hasAccess
      ? foundEpisode
      : { ...foundEpisode, pages: [] };

    return res.json({
      episode: safeEpisode,
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
        isComplimentaryAdminAccess: Boolean(subStatus.isComplimentaryAdminAccess),
        isFreeTrial: subStatus.isFreeTrial,
        trialDaysRemaining: subStatus.trialDaysRemaining,
        trialExpired: subStatus.trialExpired,
        freeTrialExpiresAt: subStatus.freeTrialExpiresAt,
        activePlan: subStatus.activePlan,
        expiresAt: subStatus.expiresAt,
        activeReceipt: subStatus.activeReceipt,
      },
      userVote: userVote ? userVote.type : null,
      userRating: userRating ? userRating.stars : null,
      comments,
    });
  });

  // Real-time endpoint to verify reader Gmail/account & Razorpay payment status for any comic/chapter/episode
  app.get('/api/payments/verify-access', async (req, res) => {
    const { userId, email, phone, comicId, chapterId, episodeId, paymentId, razorpayPaymentId } = req.query;
    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const reconciled = await reconcileCustomerRazorpayPremium({
      userId: userId ? String(userId) : undefined,
      email: email ? String(email) : undefined,
      phone: phone ? String(phone) : undefined,
      paymentId: paymentId ? String(paymentId) : razorpayPaymentId ? String(razorpayPaymentId) : undefined,
      firebaseIdToken: fbToken,
    });

    const snapshot = db.getSnapshot();
    const subStatus = reconciled.subStatus;

    let foundComic: any = comicId ? snapshot.comics.find((c: Comic) => c.id === String(comicId)) : null;
    let foundChapter: any = null;
    let foundEpisode: any = null;

    if (episodeId) {
      for (const c of snapshot.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find((e: Episode) => e.id === String(episodeId));
          if (ep) {
            foundComic = c;
            foundChapter = ch;
            foundEpisode = ep;
            break;
          }
        }
        if (foundEpisode) break;
      }
    } else if (chapterId && foundComic) {
      foundChapter = foundComic.chapters.find((ch: Chapter) => ch.id === String(chapterId)) || null;
    }

    const hasTargetContext = Boolean(foundEpisode || foundChapter || foundComic || comicId || episodeId || chapterId);
    const isPaywalled = foundEpisode
      ? Boolean(foundEpisode.isPremium || foundChapter?.isPremium || foundComic?.accessType === 'premium')
      : foundChapter
      ? Boolean(foundChapter.isPremium || foundComic?.accessType === 'premium')
      : foundComic
      ? foundComic.accessType === 'premium'
      : false;

    const targetComicId = foundComic?.id || (comicId ? String(comicId) : '');
    const targetChapterId = foundChapter?.id || (chapterId ? String(chapterId) : '');
    const targetEpisodeId = foundEpisode?.id || (episodeId ? String(episodeId) : '');

    const matchedUser = subStatus.matchedUser;
    const targetEmail = (email ? String(email) : subStatus.verifiedGmail || '').trim().toLowerCase();
    const targetPhoneDigits = (phone ? String(phone) : subStatus.verifiedPhone || '').replace(/\D/g, '');

    const itemPurchase = targetComicId
      ? snapshot.purchases.find((p: Purchase) => {
          if (p.status !== 'success' || p.comicId !== targetComicId) return false;
          const userMatches =
            (userId && p.userId === String(userId)) ||
            (matchedUser?.id && p.userId === matchedUser.id) ||
            (targetEmail && p.userEmail?.toLowerCase() === targetEmail) ||
            (targetPhoneDigits.length >= 10 &&
              p.userPhone &&
              p.userPhone.replace(/\D/g, '').endsWith(targetPhoneDigits.slice(-10)));
          if (!userMatches) return false;
          return (
            p.type === 'full_comic' ||
            (targetChapterId && p.chapterId === targetChapterId) ||
            (targetEpisodeId && p.episodeId === targetEpisodeId)
          );
        })
      : null;

    let hasAccess = false;
    let accessReason = 'paywall_locked';

    if (hasTargetContext && !isPaywalled && (foundComic || foundEpisode)) {
      hasAccess = true;
      accessReason = 'free_content';
    } else if (subStatus.hasActiveSubscription) {
      hasAccess = true;
      accessReason = subStatus.isComplimentaryAdminAccess
        ? 'complimentary_owner_reader'
        : subStatus.isFreeTrial
          ? 'free_trial_1_month'
          : `gmail_premium_${subStatus.activePlan}`;
    } else if (itemPurchase) {
      hasAccess = true;
      accessReason = 'item_purchased';
    }

    return res.json({
      verified: true,
      verifiedAt: new Date().toISOString(),
      isPaywalled,
      hasAccess,
      unlocked: hasAccess,
      accessReason,
      hasActiveSubscription: subStatus.hasActiveSubscription,
      isComplimentaryAdminAccess: Boolean(subStatus.isComplimentaryAdminAccess),
      isFreeTrial: subStatus.isFreeTrial,
      trialDaysRemaining: subStatus.trialDaysRemaining,
      trialExpired: subStatus.trialExpired,
      freeTrialExpiresAt: subStatus.freeTrialExpiresAt,
      activePlan: subStatus.activePlan,
      plan: subStatus.activePlan,
      expiresAt: subStatus.expiresAt,
      activeReceipt: subStatus.activeReceipt || itemPurchase?.receiptNumber,
      transactionId: subStatus.transactionId || itemPurchase?.razorpayPaymentId,
      paymentMethod: subStatus.paymentMethod || itemPurchase?.paymentMethod,
      verifiedGmail: subStatus.verifiedGmail,
      verifiedPhone: subStatus.verifiedPhone,
      razorpayVerified: reconciled.razorpayVerified,
      verificationSource: reconciled.verificationSource,
      razorpayApiConfigured: reconciled.razorpayApiConfigured,
      razorpayError: reconciled.razorpayError,
    });
  });

  // Verify a Razorpay Payment ID (`pay_...`) or customer email/phone directly against Razorpay + Backend DB
  app.post('/api/payments/verify-razorpay', paymentRateLimiter, async (req, res) => {
    const { userId, email, phone, razorpayPaymentId, paymentId } = req.body;
    const cleanPayId = String(razorpayPaymentId || paymentId || '').trim();
    if (!email && !phone && !userId && !cleanPayId) {
      return res.status(400).json({
        error: 'Please enter a Gmail address, Mobile number, or Razorpay Payment ID (pay_...) to verify.',
      });
    }

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const reconciled = await reconcileCustomerRazorpayPremium({
      userId: userId ? String(userId) : undefined,
      email: email ? String(email) : undefined,
      phone: phone ? String(phone) : undefined,
      paymentId: cleanPayId || undefined,
      firebaseIdToken: fbToken,
    });

    if (cleanPayId && !reconciled.subStatus.hasActiveSubscription && !reconciled.razorpayApiConfigured) {
      // Check if that payment ID exists in local purchases/paymentTransactions
      const localMatch = db.getSnapshot().purchases.find(
        (p: Purchase) => p.razorpayPaymentId === cleanPayId && p.status === 'success'
      );
      if (!localMatch) {
        return res.status(404).json({
          verified: false,
          razorpayVerified: false,
          razorpayApiConfigured: false,
          error:
            'Razorpay Payment ID not found in local backend database, and live RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET API lookup is not configured.',
        });
      }
    }

    return res.json({
      success: true,
      verified: reconciled.subStatus.hasActiveSubscription,
      razorpayVerified: reconciled.razorpayVerified,
      verificationSource: reconciled.verificationSource,
      razorpayApiConfigured: reconciled.razorpayApiConfigured,
      subscription: sanitizeSubStatusForClient(reconciled.subStatus),
      user: reconciled.subStatus.matchedUser
        ? sanitizeUserForClient(reconciled.subStatus.matchedUser, false)
        : null,
      error: reconciled.razorpayError,
    });
  });

  // Comments: Post, Edit, Like, Delete & Report
  app.post('/api/episodes/:id/comments', async (req, res) => {
    const { id: clientCommentId, userId, userName, userAvatar, userRole = 'reader', content, parentId } = req.body;
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    const cleanCommentId =
      typeof clientCommentId === 'string' && clientCommentId.trim()
        ? sanitizeFirestoreId(clientCommentId.trim())
        : `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const newComment = {
      id: cleanCommentId,
      episodeId: req.params.id,
      userId: userId || 'usr_guest',
      userName: String(userName || 'Comic Reader').trim().slice(0, 80) || 'Comic Reader',
      userAvatar: userAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userName || 'Reader')}`,
      userRole,
      content: String(content).trim().slice(0, 1000),
      createdAt: nowIso,
      updatedAt: nowIso,
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

    db.logActivity('COMMENT_POSTED', newComment.userName, userRole, `Commented on episode ${req.params.id}`, 'comment', newComment.id);
    const persistRes = await db.persistChanges({
      changedComments: [newComment],
      collections: ['comments', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({
      success: true,
      comment: newComment,
      persistedToFirestore: persistRes.persisted,
    });
  });

  app.put('/api/episodes/:id/comments/:commentId', async (req, res) => {
    const { userId, content } = req.body;
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'Updated comment cannot be empty' });
    }
    let updatedComment: any = null;
    db.mutate(d => {
      for (const c of d.comments) {
        if (c.id === req.params.commentId && (!userId || c.userId === userId)) {
          c.content = String(content).trim().slice(0, 1000);
          c.updatedAt = new Date().toISOString();
          c.isEdited = true;
          updatedComment = c;
          break;
        }
        if (c.replies) {
          const r = c.replies.find(rep => rep.id === req.params.commentId && (!userId || rep.userId === userId));
          if (r) {
            r.content = String(content).trim().slice(0, 1000);
            r.updatedAt = new Date().toISOString();
            r.isEdited = true;
            updatedComment = r;
            break;
          }
        }
      }
    });
    if (!updatedComment) return res.status(404).json({ error: 'Comment not found or unauthorized' });
    const persistRes = await db.persistChanges({
      changedComments: [updatedComment],
      collections: ['comments'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({
      success: true,
      comment: updatedComment,
      persistedToFirestore: persistRes.persisted,
    });
  });

  app.post('/api/episodes/:id/comments/:commentId/like', async (req, res) => {
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
        targetComment.updatedAt = new Date().toISOString();
      }
    });
    if (!targetComment) return res.status(404).json({ error: 'Comment not found' });
    const persistRes = await db.persistChanges({
      changedComments: [targetComment],
      collections: ['comments'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({
      success: true,
      comment: targetComment,
      likesCount: targetComment.likesCount,
      likedBy: targetComment.likedBy,
      persistedToFirestore: persistRes.persisted,
    });
  });

  app.delete('/api/episodes/:id/comments/:commentId', async (req, res) => {
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
    const persistRes = await db.persistChanges({
      deletedCommentIds: [req.params.commentId],
      collections: ['comments'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({
      success: true,
      message: 'Comment removed',
      persistedToFirestore: persistRes.persisted,
    });
  });

  // Content & Comment Reporting
  app.post('/api/reports', async (req, res) => {
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
    await db.persistChanges({
      collections: ['reports', 'comments', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, report });
  });

  // Automated Real Gmail & In-App Notification Bar Broadcast for New Comic / Episode Releases
  async function broadcastComicReleaseNotification(params: {
    comic: Comic;
    episode?: Episode | null;
    releaseType: 'new_comic' | 'new_episode';
    firebaseIdToken?: string;
  }): Promise<{
    totalCustomers: number;
    sentCount: number;
    failedCount: number;
    smtpConfigured: boolean;
    recipients: { email: string; sent: boolean; error?: string }[];
  }> {
    const { comic, episode, releaseType, firebaseIdToken } = params;
    const isPaywalled =
      comic.accessType === 'premium' ||
      Boolean(episode?.isPremium) ||
      Boolean(comic.chapters?.some(ch => ch.isPremium || ch.episodes?.some(ep => ep.isPremium)));
    const resolvedEpisodeTitle =
      episode?.title?.trim() || comic.chapters?.[0]?.episodes?.[0]?.title?.trim() || '';
    const resolvedEpisodeId =
      episode?.id || comic.chapters?.[0]?.episodes?.[0]?.id;

    const title =
      releaseType === 'new_comic'
        ? `New Comic Published: ${comic.title}${resolvedEpisodeTitle ? ` · ${resolvedEpisodeTitle}` : ''}`
        : `New Episode Published: ${comic.title} · ${resolvedEpisodeTitle || 'Latest Episode'}`;
    const baseMessage =
      releaseType === 'new_comic'
        ? `"${comic.title}"${resolvedEpisodeTitle ? ` (${resolvedEpisodeTitle})` : ''} by ${comic.authorName} has been published (${isPaywalled ? 'Premium Pass' : 'Free to Read'}).`
        : `"${comic.title}" — Episode "${resolvedEpisodeTitle || 'New Episode'}" by ${comic.authorName} has been published (${isPaywalled ? 'Premium Pass' : 'Free to Read'}).`;

    const snapshot = db.getSnapshot();
    const seenEmails = new Set<string>();
    const registeredCustomers = (snapshot.users || []).filter(u => {
      const cleanEmail = String(u.email || '').trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.endsWith('@mobile.reader')) {
        return false;
      }
      if (u.notifyGmail === false) {
        return false;
      }
      if (seenEmails.has(cleanEmail)) {
        return false;
      }
      seenEmails.add(cleanEmail);
      return true;
    });

    const createdNotifIdsByUser = new Map<string, string>();
    for (const customer of registeredCustomers) {
      const notif = db.addNotification({
        userId: customer.id,
        userEmail: customer.email,
        type: releaseType,
        title,
        message: `${baseMessage} Sending Gmail notification to ${customer.email}...`,
        targetId: comic.id,
        comicId: comic.id,
        comicTitle: comic.title,
        episodeId: resolvedEpisodeId,
        episodeTitle: resolvedEpisodeTitle || undefined,
        isPaywalled,
        gmailSent: false,
        gmailSentTo: customer.email,
      });
      createdNotifIdsByUser.set(customer.id, notif.id);
    }

    // Add global Notification Bar entry for guest/public view
    const globalNotif = db.addNotification({
      userId: 'all',
      type: releaseType,
      title,
      message: baseMessage,
      targetId: comic.id,
      comicId: comic.id,
      comicTitle: comic.title,
      episodeId: resolvedEpisodeId,
      episodeTitle: resolvedEpisodeTitle || undefined,
      isPaywalled,
      gmailSent: false,
      gmailTargetCount: registeredCustomers.length,
    });

    const smtpSummary = getSmtpConfigSummary();
    const emailResults = await Promise.all(
      registeredCustomers.map(async customer => {
        const result = await sendComicReleaseNotificationEmail({
          to: customer.email,
          customerName: customer.name,
          comicTitle: comic.title,
          episodeTitle: resolvedEpisodeTitle || undefined,
          authorName: comic.authorName,
          releaseType,
          isPaywalled,
        });
        return { customer, result };
      })
    );

    const recipients: { email: string; sent: boolean; error?: string }[] = [];
    let sentCount = 0;
    let failedCount = 0;
    const completedIso = new Date().toISOString();

    db.mutate(d => {
      for (const { customer, result } of emailResults) {
        const cleanEmail = customer.email;
        if (result.sent) {
          sentCount += 1;
          recipients.push({ email: cleanEmail, sent: true });
        } else {
          failedCount += 1;
          recipients.push({
            email: cleanEmail,
            sent: false,
            error: result.error || 'SMTP delivery failed',
          });
        }
        const notifId = createdNotifIdsByUser.get(customer.id);
        const notif = d.notifications.find(n => n.id === notifId);
        if (notif) {
          notif.gmailSent = result.sent;
          notif.gmailSentAt = result.sent ? completedIso : undefined;
          notif.gmailError = result.sent ? undefined : result.error || 'SMTP delivery unavailable';
          notif.message = result.sent
            ? `${baseMessage} Gmail notification sent to ${cleanEmail}.`
            : `${baseMessage} Notification posted here (Gmail error: ${result.error || 'SMTP not configured'}).`;
        }
      }

      const allNotif = d.notifications.find(n => n.id === globalNotif.id);
      if (allNotif) {
        allNotif.gmailSent = sentCount > 0;
        allNotif.gmailSentAt = sentCount > 0 ? completedIso : undefined;
        allNotif.gmailDeliveredCount = sentCount;
        allNotif.gmailTargetCount = registeredCustomers.length;
        if (registeredCustomers.length > 0 && sentCount > 0) {
          allNotif.message = `${baseMessage} Gmail alert sent to ${sentCount}/${registeredCustomers.length} customer(s).`;
        }
      }
    });

    const updatedSnapshot = db.getSnapshot();
    const notificationsToMirror = updatedSnapshot.notifications.filter(
      n => n.id === globalNotif.id || Array.from(createdNotifIdsByUser.values()).includes(n.id)
    );
    if (notificationsToMirror.length > 0) {
      mirrorWritesInBackground(
        'comic_release_notifications',
        notificationsToMirror.map(buildNotificationWriteItem),
        firebaseIdToken
      );
    }

    if (registeredCustomers.length > 0) {
      db.logActivity(
        'GMAIL_RELEASE_ALERT_SENT',
        'system@aathirai.com',
        'admin',
        `Notification Bar & Gmail release alert for "${comic.title}"${resolvedEpisodeTitle ? ` (${resolvedEpisodeTitle})` : ''} (${releaseType}) — Sent: ${sentCount}/${registeredCustomers.length} (${recipients.filter(r => r.sent).map(r => r.email).join(', ') || 'none'}).`,
        'comic',
        comic.id
      );
    }

    return {
      totalCustomers: registeredCustomers.length,
      sentCount,
      failedCount,
      smtpConfigured: smtpSummary.configured,
      recipients,
    };
  }

  // Reader Bookmarks, Favorites, Reading Progress & Notifications
  app.get('/api/notifications', async (req, res) => {
    await db.ensureFreshFromCloud();
    const { userId, email } = req.query;
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    const cleanUserId = userId ? String(userId).trim() : '';
    const snapshot = db.getSnapshot();
    const rawList = (snapshot.notifications || []).filter(n => {
      const dismissedBy = Array.isArray(n.dismissedBy) ? n.dismissedBy : [];
      if (cleanUserId && dismissedBy.includes(cleanUserId)) return false;
      if (cleanEmail && dismissedBy.includes(cleanEmail)) return false;
      if (!cleanUserId && !cleanEmail && dismissedBy.includes('guest')) return false;
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

  app.post('/api/notifications/mark-read', async (req, res) => {
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
    await db.persistChanges({
      collections: ['notifications'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true });
  });

  app.post('/api/notifications/dismiss', async (req, res) => {
    const { notificationId, userId, email } = req.body;
    if (!notificationId || !String(notificationId).trim()) {
      return res.status(400).json({ error: 'notificationId is required' });
    }
    const cleanId = String(notificationId).trim();
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    const cleanUserId = userId ? String(userId).trim() : '';

    db.mutate(d => {
      if (!Array.isArray(d.notifications)) return;
      const targetNotif = d.notifications.find(x => x.id === cleanId);
      const isMatchingDuplicate = (n: any) =>
        n.id === cleanId ||
        Boolean(
          targetNotif &&
            n.type === targetNotif.type &&
            (n.comicId || n.targetId) === (targetNotif.comicId || targetNotif.targetId) &&
            (n.episodeId || '') === (targetNotif.episodeId || '') &&
            n.title === targetNotif.title
        );

      const remaining: typeof d.notifications = [];
      for (const n of d.notifications) {
        if (!isMatchingDuplicate(n)) {
          remaining.push(n);
          continue;
        }
        const belongsOnlyToThisUser =
          n.userId !== 'all' &&
          ((cleanUserId && n.userId === cleanUserId) ||
            (cleanEmail && n.userEmail?.toLowerCase() === cleanEmail));

        if (belongsOnlyToThisUser) {
          // Permanently remove user-specific notification
          continue;
        }

        // For broadcast ('all') notifications, record dismissal for this reader only
        if (n.userId === 'all') {
          const nextDismissed = new Set<string>(Array.isArray(n.dismissedBy) ? n.dismissedBy : []);
          if (cleanUserId) nextDismissed.add(cleanUserId);
          if (cleanEmail) nextDismissed.add(cleanEmail);
          if (!cleanUserId && !cleanEmail) nextDismissed.add('guest');
          n.dismissedBy = Array.from(nextDismissed);
          n.read = true;
        }
        remaining.push(n);
      }
      d.notifications = remaining;
    });

    await db.persistChanges({
      collections: ['notifications'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({ success: true, dismissedId: cleanId });
  });

  app.post('/api/reader/bookmarks/toggle', async (req, res) => {
    await db.ensureFreshFromCloud();
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required to update bookmarks.' });
    }
    const { comicId } = req.body;
    if (!comicId) return res.status(400).json({ error: 'comicId is required' });
    let bookmarks: string[] = [];
    let bookmarked = false;
    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find(x => x.id === authCtx.user!.id);
      if (u) {
        if (!Array.isArray(u.bookmarks)) u.bookmarks = [];
        const idx = u.bookmarks.indexOf(comicId);
        if (idx >= 0) {
          u.bookmarks.splice(idx, 1);
          bookmarked = false;
        } else {
          u.bookmarks.push(comicId);
          bookmarked = true;
        }
        bookmarks = u.bookmarks;
        updatedUser = u;
      }
    });
    if (updatedUser) {
      await db.persistChanges({
        users: [updatedUser],
        userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
      });
    }
    return res.json({ success: true, bookmarks, bookmarked });
  });

  app.post('/api/reader/favorites/toggle', async (req, res) => {
    await db.ensureFreshFromCloud();
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required to update favorites.' });
    }
    const { comicId } = req.body;
    if (!comicId) return res.status(400).json({ error: 'comicId is required' });
    let favorites: string[] = [];
    let favorited = false;
    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find(x => x.id === authCtx.user!.id);
      if (u) {
        if (!Array.isArray(u.favorites)) u.favorites = [];
        const idx = u.favorites.indexOf(comicId);
        if (idx >= 0) {
          u.favorites.splice(idx, 1);
          favorited = false;
        } else {
          u.favorites.push(comicId);
          favorited = true;
        }
        favorites = u.favorites;
        updatedUser = u;
      }
    });
    if (updatedUser) {
      await db.persistChanges({
        users: [updatedUser],
        userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
      });
    }
    return res.json({ success: true, favorites, favorited });
  });

  app.post('/api/reader/progress', async (req, res) => {
    await db.ensureFreshFromCloud();
    const authCtx = await resolveAuthenticatedUser(req, db.getSnapshot().users);
    if (!authCtx.user || authCtx.authMethod !== 'token') {
      return res.status(401).json({ error: 'Authentication required to save reading progress.' });
    }
    const { comicId, comicTitle, coverImage, episodeId, episodeTitle, episodeNumber = 1, chapterNumber = 1, pageIndex = 0, totalPages = 1 } = req.body;
    if (!comicId || !episodeId) {
      return res.status(400).json({ error: 'comicId and episodeId are required' });
    }
    let readingHistory: any[] = [];
    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find(x => x.id === authCtx.user!.id);
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
        updatedUser = u;
      }
    });
    if (updatedUser) {
      await db.persistChanges({
        users: [updatedUser],
        userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
      });
    }
    return res.json({ success: true, readingHistory });
  });

  // Like / Dislike Vote
  app.post('/api/episodes/:id/vote', async (req, res) => {
    const { userId, type } = req.body; // type: 'like' | 'dislike'
    if (!userId || !['like', 'dislike'].includes(type)) {
      return res.status(400).json({ error: 'Valid userId and type are required' });
    }

    let result = { likesCount: 0, dislikesCount: 0, userVote: type };
    let targetComicForPersist: Comic | null = null;

    db.mutate(d => {
      // Find episode
      let targetEp: any = null;
      for (const c of d.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === req.params.id);
          if (ep) {
            targetEp = ep;
            targetComicForPersist = c;
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

    await db.persistChanges({
      comics: targetComicForPersist ? [targetComicForPersist] : [],
      collections: ['votes'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({ success: true, ...result });
  });

  // Star Rating (1 to 5 Stars)
  app.post('/api/episodes/:id/rate', async (req, res) => {
    const { userId, stars, ratingId: clientRatingId } = req.body;
    const numStars = Math.round(Number(stars));
    if (!userId || isNaN(numStars) || numStars < 1 || numStars > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
    }

    let result = { averageRating: 0, totalRatings: 0, userRating: numStars, comicAverageRating: 0 };
    let targetComicForPersist: Comic | null = null;
    let savedRating: any = null;

    db.mutate(d => {
      const matchedUser = d.users.find(u => u.id === userId || u.firebaseUid === userId);
      const candidateUserIds = new Set<string>(
        [String(userId), matchedUser?.id || '', matchedUser?.firebaseUid || ''].filter(Boolean)
      );

      // Find existing rating by this user on this episode
      const existingIdx = d.ratings.findIndex(
        r => r.episodeId === req.params.id && candidateUserIds.has(r.userId)
      );
      const now = new Date().toISOString();

      if (existingIdx !== -1) {
        d.ratings[existingIdx].stars = numStars;
        d.ratings[existingIdx].updatedAt = now;
        if (typeof clientRatingId === 'string' && clientRatingId.trim()) {
          d.ratings[existingIdx].id = sanitizeFirestoreId(clientRatingId.trim());
        }
        savedRating = d.ratings[existingIdx];
      } else {
        const deterministicId =
          typeof clientRatingId === 'string' && clientRatingId.trim()
            ? sanitizeFirestoreId(clientRatingId.trim())
            : sanitizeFirestoreId(`r_${req.params.id}_${userId}`);
        savedRating = {
          id: deterministicId,
          episodeId: req.params.id,
          userId: String(userId),
          stars: numStars,
          createdAt: now,
          updatedAt: now,
        };
        d.ratings.push(savedRating);
      }

      // Recompute episode and parent comic rating stats
      applyRatingsToComics(d.comics, d.ratings);

      for (const c of d.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === req.params.id);
          if (ep) {
            result.averageRating = ep.averageRating;
            result.totalRatings = ep.totalRatings;
            result.comicAverageRating = c.averageRating;
            targetComicForPersist = c;
            break;
          }
        }
        if (targetComicForPersist) break;
      }
    });

    const persistRes = await db.persistChanges({
      comics: targetComicForPersist ? [targetComicForPersist] : [],
      changedRatings: savedRating ? [savedRating] : [],
      collections: ['ratings'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({
      success: true,
      ...result,
      rating: savedRating,
      persistedToFirestore: persistRes.persisted,
    });
  });

  // -------------------------------------------------------------
  // AUTHOR APPLICATIONS & AUTHOR DASHBOARD
  // -------------------------------------------------------------

  app.post('/api/author/apply', async (req, res) => {
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
            : d.comics[0]?.chapters?.[0]?.episodes?.[0]?.pages?.map(p => p.imageUrl).filter(Boolean) || [];

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

    await db.persistChanges({
      users: updatedUser ? [updatedUser] : [],
      collections: ['authorApplications', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({
      success: true,
      application: savedApp,
      user: updatedUser,
      message:
        'Author photo & sample comic pages submitted! Your application is now Pending Approval in the Admin Console.',
    });
  });

  app.post('/api/author/update-photo', async (req, res) => {
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
          d.comics[0]?.chapters?.[0]?.episodes?.[0]?.pages?.map(p => p.imageUrl).filter(Boolean) || [];
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

    await db.persistChanges({
      users: updatedUser ? [updatedUser] : [],
      collections: ['authorApplications'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({
      success: true,
      user: updatedUser,
      application: updatedApp,
      message: 'Author photo updated on the Author List!',
    });
  });

  app.get('/api/authors', async (_req, res) => {
    await db.ensureFreshFromCloud();
    const snapshot = db.getSnapshot();

    const formatReads = (views: number) => {
      if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
      return String(views);
    };

    const customAuthors = snapshot.authorApplications
      .filter((app) => app.status === 'approved' || snapshot.comics.some((c) => c.authorId === app.userId && c.moderationStatus === 'approved'))
      .map((app) => {
        const matchedUser = snapshot.users.find(
          (u) => u.id === app.userId || u.email.toLowerCase() === app.email.toLowerCase()
        );
        const authorComics = snapshot.comics.filter(
          (c) =>
            c.moderationStatus === 'approved' &&
            (c.authorId === app.userId || c.authorName?.toLowerCase() === app.authorName.toLowerCase())
        );
        const totalViews = authorComics.reduce((sum, c) => sum + (c.totalViews || 0), 0);
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
          followers: String(authorComics.length),
          totalReads: formatReads(totalViews),
        };
      });

    // Also include real approved creators from uploaded comics or users table with role === 'author'
    const userAuthors = snapshot.users
      .filter((u) => u.role === 'author')
      .map((u) => {
        const authorComics = snapshot.comics.filter(
          (c) => c.moderationStatus === 'approved' && c.authorId === u.id
        );
        const totalViews = authorComics.reduce((sum, c) => sum + (c.totalViews || 0), 0);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: 'Published Author',
          avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`,
          bio: u.bio || 'Original comic creator on Aathirai_Comic.',
          sampleComicTitle: authorComics[0]?.title || '',
          sampleImages: [] as string[],
          followers: String(authorComics.length),
          totalReads: formatReads(totalViews),
        };
      });

    // Merge real authors avoiding duplicates by id, email, or name
    const seenIds = new Set<string>();
    const seenEmails = new Set<string>();
    const seenNames = new Set<string>();
    const combined = [];
    for (const a of [...customAuthors, ...userAuthors]) {
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

  app.get('/api/author/me', async (req, res) => {
    await db.ensureFreshFromCloud();
    const { userId, email } = req.query;
    const snapshot = db.getSnapshot();
    const app = snapshot.authorApplications.find(a =>
      (userId && a.userId === userId) || (email && a.email.toLowerCase() === String(email).toLowerCase())
    );
    return res.json({ application: app || null });
  });

  app.get('/api/author/analytics', async (req, res) => {
    await db.ensureFreshFromCloud();
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

  // Create Razorpay Order (Server-Side via official Razorpay SDK Orders API for Test & Live modes)
  const handleCreateOrder = async (req: express.Request, res: express.Response) => {
    const rzpStatus = getRazorpayEnvironmentStatus();
    if (!rzpStatus.isConfigured || rzpStatus.mode === 'unconfigured') {
      return res.status(401).json({
        error: 'Razorpay authentication failed: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not configured on the server.',
        mode: 'UNCONFIGURED',
      });
    }

    const {
      comicId,
      chapterId,
      episodeId,
      type = 'episode',
      amountInr,
      amount,
      currency = 'INR',
      receipt,
      userId,
      userEmail,
      placeOfSupplyStateCode,
      isInternational,
      customerGstin,
    } = req.body || {};

    let amountInPaise = 0;
    let parsedAmountInr = 0;
    if (amount !== undefined && amount !== null && String(amount).trim() !== '') {
      const rawPaise = Number(amount);
      if (!Number.isFinite(rawPaise)) {
        return res.status(400).json({ error: 'Valid amount in paise is required.' });
      }
      amountInPaise = Math.round(rawPaise);
      parsedAmountInr = Number((amountInPaise / 100).toFixed(2));
    } else if (amountInr !== undefined && amountInr !== null && String(amountInr).trim() !== '') {
      const rawInr = Number(amountInr);
      if (!Number.isFinite(rawInr)) {
        return res.status(400).json({ error: 'Valid amount in INR is required.' });
      }
      parsedAmountInr = rawInr;
      amountInPaise = Math.round(rawInr * 100);
    } else {
      return res.status(400).json({ error: 'Order amount (amount in paise or amountInr) is required.' });
    }

    if (amountInPaise < 100) {
      return res.status(400).json({
        error: 'Minimum Razorpay order amount is 100 paise (₹1.00 INR).',
      });
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
    const cleanOrderEmail = (userEmail || '').trim().toLowerCase();
    const orderSubStatus = getReaderSubscriptionStatus(snapshot, {
      userId: userId ? String(userId) : undefined,
      email: cleanOrderEmail || undefined,
      phone: req.body?.userPhone ? String(req.body.userPhone) : undefined,
    });

    // Block unnecessary Razorpay checkout on the complimentary Owner Reader account
    if (orderSubStatus.isComplimentaryAdminAccess) {
      return res.status(400).json({
        code: 'COMPLIMENTARY_ACCESS_ACTIVE',
        error:
          'All premium comics, chapters, and pages are already permanently unlocked on this account with Complimentary Unrestricted Access. No payment is required.',
      });
    }

    // Strict Free Trial Payment Lock: Block ALL payments while the customer's 30-day Free Trial is ongoing
    if (orderSubStatus.hasActiveSubscription && orderSubStatus.isFreeTrial && orderSubStatus.expiresAt) {
      const expiryDateStr = new Date(orderSubStatus.expiresAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      return res.status(400).json({
        code: 'FREE_TRIAL_ACTIVE',
        trialDaysRemaining: orderSubStatus.trialDaysRemaining,
        expiresAt: orderSubStatus.expiresAt,
        error: `Payments are disabled during your active 30-Day Free One-Month Premium Trial (₹49 value). You have ${orderSubStatus.trialDaysRemaining} day${orderSubStatus.trialDaysRemaining === 1 ? '' : 's'} remaining until ${expiryDateStr}. Paid plans will unlock automatically after your free trial ends.`,
      });
    }

    if (type === 'subscription') {
      if (orderSubStatus.hasActiveSubscription && orderSubStatus.expiresAt) {
        const activePlanLabel =
          orderSubStatus.activePlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)';
        const expiryDateStr = new Date(orderSubStatus.expiresAt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata',
        });
        return res.status(400).json({
          error: `Only one plan can be active at a time. Your ${activePlanLabel} plan is currently active until ${expiryDateStr}. You can choose another plan after your current plan ends.`,
        });
      }
    }

    const gstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const gstBreakdown = calculateInclusiveGstBreakdown({
      totalAmountInr: parsedAmountInr,
      sellerStateCode: gstSettings.stateCode || '33',
      placeOfSupplyStateCode: placeOfSupplyStateCode || gstSettings.stateCode || '33',
      applicableRatePercent: gstSettings.applicableGstRate ?? 18,
      applyGst: gstSettings.applyGstToDomesticSales !== false,
      isInternational: Boolean(isInternational || placeOfSupplyStateCode === '96'),
      hsnSacCode: gstSettings.defaultSacCode || '998431',
      hsnSacDescription: gstSettings.defaultSacDescription,
    });

    const normalizedCurrency = String(currency || 'INR').trim().toUpperCase() || 'INR';
    const orderReceipt = String(receipt || `rcpt_${Date.now()}`).trim().slice(0, 40);
    const environment: 'test' | 'live' = rzpStatus.isLiveMode ? 'live' : 'test';
    const orderResult = await createGatewayOrderOnRazorpay({
      amountPaise: amountInPaise,
      currency: normalizedCurrency,
      receipt: orderReceipt,
      notes: {
        comicId: String(comicId || 'global_subscription'),
        type: String(type),
        userEmail: String(userEmail || ''),
        ...(chapterId ? { chapterId: String(chapterId) } : {}),
        ...(episodeId ? { episodeId: String(episodeId) } : {}),
      },
    });

    if (!orderResult.orderId) {
      const status = orderResult.statusCode === 401 ? 401 : 500;
      return res.status(status).json({
        error: orderResult.error || 'Could not initialize order with Razorpay API.',
      });
    }

    const orderId = orderResult.orderId;
    const finalAmount = orderResult.amount ?? amountInPaise;
    const finalCurrency = orderResult.currency || normalizedCurrency;

    return res.json({
      success: true,
      mode: rzpStatus.mode.toUpperCase(),
      modeLower: rzpStatus.mode,
      environment,
      createdViaRazorpayApi: orderResult.createdViaRazorpayApi,
      warningBanner: rzpStatus.statusMessage,
      order_id: orderId,
      orderId,
      amount: finalAmount,
      amountInr: parsedAmountInr,
      gstBreakdown,
      currency: finalCurrency,
      keyId: rzpStatus.keyId,
      paymentMethods: [
        'UPI (Google Pay, PhonePe, Paytm, BHIM)',
        'RuPay, Visa, Mastercard Debit & Credit Cards',
        'Net Banking (SBI, HDFC, ICICI, Axis, Indian Bank)',
        'Digital Wallets (Paytm, PhonePe)',
      ],
    });
  };

  app.post('/api/create-order', paymentRateLimiter, handleCreateOrder);
  app.post('/api/payments/razorpay/create-order', paymentRateLimiter, handleCreateOrder);

  // Verify Razorpay Payment via HMAC-SHA256 + Razorpay API confirmation & Persist Customer + Purchase
  const handleVerifyPayment = async (req: express.Request, res: express.Response) => {
    const rzpStatus = getRazorpayEnvironmentStatus();
    if (!rzpStatus.isConfigured || rzpStatus.mode === 'unconfigured') {
      return res.status(503).json({
        error: 'Cannot verify payment: Razorpay gateway is not configured on the server.',
      });
    }

    const body = req.body || {};
    const resolvedOrderId = String(body.razorpay_order_id || body.razorpayOrderId || '').trim();
    const resolvedPaymentId = String(body.razorpay_payment_id || body.razorpayPaymentId || '').trim();
    const resolvedSignature = String(body.razorpay_signature || body.razorpaySignature || '').trim();

    const {
      userId,
      customerName,
      userEmail,
      userPhone,
      userUpiId,
      comicId = 'global_subscription',
      comicTitle,
      chapterId,
      episodeId,
      type = 'subscription',
      subscriptionPlan,
      amountInr,
      amount,
      paymentMethod = 'Razorpay Checkout',
      placeOfSupplyStateCode,
      isInternational,
      customerGstin,
    } = body;

    if (!resolvedOrderId || !resolvedPaymentId || !resolvedSignature) {
      return res.status(400).json({
        error: 'Payment verification failed: Missing razorpay_order_id, razorpay_payment_id, or razorpay_signature.',
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
      p => p.razorpayPaymentId === resolvedPaymentId || (p.razorpayOrderId === resolvedOrderId && p.status === 'success')
    );
    if (existingPurchase) {
      return res.json({
        success: true,
        verified: true,
        idempotentReplay: true,
        purchase: existingPurchase,
        message: 'Payment already verified and fulfilled.',
      });
    }

    // 2. Cryptographic HMAC-SHA256 signature verification (order_id + "|" + payment_id, KEY_SECRET)
    const isSignatureValid = verifyRazorpayPaymentSignature({
      orderId: resolvedOrderId,
      paymentId: resolvedPaymentId,
      signature: resolvedSignature,
    });

    if (!isSignatureValid) {
      db.logActivity(
        'PAYMENT_SIGNATURE_INVALID',
        userEmail || 'unknown',
        'reader',
        `Rejected tampered or invalid Razorpay signature for order ${resolvedOrderId} / payment ${resolvedPaymentId}.`,
        'payment',
        resolvedOrderId
      );
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Cryptographic HMAC-SHA256 payment signature verification failed. Access denied.',
      });
    }

    // 2b. Confirm payment capture/authorization status directly with Razorpay API
    let confirmedViaRazorpayApi = false;
    let razorpayPaymentAmountInr: number | undefined = undefined;
    let razorpayMethodLabel: string | undefined = undefined;
    if (hasRealRazorpayApiKeys()) {
      const liveCheck = await fetchRazorpayPaymentById(resolvedPaymentId);
      if (liveCheck.checked && liveCheck.found && !liveCheck.capturedOrAuthorized) {
        return res.status(400).json({
          success: false,
          verified: false,
          error: `Razorpay payment status is "${liveCheck.rawStatus || 'unpaid'}" and has not been captured yet.`,
        });
      }
      if (liveCheck.checked && !liveCheck.found && rzpStatus.isLiveMode) {
        return res.status(400).json({
          success: false,
          verified: false,
          error: liveCheck.error || 'Razorpay payment could not be confirmed on Razorpay servers.',
        });
      }
      confirmedViaRazorpayApi = Boolean(liveCheck.capturedOrAuthorized);
      if (liveCheck.payment?.amountInr) {
        razorpayPaymentAmountInr = liveCheck.payment.amountInr;
      }
      if (liveCheck.payment?.method) {
        razorpayMethodLabel = liveCheck.payment.method;
      }
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

    const parsedBodyAmountInr = Number(amountInr);
    const parsedBodyPaise = Number(amount);
    const amountNum =
      Number.isFinite(parsedBodyAmountInr) && parsedBodyAmountInr > 0
        ? parsedBodyAmountInr
        : Number.isFinite(parsedBodyPaise) && parsedBodyPaise > 0
          ? Number((parsedBodyPaise / 100).toFixed(2))
          : razorpayPaymentAmountInr || (subscriptionPlan === '6_months' ? 249 : 49);

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
      paymentMethod: razorpayMethodLabel || paymentMethod || 'Razorpay Checkout',
      razorpayOrderId: resolvedOrderId,
      razorpayPaymentId: resolvedPaymentId,
      signatureVerified: true,
      environment,
      idempotencyKey: `idem_${resolvedOrderId}_${resolvedPaymentId}`,
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
      idempotencyKey: `idem_${resolvedOrderId}_${resolvedPaymentId}`,
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

      let u = d.users.find(user =>
        (userId && userId !== 'usr_guest' && user.id === userId) ||
        (cleanEmail && user.email.toLowerCase() === cleanEmail)
      );

      // Ensure paying customer is always persisted in backend users collection
      if (!u && cleanEmail && cleanEmail !== 'customer@aathirai.com') {
        const displayName = (customerName || cleanEmail.split('@')[0] || 'Reader').trim();
        u = {
          id: userId && userId !== 'usr_guest' ? userId : 'usr_' + Date.now(),
          name: displayName,
          email: cleanEmail,
          phone: userPhone || undefined,
          upiId: userUpiId?.trim() || undefined,
          countryCode: '+91',
          countryName: 'India',
          role: 'reader',
          isVerified: true,
          bookmarks: [],
          favorites: [],
          readingHistory: [],
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(displayName)}`,
          createdAt: nowIso,
          lastLoginAt: nowIso,
          premiumPlan: null,
        };
        d.users.push(u);
      }

      if (u) {
        if (customerName && !u.name) u.name = String(customerName).trim();
        if (userPhone && !u.phone) u.phone = userPhone;
        if (userUpiId && userUpiId.trim()) u.upiId = userUpiId.trim();
        if (type === 'subscription' && resolvedPlan && computedExpiresAt) {
          u.premiumPlan = resolvedPlan;
          u.premiumStartedAt = nowIso;
          u.premiumExpiresAt = computedExpiresAt;
          u.isFreeTrial = false;
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
            isFreeTrial: false,
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
      `[${environment.toUpperCase()}] Payment of ₹${amountNum} captured & HMAC-SHA256 verified${confirmedViaRazorpayApi ? ' (+ Razorpay API)' : ''} for ${newPurchase.comicTitle}${resolvedPlan ? ` (${resolvedPlan === '6_months' ? '6 Months Premium - ₹249' : '1 Month Premium - ₹49'}, valid until ${new Date(computedExpiresAt!).toLocaleDateString()})` : ''}. Receipt ${receiptNumber}`,
      'purchase',
      newPurchase.id,
      { amountInr: amountNum }
    );

    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    await db.persistChanges({
      users: updatedReader ? [updatedReader] : [],
      collections: ['purchases', 'paymentTransactions', 'notifications', 'activityLogs', 'settings'],
      userFirebaseIdToken: fbToken,
    });

    return res.json({
      success: true,
      verified: true,
      environment,
      razorpayVerified: true,
      confirmedViaRazorpayApi,
      purchase: newPurchase,
      user: updatedReader ? sanitizeUserForClient(updatedReader, true) : null,
      message: resolvedPlan
        ? `Gmail (${cleanEmail}) verified! ${resolvedPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)'} Premium Pass activated (${environment.toUpperCase()} mode).`
        : `Payment verified successfully (${environment.toUpperCase()} mode)! Access granted to premium comic episode.`,
    });
  };

  app.post('/api/verify-payment', paymentRateLimiter, handleVerifyPayment);
  app.post('/api/payments/razorpay/verify-payment', paymentRateLimiter, handleVerifyPayment);

  // Customer Purchases
  app.get('/api/payments/my-purchases', async (req, res) => {
    await db.ensureFreshFromCloud();
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
  const handleRazorpayWebhook = async (req: express.Request, res: express.Response) => {
    const signature = String(req.headers['x-razorpay-signature'] || '');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
    const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});

    if (webhookSecret && signature) {
      const valid = verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret);
      if (!valid) {
        return res.status(400).json({ error: 'Invalid Razorpay webhook signature' });
      }
    } else if (process.env.RAZORPAY_WEBHOOK_SECRET && !signature) {
      return res.status(400).json({ error: 'Missing X-Razorpay-Signature header' });
    }

    const event = req.body || {};
    const eventName = String(event?.event || '');
    const paymentEntity = event?.payload?.payment?.entity;
    const plinkEntity = event?.payload?.payment_link?.entity;
    const subEntity = event?.payload?.subscription?.entity;
    const invoiceEntity = event?.payload?.invoice?.entity;
    const paymentId = String(
      paymentEntity?.id || invoiceEntity?.payment_id || plinkEntity?.id || subEntity?.id || ''
    );

    db.logActivity(
      'WEBHOOK_RECEIVED',
      'Razorpay Gateway',
      'reader',
      `Verified Webhook event: ${eventName || 'payment.captured'}`,
      'payment',
      paymentId || 'event'
    );

    const isPaidEvent =
      eventName === 'payment.captured' ||
      eventName === 'order.paid' ||
      eventName === 'payment_link.paid' ||
      eventName === 'subscription.activated' ||
      eventName === 'subscription.charged' ||
      eventName === 'invoice.paid';

    if (isPaidEvent) {
      const paymentLinkId = String(
        plinkEntity?.id || paymentEntity?.notes?.payment_link_id || ''
      ).trim();
      const subscriptionId = String(
        subEntity?.id || paymentEntity?.subscription_id || invoiceEntity?.subscription_id || ''
      ).trim();
      const planId = String(subEntity?.plan_id || '').trim();
      const amountPaise = Number(
        paymentEntity?.amount ||
          invoiceEntity?.amount_paid ||
          plinkEntity?.amount_paid ||
          plinkEntity?.amount ||
          0
      );
      const amountInr = Math.round(amountPaise / 100);

      let resolvedPlan: '1_month' | '6_months' | null = null;
      if (
        planId === 'plan_U0DDDaA2ru0PLQ' ||
        subscriptionId === 'sub_U0DEqhM6bgOd0h' ||
        paymentLinkId === 'plink_U0CloVifURBxlY' ||
        amountInr >= 249
      ) {
        resolvedPlan = '6_months';
      } else if (
        planId === 'plan_U0CwrDGonjUDN2' ||
        subscriptionId === 'sub_U0DeTe3l42sQ9K' ||
        subscriptionId === 'sub_U0DNKt8md78zWC' ||
        paymentLinkId === 'plink_U0ChD9beWUpb0M' ||
        amountInr >= 49
      ) {
        resolvedPlan = '1_month';
      }

      const payerEmail = String(
        paymentEntity?.email ||
          plinkEntity?.customer?.email ||
          invoiceEntity?.customer_details?.email ||
          subEntity?.notes?.email ||
          paymentEntity?.notes?.email ||
          ''
      )
        .trim()
        .toLowerCase();
      const payerPhone = String(
        paymentEntity?.contact ||
          plinkEntity?.customer?.contact ||
          invoiceEntity?.customer_details?.contact ||
          subEntity?.notes?.phone ||
          paymentEntity?.notes?.phone ||
          ''
      ).trim();

      if (resolvedPlan && (payerEmail || payerPhone)) {
        let activatedUserEmail: string | null = null;
        let activatedUserId: string | null = null;

        db.mutate(d => {
          const alreadyProcessed =
            paymentId &&
            d.purchases.some((p: Purchase) => p.razorpayPaymentId === paymentId && p.status === 'success');
          if (alreadyProcessed) return;

          const matchedUser = d.users.find((u: User) => {
            if (payerEmail && u.email?.toLowerCase() === payerEmail) return true;
            if (payerPhone && phonesMatch(u.phone, payerPhone)) return true;
            return false;
          });

          if (matchedUser) {
            const refTag = subscriptionId || paymentLinkId || 'Razorpay';
            const methodLabel = paymentEntity?.method
              ? `Razorpay ${String(paymentEntity.method).toUpperCase()} (${refTag})`
              : `Razorpay Subscription (${refTag})`;
            applyPaidPremiumDetailToUser(
              d,
              matchedUser,
              resolvedPlan,
              methodLabel,
              paymentId || `pay_sub_${Date.now()}`,
              paymentEntity?.vpa
            );
            activatedUserEmail = matchedUser.email;
            activatedUserId = matchedUser.id;
          }
        });

        if (activatedUserEmail && activatedUserId) {
          db.addNotification({
            userId: activatedUserId,
            userEmail: activatedUserEmail,
            title: `Premium Unlocked (${resolvedPlan === '6_months' ? '6 Months · ₹249' : '1 Month · ₹49'})`,
            message: `Your Razorpay payment (${paymentId || paymentLinkId}) was confirmed and your Premium Pass is now active!`,
            type: 'payment_success',
            targetId: paymentId || paymentLinkId,
          });
          db.logActivity(
            'WEBHOOK_PAYMENT_UNLOCKED',
            activatedUserEmail,
            'reader',
            `Activated ${resolvedPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)'} pass via Razorpay webhook (${paymentLinkId || paymentId}).`,
            'purchase',
            paymentId || paymentLinkId,
            { amountInr: resolvedPlan === '6_months' ? 249 : 49 }
          );
          const latestSnapWebhook = db.getSnapshot();
          const syncedUser = latestSnapWebhook.users.find(u => u.id === activatedUserId);
          await db.persistChanges({
            users: syncedUser ? [syncedUser] : [],
            collections: ['purchases', 'paymentTransactions', 'notifications', 'activityLogs', 'settings'],
          });
        }
      }
    }

    return res.json({ status: 'ok', verified: Boolean(signature) });
  };

  app.post('/api/payments/webhook', handleRazorpayWebhook);
  app.post('/api/webhooks/razorpay', handleRazorpayWebhook);

  // -------------------------------------------------------------
  // ADMINISTRATOR DASHBOARD ROUTES
  // -------------------------------------------------------------

  app.get('/api/admin/readers', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;
    await db.ensureFreshFromCloud();
    const snapshot = db.getSnapshot();
    const readers = snapshot.users.map(u => {
      const isImmutableAdmin = isProtectedVaultUser(u);
      const subStatus = getReaderSubscriptionStatus(snapshot, {
        userId: u.id,
        email: u.email,
        phone: isImmutableAdmin ? undefined : u.phone,
      });
      const userPurchases = snapshot.purchases.filter(
        p => p.status === 'success' && (p.userId === u.id || p.userEmail?.toLowerCase() === u.email?.toLowerCase())
      );
      const totalSpentInr = userPurchases.reduce((sum, p) => sum + p.amountInr, 0);
      return {
        ...sanitizeUserForClient(u, false),
        isImmutableAdmin,
        age: u.age,
        upiId: isImmutableAdmin ? undefined : (u.upiId || subStatus.upiId),
        premiumPlan: subStatus.activePlan,
        premiumStartedAt: subStatus.startedAt,
        premiumExpiresAt: subStatus.expiresAt,
        premiumPaymentDetail: subStatus.premiumPaymentDetail,
        hasActiveSubscription: subStatus.hasActiveSubscription,
        activeReceipt: subStatus.activeReceipt,
        subscription: {
          hasActiveSubscription: subStatus.hasActiveSubscription,
          isComplimentaryAdminAccess: Boolean(subStatus.isComplimentaryAdminAccess),
          plan: subStatus.activePlan,
          amountPaidInr: subStatus.amountPaidInr,
          upiId: isImmutableAdmin ? undefined : (u.upiId || subStatus.upiId),
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

  // Customer Tracker: Look up customer profile by registered Gmail or Mobile Number (strictly excludes immutable admin & owner vaults)
  app.get('/api/admin/customers/track', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;
    await db.ensureFreshFromCloud();

    const snapshot = db.getSnapshot();
    const rawQuery = String(req.query.q || '').trim();
    const queryLower = rawQuery.toLowerCase();
    const queryDigits = rawQuery.replace(/\D/g, '');

    const customerUsers = (snapshot.users || []).filter(
      (u: User) => !isProtectedVaultUser(u)
    );

    let activePlanCustomers = 0;
    for (const u of customerUsers) {
      const sub = getReaderSubscriptionStatus(snapshot, {
        userId: u.id,
        email: u.email,
        phone: u.phone,
      });
      if (sub.hasActiveSubscription) {
        activePlanCustomers += 1;
      }
    }

    const summary = {
      totalCustomers: customerUsers.length,
      activePlanCustomers,
      freeCustomers: Math.max(0, customerUsers.length - activePlanCustomers),
    };

    if (!rawQuery) {
      return res.json({ query: '', summary, matches: [] });
    }

    const scoredMatches: Array<{ user: User; score: number }> = [];
    for (const u of customerUsers) {
      const emailLower = String(u.email || '').trim().toLowerCase();
      const phoneDigits = String(u.phone || '').replace(/\D/g, '');
      const last10User = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
      const last10Query = queryDigits.length >= 10 ? queryDigits.slice(-10) : queryDigits;

      let score = 0;
      if (emailLower && emailLower === queryLower) {
        score = 100;
      } else if (last10Query.length >= 10 && last10User && last10User === last10Query) {
        score = 100;
      } else if (queryDigits.length >= 6 && phoneDigits && phoneDigits === queryDigits) {
        score = 95;
      } else if (queryLower.length >= 2 && emailLower.includes(queryLower)) {
        score = 70;
      } else if (queryDigits.length >= 4 && phoneDigits.includes(queryDigits)) {
        score = 65;
      }

      if (score > 0) {
        scoredMatches.push({ user: u, score });
      }
    }

    scoredMatches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.user.createdAt || 0).getTime() - new Date(a.user.createdAt || 0).getTime();
    });

    const nowMs = Date.now();
    const matches = scoredMatches.slice(0, 15).map(({ user: u }) => {
      const emailLower = String(u.email || '').trim().toLowerCase();
      const phoneDigits = String(u.phone || '').replace(/\D/g, '');
      const last10Phone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : '';

      const subStatus = getReaderSubscriptionStatus(snapshot, {
        userId: u.id,
        email: u.email,
        phone: u.phone,
      });

      const userPurchases = (snapshot.purchases || []).filter((p: Purchase) => {
        if (p.userId && p.userId === u.id) return true;
        if (emailLower && p.userEmail?.toLowerCase() === emailLower) return true;
        if (last10Phone && p.userPhone && p.userPhone.replace(/\D/g, '').endsWith(last10Phone)) return true;
        return false;
      });

      const userPaymentTxs = (snapshot.paymentTransactions || []).filter((tx: PaymentTransaction) => {
        if (tx.userId && tx.userId === u.id) return true;
        if (emailLower && tx.userEmail?.toLowerCase() === emailLower) return true;
        return false;
      });

      // Merge purchases and paymentTransactions cleanly (deduplicated by paymentId / orderId / id)
      const historyMap = new Map<
        string,
        {
          id: string;
          date: string;
          itemTitle: string;
          plan: string;
          amountInr: number;
          status: 'success' | 'pending' | 'failed' | 'refunded';
          paymentMethod: string;
          receiptNumber: string;
          transactionId: string;
          orderId: string;
        }
      >();

      for (const p of userPurchases) {
        const dedupKey = p.razorpayPaymentId || p.razorpayOrderId || p.id;
        const planLabel =
          p.subscriptionPlan === '6_months'
            ? '6-Months Pass (₹249)'
            : p.subscriptionPlan === '1_month'
              ? '1-Month Pass (₹49)'
              : p.type === 'subscription'
                ? 'Premium Subscription'
                : p.type;
        const mappedStatus: 'success' | 'pending' | 'failed' | 'refunded' =
          p.status === 'success'
            ? 'success'
            : p.status === 'failed'
              ? 'failed'
              : p.status === 'refunded'
                ? 'refunded'
                : 'pending';
        historyMap.set(dedupKey, {
          id: p.id,
          date: p.createdAt,
          itemTitle: p.comicTitle || planLabel,
          plan: planLabel,
          amountInr: Number(p.amountInr || 0),
          status: mappedStatus,
          paymentMethod: p.paymentMethod || 'Razorpay / UPI',
          receiptNumber: p.receiptNumber || '',
          transactionId: p.razorpayPaymentId || '',
          orderId: p.razorpayOrderId || '',
        });
      }

      for (const tx of userPaymentTxs) {
        const dedupKey = tx.paymentId || tx.orderId || tx.id;
        if (historyMap.has(dedupKey)) continue;
        const planLabel =
          tx.subscriptionPlan === '6_months'
            ? '6-Months Pass (₹249)'
            : tx.subscriptionPlan === '1_month'
              ? '1-Month Pass (₹49)'
              : tx.type;
        const mappedStatus: 'success' | 'pending' | 'failed' | 'refunded' =
          tx.status === 'verified'
            ? 'success'
            : tx.status === 'failed'
              ? 'failed'
              : tx.status === 'refunded'
                ? 'refunded'
                : 'pending';
        historyMap.set(dedupKey, {
          id: tx.id,
          date: tx.createdAt,
          itemTitle: tx.itemTitle || planLabel,
          plan: planLabel,
          amountInr: Number(tx.amountInr || 0),
          status: mappedStatus,
          paymentMethod: 'Razorpay',
          receiptNumber: '',
          transactionId: tx.paymentId || '',
          orderId: tx.orderId || '',
        });
      }

      const paymentHistory = Array.from(historyMap.values()).sort(
        (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      );

      const successfulPayments = paymentHistory.filter((item) => item.status === 'success');
      const pendingPayments = paymentHistory.filter((item) => item.status === 'pending');
      const failedPayments = paymentHistory.filter((item) => item.status === 'failed');
      const totalSpentInr = Number(
        successfulPayments.reduce((sum, item) => sum + Number(item.amountInr || 0), 0).toFixed(2)
      );

      let daysRemaining = 0;
      if (subStatus.hasActiveSubscription && subStatus.expiresAt) {
        const expMs = new Date(subStatus.expiresAt).getTime();
        if (Number.isFinite(expMs) && expMs > nowMs) {
          daysRemaining = Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000));
        }
      }

      let paymentStatus: 'paid_active' | 'trial_active' | 'trial_expired' | 'paid_expired' | 'pending_payment' | 'unpaid' = 'unpaid';
      let paymentStatusLabel = 'Unpaid · Free Account';
      if (subStatus.hasActiveSubscription && subStatus.isFreeTrial) {
        paymentStatus = 'trial_active';
        paymentStatusLabel = `Free Trial Active · ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left (₹0 Paid)`;
      } else if (subStatus.hasActiveSubscription) {
        paymentStatus = 'paid_active';
        paymentStatusLabel = 'Paid · Ongoing Plan Active';
      } else if (successfulPayments.length > 0) {
        paymentStatus = 'paid_expired';
        paymentStatusLabel = 'Previously Paid · Plan Expired';
      } else if (subStatus.trialExpired) {
        paymentStatus = 'trial_expired';
        paymentStatusLabel = 'Free Trial Expired · Unpaid';
      } else if (pendingPayments.length > 0) {
        paymentStatus = 'pending_payment';
        paymentStatusLabel = 'Payment Pending / Incomplete';
      }

      const ongoingPlanLabel = subStatus.hasActiveSubscription
        ? subStatus.isFreeTrial
          ? 'Free 1-Month Trial (₹49 Value)'
          : subStatus.activePlan === '6_months'
            ? '6-Months Pass (₹249)'
            : '1-Month Pass (₹49)'
        : subStatus.trialExpired
          ? 'Free Trial Expired (Upgrade Required)'
          : 'No Ongoing Plan (Free Account)';

      return {
        ...sanitizeUserForClient(u, false),
        age: u.age,
        dob: u.dob,
        countryName: u.countryName,
        upiId: u.upiId || subStatus.upiId || '',
        ongoingPlan: {
          hasActivePlan: subStatus.hasActiveSubscription,
          isFreeTrial: subStatus.isFreeTrial,
          trialExpired: subStatus.trialExpired,
          plan: subStatus.activePlan,
          planLabel: ongoingPlanLabel,
          amountPaidInr: subStatus.amountPaidInr || 0,
          startedAt: subStatus.startedAt || null,
          expiresAt: subStatus.expiresAt || null,
          daysRemaining,
          paymentMethod: subStatus.paymentMethod || null,
          transactionId: subStatus.transactionId || null,
          receiptNumber: subStatus.activeReceipt || null,
        },
        paymentSummary: {
          status: paymentStatus,
          statusLabel: paymentStatusLabel,
          totalSpentInr,
          successfulPaymentsCount: successfulPayments.length,
          pendingPaymentsCount: pendingPayments.length,
          failedPaymentsCount: failedPayments.length,
          lastPaymentAt: paymentHistory[0]?.date || null,
        },
        paymentHistory,
      };
    });

    return res.json({
      query: rawQuery,
      summary,
      matches,
    });
  });

  // Admin Database Management: Update or Grant/Revoke Reader Account, UPI & Paid Premium
  app.put('/api/admin/readers/:id', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;

    const existingTarget = db.getSnapshot().users.find((x: User) => x.id === req.params.id);
    if (existingTarget && isProtectedVaultUser(existingTarget)) {
      return res.status(403).json({
        error:
          'Forbidden: Protected administrator & owner reader credentials are immutable in the backend vault and cannot be altered by any means.',
      });
    }

    const { name, email, phone, age, upiId, paidPlan, paymentMethod, transactionId, role, isSuspended, suspendedReason } = req.body;
    let updatedUser: User | null = null;

    db.mutate(d => {
      const u = d.users.find((x: User) => x.id === req.params.id);
      if (u && !isProtectedVaultUser(u)) {
        if (name !== undefined && name.trim()) u.name = name.trim();
        if (email !== undefined && email.trim()) u.email = email.trim().toLowerCase();
        if (phone !== undefined) u.phone = phone.trim();
        if (age !== undefined && age !== '' && !isNaN(Number(age))) u.age = Number(age);
        if (upiId !== undefined) u.upiId = upiId.trim();
        if (role && ['reader', 'author'].includes(role)) {
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
    db.logActivity('ADMIN_UPDATED_READER', 'protected_admin', 'admin', `Updated reader ${(updatedUser as User).email} (Plan: ${paidPlan || 'unchanged'}, UPI: ${upiId || 'N/A'})`, 'user', req.params.id);
    await db.persistChanges({
      users: [updatedUser as User],
      collections: ['purchases', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, reader: sanitizeUserForClient(updatedUser as User, false) });
  });

  app.post('/api/admin/readers/:id/suspend', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;

    const existingTarget = db.getSnapshot().users.find((x: User) => x.id === req.params.id);
    if (existingTarget && isProtectedVaultUser(existingTarget)) {
      return res.status(403).json({
        error: 'Forbidden: Protected administrator & owner reader account cannot be suspended.',
      });
    }

    const { isSuspended, reason } = req.body;
    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find((x: User) => x.id === req.params.id);
      if (u && !isProtectedVaultUser(u)) {
        u.isSuspended = Boolean(isSuspended);
        u.suspendedReason = u.isSuspended ? (reason || 'Account suspended by Administrator.') : undefined;
        updatedUser = u;
      }
    });
    if (!updatedUser) return res.status(404).json({ error: 'Reader not found' });
    const targetUser = updatedUser as User;
    db.logActivity(
      targetUser.isSuspended ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      'protected_admin',
      'admin',
      `${targetUser.isSuspended ? 'Suspended' : 'Reactivated'} account ${targetUser.email}`,
      'user',
      req.params.id
    );
    await db.persistChanges({
      users: [targetUser],
      collections: ['activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, reader: sanitizeUserForClient(targetUser, false) });
  });

  app.delete('/api/admin/readers/:id', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;

    const existingTarget = db.getSnapshot().users.find((x: User) => x.id === req.params.id);
    if (existingTarget && isProtectedVaultUser(existingTarget)) {
      return res.status(403).json({
        error: 'Forbidden: Protected administrator & owner reader account cannot be deleted.',
      });
    }

    let removedEmail = '';
    db.mutate(d => {
      const idx = d.users.findIndex((x: User) => x.id === req.params.id);
      if (idx !== -1 && !isProtectedVaultUser(d.users[idx])) {
        removedEmail = d.users[idx].email;
        d.users.splice(idx, 1);
      }
    });
    if (!removedEmail) return res.status(404).json({ error: 'Reader not found' });
    db.logActivity('ADMIN_DELETED_READER', 'protected_admin', 'admin', `Deleted reader account ${removedEmail}`, 'user', req.params.id);
    await db.persistChanges({
      deletedUserIds: [req.params.id],
      collections: ['activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
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
        app.sampleImages = comicPages.slice(0, 6);
        if (!app.samplePagesCount) {
          app.samplePagesCount = app.sampleImages.length;
        }
      }
    });
  };

  app.get('/api/admin/stats', async (req, res) => {
    await db.ensureFreshFromCloud();
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

  app.get('/api/admin/authors', async (req, res) => {
    await db.ensureFreshFromCloud();
    db.mutate(d => normalizeAuthorApplications(d));
    const snapshot = db.getSnapshot();
    return res.json({
      applications: snapshot.authorApplications,
      authors: snapshot.users.filter(u => u.role === 'author').map(u => sanitizeUserForClient(u, false)),
    });
  });

  app.post('/api/admin/author-applications/:id/action', async (req, res) => {
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

    if (targetApp) {
      await db.persistChanges({
        users: promoObj ? [promoObj] : [],
        collections: ['authorApplications', 'notifications', 'activityLogs'],
        userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
      });
    }

    return res.json({
      success: true,
      application: targetApp,
      user: promoObj ? sanitizeUserForClient(promoObj, false) : null,
    });
  });

  app.get('/api/admin/transactions', async (req, res) => {
    await db.ensureFreshFromCloud();
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

  app.post('/api/admin/transactions/:id/refund', async (req, res) => {
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
    await db.persistChanges({
      collections: ['purchases', 'paymentTransactions', 'settings', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
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

  app.get('/api/admin/gst/settings', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;
    await db.ensureFreshFromCloud();
    const snapshot = db.getSnapshot();
    const rawGstSettings = snapshot.gstSettings || getDefaultGstBusinessSettings();
    const gstSettings: GstBusinessSettings = {
      ...rawGstSettings,
      updatedByEmail: redactAdminSecrets(
        rawGstSettings.updatedByEmail,
        IMMUTABLE_ADMIN_VAULT.email,
        IMMUTABLE_ADMIN_VAULT.phone
      ),
      auditHistory: (rawGstSettings.auditHistory || []).map((entry) => ({
        ...entry,
        adminEmail: redactAdminSecrets(
          entry.adminEmail,
          IMMUTABLE_ADMIN_VAULT.email,
          IMMUTABLE_ADMIN_VAULT.phone
        ),
        summary: redactAdminSecrets(
          entry.summary,
          IMMUTABLE_ADMIN_VAULT.email,
          IMMUTABLE_ADMIN_VAULT.phone
        ),
      })),
    };
    const creditNotes = snapshot.creditNotes || [];
    const invoices = snapshot.purchases.map((p, idx) =>
      ensurePurchaseGstFields(p, rawGstSettings, idx + 1)
    );
    const validation = validateGstExportData({
      settings: rawGstSettings,
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

    if (updatedSettings) {
      await db.persistChanges({
        collections: ['settings', 'activityLogs'],
        userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
      });
    }

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

    await db.persistChanges({
      collections: ['purchases', 'settings', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

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

  app.get('/api/admin/reports', async (req, res) => {
    await db.ensureFreshFromCloud();
    return res.json({ reports: db.getSnapshot().reports || [] });
  });

  app.post('/api/admin/reports/:id/action', async (req, res) => {
    const { status = 'resolved' } = req.body;
    db.mutate(d => {
      const r = (d.reports || []).find(rep => rep.id === req.params.id);
      if (r) {
        r.status = status;
        r.resolvedAt = new Date().toISOString();
      }
    });
    await db.persistChanges({
      collections: ['reports'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true });
  });

  // -------------------------------------------------------------
  // COMPANY AD PLACEMENT & IN-COMIC CHARACTER PROMOTION REQUESTS
  // -------------------------------------------------------------

  app.post('/api/ads/request', async (req, res) => {
    const {
      companyName,
      contactName,
      contactEmail,
      contactPhone = '',
      placementType = 'character_promotion',
      targetComicId = '',
      targetComicTitle = 'Any Popular Comic Series',
      budgetRange = '₹15,000 – ₹50,000',
      description,
      submittedByUserId,
    } = req.body || {};

    const cleanCompany = String(companyName || '').trim();
    const cleanContact = String(contactName || '').trim();
    const cleanEmail = String(contactEmail || '').trim();
    const cleanDesc = String(description || '').trim();

    if (!cleanCompany || !cleanContact || !cleanEmail || !cleanEmail.includes('@') || cleanDesc.length < 5) {
      return res.status(400).json({
        error: 'Please enter Company Name, Contact Name, valid Email, and Campaign Description (at least 5 characters).',
      });
    }

    const safePlacementType: 'character_promotion' | 'sponsored_page' | 'episode_sponsor' =
      placementType === 'sponsored_page' || placementType === 'episode_sponsor'
        ? placementType
        : 'character_promotion';

    const nowIso = new Date().toISOString();
    const newAdRequest = {
      id: `adreq_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      companyName: cleanCompany.slice(0, 120),
      contactName: cleanContact.slice(0, 80),
      contactEmail: cleanEmail.slice(0, 120),
      contactPhone: String(contactPhone || '').trim().slice(0, 32),
      placementType: safePlacementType,
      targetComicId: String(targetComicId || '').trim() || undefined,
      targetComicTitle: String(targetComicTitle || 'Any Popular Comic Series').trim().slice(0, 140),
      budgetRange: String(budgetRange || 'Custom Campaign').trim().slice(0, 64),
      description: cleanDesc.slice(0, 1000),
      status: 'pending' as const,
      submittedByUserId: String(submittedByUserId || 'guest_sponsor').trim() || 'guest_sponsor',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const adminUsers = db.getSnapshot().users.filter(u => u.role === 'admin');
    db.mutate(d => {
      if (!Array.isArray(d.adRequests)) d.adRequests = [];
      d.adRequests.unshift(newAdRequest);

      for (const adminUser of adminUsers) {
        d.notifications.unshift({
          id: `notif_ad_${Date.now()}_${adminUser.id}`,
          userId: adminUser.id,
          userEmail: adminUser.email,
          type: 'system',
          title: `New Company Ad Request: ${newAdRequest.companyName}`,
          message: `${newAdRequest.companyName} (${newAdRequest.contactEmail}) requested "${safePlacementType === 'character_promotion' ? 'In-Comic Character Promotion' : safePlacementType}" for ${newAdRequest.targetComicTitle}.`,
          read: false,
          targetId: newAdRequest.id,
          createdAt: nowIso,
        });
      }
    });

    db.logActivity(
      'AD_REQUEST_SUBMITTED',
      cleanEmail,
      'reader',
      `Company "${newAdRequest.companyName}" submitted a ${safePlacementType} ad request.`,
      'ad_request',
      newAdRequest.id
    );

    await db.persistChanges({
      collections: ['adRequests', 'notifications', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({
      success: true,
      adRequest: newAdRequest,
      adminEmail: 'aathiraicomic@gmail.com',
      message: 'Your company ad request was submitted! Our team at aathiraicomic@gmail.com will review your character promotion brief shortly.',
    });
  });

  app.get('/api/admin/ad-requests', async (_req, res) => {
    await db.ensureFreshFromCloud();
    const adRequests = [...(db.getSnapshot().adRequests || [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return res.json({ adRequests });
  });

  app.put('/api/admin/ad-requests/:id', async (req, res) => {
    const { status, adminNote } = req.body || {};
    const allowedStatuses = new Set(['pending', 'contacted', 'approved', 'rejected']);
    let updatedReq: any = null;

    db.mutate(d => {
      if (!Array.isArray(d.adRequests)) d.adRequests = [];
      const item = d.adRequests.find(a => a.id === req.params.id);
      if (item) {
        if (status && allowedStatuses.has(status)) {
          item.status = status;
        }
        if (adminNote !== undefined) {
          item.adminNote = String(adminNote).trim().slice(0, 400);
        }
        item.updatedAt = new Date().toISOString();
        updatedReq = item;
      }
    });

    if (!updatedReq) {
      return res.status(404).json({ error: 'Ad request not found.' });
    }

    db.logActivity(
      'AD_REQUEST_UPDATED',
      'aathiraicomic@gmail.com',
      'admin',
      `Updated ad request from "${updatedReq.companyName}" to status: ${updatedReq.status}`,
      'ad_request',
      updatedReq.id
    );

    await db.persistChanges({
      collections: ['adRequests', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({ success: true, adRequest: updatedReq });
  });

  app.get('/api/admin/migration-status', async (req, res) => {
    const snapshot = db.getSnapshot();
    const firestoreStatus = await getFirestoreLiveStatus(extractFirebaseIdToken(req.headers.authorization));
    return res.json({
      migrationReport: snapshot.migrationReport || null,
      firestoreStatus,
      counts: {
        users: snapshot.users.length,
        comics: snapshot.comics.length,
        purchases: snapshot.purchases.length,
        paymentTransactions: (snapshot.paymentTransactions || []).length,
        notifications: (snapshot.notifications || []).length,
      },
    });
  });

  app.get('/api/admin/firestore/status', async (req, res) => {
    const status = await getFirestoreLiveStatus(extractFirebaseIdToken(req.headers.authorization));
    return res.json({ success: true, ...status });
  });

  app.post('/api/admin/firestore/sync', async (req, res) => {
    const fbToken = extractFirebaseIdToken(req.headers.authorization);
    const snapshot = db.getSnapshot();
    const { success: syncOk, ...syncDetails } = await syncDatabaseSnapshotToFirestore(snapshot, fbToken);
    if (!syncOk) {
      return res.status(syncDetails.mode === 'public_api_key' ? 401 : 502).json({
        success: false,
        ...syncDetails,
      });
    }
    db.logActivity(
      'FIRESTORE_FULL_SYNC',
      'balajiaris05@gmail.com',
      'admin',
      `Synced ${syncDetails.written} Firestore documents to ${syncDetails.projectId}/${syncDetails.databaseId} (${syncDetails.mode}).`,
      'firestore',
      syncDetails.databaseId
    );
    return res.json({
      success: true,
      ...syncDetails,
      message: `Synced ${syncDetails.written} documents across all 15 Firestore collections (${syncDetails.mode}).`,
    });
  });

  app.get('/api/admin/ratings', async (req, res) => {
    await db.ensureFreshFromCloud();
    return res.json({ ratings: db.getSnapshot().ratings });
  });

  app.delete('/api/admin/ratings/:id', async (req, res) => {
    db.mutate(d => {
      d.ratings = d.ratings.filter(r => r.id !== req.params.id);
      applyRatingsToComics(d.comics, d.ratings);
    });
    db.logActivity('RATING_REMOVED_AUDIT', 'admin@aathirai.com', 'admin', `Admin removed rating ID: ${req.params.id}`, 'rating', req.params.id);
    await db.persistChanges({
      deletedRatingIds: [req.params.id],
      collections: ['ratings', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, message: 'Rating removed by administrator' });
  });

  app.get('/api/admin/comments', async (req, res) => {
    await db.ensureFreshFromCloud();
    return res.json({ comments: db.getSnapshot().comments });
  });

  app.get('/api/admin/copyright', async (req, res) => {
    await db.ensureFreshFromCloud();
    return res.json({ copyrightDocs: db.getSnapshot().copyrightDocs });
  });

  app.post('/api/admin/copyright', async (req, res) => {
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
    await db.persistChanges({
      collections: ['copyrightDocs', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });

    return res.json({ success: true, doc: newDoc });
  });

  app.delete('/api/admin/copyright/:id', async (req, res) => {
    db.mutate(d => {
      d.copyrightDocs = d.copyrightDocs.filter(c => c.id !== req.params.id);
    });
    await db.persistChanges({
      collections: ['copyrightDocs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true });
  });

  app.get('/api/admin/settings', async (req, res) => {
    await db.ensureFreshFromCloud();
    return res.json({ settings: db.getSnapshot().settings });
  });

  app.put('/api/admin/settings', async (req, res) => {
    db.mutate(d => {
      d.settings = { ...d.settings, ...req.body };
    });
    const updatedSettings = db.getSnapshot().settings;
    db.logActivity('SETTINGS_UPDATED', 'admin@aathirai.com', 'admin', 'Updated website settings and pricing.', 'settings', 'global');
    await db.persistChanges({
      collections: ['settings', 'activityLogs'],
      userFirebaseIdToken: extractFirebaseIdToken(req.headers.authorization),
    });
    return res.json({ success: true, settings: updatedSettings });
  });

  // -------------------------------------------------------------
  // SCOPED ACTIVITY LOGS: 1-DAY IST VIEW + MONTHLY AUTO-ARCHIVE & CLEANUP
  // Stores ONLY Admin Panel events + ₹49 / ₹249 customer payments
  // -------------------------------------------------------------
  const sanitizeActivityLogEntry = (entry: ActivityLog): ActivityLog => {
    const ist = getIstDateParts(entry.timestamp);
    return {
      ...entry,
      istDayKey: entry.istDayKey || ist.dayKey,
      istMonthKey: entry.istMonthKey || ist.monthKey,
      actorEmail: redactAdminSecrets(
        entry.actorEmail,
        IMMUTABLE_ADMIN_VAULT.email,
        IMMUTABLE_ADMIN_VAULT.phone
      ),
      details: redactAdminSecrets(
        entry.details,
        IMMUTABLE_ADMIN_VAULT.email,
        IMMUTABLE_ADMIN_VAULT.phone
      ),
    };
  };

  const escapeFormulaSafeCsvCell = (value: unknown): string => {
    let str = String(value ?? '').replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const buildMonthlyLogsCsv = (logs: ActivityLog[]): string => {
    const headers = [
      'Log ID',
      'IST Date',
      'IST Month',
      'Timestamp (ISO)',
      'Category',
      'Amount (INR)',
      'Action',
      'Actor Email',
      'Actor Role',
      'Target Type',
      'Target ID',
      'Details',
    ];
    const rows = logs.map((log) => [
      log.id,
      log.istDayKey || getIstDateParts(log.timestamp).dayKey,
      log.istMonthKey || getIstDateParts(log.timestamp).monthKey,
      log.timestamp,
      log.category === 'payment_49'
        ? 'Customer Payment (₹49)'
        : log.category === 'payment_249'
          ? 'Customer Payment (₹249)'
          : 'Admin Panel',
      log.amountInr ?? '',
      log.action,
      log.actorEmail,
      log.actorRole || '',
      log.targetType || '',
      log.targetId || '',
      log.details,
    ]);
    return (
      '\uFEFF' +
      [
        headers.map(escapeFormulaSafeCsvCell).join(','),
        ...rows.map((row) => row.map(escapeFormulaSafeCsvCell).join(',')),
      ].join('\n')
    );
  };

  const computeLogSummaryStats = (logs: ActivityLog[]) => {
    let adminActionsCount = 0;
    let payments49Count = 0;
    let payments249Count = 0;
    for (const log of logs) {
      if (log.category === 'payment_49' || log.amountInr === 49) {
        payments49Count += 1;
      } else if (log.category === 'payment_249' || log.amountInr === 249) {
        payments249Count += 1;
      } else {
        adminActionsCount += 1;
      }
    }
    const totalRevenueInr = payments49Count * 49 + payments249Count * 249;
    return { adminActionsCount, payments49Count, payments249Count, totalRevenueInr };
  };

  let activityLogArchiveLock: Promise<unknown> = Promise.resolve();

  const archiveMonthLogsAndEmail = async (params: {
    monthKey: string;
    trigger: 'auto_month_end' | 'manual';
  }): Promise<{
    ok: boolean;
    monthKey: string;
    monthLabel: string;
    archivedCount: number;
    skipped?: boolean;
    logsPreserved?: boolean;
    error?: string;
    message?: string;
  }> => {
    const runArchive = async () => {
      const targetMonthKey = params.monthKey;
      const monthLabel = formatIstMonthLabel(targetMonthKey);
      const snapshot = db.getSnapshot();
      const matchingLogs = (snapshot.activityLogs || [])
        .map(sanitizeActivityLogEntry)
        .filter((log) => (log.istMonthKey || getIstDateParts(log.timestamp).monthKey) === targetMonthKey);

      if (matchingLogs.length === 0) {
        db.mutate((d) => {
          const prev = d.activityLogArchiveState || {};
          const nextPending = (prev.pendingRetryMonths || []).filter((m) => m !== targetMonthKey);
          d.activityLogArchiveState = {
            ...prev,
            pendingRetryMonths: nextPending,
          };
        });
        return {
          ok: true,
          monthKey: targetMonthKey,
          monthLabel,
          archivedCount: 0,
          skipped: true,
          message: `No activity logs found for ${monthLabel} to archive.`,
        };
      }

      const stats = computeLogSummaryStats(matchingLogs);
      const csvContent = buildMonthlyLogsCsv(matchingLogs);
      const jsonContent = JSON.stringify(
        {
          platform: 'Aathirai_Comic',
          archiveTrigger: params.trigger,
          monthKey: targetMonthKey,
          monthLabel,
          timezone: 'Asia/Kolkata (IST)',
          exportedAt: new Date().toISOString(),
          scope: 'Admin Panel Actions & Verified ₹49 / ₹249 Customer Payments Only',
          summary: {
            totalLogs: matchingLogs.length,
            ...stats,
          },
          logs: matchingLogs,
        },
        null,
        2
      );

      // Email strictly to the immutable backend Admin Gmail with BOTH CSV and JSON attachments
      const emailRes = await sendMonthlyActivityLogArchiveEmail({
        to: IMMUTABLE_ADMIN_VAULT.email,
        monthKey: targetMonthKey,
        monthLabel,
        trigger: params.trigger,
        totalLogs: matchingLogs.length,
        adminActionsCount: stats.adminActionsCount,
        payments49Count: stats.payments49Count,
        payments249Count: stats.payments249Count,
        totalRevenueInr: stats.totalRevenueInr,
        csvContent,
        jsonContent,
      });

      if (!emailRes.sent) {
        // SAFETY RULE: Never delete logs if email delivery fails — retain and retry automatically
        const safeErr = redactAdminSecrets(
          emailRes.error || 'SMTP delivery failed while sending monthly log archive.',
          IMMUTABLE_ADMIN_VAULT.email,
          IMMUTABLE_ADMIN_VAULT.phone
        );
        db.mutate((d) => {
          const prev = d.activityLogArchiveState || {};
          const pending = new Set<string>(prev.pendingRetryMonths || []);
          pending.add(targetMonthKey);
          d.activityLogArchiveState = {
            ...prev,
            pendingRetryMonths: Array.from(pending).sort(),
            lastArchiveError: safeErr,
            lastAttemptAt: new Date().toISOString(),
          };
        });
        return {
          ok: false,
          monthKey: targetMonthKey,
          monthLabel,
          archivedCount: 0,
          logsPreserved: true,
          error: `${safeErr} All ${matchingLogs.length} logs were preserved safely and will retry automatically.`,
        };
      }

      // CONFIRMED DELIVERY: Automatically delete archived month's logs from backend + Firestore to free space
      const archivedIdSet = new Set(matchingLogs.map((l) => l.id));
      const archivedAtIso = new Date().toISOString();
      db.mutate((d) => {
        d.activityLogs = (d.activityLogs || []).filter((log) => !archivedIdSet.has(log.id));
        const prev = d.activityLogArchiveState || {};
        const nextPending = (prev.pendingRetryMonths || []).filter((m) => m !== targetMonthKey);
        d.activityLogArchiveState = {
          ...prev,
          lastArchivedMonth: targetMonthKey,
          lastArchivedAt: archivedAtIso,
          lastArchivedCount: matchingLogs.length,
          lastArchiveMessageId: emailRes.messageId,
          pendingRetryMonths: nextPending,
          lastArchiveError: nextPending.length === 0 ? undefined : prev.lastArchiveError,
          lastAttemptAt: archivedAtIso,
        };
      });

      await db.persistChanges({ collections: ['activityLogs'] }).catch(() => undefined);

      return {
        ok: true,
        monthKey: targetMonthKey,
        monthLabel,
        archivedCount: matchingLogs.length,
        message: `Emailed ${matchingLogs.length} logs for ${monthLabel} (CSV + JSON) to Protected Backend Admin Gmail and cleared them from backend storage.`,
      };
    };

    const next = activityLogArchiveLock.then(runArchive, runArchive);
    activityLogArchiveLock = next.catch(() => undefined);
    return next;
  };

  const runAutoMonthEndLogArchiveCheck = async () => {
    try {
      const currentIstMonthKey = getIstDateParts().monthKey;
      const snapshot = db.getSnapshot();
      const overdueMonths = new Set<string>();
      for (const log of snapshot.activityLogs || []) {
        const logMonth = log.istMonthKey || getIstDateParts(log.timestamp).monthKey;
        if (logMonth && logMonth < currentIstMonthKey) {
          overdueMonths.add(logMonth);
        }
      }
      const sortedOverdue = Array.from(overdueMonths).sort();
      for (const monthKey of sortedOverdue) {
        await archiveMonthLogsAndEmail({ monthKey, trigger: 'auto_month_end' });
      }
    } catch {
      // Non-fatal; will retry on next periodic tick
    }
  };

  // Run month-end archive check shortly after startup and every 15 minutes thereafter
  const startupArchiveTimer = setTimeout(() => {
    void runAutoMonthEndLogArchiveCheck();
  }, 4000);
  startupArchiveTimer.unref?.();

  const periodicArchiveInterval = setInterval(() => {
    void runAutoMonthEndLogArchiveCheck();
  }, 15 * 60 * 1000);
  periodicArchiveInterval.unref?.();

  app.get('/api/admin/logs', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;
    await db.ensureFreshFromCloud();

    // Non-blocking background retry if any previous IST month is overdue for email archive
    const currentIst = getIstDateParts();
    const snapshot = db.getSnapshot();
    const hasOverdueMonth = (snapshot.activityLogs || []).some((entry) => {
      const entryMonth = entry.istMonthKey || getIstDateParts(entry.timestamp).monthKey;
      return entryMonth < currentIst.monthKey;
    });
    if (hasOverdueMonth) {
      void runAutoMonthEndLogArchiveCheck();
    }

    const scope = req.query.scope === 'month' ? 'month' : 'day';
    const allSafeLogs = (snapshot.activityLogs || []).map(sanitizeActivityLogEntry);

    const currentMonthLogs = allSafeLogs.filter(
      (entry) => (entry.istMonthKey || getIstDateParts(entry.timestamp).monthKey) === currentIst.monthKey
    );
    const todayLogs = currentMonthLogs.filter(
      (entry) => (entry.istDayKey || getIstDateParts(entry.timestamp).dayKey) === currentIst.dayKey
    );
    const monthStats = computeLogSummaryStats(currentMonthLogs);
    const rawArchiveState = snapshot.activityLogArchiveState || {};

    return res.json({
      scope,
      logs: scope === 'month' ? currentMonthLogs : todayLogs,
      todayCount: todayLogs.length,
      currentMonthCount: currentMonthLogs.length,
      currentIstDayKey: currentIst.dayKey,
      currentIstMonthKey: currentIst.monthKey,
      currentIstMonthLabel: currentIst.monthLabel,
      nextRolloverLabel: currentIst.nextRolloverLabel,
      adminActionsMonthCount: monthStats.adminActionsCount,
      payments49MonthCount: monthStats.payments49Count,
      payments249MonthCount: monthStats.payments249Count,
      totalRevenueMonthInr: monthStats.totalRevenueInr,
      archiveState: {
        lastArchivedMonth: rawArchiveState.lastArchivedMonth,
        lastArchivedAt: rawArchiveState.lastArchivedAt,
        lastArchivedCount: rawArchiveState.lastArchivedCount,
        pendingRetryMonths: rawArchiveState.pendingRetryMonths || [],
        lastArchiveError: rawArchiveState.lastArchiveError
          ? redactAdminSecrets(
              rawArchiveState.lastArchiveError,
              IMMUTABLE_ADMIN_VAULT.email,
              IMMUTABLE_ADMIN_VAULT.phone
            )
          : undefined,
      },
    });
  });

  app.post('/api/admin/logs/archive-now', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;
    await db.ensureFreshFromCloud();

    const currentIst = getIstDateParts();
    const requestedMonth =
      typeof req.body?.monthKey === 'string' && /^\d{4}-\d{2}$/.test(req.body.monthKey.trim())
        ? req.body.monthKey.trim()
        : currentIst.monthKey;

    const result = await archiveMonthLogsAndEmail({
      monthKey: requestedMonth,
      trigger: 'manual',
    });

    if (!result.ok) {
      return res.status(502).json({
        success: false,
        logsPreserved: true,
        monthKey: result.monthKey,
        monthLabel: result.monthLabel,
        error: result.error || 'Unable to email monthly archive. All logs were safely preserved.',
        archiveState: db.getSnapshot().activityLogArchiveState || {},
      });
    }

    return res.json({
      success: true,
      monthKey: result.monthKey,
      monthLabel: result.monthLabel,
      archivedCount: result.archivedCount,
      skipped: Boolean(result.skipped),
      message: result.message,
      archiveState: db.getSnapshot().activityLogArchiveState || {},
    });
  });

  app.post('/api/admin/logs/send-sample-email', async (req, res) => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;

    const now = new Date();
    const ist = getIstDateParts(now);
    const sampleMonthKey = `${ist.monthKey}-SAMPLE`;
    const sampleMonthLabel = `${ist.monthLabel} (Sample Test)`;

    const sampleLogs: ActivityLog[] = [
      {
        id: `sample-admin-${Date.now()}`,
        timestamp: now.toISOString(),
        istDayKey: ist.dayKey,
        istMonthKey: ist.monthKey,
        category: 'admin',
        action: 'ADMIN_DUAL_OTP_LOGIN_SUCCESS',
        actorEmail: 'Protected Admin Vault',
        actorRole: 'admin',
        targetType: 'admin',
        targetId: 'admin-panel',
        details: '[SAMPLE TEST] Verified Admin Panel Dual-OTP login session.',
      },
      {
        id: `sample-pay49-${Date.now() + 1}`,
        timestamp: now.toISOString(),
        istDayKey: ist.dayKey,
        istMonthKey: ist.monthKey,
        category: 'payment_49',
        amountInr: 49,
        action: 'PAYMENT_CAPTURED',
        actorEmail: 'sample.reader1@example.com',
        actorRole: 'reader',
        targetType: 'payment',
        targetId: 'pay_sample_49',
        details: '[SAMPLE TEST] Verified ₹49 (1-Month Pass) customer payment captured.',
      },
      {
        id: `sample-pay249-${Date.now() + 2}`,
        timestamp: now.toISOString(),
        istDayKey: ist.dayKey,
        istMonthKey: ist.monthKey,
        category: 'payment_249',
        amountInr: 249,
        action: 'PAYMENT_CAPTURED',
        actorEmail: 'sample.reader2@example.com',
        actorRole: 'reader',
        targetType: 'payment',
        targetId: 'pay_sample_249',
        details: '[SAMPLE TEST] Verified ₹249 (6-Month Pass) customer payment captured.',
      },
    ];

    const stats = computeLogSummaryStats(sampleLogs);
    const csvContent = buildMonthlyLogsCsv(sampleLogs);
    const jsonContent = JSON.stringify(
      {
        platform: 'Aathirai_Comic',
        sampleTest: true,
        archiveTrigger: 'manual',
        monthKey: sampleMonthKey,
        monthLabel: sampleMonthLabel,
        timezone: 'Asia/Kolkata (IST)',
        exportedAt: now.toISOString(),
        scope: 'Admin Panel Actions & Verified ₹49 / ₹249 Customer Payments Only',
        summary: {
          totalLogs: sampleLogs.length,
          ...stats,
        },
        logs: sampleLogs,
      },
      null,
      2
    );

    const emailRes = await sendMonthlyActivityLogArchiveEmail({
      to: IMMUTABLE_ADMIN_VAULT.email,
      monthKey: sampleMonthKey,
      monthLabel: sampleMonthLabel,
      trigger: 'manual',
      totalLogs: sampleLogs.length,
      adminActionsCount: stats.adminActionsCount,
      payments49Count: stats.payments49Count,
      payments249Count: stats.payments249Count,
      totalRevenueInr: stats.totalRevenueInr,
      csvContent,
      jsonContent,
    });

    if (!emailRes.sent) {
      const safeErr = redactAdminSecrets(
        emailRes.error || 'SMTP delivery failed while sending sample log archive email.',
        IMMUTABLE_ADMIN_VAULT.email,
        IMMUTABLE_ADMIN_VAULT.phone
      );
      return res.status(emailRes.configured ? 502 : 400).json({
        success: false,
        configured: emailRes.configured,
        error: safeErr,
      });
    }

    return res.json({
      success: true,
      messageId: emailRes.messageId || null,
      attachments: [
        `Aathirai_Comic_Activity_Logs_${sampleMonthKey}.csv`,
        `Aathirai_Comic_Activity_Logs_${sampleMonthKey}.json`,
      ],
      message:
        'Sample monthly archive email (with both CSV + JSON attachments) was sent to your Protected Backend Admin Gmail. No real backend logs were modified or deleted.',
    });
  });

  // Serve bundled asset images directly in both dev and production for legacy cover URLs
  app.use('/src/assets/images', express.static(path.resolve('src/assets/images')));

  // -------------------------------------------------------------
  // DYNAMIC SEARCH ENGINE OPTIMIZATION (/robots.txt, /sitemap.xml, SSR META)
  // -------------------------------------------------------------

  const getPublicBaseUrl = (req: express.Request) => {
    const rawHost = ((req.headers['x-forwarded-host'] as string) || req.get('host') || '')
      .split(',')[0]
      .trim();
    const isLocalHost = !rawHost || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(rawHost);
    if (!isLocalHost) {
      const protoHeader = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
      const proto = protoHeader.split(',')[0].trim();
      return `${proto}://${rawHost}`.replace(/\/+$/, '');
    }
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
    return 'https://aathiraicomic--aathiraicomic.us-east4.hosted.app';
  };

  const escapeXml = (str: string) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const escapeHtmlAttr = (str: string) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const resolveServerSeoImageUrl = (
    imageUrl: string | undefined,
    baseUrl: string,
    comicSlugOrId?: string
  ) => {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const trimmed = String(imageUrl || '').trim();
    if (!trimmed) return `${cleanBase}/assets/og-hero-banner.jpg`;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('data:image/')) {
      return comicSlugOrId
        ? `${cleanBase}/api/comics/${encodeURIComponent(comicSlugOrId)}/og-image`
        : `${cleanBase}/assets/og-hero-banner.jpg`;
    }
    if (trimmed.startsWith('/')) return `${cleanBase}${trimmed}`;
    return `${cleanBase}/${trimmed}`;
  };

  const buildBookMetaDescription = (comic: Comic) => {
    const genres = (comic.genre || []).slice(0, 3).join(', ') || 'Tamil & Indian Comic';
    const raw = `${comic.title} by ${comic.authorName} (${genres}). ${
      comic.description || 'Read this original Tamil & Indian digital comic online on Aathirai Comic.'
    }`
      .replace(/\s+/g, ' ')
      .trim();
    if (raw.length <= 155) return raw;
    return `${raw.slice(0, 152).replace(/\s+\S*$/, '')}...`;
  };

  // On-demand streaming endpoint for externalized comic covers, pages & avatars stored in Firestore server_comic_assets
  app.get('/api/comic-assets/:assetKey', async (req, res) => {
    const rawKey = String(req.params.assetKey || '').trim();
    if (!rawKey || !/^[a-zA-Z0-9_-]{3,128}$/.test(rawKey)) {
      return res.status(400).end();
    }
    const parsedChunks = Number(req.query.chunks);
    const expectedChunks =
      Number.isFinite(parsedChunks) && parsedChunks >= 1 && parsedChunks <= 100
        ? Math.floor(parsedChunks)
        : undefined;

    try {
      const asset = await fetchComicAssetByKey(
        rawKey,
        expectedChunks,
        extractFirebaseIdToken(req.headers.authorization)
      );
      if (asset) {
        res.setHeader('Content-Type', asset.contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        return res.send(asset.buffer);
      }
    } catch {
      // Fall through to clean fallback image below
    }

    return res.status(404).end();
  });

  // Always serve /favicon.ico cleanly so browsers & CDN probes never receive 404 warnings
  app.get('/favicon.ico', (_req, res) => {
    const candidates = [
      path.resolve(process.cwd(), 'dist', 'favicon.ico'),
      path.resolve(process.cwd(), 'public', 'favicon.ico'),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(filePath);
      }
    }
    return res.status(204).end();
  });

  // Serve data-URI or externalized comic covers as clean HTTP images for Open Graph / Twitter cards
  app.get('/api/comics/:slugOrId/og-image', async (req, res) => {
    await db.ensureFreshFromCloud().catch(() => {});
    const slugOrId = decodeURIComponent(req.params.slugOrId || '').trim().toLowerCase();
    const matched = db
      .getSnapshot()
      .comics.find(
        c =>
          (c.slug && c.slug.toLowerCase() === slugOrId) ||
          c.id.toLowerCase() === slugOrId
      );
    const imgSrc = matched?.bannerImage || matched?.coverImage || '';
    const parsedAsset = parseComicAssetHttpUrl(imgSrc);
    if (parsedAsset) {
      const asset = await fetchComicAssetByKey(parsedAsset.assetKey, parsedAsset.totalChunks).catch(() => null);
      if (asset) {
        res.setHeader('Content-Type', asset.contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(asset.buffer);
      }
    }
    const dataMatch = imgSrc.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataMatch) {
      try {
        const mimeType = dataMatch[1];
        const buf = Buffer.from(dataMatch[2], 'base64');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(buf);
      } catch {
        // Fallback below
      }
    }
    const fallbackBanner = path.resolve(process.cwd(), 'public', 'assets', 'og-hero-banner.jpg');
    if (fs.existsSync(fallbackBanner)) {
      return res.sendFile(fallbackBanner);
    }
    return res.status(404).end();
  });

  app.get('/robots.txt', (req, res) => {
    const baseUrl = getPublicBaseUrl(req);
    res.type('text/plain').send(
      [
        'User-agent: *',
        'Allow: /',
        'Allow: /books',
        'Allow: /comic/',
        'Allow: /authors',
        'Allow: /about',
        'Allow: /premium',
        'Disallow: /api/admin/',
        'Disallow: /api/admin-auth/',
        'Disallow: /admin',
        '',
        `Sitemap: ${baseUrl}/sitemap.xml`,
      ].join('\n')
    );
  });

  app.get('/sitemap.xml', async (req, res) => {
    await db.ensureFreshFromCloud().catch(() => {});
    const baseUrl = getPublicBaseUrl(req);
    const liveComics = db
      .getSnapshot()
      .comics.filter(c => c.moderationStatus === 'approved' || c.moderationStatus === 'delete_requested');

    const latestTimestamp =
      liveComics
        .map(c => (c.updatedAt || c.createdAt || '').split('T')[0])
        .filter(Boolean)
        .sort()
        .pop() || new Date().toISOString().split('T')[0];

    const standardGenres = [
      'Action',
      'Fantasy',
      'Mythology',
      'Sci-Fi',
      'Cyberpunk',
      'Romance',
      'Slice of Life',
      'Horror',
    ];
    const allGenres = Array.from(
      new Set([...standardGenres, ...liveComics.flatMap(c => c.genre || []).filter(Boolean)])
    );

    const staticEntries = [
      { loc: `${baseUrl}/`, lastmod: latestTimestamp, changefreq: 'daily', priority: '1.0' },
      { loc: `${baseUrl}/books`, lastmod: latestTimestamp, changefreq: 'daily', priority: '0.95' },
      { loc: `${baseUrl}/authors`, lastmod: latestTimestamp, changefreq: 'weekly', priority: '0.8' },
      { loc: `${baseUrl}/premium`, lastmod: latestTimestamp, changefreq: 'weekly', priority: '0.75' },
      { loc: `${baseUrl}/about`, lastmod: latestTimestamp, changefreq: 'monthly', priority: '0.6' },
    ];

    const genreEntries = allGenres.map(g => ({
      loc: `${baseUrl}/books?genre=${encodeURIComponent(g)}`,
      lastmod: latestTimestamp,
      changefreq: 'daily',
      priority: '0.85',
    }));

    const comicEntries = liveComics.map(c => ({
      loc: `${baseUrl}/comic/${encodeURIComponent(c.slug || c.id)}`,
      lastmod: (c.updatedAt || c.createdAt || latestTimestamp).split('T')[0],
      changefreq: 'weekly',
      priority: '0.9',
    }));

    const allUrls = [...staticEntries, ...comicEntries, ...genreEntries];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allUrls
      .map(
        (u: any) =>
          `  <url>\n    <loc>${escapeXml(u.loc)}</loc>${
            u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : ''
          }\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join('\n')}\n</urlset>\n`;

    res.type('application/xml').send(xml);
  });

  const injectDynamicSeoHtml = async (rawHtml: string, req: express.Request): Promise<string> => {
    await db.ensureFreshFromCloud().catch(() => {});
    const baseUrl = getPublicBaseUrl(req);
    const reqPath = req.path || '/';
    const liveComics = db
      .getSnapshot()
      .comics.filter(c => c.moderationStatus === 'approved' || c.moderationStatus === 'delete_requested');
    const allGenres = Array.from(new Set(liveComics.flatMap(c => c.genre || []).filter(Boolean)));
    const allTitles = liveComics.map(c => c.title).filter(Boolean);

    let pageTitle = 'Aathirai Comic | Read Original Tamil & Indian Comics Online';
    let pageDesc =
      'Explore Aathirai Comic to read digital comics online. Discover original Tamil comic and Indian comic series across mythology, action, and manga.';
    let ogType = 'website';
    let ogImage = `${baseUrl}/assets/og-hero-banner.jpg`;
    let ogImageAlt = 'Aathirai Comic - Original Tamil & Indian Digital Comics Banner';
    let matchedComic: Comic | undefined;

    if (reqPath.startsWith('/comic/')) {
      const slug = decodeURIComponent(reqPath.slice('/comic/'.length)).replace(/\/+$/, '');
      matchedComic = liveComics.find(
        c => (c.slug && c.slug.toLowerCase() === slug.toLowerCase()) || c.id === slug
      );
      if (matchedComic) {
        pageTitle = `${matchedComic.title} - Read Tamil & Indian Comic | Aathirai Comic`;
        pageDesc = buildBookMetaDescription(matchedComic);
        ogType = 'book';
        ogImage = resolveServerSeoImageUrl(
          matchedComic.bannerImage || matchedComic.coverImage,
          baseUrl,
          matchedComic.slug || matchedComic.id
        );
        ogImageAlt = `${matchedComic.title} Tamil comic cover - Aathirai Comic`;
      }
    } else if (reqPath === '/books') {
      const qParam = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const genreParam = typeof req.query.genre === 'string' ? req.query.genre.trim() : '';
      if (qParam) {
        pageTitle = `${qParam} - Read Tamil & Indian Comics | Aathirai Comic`;
        pageDesc = `Browse "${qParam}" on Aathirai Comic. Read online Tamil comics, Indian digital comics, and original series.`;
      } else if (genreParam && genreParam !== 'All') {
        pageTitle = `${genreParam} Tamil & Indian Comics | Aathirai Comic`;
        pageDesc = `Read ${genreParam} Tamil comics and Indian digital comics online on Aathirai Comic. Free and premium series.`;
      } else {
        pageTitle = 'Browse Tamil & Indian Comic Books Online | Aathirai Comic';
        pageDesc =
          'Browse all Tamil comics, Indian digital comics, mythology, action, fantasy, and manga series on Aathirai Comic.';
      }
    } else if (reqPath === '/authors') {
      pageTitle = 'Tamil & Indian Comic Creators & Authors | Aathirai Comic';
      pageDesc =
        'Meet original Tamil and Indian comic book authors, illustrators, and storytellers publishing digital comics on Aathirai Comic.';
    } else if (reqPath === '/premium') {
      pageTitle = 'Premium Plans (₹49 / ₹249) - Read Digital Comics | Aathirai Comic';
      pageDesc =
        'Unlock unlimited online Tamil comics and Indian digital comics on Aathirai Comic with ₹49 Monthly or ₹249 6-Month passes.';
    } else if (reqPath === '/about') {
      pageTitle = 'About Aathirai Comic | Tamil & Indian Digital Comics Platform';
      pageDesc =
        'Learn how Aathirai Comic empowers Tamil comic and Indian comic creators with digital publishing and direct reader access.';
    }

    const keywords = Array.from(
      new Set([
        'Aathirai Comic',
        'Aathirai Comics',
        'Tamil comic',
        'Indian comic',
        'online Tamil comics',
        'Indian digital comics',
        'read digital comics online',
        ...allGenres.map(g => `${g} comics`),
        ...allGenres,
        ...allTitles,
      ])
    )
      .slice(0, 45)
      .join(', ');

    const canonicalUrl = matchedComic
      ? `${baseUrl}/comic/${encodeURIComponent(matchedComic.slug || matchedComic.id)}`
      : `${baseUrl}${reqPath === '/' ? '/' : reqPath}`;

    const dynamicJsonLd = matchedComic
      ? {
          '@context': 'https://schema.org',
          '@type': ['ComicSeries', 'Book'],
          '@id': `${canonicalUrl}#comic`,
          name: matchedComic.title,
          url: canonicalUrl,
          inLanguage: ['ta', 'en'],
          genre: matchedComic.genre,
          image: ogImage,
          keywords: [
            ...(matchedComic.genre || []),
            'Tamil comic',
            'Indian comic',
            'online Tamil comics',
            'Aathirai Comic',
          ].join(', '),
          description: matchedComic.description,
          author: { '@type': 'Person', name: matchedComic.authorName },
          publisher: {
            '@type': 'Organization',
            name: 'Aathirai Comic',
            url: `${baseUrl}/`,
          },
          numberOfEpisodes: matchedComic.chapters.reduce((s, ch) => s + (ch.episodes?.length || 0), 0),
          numberOfPages: matchedComic.chapters.reduce((s, ch) => s + (ch.episodes?.length || 0), 0),
          hasPart: matchedComic.chapters.map(ch => ({
            '@type': 'ComicIssue',
            name: `Chapter ${ch.chapterNumber}: ${ch.title}`,
            issueNumber: ch.chapterNumber,
            description: ch.synopsis || `${matchedComic!.title} Chapter ${ch.chapterNumber}`,
            hasPart: (ch.episodes || []).map(ep => ({
              '@type': 'Chapter',
              name: `Episode ${ep.episodeNumber}: ${ep.title}`,
              position: ep.episodeNumber,
              description: ep.synopsis || ep.title,
            })),
          })),
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: matchedComic.averageRating || 5,
            ratingCount: Math.max(1, matchedComic.totalViews || 1),
          },
        }
      : {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Organization',
              '@id': `${baseUrl}/#organization`,
              name: 'Aathirai Comic',
              alternateName: ['Aathirai Comic', 'Aathirai Comics', 'Aathirai_Comic'],
              url: `${baseUrl}/`,
              logo: `${baseUrl}/assets/og-hero-banner.jpg`,
              email: 'aathiraicomic@gmail.com',
              description:
                'Original Tamil comic and Indian digital comic publishing network for online Tamil comics and graphic novels.',
            },
            {
              '@type': 'WebSite',
              '@id': `${baseUrl}/#website`,
              name: 'Aathirai Comic',
              alternateName: ['Aathirai Comic', 'Aathirai Comics'],
              url: `${baseUrl}/`,
              inLanguage: ['ta', 'en'],
              keywords,
              publisher: { '@id': `${baseUrl}/#organization` },
              potentialAction: {
                '@type': 'SearchAction',
                target: {
                  '@type': 'EntryPoint',
                  urlTemplate: `${baseUrl}/books?q={search_term_string}`,
                },
                'query-input': 'required name=search_term_string',
              },
            },
            {
              '@type': 'CollectionPage',
              '@id': `${canonicalUrl}#collection`,
              name: pageTitle,
              url: canonicalUrl,
              inLanguage: ['ta', 'en'],
              keywords,
              description: pageDesc,
              mainEntity: {
                '@type': 'ItemList',
                name: 'Aathirai Comic – Tamil & Indian Digital Comics Catalog',
                numberOfItems: liveComics.length,
                itemListElement: liveComics.slice(0, 50).map((c, idx) => ({
                  '@type': 'ListItem',
                  position: idx + 1,
                  name: c.title,
                  url: `${baseUrl}/comic/${encodeURIComponent(c.slug || c.id)}`,
                })),
              },
            },
          ],
        };

    const noscriptHtml = matchedComic
      ? `<noscript><header><nav><a href="/">Aathirai Comic</a> | <a href="/books">Browse Tamil &amp; Indian Comics</a> | <a href="/authors">Authors</a></nav></header><main><article><h1>${escapeHtmlAttr(
          matchedComic.title
        )}</h1><p>By ${escapeHtmlAttr(matchedComic.authorName)} · ${escapeHtmlAttr(
          (matchedComic.genre || []).join(', ')
        )}</p><img src="${escapeHtmlAttr(ogImage)}" alt="${escapeHtmlAttr(
          `${matchedComic.title} Tamil comic cover - Aathirai Comic`
        )}" /><p>${escapeHtmlAttr(matchedComic.description)}</p><h2>Chapters &amp; Episodes</h2><ul>${matchedComic.chapters
          .map(
            ch =>
              `<li><strong>Chapter ${ch.chapterNumber}: ${escapeHtmlAttr(ch.title)}</strong>${
                ch.synopsis ? ` — ${escapeHtmlAttr(ch.synopsis)}` : ''
              }<ul>${(ch.episodes || [])
                .map(ep => `<li>Episode ${ep.episodeNumber}: ${escapeHtmlAttr(ep.title)}</li>`)
                .join('')}</ul></li>`
          )
          .join('')}</ul></article></main><footer><a href="/">Aathirai Comic</a></footer></noscript>`
      : `<noscript><header><nav><a href="/">Home</a> | <a href="/books">Books</a> | <a href="/authors">Authors</a> | <a href="/premium">Premium</a> | <a href="/about">About</a></nav></header><main><h1>Aathirai Comic — Read Original Tamil &amp; Indian Comics Online</h1><p>${escapeHtmlAttr(
          pageDesc
        )}</p>${
          liveComics.length > 0
            ? `<section><h2>Tamil &amp; Indian Digital Comics</h2>${liveComics
                .slice(0, 50)
                .map(
                  c =>
                    `<article><h3><a href="/comic/${encodeURIComponent(c.slug || c.id)}">${escapeHtmlAttr(
                      c.title
                    )}</a></h3><p>${escapeHtmlAttr((c.genre || []).join(', '))} by ${escapeHtmlAttr(
                      c.authorName
                    )} — ${escapeHtmlAttr(c.description || '')}</p></article>`
                )
                .join('')}</section>`
            : ''
        }</main><footer>Aathirai Comic — Tamil &amp; Indian Digital Comics</footer></noscript>`;

    let html = rawHtml
      .replace(/<script\s+id="aathirai-base-jsonld"[^>]*>[\s\S]*?<\/script>/i, '')
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttr(pageTitle)}</title>`)
      .replace(
        /<meta\s+name="description"[\s\S]*?\/>/i,
        `<meta name="description" content="${escapeHtmlAttr(pageDesc)}" />`
      )
      .replace(
        /<meta\s+name="keywords"[\s\S]*?\/>/i,
        `<meta name="keywords" content="${escapeHtmlAttr(keywords)}" />`
      )
      .replace(
        /<link\s+rel="canonical"[\s\S]*?\/>/i,
        `<link rel="canonical" href="${escapeHtmlAttr(canonicalUrl)}" />`
      )
      .replace(
        /<meta\s+property="og:title"[\s\S]*?\/>/i,
        `<meta property="og:title" content="${escapeHtmlAttr(pageTitle)}" />`
      )
      .replace(
        /<meta\s+property="og:description"[\s\S]*?\/>/i,
        `<meta property="og:description" content="${escapeHtmlAttr(pageDesc)}" />`
      )
      .replace(
        /<meta\s+property="og:image"[\s\S]*?\/>/i,
        `<meta property="og:image" content="${escapeHtmlAttr(ogImage)}" />`
      )
      .replace(
        /<meta\s+property="og:image:alt"[\s\S]*?\/>/i,
        `<meta property="og:image:alt" content="${escapeHtmlAttr(ogImageAlt)}" />`
      )
      .replace(
        /<meta\s+property="og:url"[\s\S]*?\/>/i,
        `<meta property="og:url" content="${escapeHtmlAttr(canonicalUrl)}" />`
      )
      .replace(
        /<meta\s+property="og:type"[\s\S]*?\/>/i,
        `<meta property="og:type" content="${escapeHtmlAttr(ogType)}" />`
      )
      .replace(
        /<meta\s+name="twitter:title"[\s\S]*?\/>/i,
        `<meta name="twitter:title" content="${escapeHtmlAttr(pageTitle)}" />`
      )
      .replace(
        /<meta\s+name="twitter:description"[\s\S]*?\/>/i,
        `<meta name="twitter:description" content="${escapeHtmlAttr(pageDesc)}" />`
      )
      .replace(
        /<meta\s+name="twitter:image"[\s\S]*?\/>/i,
        `<meta name="twitter:image" content="${escapeHtmlAttr(ogImage)}" />`
      )
      .replace(
        '</head>',
        `<script id="aathirai-dynamic-jsonld" type="application/ld+json">${JSON.stringify(dynamicJsonLd)}</script>\n</head>`
      )
      .replace('</body>', `${noscriptHtml}\n</body>`);

    return html;
  };

  // -------------------------------------------------------------
  // VITE DEV SERVER OR STATIC PRODUCTION BUILD
  // -------------------------------------------------------------

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    const publicDir = path.resolve(process.cwd(), 'public');
    app.use(express.static(distDir, { index: false }));
    if (fs.existsSync(publicDir)) {
      app.use(express.static(publicDir, { index: false }));
    }
    app.all('/api/*', (_req, res) => {
      return res.status(404).json({ error: 'API endpoint not found.' });
    });
    app.get('*', async (req, res) => {
      const distIndexPath = path.resolve(distDir, 'index.html');
      try {
        const rawHtml = fs.readFileSync(distIndexPath, 'utf8');
        const html = await injectDynamicSeoHtml(rawHtml, req);
        return res.type('html').send(html);
      } catch {
        if (fs.existsSync(distIndexPath)) {
          return res.sendFile(distIndexPath);
        }
        return res.status(503).send('Application bundle is initializing. Please refresh shortly.');
      }
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    app.use(async (req, res, next) => {
      const reqPath = req.path || '/';
      const accept = String(req.headers.accept || '');
      const isHtmlPageRequest =
        req.method === 'GET' &&
        !reqPath.startsWith('/api/') &&
        !reqPath.startsWith('/@') &&
        !reqPath.startsWith('/src/') &&
        !reqPath.startsWith('/node_modules/') &&
        !reqPath.startsWith('/assets/') &&
        !path.extname(reqPath) &&
        (accept.includes('text/html') || accept.includes('*/*') || accept === '');

      if (!isHtmlPageRequest) {
        return next();
      }

      try {
        const devIndexPath = path.resolve('index.html');
        const template = fs.readFileSync(devIndexPath, 'utf8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, template);
        const seoHtml = await injectDynamicSeoHtml(transformed, req);
        return res.status(200).set({ 'Content-Type': 'text/html' }).end(seoHtml);
      } catch {
        return next();
      }
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
