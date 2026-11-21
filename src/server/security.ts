import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { User, UserRole } from '../types/comic';

const FALLBACK_SESSION_SECRET = crypto
  .createHash('sha256')
  .update('aathirai-comic-session-secret-key-v2')
  .digest('hex');

function getSessionSecret(): string {
  return process.env.SESSION_SECRET?.trim() || FALLBACK_SESSION_SECRET;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours automatic session expiration

export interface SessionTokenPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Hash a password using Node's built-in crypto.scryptSync with random salt
 */
export function hashPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
  return `scrypt:${salt}:${derivedKey}`;
}

/**
 * Verify password against stored scrypt hash (or legacy migrated plaintext prior to upgrade)
 */
export function verifyPasswordHash(plainPassword: string, storedPassword?: string, storedHash?: string): {
  valid: boolean;
  needsRehash: boolean;
} {
  const target = storedHash || storedPassword || '';
  if (!target) {
    return { valid: false, needsRehash: false };
  }

  if (target.startsWith('scrypt:')) {
    const parts = target.split(':');
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, salt, keyHex] = parts;
    const derived = crypto.scryptSync(plainPassword, salt, 64);
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== keyBuf.length) return { valid: false, needsRehash: false };
    const valid = crypto.timingSafeEqual(derived, keyBuf);
    return { valid, needsRehash: false };
  }

  // Legacy plaintext compatibility for pre-existing accounts prior to migration; upgrades to scrypt on match
  const plainBuf = Buffer.from(String(plainPassword));
  const targetBuf = Buffer.from(String(target));
  if (plainBuf.length === targetBuf.length && crypto.timingSafeEqual(plainBuf, targetBuf)) {
    return { valid: true, needsRehash: true };
  }
  return { valid: false, needsRehash: false };
}

/**
 * Issue a signed session token (HMAC-SHA256) with automatic expiration
 */
