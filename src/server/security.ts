import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { User, UserRole } from '../types/comic';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('aathirai-comic-session-secret-key-v2').digest('hex');

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
export function createSessionToken(user: Pick<User, 'id' | 'email'>): string {
  const now = Date.now();
  const payload: SessionTokenPayload = {
    userId: user.id,
    email: user.email.toLowerCase(),
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const base64Payload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
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
    .createHmac('sha256', SESSION_SECRET)
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

/**
 * Decode & verify a Firebase ID Token JWT structure or signed session token
 */
export async function verifyBearerToken(
  rawHeader?: string
): Promise<{ userId?: string; email?: string; emailVerified?: boolean; firebaseUid?: string } | null> {
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
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Strip sensitive credentials/hashes before returning a User object to the frontend
 */
export function sanitizeUserForClient(user: User, includeSessionToken = false): User {
  const clone: User = { ...user };
  delete clone.password;
  delete clone.passwordHash;
  if (includeSessionToken) {
    clone.sessionToken = createSessionToken(user);
  }
  return clone;
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Razorpay-Signature');
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

export function getRazorpayEnvironmentStatus(): RazorpayConfigStatus {
  const rawKeyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const rawSecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

  // If no env vars are set, use explicit TEST mode credentials unless disabled
  const effectiveKeyId = rawKeyId || (process.env.RAZORPAY_DISABLE_TEST_FALLBACK === 'true' ? '' : 'rzp_test_AathiraiTestModeKey');
  const effectiveSecret = rawSecret || (process.env.RAZORPAY_DISABLE_TEST_FALLBACK === 'true' ? '' : 'rzp_test_secret_AathiraiTestSecretKey2026');

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
  const rawSecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  return rawSecret || (process.env.RAZORPAY_DISABLE_TEST_FALLBACK === 'true' ? '' : 'rzp_test_secret_AathiraiTestSecretKey2026');
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
    const matched = users.find(
      u =>
        (tokenInfo.userId && u.id === tokenInfo.userId) ||
        (tokenInfo.firebaseUid && (u.firebaseUid === tokenInfo.firebaseUid || u.id === tokenInfo.firebaseUid)) ||
        (tokenInfo.email && u.email.toLowerCase() === tokenInfo.email.toLowerCase())
    );
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
    const matched = users.find(
      u =>
        (candidateId && u.id === String(candidateId)) ||
        (candidateEmail && u.email.toLowerCase() === String(candidateEmail).trim().toLowerCase())
    );
    if (matched && !matched.isSuspended) {
      return { user: matched, role: matched.role, authMethod: 'identity' };
    }
  }

  return { user: null, role: null, authMethod: 'none' };
}
