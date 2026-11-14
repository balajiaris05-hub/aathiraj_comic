import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  hashPassword,
  verifyPasswordHash,
  createSessionToken,
  verifySessionToken,
  sanitizeUserForClient,
  sanitizePublicAuthorProfile,
  getRazorpayEnvironmentStatus,
  computeRazorpayOrderSignature,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from '../src/server/security.ts';
import {
  DEFAULT_GST_SETTINGS,
  computeGstinCheckDigit,
  validateIndianGstin,
  calculateInclusiveGstBreakdown,
  generateGstr1OfflineJson,
  generateGstReconciliationCsv,
  generateTaxInvoicePdfBytes,
  ensurePurchaseGstFields,
} from '../src/utils/gstUtils.ts';
import { db } from '../src/server/storage.ts';
import { User } from '../src/types/comic.ts';

async function runVerificationSuite() {
  console.log('=== Aathirai_Comic Automated Verification Suite ===');

  // 1. Test scrypt password hashing & verification
  const rawPass = 'Aathirai#2026!Secure';
  const hashed = hashPassword(rawPass);
  assert.ok(hashed.startsWith('scrypt:'), 'Password hash must use scrypt: format');
  assert.equal(verifyPasswordHash(rawPass, undefined, hashed).valid, true, 'Valid password must verify against scrypt hash');
  assert.equal(verifyPasswordHash('WrongPassword123', undefined, hashed).valid, false, 'Invalid password must be rejected');
  console.log('[PASS] 1. Scrypt password hashing & timing-safe verification');

  // 2. Test HMAC-SHA256 Session Token creation & verification
  const token = createSessionToken({ id: 'usr_test_1', email: 'reader@aathirai.com' });
  const verifiedPayload = verifySessionToken(token);
  assert.ok(verifiedPayload, 'Valid session token must verify');
  assert.equal(verifiedPayload?.userId, 'usr_test_1');
  assert.equal(verifiedPayload?.email, 'reader@aathirai.com');
  assert.equal(verifySessionToken(token + 'tampered'), null, 'Tampered session token must be rejected');
  console.log('[PASS] 2. HMAC-SHA256 session token signing & tamper rejection');

  // 3. Test PII Sanitization
  const mockUser: User = {
    id: 'usr_author_99',
    name: 'Arunachalam Varma',
    email: 'arun.private@gmail.com',
    phone: '+91 9876543210',
    upiId: 'arun@okaxis',
    password: 'PlaintextSecretShouldNeverLeak',
    passwordHash: hashed,
    role: 'author',
    isVerified: true,
    avatar: 'https://example.com/avatar.jpg',
    bio: 'Creator of Blade of Kumari',
    createdAt: new Date().toISOString(),
  };

  const clientSelf = sanitizeUserForClient(mockUser, true);
  assert.equal((clientSelf as any).password, undefined, 'Plaintext password must be stripped');
  assert.equal((clientSelf as any).passwordHash, undefined, 'Password hash must be stripped');
  assert.ok(clientSelf.sessionToken, 'Authenticated self user object should include signed sessionToken');

  const publicAuthor = sanitizePublicAuthorProfile(mockUser);
  assert.equal((publicAuthor as any).email, undefined, 'Public author profile must not expose private email');
  assert.equal((publicAuthor as any).phone, undefined, 'Public author profile must not expose private phone');
  assert.equal((publicAuthor as any).upiId, undefined, 'Public author profile must not expose private UPI ID');
  console.log('[PASS] 3. Client & public author PII sanitization');

  // 4. Test Razorpay UNCONFIGURED / TEST / LIVE modes & HMAC-SHA256 signature verification
  const origKeyId = process.env.RAZORPAY_KEY_ID;
  const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const origDisableFallback = process.env.RAZORPAY_DISABLE_TEST_FALLBACK;

  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_DISABLE_TEST_FALLBACK = 'true';
  const unconfigured = getRazorpayEnvironmentStatus();
  assert.equal(unconfigured.mode, 'unconfigured');
  assert.equal(unconfigured.isConfigured, false);

  delete process.env.RAZORPAY_DISABLE_TEST_FALLBACK;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_1234567890abcd';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret_key_99887766';
  const testStatus = getRazorpayEnvironmentStatus();
  assert.equal(testStatus.mode, 'test');
  assert.equal(testStatus.isConfigured, true);
  assert.equal(testStatus.isTestMode, true);
  assert.ok(testStatus.statusMessage.includes('TEST MODE'));

  process.env.RAZORPAY_KEY_ID = 'rzp_live_1234567890abcd';
  process.env.RAZORPAY_KEY_SECRET = 'live_secret_key_99887766';
  const liveStatus = getRazorpayEnvironmentStatus();
  assert.equal(liveStatus.mode, 'live');
  assert.equal(liveStatus.isConfigured, true);
  assert.equal(liveStatus.isLiveMode, true);

  const sampleOrderId = 'order_TestOrder999';
  const samplePaymentId = 'pay_TestPayment888';
  const validSig = computeRazorpayOrderSignature(sampleOrderId, samplePaymentId, 'live_secret_key_99887766');
  assert.equal(
    verifyRazorpayPaymentSignature({
      orderId: sampleOrderId,
      paymentId: samplePaymentId,
      signature: validSig,
      secret: 'live_secret_key_99887766',
    }),
    true,
    'Valid Razorpay HMAC-SHA256 signature must pass verification'
  );
  assert.equal(
    verifyRazorpayPaymentSignature({
      orderId: sampleOrderId,
      paymentId: samplePaymentId,
      signature: '00'.repeat(32),
      secret: 'live_secret_key_99887766',
    }),
    false,
    'Tampered Razorpay signature must fail verification'
  );

  const webhookBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } });
  const invalidWebhookSig = computeRazorpayOrderSignature('', '', 'webhook_secret');
  assert.equal(verifyRazorpayWebhookSignature(webhookBody, invalidWebhookSig, 'webhook_secret'), false);

  // Restore env
  if (origKeyId !== undefined) process.env.RAZORPAY_KEY_ID = origKeyId;
  else delete process.env.RAZORPAY_KEY_ID;
  if (origKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = origKeySecret;
  else delete process.env.RAZORPAY_KEY_SECRET;
  if (origDisableFallback !== undefined) process.env.RAZORPAY_DISABLE_TEST_FALLBACK = origDisableFallback;
  else delete process.env.RAZORPAY_DISABLE_TEST_FALLBACK;
  console.log('[PASS] 4. Razorpay UNCONFIGURED/TEST/LIVE mode detection & HMAC-SHA256 verification');

  // 5. Test Database Pre-Migration Backup, Password Hash Upgrade & Firestore Manifest Generation
  const snapshot = db.getSnapshot();
  assert.ok(snapshot.migrationReport, 'Migration audit report must be generated');
  assert.equal(snapshot.migrationReport?.integrityChecksPassed, true, 'Migration audit counts must match 100%');
  assert.ok(fs.existsSync(path.resolve(process.cwd(), 'backups/aathirai_db.latest_backup.json')), 'Pre-migration backup file must exist');
  assert.ok(
    fs.existsSync(path.resolve(process.cwd(), 'firestore_collections/firestore_collections_manifest.json')),
    'Normalized Firestore collections manifest must exist'
  );

  const usersWithPlaintext = snapshot.users.filter(u => Boolean(u.password));
  assert.equal(usersWithPlaintext.length, 0, 'All users in storage must have plaintext passwords migrated to scrypt hashes');
  console.log('[PASS] 5. Pre-migration SHA-256 backup, password migration & Firestore manifest integrity');

  // 6. Test Indian GST-Inclusive Calculation (18%), Modulo-36 GSTIN Validation & Exports
  const base14 = '33AABCA1234C1Z';
  const checkDigit = computeGstinCheckDigit(base14);
  const validGstin = base14 + checkDigit;
  const gstinValidRes = validateIndianGstin(validGstin);
  assert.equal(gstinValidRes.isValid, true, 'Valid 15-char GSTIN with Modulo-36 check digit must pass');
  assert.equal(gstinValidRes.stateCode, '33');
  assert.equal(validateIndianGstin('').isValid, true, 'Blank GSTIN must be allowed for unregistered businesses');
  assert.equal(validateIndianGstin('33AABCA1234C1Z0').isValid && checkDigit !== '0', false, 'Wrong check digit must fail');

  // Intra-state (33 -> 33) ₹49 inclusive of 18% GST: GST = 49 * 18 / 118 = 7.47, Taxable = 41.53
  const intra49 = calculateInclusiveGstBreakdown(49, '33', DEFAULT_GST_SETTINGS);
  assert.equal(intra49.taxAmount, 7.47, '49 * 18 / 118 must round to 7.47');
  assert.equal(intra49.taxableValue, 41.53, 'Taxable value must equal 49 - 7.47 = 41.53');
  assert.equal(intra49.taxType, 'CGST_SGST', 'Intra-state supply must use CGST + SGST');
  assert.equal(Number((intra49.cgstAmount + intra49.sgstAmount).toFixed(2)), 7.47);

  // Inter-state (29 Karnataka vs 33 Tamil Nadu) ₹249 inclusive of 18% GST: GST = 249 * 18 / 118 = 37.98, Taxable = 211.02
  const inter249 = calculateInclusiveGstBreakdown(249, '29', DEFAULT_GST_SETTINGS);
  assert.equal(inter249.taxAmount, 37.98, '249 * 18 / 118 must round to 37.98');
  assert.equal(inter249.taxableValue, 211.02, 'Taxable value must equal 249 - 37.98 = 211.02');
  assert.equal(inter249.taxType, 'IGST', 'Inter-state supply must use IGST');
  assert.equal(inter249.igstAmount, 37.98);

  // International Export (96) -> 0% GST
  const export49 = calculateInclusiveGstBreakdown(49, '96', DEFAULT_GST_SETTINGS);
  assert.equal(export49.taxType, 'NONE');
  assert.equal(export49.taxAmount, 0);
  assert.equal(export49.taxableValue, 49);

  // GSTR-1 Offline JSON & CSV & PDF generation
  const testSettings = { ...DEFAULT_GST_SETTINGS, gstin: validGstin };
  const gstr1 = generateGstr1OfflineJson(snapshot.purchases, snapshot.creditNotes || [], testSettings, 'ALL');
  assert.equal(gstr1.gstin, validGstin);
  assert.equal(gstr1.version, 'GST3.1.6');
  assert.ok(Array.isArray(gstr1.b2cs), 'GSTR-1 JSON must include b2cs array');
  assert.ok(gstr1.hsn && Array.isArray(gstr1.hsn.data), 'GSTR-1 JSON must include HSN/SAC summary');

  const csv = generateGstReconciliationCsv(snapshot.purchases, snapshot.creditNotes || [], testSettings, 'ALL');
  assert.ok(csv.includes('998431'), 'CSV must include SAC 998431');

  const firstPurchase = ensurePurchaseGstFields(snapshot.purchases[0], testSettings);
  const pdfBytes = generateTaxInvoicePdfBytes(firstPurchase, testSettings);
  const pdfHeader = Buffer.from(pdfBytes.slice(0, 8)).toString('ascii');
  assert.ok(pdfHeader.startsWith('%PDF-1.4'), 'Generated invoice must be a valid %PDF-1.4 binary');
  console.log('[PASS] 6. Indian GST-inclusive pricing (18%), Modulo-36 GSTIN validation, GSTR-1 JSON, CSV & PDF Invoice generation');

  console.log('=== ALL 6 VERIFICATION SUITES PASSED ===');
}

runVerificationSuite().catch(err => {
  console.error('Verification suite failed:', err);
  process.exit(1);
});