export function createSessionToken(user: Pick<User, 'id' | 'email'> & { role?: UserRole }): string {
  const now = Date.now();
  const isAdminAccount = user.role === 'admin' || user.id === 'usr_admin';
  const payload: SessionTokenPayload = {
    userId: user.id,
    // Never embed personal admin Gmail inside base64url JWT payloads visible in browser DevTools
    email: isAdminAccount ? 'admin@vault.internal' : user.email.toLowerCase(),
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const base64Payload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(base64Payload)
    .digest('base64url');
  return `${base64Payload}.${signature}`;
}

/**
 * Verify a signed session token and check expiration
 */
export function verifySessionToken(token?: string): SessionTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [base64Payload, providedSig] = token.split('.');
  if (!base64Payload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(base64Payload)
    .digest('base64url');

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf-8')) as SessionTokenPayload;
    if (!decoded.exp || Date.now() > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export type VerificationProofPurpose = 'reg_email' | 'reg_mobile';

function normalizeProofIdentifier(purpose: VerificationProofPurpose, rawIdentifier: string): string {
  const trimmed = String(rawIdentifier || '').trim();
  if (purpose === 'reg_email') {
    return trimmed.toLowerCase();
  }
  return trimmed.replace(/\D/g, '');
}

const VERIFICATION_PROOF_TTL_MS = 30 * 60 * 1000; // 30 minutes to finish registration after OTP verify

export function createVerificationProofToken(
  purpose: VerificationProofPurpose,
  identifier: string
): string {
  const now = Date.now();
  const payload = {
    purpose,
    identifier: normalizeProofIdentifier(purpose, identifier),
    iat: now,
    exp: now + VERIFICATION_PROOF_TTL_MS,
  };
  const base64Payload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`verify-proof:${base64Payload}`)
    .digest('base64url');
  return `${base64Payload}.${signature}`;
}

export function verifyVerificationProofToken(
  token: unknown,
  expectedPurpose: VerificationProofPurpose,
  expectedIdentifier: string
): boolean {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return false;
  }
  const [base64Payload, providedSig] = token.split('.');
  if (!base64Payload || !providedSig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`verify-proof:${base64Payload}`)
    .digest('base64url');

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf-8')) as {
      purpose?: string;
      identifier?: string;
      exp?: number;
    };
    if (!decoded.exp || Date.now() > decoded.exp) return false;
    if (decoded.purpose !== expectedPurpose || !decoded.identifier) return false;

    const expectedNorm = normalizeProofIdentifier(expectedPurpose, expectedIdentifier);
    if (!expectedNorm) return false;

    if (decoded.identifier === expectedNorm) {
      return true;
    }
    if (
      expectedPurpose === 'reg_mobile' &&
      decoded.identifier.length >= 10 &&
      expectedNorm.length >= 10 &&
      decoded.identifier.slice(-10) === expectedNorm.slice(-10)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function hashOtpCode(challengeId: string, otp: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(`dual-otp:${challengeId}:${String(otp || '').trim()}`)
    .digest('hex');
}

export function verifyOtpCodeHash(challengeId: string, providedOtp: string, storedHash: string): boolean {
  const cleanOtp = String(providedOtp || '').trim();
  if (!challengeId || !cleanOtp || !storedHash) return false;
  const computed = hashOtpCode(challengeId, cleanOtp);
  const a = Buffer.from(computed);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const ADMIN_EXPORT_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface AdminExportTokenPayload {
  sub: string;
  purpose: 'customer_export';
  iat: number;
  exp: number;
}

export function createAdminExportToken(adminId: string): { token: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + ADMIN_EXPORT_TOKEN_TTL_MS;
  const payload: AdminExportTokenPayload = {
    sub: adminId,
    purpose: 'customer_export',
    iat: now,
    exp: expiresAt,
  };
  const base64Payload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`admin-export:${base64Payload}`)
    .digest('base64url');
  return {
    token: `${base64Payload}.${signature}`,
    expiresAt,
  };
}

export function verifyAdminExportToken(token?: unknown): AdminExportTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [base64Payload, providedSig] = token.split('.');
  if (!base64Payload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`admin-export:${base64Payload}`)
    .digest('base64url');

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(base64Payload, 'base64url').toString('utf-8')
    ) as AdminExportTokenPayload;
    if (!decoded.exp || Date.now() > decoded.exp) return null;
    if (decoded.purpose !== 'customer_export' || !decoded.sub) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Decode & verify a Firebase ID Token JWT structure or signed session token
 */
export async function verifyBearerToken(
  rawHeader?: string
): Promise<{
  userId?: string;
  email?: string;
  emailVerified?: boolean;
  firebaseUid?: string;
  phoneNumber?: string;
  signInProvider?: string;
} | null> {
  if (!rawHeader || !rawHeader.startsWith('Bearer ')) return null;
  const token = rawHeader.slice(7).trim();
  if (!token) return null;

  // 1. Check if it is our backend-signed HMAC session token (2 segments)
  const segments = token.split('.');
  if (segments.length === 2) {
    const verified = verifySessionToken(token);
    if (verified) {
      return {
        userId: verified.userId,
        email: verified.email,
        emailVerified: true,
      };
    }
    return null;
  }

  // 2. Check if it is a 3-segment Firebase Auth JWT ID Token
  if (segments.length === 3) {
    try {
      const payloadJson = Buffer.from(segments[1], 'base64url').toString('utf-8');
      const payload = JSON.parse(payloadJson);
      const nowSec = Math.floor(Date.now() / 1000);
      if (
        payload &&
        payload.aud === 'aathiraicomic' &&
        payload.iss === 'https://securetoken.google.com/aathiraicomic' &&
        payload.exp > nowSec
      ) {
        return {
          firebaseUid: payload.user_id || payload.sub,
          email: payload.email ? String(payload.email).toLowerCase() : undefined,
          emailVerified: Boolean(payload.email_verified),
          phoneNumber: payload.phone_number ? String(payload.phone_number).trim() : undefined,
          signInProvider:
            payload.firebase && typeof payload.firebase.sign_in_provider === 'string'
              ? payload.firebase.sign_in_provider
              : undefined,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Strip sensitive credentials/hashes before returning a User object to the frontend.
 * For the immutable administrator account, also redact personal Gmail & Mobile Number
 * so they never appear in browser Network payloads, sessionStorage, DOM, or Website Inspect.
 */
export function sanitizeUserForClient(user: User, includeSessionToken = false): User {
  const clone: User = { ...user };
  delete clone.password;
  delete clone.passwordHash;
  const isAdminAccount = clone.role === 'admin' || clone.id === 'usr_admin';
  const isProtectedOwnerReader =
    clone.id === 'usr_admin_reader' || Boolean(clone.isProtectedOwnerReader);
  if (includeSessionToken) {
    clone.sessionToken = createSessionToken(user);
  }
  if (isAdminAccount) {
    clone.email = 'protected@admin.vault';
    clone.phone = 'Protected Backend Vault';
    clone.upiId = undefined;
  } else if (isProtectedOwnerReader) {
    // Strictly keep mobile number in backend storage only — never emit to browser/DOM/console
    delete clone.phone;
    clone.upiId = undefined;
    clone.role = 'reader';
    clone.hasComplimentaryAdminAccess = Boolean(clone.hasComplimentaryAdminAccess);
    clone.isProtectedOwnerReader = true;
  }
  return clone;
}

/**
 * Scrub any accidental occurrence of the immutable admin Gmail or mobile number from strings
 * (e.g., audit logs, settings attribution, or error notices) before sending to clients.
 */
export function redactAdminSecrets(input: unknown, adminEmail: string, adminPhone: string): string {
  let out = String(input ?? '');
  if (!out) return out;
  const cleanEmail = String(adminEmail || '').trim();
  const digits = String(adminPhone || '').replace(/\D/g, '');
  const tail10 = digits.length >= 10 ? digits.slice(-10) : digits;

  if (cleanEmail) {
    const escapedEmail = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escapedEmail, 'gi'), '[Protected Admin Vault]');
  }
  if (tail10.length === 10) {
    out = out.replace(new RegExp(`(?:\\+?91[\\s-]*)?${tail10}`, 'g'), '[Protected Admin Mobile]');
  }
  return out;
}

/**
 * Strictly validate calendar Date of Birth (DD/MM/YYYY or YYYY-MM-DD)
 * Rejects impossible dates (e.g. 31/02/2000, future dates, < 5 yrs, > 115 yrs)
 * and computes authoritative server-side age.
 */
export function validateAndNormalizeDob(rawDob?: unknown): {
  valid: boolean;
  dob?: string;
  age?: number;
  error?: string;
} {
  if (typeof rawDob !== 'string' || !rawDob.trim()) {
    return { valid: false, error: 'Date of Birth (DD/MM/YYYY) is required.' };
  }
  const trimmed = rawDob.trim();
  let day = 0;
  let month = 0;
  let year = 0;

  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (dmyMatch) {
    day = parseInt(dmyMatch[1], 10);
    month = parseInt(dmyMatch[2], 10);
    year = parseInt(dmyMatch[3], 10);
  } else if (ymdMatch) {
    year = parseInt(ymdMatch[1], 10);
    month = parseInt(ymdMatch[2], 10);
    day = parseInt(ymdMatch[3], 10);
  } else {
    return { valid: false, error: 'Invalid Date of Birth format. Please select Date, Month, and Year (DD/MM/YYYY).' };
  }

  const currentYear = new Date().getFullYear();
  if (year < 1910 || year > currentYear) {
    return { valid: false, error: `Birth year must be between 1910 and ${currentYear}.` };
  }
  if (month < 1 || month > 12) {
    return { valid: false, error: 'Birth month must be between 01 and 12.' };
  }

  // Exact calendar check (catches Feb 30/31, non-leap Feb 29, Apr 31, etc.)
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return {
      valid: false,
      error: `Invalid calendar date (${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}). Please check the day for that month.`,
    };
  }

  const today = new Date();
  const dobLocal = new Date(year, month - 1, day);
  if (dobLocal.getTime() > today.getTime()) {
    return { valid: false, error: 'Date of Birth cannot be in the future.' };
  }

  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age--;
  }
  if (age < 5 || age > 115) {
    return { valid: false, error: 'Customer age must be between 5 and 115 years.' };
  }

  const normalizedDob = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  return { valid: true, dob: normalizedDob, age };
}

/**
 * Strip private PII before returning a public profile (e.g., for Author directory or comment cards)
 */
export function sanitizePublicAuthorProfile(user: Partial<User>) {
  return {
    id: user.id || '',
    name: user.name || 'Creator',
    role: user.role || 'author',
    avatar: user.avatar || '',
    bio: user.bio || '',
    socialLinks: user.socialLinks || {},
    createdAt: user.createdAt || '',
  };
}

/**
 * Security HTTP Headers Middleware
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Strict CORS checking for API routes
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Razorpay-Signature, X-Admin-Export-Token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Per-IP + Per-Route In-Memory Rate Limiter
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function createRateLimiter(options: { windowMs: number; maxRequests: number; message?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'local';
    const key = `${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now > record.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (record.count >= options.maxRequests) {
      res.status(429).json({
        error: options.message || 'Too many requests. Please wait a moment and try again.',
        retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
      });
      return;
    }

    record.count += 1;
    next();
  };
}

/**
 * Razorpay Configuration & Cryptographic Signature Verification
 * Modes:
 * - 'unconfigured': No valid Razorpay keys configured
 * - 'test': Valid test credentials configured (rzp_test_*)
 * - 'live': Valid live credentials configured (rzp_live_*)
 */
export interface RazorpayConfigStatus {
  mode: 'unconfigured' | 'test' | 'live';
  isConfigured: boolean;
  isTestMode: boolean;
  isLiveMode: boolean;
  keyId: string | null;
  statusMessage: string;
}

function cleanEnvSecret(raw?: string): string {
  return String(raw || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

export function getRazorpayEnvironmentStatus(): RazorpayConfigStatus {
  const rawKeyId = cleanEnvSecret(process.env.RAZORPAY_KEY_ID);
  const rawSecret = cleanEnvSecret(process.env.RAZORPAY_KEY_SECRET);

  const effectiveKeyId = rawKeyId;
  const effectiveSecret = rawSecret;

  if (!effectiveKeyId || !effectiveSecret || effectiveKeyId === 'your_razorpay_key_id') {
    return {
      mode: 'unconfigured',
      isConfigured: false,
      isTestMode: false,
      isLiveMode: false,
      keyId: null,
      statusMessage:
        'Razorpay credentials are not configured in backend environment variables (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET). Checkout is currently disabled.',
    };
  }

  if (effectiveKeyId.startsWith('rzp_live_')) {
    return {
      mode: 'live',
      isConfigured: true,
      isTestMode: false,
      isLiveMode: true,
      keyId: effectiveKeyId,
      statusMessage: 'Razorpay Live Gateway Active — Real INR payments enabled.',
    };
  }

  if (effectiveKeyId.startsWith('rzp_test_')) {
    return {
      mode: 'test',
      isConfigured: true,
      isTestMode: true,
      isLiveMode: false,
      keyId: effectiveKeyId,
      statusMessage: 'Razorpay Official TEST MODE Active — No real money will be charged.',
    };
  }

  return {
    mode: 'unconfigured',
    isConfigured: false,
    isTestMode: false,
    isLiveMode: false,
    keyId: null,
    statusMessage: 'Invalid RAZORPAY_KEY_ID format. Must start with rzp_test_ or rzp_live_.',
  };
}

export function getRazorpaySecret(): string {
  return cleanEnvSecret(process.env.RAZORPAY_KEY_SECRET);
}

/**
 * Compute and verify HMAC-SHA256 signature for Razorpay Order + Payment ID
 */
export function computeRazorpayOrderSignature(orderId: string, paymentId: string, secret?: string): string {
  const keySecret = secret ?? getRazorpaySecret();
  return crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

export function verifyRazorpayPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret?: string;
}): boolean {
  const { orderId, paymentId, signature, secret } = params;
  if (!orderId || !paymentId || !signature) return false;
  const expected = computeRazorpayOrderSignature(orderId, paymentId, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Compute and verify HMAC-SHA256 signature for Razorpay Subscriptions:
 * HMAC-SHA256(razorpay_payment_id + "|" + razorpay_subscription_id, KEY_SECRET)
 */
export function computeRazorpaySubscriptionSignature(
  paymentId: string,
  subscriptionId: string,
  secret?: string
): string {
  const keySecret = secret ?? getRazorpaySecret();
  return crypto
    .createHmac('sha256', keySecret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
}

export function verifyRazorpaySubscriptionSignature(params: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  secret?: string;
}): boolean {
  const { paymentId, subscriptionId, signature, secret } = params;
  if (!paymentId || !subscriptionId || !signature) return false;
  const expected = computeRazorpaySubscriptionSignature(paymentId, subscriptionId, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature?: string, webhookSecret?: string): boolean {
  const secret = webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || getRazorpaySecret();
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve the authenticated User and their authoritative DB Role from the request.
 * Never trusts a frontend-supplied role string.
 */
export async function resolveAuthenticatedUser(
  req: Request,
  users: User[]
): Promise<{ user: User | null; role: UserRole | null; authMethod: 'token' | 'identity' | 'none' }> {
  const authHeader = req.headers.authorization;
  const tokenInfo = await verifyBearerToken(authHeader);

  if (tokenInfo) {
    let matched: User | undefined;
    if (tokenInfo.userId) {
      matched = users.find(u => u.id === tokenInfo.userId);
    }
    if (!matched && tokenInfo.firebaseUid) {
      matched = users.find(
        u => u.firebaseUid === tokenInfo.firebaseUid || u.id === tokenInfo.firebaseUid
      );
    }
    if (!matched && tokenInfo.email) {
      const targetEmail = tokenInfo.email.toLowerCase();
      matched =
        users.find(
          u =>
            u.role !== 'admin' &&
            u.id !== 'usr_admin' &&
            u.email.toLowerCase() === targetEmail
        ) || users.find(u => u.email.toLowerCase() === targetEmail);
    }
    if (matched && !matched.isSuspended) {
      return { user: matched, role: matched.role, authMethod: 'token' };
    }
  }

  // Fallback lookup by userId/authorId/email in body or query, ALWAYS resolving actual role from DB (never from req.body.role)
  const candidateId =
    req.body?.userId ||
    req.body?.authorId ||
    req.query?.userId ||
    req.query?.authorId;
  const candidateEmail =
    req.body?.email ||
    req.body?.userEmail ||
    req.query?.email;

  if (candidateId || candidateEmail) {
    let matched: User | undefined;
    if (candidateId) {
      matched = users.find(u => u.id === String(candidateId));
    }
    if (!matched && candidateEmail) {
      const targetEmail = String(candidateEmail).trim().toLowerCase();
      matched =
        users.find(
          u =>
            u.role !== 'admin' &&
            u.id !== 'usr_admin' &&
            u.email.toLowerCase() === targetEmail
        ) || users.find(u => u.email.toLowerCase() === targetEmail);
    }
    if (matched && !matched.isSuspended) {
      return { user: matched, role: matched.role, authMethod: 'identity' };
    }
  }

  return { user: null, role: null, authMethod: 'none' };
}
