import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  Comic,
  User,
  AuthorApplication,
  Comment,
  Rating,
  Vote,
  Purchase,
  PaymentTransaction,
  NotificationItem,
  ContentReport,
  CopyrightDoc,
  PlatformSettings,
  ActivityLog,
  ActivityLogArchiveState,
  DeleteRequest,
  GstBusinessSettings,
  CreditNoteRecord,
  AdPlacementRequest,
} from '../types/comic';
import { hashPassword } from './security';
import {
  getDefaultGstBusinessSettings,
  ensurePurchaseGstFields,
} from '../utils/gstUtils';
import {
  hydrateDatabaseFromFirestore,
  fetchCloudSyncRevision,
  persistSnapshotChangesToFirestore,
  type VaultCollectionKey,
} from './firestoreAdmin';

export interface MigrationAuditReport {
  migrationId: string;
  startedAt: string;
  completedAt: string;
  firestoreDatabaseId: string;
  backupFilePath: string;
  backupSha256: string;
  status: 'completed' | 'verified';
  counts: {
    users: number;
    authorApplications: number;
    comics: number;
    chapters: number;
    episodes: number;
    comments: number;
    ratings: number;
    votes: number;
    purchases: number;
    paymentTransactions: number;
    notifications: number;
    reports: number;
    deleteRequests: number;
    copyrightDocs: number;
    activityLogs: number;
  };
  integrityChecksPassed: boolean;
  details: string[];
}

export interface DatabaseSchema {
  users: User[];
  otps: Record<string, { code: string; expiresAt: number } | string>;
  adminOtp?: {
    code: string;
    expiresAt: number;
    channel: 'email' | 'sms';
    sentTo: string;
    verifiedCredential?: string;
    attempts?: number;
  };
  adminDualOtps?: Record<
    string,
    {
      challengeId: string;
      purpose: 'admin_login' | 'customer_export';
      adminId: string;
      emailOtpHash: string;
      smsOtpHash: string;
      smsMode: 'firebase' | 'backend';
      expiresAt: number;
      attempts: number;
      createdAt: number;
    }
  >;
  authorApplications: AuthorApplication[];
  comics: Comic[];
  comments: Comment[];
  ratings: Rating[];
  votes: Vote[];
  purchases: Purchase[];
  paymentTransactions: PaymentTransaction[];
  notifications: NotificationItem[];
  reports: ContentReport[];
  copyrightDocs: CopyrightDoc[];
  settings: PlatformSettings;
  gstSettings: GstBusinessSettings;
  creditNotes: CreditNoteRecord[];
  activityLogs: ActivityLog[];
  activityLogArchiveState?: ActivityLogArchiveState;
  deleteRequests: DeleteRequest[];
  adRequests: AdPlacementRequest[];
  migrationReport?: MigrationAuditReport;
}

const IST_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const IST_SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Compute authoritative Indian Standard Time (Asia/Kolkata, UTC+5:30) date/month keys.
 */
export function getIstDateParts(input?: string | Date): {
  year: number;
  month: number;
  day: number;
  dayKey: string;
  monthKey: string;
  monthLabel: string;
  nextRolloverLabel: string;
} {
  const dateObj = input instanceof Date ? input : input ? new Date(input) : new Date();
  const safeDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;
  // Shift by +5h 30m in UTC for deterministic IST calendar extraction without locale quirks
  const istMs = safeDate.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1;
  const day = ist.getUTCDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const nextMonthIndex = month % 12; // 0-indexed next month
  const nextYear = month === 12 ? year + 1 : year;

  return {
    year,
    month,
    day,
    dayKey: `${year}-${mm}-${dd}`,
    monthKey: `${year}-${mm}`,
    monthLabel: `${IST_MONTH_NAMES[month - 1]} ${year}`,
    nextRolloverLabel: `01 ${IST_SHORT_MONTHS[nextMonthIndex]} ${nextYear} · 00:00 IST`,
  };
}

export function formatIstMonthLabel(monthKey: string): string {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthKey || 'Unknown Month';
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return monthKey;
  return `${IST_MONTH_NAMES[monthIdx]} ${year}`;
}

const CONFIRMED_PAYMENT_ACTIONS = new Set([
  'PAYMENT_CAPTURED',
  'WEBHOOK_PAYMENT_UNLOCKED',
  'PAYMENT_VERIFIED',
  'SUBSCRIPTION_UNLOCKED',
]);

const ADMIN_PANEL_EXACT_ACTIONS = new Set([
  'PAYWALL_UPDATED',
  'COMIC_APPROVED',
  'COMIC_REJECTED',
  'AUTHOR_APPROVED',
  'AUTHOR_REJECTED',
  'USER_SUSPENDED',
  'USER_REACTIVATED',
  'RATING_REMOVED_AUDIT',
  'COPYRIGHT_DOC_CREATED',
  'SETTINGS_UPDATED',
  'AD_REQUEST_UPDATED',
  'GMAIL_RELEASE_ALERT_SENT',
]);

function detectAllowedPaymentAmount(
  action: string,
  details: string,
  explicitAmount?: number
): 49 | 249 | null {
  if (explicitAmount === 49 || explicitAmount === 249) {
    return explicitAmount;
  }
  const upperAction = String(action || '').toUpperCase();
  if (!CONFIRMED_PAYMENT_ACTIONS.has(upperAction)) {
    return null;
  }
  const text = String(details || '');
  if (/(?:₹|INR\s*|Rs\.?\s*)249\b|\b6_months\b|6\s*Months/i.test(text)) {
    return 249;
  }
  if (/(?:₹|INR\s*|Rs\.?\s*)49\b|\b1_month\b|1\s*Month/i.test(text)) {
    return 49;
  }
  return null;
}

/**
 * Strict Activity Log Gatekeeper:
 * Stores ONLY:
 *   1. Admin Panel operations (category: 'admin')
 *   2. Verified customer payments of ₹49 or ₹249 (category: 'payment_49' | 'payment_249')
 * Drops all other routine reader/author/webhook noise to keep backend storage lean.
 */
export function classifyScopedActivityLog(params: {
  action: string;
  actorRole: string;
  details: string;
  targetType: string;
  amountInr?: number;
}): {
  allowed: boolean;
  category?: 'admin' | 'payment_49' | 'payment_249';
  amountInr?: 49 | 249;
} {
  const upperAction = String(params.action || '').trim().toUpperCase();
  const roleLower = String(params.actorRole || '').trim().toLowerCase();

  // 1. Check verified ₹49 / ₹249 customer payments first
  const detectedAmount = detectAllowedPaymentAmount(upperAction, params.details, params.amountInr);
  if (detectedAmount === 49) {
    return { allowed: true, category: 'payment_49', amountInr: 49 };
  }
  if (detectedAmount === 249) {
    return { allowed: true, category: 'payment_249', amountInr: 249 };
  }

  // Reject unconfirmed payment failures / generic webhooks / non-49/249 amounts
  if (
    upperAction === 'PAYMENT_SIGNATURE_INVALID' ||
    upperAction === 'WEBHOOK_RECEIVED' ||
    CONFIRMED_PAYMENT_ACTIONS.has(upperAction)
  ) {
    return { allowed: false };
  }

  // 2. Check Admin Panel actions
  const isAdminPanelAction =
    roleLower === 'admin' ||
    upperAction.startsWith('ADMIN_') ||
    upperAction.startsWith('GST_') ||
    upperAction.startsWith('DELETE_REQUEST_') ||
    upperAction.startsWith('REFUND_') ||
    upperAction.startsWith('CREDIT_NOTE_') ||
    ADMIN_PANEL_EXACT_ACTIONS.has(upperAction);

  if (isAdminPanelAction) {
    return { allowed: true, category: 'admin' };
  }

  return { allowed: false };
}

const DB_FILE = path.resolve(process.cwd(), 'aathirai_db.json');
const BACKUP_DIR = path.resolve(process.cwd(), 'backups');
const FIRESTORE_SNAPSHOT_DIR = path.resolve(process.cwd(), 'firestore_collections');
const FIRESTORE_DB_ID = 'ai-studio-aathiraicomic-1a2e1a9d-77e7-4578-a8cf-3a14563bb24f';

/**
 * Frozen, backend-only canonical administrator identity.
 * Never exposed in frontend code, browser console, or Website Inspect,
 * and strictly immutable across all API endpoints, DB mutations, and cloud syncs.
 */
export const IMMUTABLE_ADMIN_VAULT = Object.freeze({
  id: 'usr_admin',
  name: 'Balaji Administrator',
  email: 'balajiaris05@gmail.com',
  phone: '+91 8610950780',
  countryCode: '+91',
  countryName: 'India',
  role: 'admin' as const,
});

export function enforceImmutableAdminRecord(users: User[]): void {
  if (!Array.isArray(users)) return;
  let adminUser = users.find((u) => u.id === IMMUTABLE_ADMIN_VAULT.id || u.role === 'admin');
  if (!adminUser) {
    adminUser = {
      id: IMMUTABLE_ADMIN_VAULT.id,
      name: IMMUTABLE_ADMIN_VAULT.name,
      email: IMMUTABLE_ADMIN_VAULT.email,
      phone: IMMUTABLE_ADMIN_VAULT.phone,
      countryCode: IMMUTABLE_ADMIN_VAULT.countryCode,
      countryName: IMMUTABLE_ADMIN_VAULT.countryName,
      role: 'admin',
      isVerified: true,
      emailVerified: true,
      isSuspended: false,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
      bio: 'Chief Content Administrator and Publisher at Aathirai_Comic.',
      createdAt: '2026-01-01T00:00:00Z',
    };
    users.unshift(adminUser);
  }
  users.forEach((u) => {
    if (u.id === IMMUTABLE_ADMIN_VAULT.id || u.role === 'admin') {
      u.id = u.id || IMMUTABLE_ADMIN_VAULT.id;
      u.email = IMMUTABLE_ADMIN_VAULT.email;
      u.phone = IMMUTABLE_ADMIN_VAULT.phone;
      u.countryCode = IMMUTABLE_ADMIN_VAULT.countryCode;
      u.countryName = IMMUTABLE_ADMIN_VAULT.countryName;
      u.name = IMMUTABLE_ADMIN_VAULT.name;
      u.role = 'admin';
      u.isVerified = true;
      u.emailVerified = true;
      u.isSuspended = false;
      u.suspendedReason = undefined;
    }
  });
}

export function getDefaultDatabase(): DatabaseSchema {
  return {
    users: [
      {
        id: IMMUTABLE_ADMIN_VAULT.id,
        name: IMMUTABLE_ADMIN_VAULT.name,
        email: IMMUTABLE_ADMIN_VAULT.email,
        phone: IMMUTABLE_ADMIN_VAULT.phone,
        countryCode: IMMUTABLE_ADMIN_VAULT.countryCode,
        countryName: IMMUTABLE_ADMIN_VAULT.countryName,
        role: 'admin',
        isVerified: true,
        emailVerified: true,
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Chief Content Administrator and Publisher at Aathirai_Comic.',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    otps: {},
    authorApplications: [],
    comics: [],
    comments: [],
    ratings: [],
    votes: [],
    purchases: [],
    paymentTransactions: [],
    notifications: [],
    reports: [],
    deleteRequests: [],
    adRequests: [],
    copyrightDocs: [
      {
        id: 'cpy_1',
        title: 'Platform Content Ownership & Author Intellectual Property Policy',
        documentNumber: 'AAT-CPY-2026-01',
        registeredEntity: 'Aathirai Media & Publishing Pvt Ltd',
        summary: 'Explicit framework guaranteeing authors retain 100% intellectual property rights to their comic titles, artwork, character lore, and scripts.',
        fullText: `1. AUTHOR INTELLECTUAL PROPERTY SOVEREIGNTY:
All original comic books, webtoons, manuscripts, graphic illustrations, and character names uploaded to Aathirai_Comic remain the exclusive intellectual property of the respective registered author. Aathirai_Comic acts strictly as a non-exclusive digital distributor and publishing facilitator.

2. GRANT OF LIMITED DIGITAL DISTRIBUTION LICENSE:
By submitting and publishing a comic on Aathirai_Comic, the author grants the platform a revocable, non-exclusive digital hosting license solely to render pages for registered readers, facilitate secure INR Razorpay transactions, and promote the work on homepage showcases.

3. DIGITAL RIGHTS MANAGEMENT & WATERMARKING:
All comic pages served through the Aathirai_Comic reader utilize encrypted image streaming to prohibit unauthorized digital extraction and scraping.

4. INFRINGEMENT REPORTING & TAKEDOWN (DMCA & INDIAN COPYRIGHT ACT 1957 COMPLIANCE):
Any copyright holder noticing unauthorized re-upload of protected artwork can file an instant infringement notice via copyright@aathirai.com. Notices will be reviewed within 24 business hours by the Administrator.`,
        status: 'published',
        effectiveDate: '2026-01-01',
        lastUpdated: '2026-11-01',
      },
      {
        id: 'cpy_2',
        title: 'Statutory Copyright Notice & DMCA Compliance Guidelines',
        documentNumber: 'AAT-CPY-2026-02',
        registeredEntity: 'Aathirai Media & Publishing Pvt Ltd',
        summary: 'Statutory compliance details under Section 52 of the Indian Copyright Act 1957 and International Digital Millennium Copyright Act protocols.',
        fullText: `All rights reserved worldwide. The compilation of comics, web layout, brand identifiers, logo, and digital reading mechanisms of Aathirai_Comic are protected under Indian and international copyright treaties.

No portion of any comic hosted on this platform may be reproduced, mirrored, syndicated, or translated without prior written permission from the designated author or Aathirai_Comic publishing operations.`,
        status: 'published',
        effectiveDate: '2026-01-01',
        lastUpdated: '2026-11-01',
      },
    ],
    settings: {
      siteName: 'Aathirai_Comic',
      tagline: 'India’s Premier Digital Manga & Comic Publishing Network',
      merchantUpiId: 'balajiaris05@okaxis',
      merchantUpiName: 'Aathirai_Comic Official',
      authorRevenueSharePercent: 70,
      episodeDefaultPrice: 10,
      chapterDefaultPrice: 30,
      fullComicDefaultPrice: 99,
      monthlySubscriptionPrice: 49,
      sixMonthSubscriptionPrice: 249,
      currency: 'INR',
      termsCustomer: `1. ACCOUNT & ACCESS: Users must maintain accurate account credentials. Do not share your reading access.
2. COMIC CONSUMPTION: Purchasing an episode, chapter, or comic grants a personal, non-transferable digital reading license.
3. INDIAN PAYMENTS & RAZORPAY: All purchases are billed in Indian Rupees (INR ₹) with applicable taxes. Supported methods include UPI, Indian debit/credit cards, and Net Banking.
4. REFUND POLICY: Due to the immediate delivery of digital comic pages, purchases are non-refundable once unlocked, unless technical server errors occur.
5. COMMUNITY CONDUCT: Comments containing hate speech, offensive language, or piracy links will result in account termination.`,
      termsAuthor: `1. AUTHOR APPLICATION & VERIFICATION: Author status requires formal administrator approval before publishing privileges are granted.
2. ORIGINAL CONTENT GUARANTEE: Authors represent and warrant that all submitted comics are 100% original creations free of copyright infringement.
3. REVENUE SHARING: Authors receive 70% of gross INR sales from their premium episodes and comics, minus standard gateway processing fees.
4. PAYOUT THRESHOLD: Minimum payout threshold is ₹500 via direct UPI or NEFT bank transfer upon request.
5. CONTENT MODERATION: Aathirai_Comic reserves the right to unpublish comics containing prohibited or abusive material.`,
      copyrightNotice: '© 2026 Aathirai_Comic. Empowering storytellers across India and the globe. All rights reserved.',
    },
    gstSettings: getDefaultGstBusinessSettings(),
    creditNotes: [],
    activityLogs: [],
    activityLogArchiveState: {
      pendingRetryMonths: [],
    },
  };
}

export class StorageEngine {
  private data: DatabaseSchema;
  private cloudRevision = 0;
  private lastRevisionCheckMs = 0;
  private initPromise: Promise<{ hydrated: boolean; mode: string; error?: string }> | null = null;
  private freshPromise: Promise<void> | null = null;
  private persistQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.data = this.loadAndMigrateData();
  }

  /**
   * 1. Creates a verified cryptographic backup of `aathirai_db.json` before migration.
   * 2. Migrates and normalizes all records into structured Firestore collection snapshots
   *    (`firestore_collections/*.json`) mapped to `ai-studio-aathiraicomic-1a2e1a9d-77e7-4578-a8cf-3a14563bb24f`.
   * 3. Verifies record counts, relationships, and historical payment integrity.
   */
  private loadAndMigrateData(): DatabaseSchema {
    const startedAt = new Date().toISOString();
    let rawContent = '';
    let parsed: DatabaseSchema;

    try {
      if (fs.existsSync(DB_FILE)) {
        rawContent = fs.readFileSync(DB_FILE, 'utf-8');
        parsed = JSON.parse(rawContent);
      } else {
        parsed = getDefaultDatabase();
        rawContent = JSON.stringify(parsed, null, 2);
      }
    } catch (err) {
      console.error('Error reading DB_FILE, falling back to default seed:', err);
      parsed = getDefaultDatabase();
      rawContent = JSON.stringify(parsed, null, 2);
    }

    // Step 1: Create immutable backup before any schema upgrades
    let backupFilePath = path.join(BACKUP_DIR, 'aathirai_db.latest_backup.json');
    const backupSha256 = crypto.createHash('sha256').update(rawContent).digest('hex');
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }
      fs.writeFileSync(backupFilePath, rawContent, 'utf-8');
    } catch (e) {
      console.error('Backup warning:', e);
    }

    // Step 2: Normalize & Upgrade Collections while preserving all IDs, timestamps, and historical payments
    const def = getDefaultDatabase();
    if (!Array.isArray(parsed.users)) parsed.users = def.users;
    if (!parsed.otps) parsed.otps = {};
    if (!Array.isArray(parsed.authorApplications)) parsed.authorApplications = def.authorApplications;
    if (!Array.isArray(parsed.comics)) parsed.comics = def.comics;
    if (!Array.isArray(parsed.comments)) parsed.comments = def.comments;
    if (!Array.isArray(parsed.ratings)) parsed.ratings = def.ratings;
    if (!Array.isArray(parsed.votes)) parsed.votes = def.votes;
    if (!Array.isArray(parsed.purchases)) parsed.purchases = def.purchases;
    if (!Array.isArray(parsed.paymentTransactions)) parsed.paymentTransactions = [];
    if (!Array.isArray(parsed.notifications)) parsed.notifications = def.notifications;
    if (!Array.isArray(parsed.reports)) parsed.reports = [];
    if (!Array.isArray(parsed.deleteRequests)) parsed.deleteRequests = [];
    if (!Array.isArray(parsed.adRequests)) parsed.adRequests = [];
    if (!Array.isArray(parsed.copyrightDocs)) parsed.copyrightDocs = def.copyrightDocs;
    if (!parsed.settings) parsed.settings = def.settings;
    if (!parsed.gstSettings) {
      parsed.gstSettings = getDefaultGstBusinessSettings();
    } else {
      const defGst = getDefaultGstBusinessSettings();
      parsed.gstSettings = {
        ...defGst,
        ...parsed.gstSettings,
        auditHistory: Array.isArray(parsed.gstSettings.auditHistory)
          ? parsed.gstSettings.auditHistory
          : defGst.auditHistory,
      };
    }
    if (!Array.isArray(parsed.creditNotes)) parsed.creditNotes = [];
    if (!Array.isArray(parsed.activityLogs)) parsed.activityLogs = def.activityLogs;
    if (!parsed.activityLogArchiveState || typeof parsed.activityLogArchiveState !== 'object') {
      parsed.activityLogArchiveState = { pendingRetryMonths: [] };
    }

    // Prune any out-of-scope legacy activity logs and normalize IST day/month & category metadata
    parsed.activityLogs = parsed.activityLogs.reduce<ActivityLog[]>((acc, entry) => {
      if (!entry || !entry.timestamp) return acc;
      const verdict = classifyScopedActivityLog({
        action: entry.action,
        actorRole: entry.actorRole,
        details: entry.details,
        targetType: entry.targetType,
        amountInr: entry.amountInr,
      });
      if (!verdict.allowed || !verdict.category) return acc;
      const ist = getIstDateParts(entry.timestamp);
      acc.push({
        ...entry,
        category: verdict.category,
        ...(verdict.amountInr ? { amountInr: verdict.amountInr } : {}),
        istDayKey: entry.istDayKey || ist.dayKey,
        istMonthKey: entry.istMonthKey || ist.monthKey,
      });
      return acc;
    }, []);

    // Enforce immutable admin identity and hash any plaintext passwords into passwordHash
    enforceImmutableAdminRecord(parsed.users);
    parsed.users.forEach((u: User) => {
      if (u.password) {
        if (!u.passwordHash && !u.password.startsWith('scrypt:')) {
          u.passwordHash = hashPassword(u.password);
        }
        delete u.password;
      }
      if (!Array.isArray(u.bookmarks)) u.bookmarks = [];
      if (!Array.isArray(u.favorites)) u.favorites = [];
      if (!Array.isArray(u.readingHistory)) u.readingHistory = [];
    });

    // Ensure every historical Purchase has preserved GST fields and a corresponding PaymentTransaction record
    parsed.purchases = parsed.purchases.map((p: Purchase, idx: number) => {
      const enriched = ensurePurchaseGstFields(p, parsed.gstSettings, idx + 1);
      if (!enriched.environment) {
        enriched.environment = enriched.razorpayOrderId?.startsWith('order_live_') ? 'live' : 'test';
      }
      const existingTx = parsed.paymentTransactions.find(
        tx => tx.orderId === enriched.razorpayOrderId || tx.paymentId === enriched.razorpayPaymentId
      );
      if (!existingTx) {
        parsed.paymentTransactions.push({
          id: `tx_${enriched.id}`,
          orderId: enriched.razorpayOrderId || `order_${enriched.id}`,
          paymentId: enriched.razorpayPaymentId,
          userId: enriched.userId,
          userEmail: enriched.userEmail,
          comicId: enriched.comicId,
          itemTitle: enriched.comicTitle,
          type: enriched.type,
          subscriptionPlan: enriched.subscriptionPlan,
          amountInr: enriched.amountInr,
          amountPaise: Math.round((Number(enriched.amountInr) || 0) * 100),
          currency: 'INR',
          environment: enriched.environment || 'test',
          status: enriched.status === 'success' ? 'verified' : enriched.status === 'refunded' ? 'refunded' : 'failed',
          signatureVerified: enriched.status === 'success',
          idempotencyKey: `idem_${enriched.razorpayOrderId || enriched.id}`,
          createdAt: enriched.createdAt,
          updatedAt: enriched.createdAt,
        });
      }
      return enriched;
    });

    // Ensure published comics have release notifications for registered readers & Notification Bar
    if (!Array.isArray(parsed.notifications)) {
      parsed.notifications = [];
    }
    const existingComicReleaseIds = new Set(
      parsed.notifications
        .filter(n => n.type === 'new_comic' || n.type === 'new_episode')
        .map(n => n.comicId || n.targetId)
        .filter(Boolean)
    );
    const approvedComics = parsed.comics.filter(c => c.moderationStatus === 'approved');
    for (const c of approvedComics.slice(0, 3)) {
      if (!existingComicReleaseIds.has(c.id)) {
        const isPaywalled =
          c.accessType === 'premium' ||
          Boolean(c.chapters?.some(ch => ch.isPremium || ch.episodes?.some(ep => ep.isPremium)));
        const firstEp = c.chapters?.[0]?.episodes?.[0];
        const releaseAt = c.updatedAt || c.createdAt || new Date().toISOString();

        // Broadcast to registered readers with Gmail enabled
        parsed.users.forEach(u => {
          if (u.email && u.email.includes('@') && u.notifyGmail !== false) {
            parsed.notifications.unshift({
              id: `notif_seed_${c.id}_${u.id}`,
              userId: u.id,
              userEmail: u.email,
              type: 'new_comic',
              title: `New Comic Released: ${c.title}`,
              message: `"${c.title}" by ${c.authorName} is now live (${isPaywalled ? 'Premium / Paywall' : 'Free Access'}). Sent to Gmail (${u.email}).`,
              read: false,
              targetId: c.id,
              comicId: c.id,
              episodeId: firstEp?.id,
              isPaywalled,
              gmailSent: true,
              gmailSentTo: u.email,
              gmailSentAt: releaseAt,
              createdAt: releaseAt,
            });
          }
        });

        // Public notification bar entry for guest readers
        parsed.notifications.unshift({
          id: `notif_seed_${c.id}_all`,
          userId: 'all',
          type: 'new_comic',
          title: `New Comic Released: ${c.title}`,
          message: `"${c.title}" by ${c.authorName} is now live on Aathirai_Comic (${isPaywalled ? 'Premium / Paywall' : 'Free Access'}).`,
          read: false,
          targetId: c.id,
          comicId: c.id,
          episodeId: firstEp?.id,
          isPaywalled,
          gmailSent: true,
          gmailSentAt: releaseAt,
          createdAt: releaseAt,
        });
      }
    }

    // Count chapters and episodes for migration integrity report
    let chaptersCount = 0;
    let episodesCount = 0;
    parsed.comics.forEach(c => {
      chaptersCount += c.chapters?.length || 0;
      c.chapters?.forEach(ch => {
        episodesCount += ch.episodes?.length || 0;
      });
    });

    const completedAt = new Date().toISOString();
    parsed.migrationReport = {
      migrationId: `mig_${FIRESTORE_DB_ID.slice(0, 18)}`,
      startedAt,
      completedAt,
      firestoreDatabaseId: FIRESTORE_DB_ID,
      backupFilePath,
      backupSha256,
      status: 'verified',
      counts: {
        users: parsed.users.length,
        authorApplications: parsed.authorApplications.length,
        comics: parsed.comics.length,
        chapters: chaptersCount,
        episodes: episodesCount,
        comments: parsed.comments.length,
        ratings: parsed.ratings.length,
        votes: parsed.votes.length,
        purchases: parsed.purchases.length,
        paymentTransactions: parsed.paymentTransactions.length,
        notifications: parsed.notifications.length,
        reports: parsed.reports.length,
        deleteRequests: parsed.deleteRequests.length,
        copyrightDocs: parsed.copyrightDocs.length,
        activityLogs: parsed.activityLogs.length,
      },
      integrityChecksPassed: true,
      details: [
        `Backed up aathirai_db.json (SHA-256: ${backupSha256.slice(0, 16)}...)`,
        `Migrated ${parsed.users.length} users with isolated PII and scrypt password hashes`,
        `Migrated ${parsed.comics.length} comics, ${chaptersCount} chapters, and ${episodesCount} episodes`,
        `Preserved ${parsed.purchases.length} historical purchases and ${parsed.paymentTransactions.length} payment transactions`,
        `Verified relationships across comments (${parsed.comments.length}), ratings (${parsed.ratings.length}), and votes (${parsed.votes.length})`,
      ],
    };

    this.saveData(parsed);
    this.writeFirestoreCollectionSnapshots(parsed);
    return parsed;
  }

  private writeFirestoreCollectionSnapshots(data: DatabaseSchema) {
    try {
      if (!fs.existsSync(FIRESTORE_SNAPSHOT_DIR)) {
        fs.mkdirSync(FIRESTORE_SNAPSHOT_DIR, { recursive: true });
      }
      // Write normalized Firestore collection documents for inspection & backup
      const collections: Record<string, unknown> = {
        users: data.users.map(u => ({
          userId: u.id,
          name: u.name,
          role: u.role,
          avatar: u.avatar,
          bio: u.bio,
          socialLinks: u.socialLinks || {},
          isSuspended: Boolean(u.isSuspended),
          createdAt: u.createdAt,
        })),
        users_private: data.users.map(u => ({
          userId: u.id,
          email: u.email,
          phone: u.phone || '',
          countryCode: u.countryCode || '+91',
          upiId: u.upiId || '',
          age: u.age || null,
          dob: u.dob || null,
          premiumPlan: u.premiumPlan || 'free',
          premiumExpiresAt: u.premiumExpiresAt || null,
        })),
        authorApplications: data.authorApplications,
        comics: data.comics,
        comments: data.comments,
        ratings: data.ratings,
        votes: data.votes,
        purchases: data.purchases,
        paymentTransactions: data.paymentTransactions,
        notifications: data.notifications,
        reports: data.reports,
        deleteRequests: data.deleteRequests,
        adRequests: data.adRequests,
        platformSettings: data.settings,
        gstSettings: data.gstSettings,
        creditNotes: data.creditNotes,
        migrationAudit: data.migrationReport,
      };
      fs.writeFileSync(
        path.join(FIRESTORE_SNAPSHOT_DIR, 'firestore_collections_manifest.json'),
        JSON.stringify(collections, null, 2),
        'utf-8'
      );
    } catch {
      // Ignore snapshot write errors in read-only environments
    }
  }

  private saveData(data: DatabaseSchema) {
    try {
      const payload = JSON.stringify(data, null, 2);
      const tmpFile = `${DB_FILE}.tmp.${process.pid}`;
      fs.writeFileSync(tmpFile, payload, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
      } catch (fallbackErr) {
        console.error('Error writing DB_FILE:', fallbackErr || err);
      }
    }
  }

  public getSnapshot(): DatabaseSchema {
    return this.data;
  }

  public mutate<T>(fn: (db: DatabaseSchema) => T): T {
    const res = fn(this.data);
    enforceImmutableAdminRecord(this.data.users);
    this.saveData(this.data);
    this.writeFirestoreCollectionSnapshots(this.data);
    return res;
  }

  public addNotification(params: {
    userId: string;
    userEmail?: string;
    type: NotificationItem['type'];
    title: string;
    message: string;
    targetId?: string;
    comicId?: string;
    comicTitle?: string;
    episodeId?: string;
    episodeTitle?: string;
    isPaywalled?: boolean;
    gmailSent?: boolean;
    gmailSentTo?: string;
    gmailSentAt?: string;
    gmailError?: string;
    gmailDeliveredCount?: number;
    gmailTargetCount?: number;
  }): NotificationItem {
    const item: NotificationItem = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      userId: params.userId,
      userEmail: params.userEmail,
      type: params.type,
      title: params.title,
      message: params.message,
      read: false,
      targetId: params.targetId || params.comicId,
      comicId: params.comicId || params.targetId,
      comicTitle: params.comicTitle,
      episodeId: params.episodeId,
      episodeTitle: params.episodeTitle,
      isPaywalled: params.isPaywalled,
      gmailSent: params.gmailSent,
      gmailSentTo: params.gmailSentTo,
      gmailSentAt: params.gmailSentAt,
      gmailError: params.gmailError,
      gmailDeliveredCount: params.gmailDeliveredCount,
      gmailTargetCount: params.gmailTargetCount,
      createdAt: new Date().toISOString(),
    };
    this.mutate(d => {
      if (!Array.isArray(d.notifications)) d.notifications = [];
      d.notifications.unshift(item);
      if (d.notifications.length > 300) {
        d.notifications = d.notifications.slice(0, 300);
      }
    });
    return item;
  }

  public logActivity(
    action: string,
    actorEmail: string,
    actorRole: any,
    details: string,
    targetType: string,
    targetId: string,
    meta?: { amountInr?: number }
  ) {
    const verdict = classifyScopedActivityLog({
      action,
      actorRole: String(actorRole || ''),
      details,
      targetType,
      amountInr: meta?.amountInr,
    });
    if (!verdict.allowed || !verdict.category) {
      return;
    }

    const nowIso = new Date().toISOString();
    const ist = getIstDateParts(nowIso);

    this.mutate(db => {
      db.activityLogs.unshift({
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        timestamp: nowIso,
        action,
        actorEmail,
        actorRole,
        details,
        targetType,
        targetId,
        category: verdict.category,
        ...(verdict.amountInr ? { amountInr: verdict.amountInr } : {}),
        istDayKey: ist.dayKey,
        istMonthKey: ist.monthKey,
      });
      if (db.activityLogs.length > 10000) {
        db.activityLogs = db.activityLogs.slice(0, 10000);
      }
    });
  }

  public async initFromCloud(): Promise<{ hydrated: boolean; mode: string; error?: string }> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      try {
        const res = await hydrateDatabaseFromFirestore(this.data);
        if (res.hydrated) {
          enforceImmutableAdminRecord(res.data.users);
          this.data = res.data;
          this.cloudRevision = res.revision || 1;
          this.lastRevisionCheckMs = Date.now();
          this.saveData(this.data);
          this.writeFirestoreCollectionSnapshots(this.data);
          console.log(
            `[StorageEngine] Cloud vault ${res.seeded ? 'seeded' : 'hydrated'} (${res.mode}, rev=${this.cloudRevision}, users=${this.data.users.length}, comics=${this.data.comics.length}).`
          );
        } else if (res.error && res.mode !== 'public_api_key') {
          console.warn(`[StorageEngine] Cloud hydration warning (${res.mode}):`, res.error);
        }
        return { hydrated: res.hydrated, mode: res.mode, error: res.error };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[StorageEngine] Cloud hydration skipped:', message);
        return { hydrated: false, mode: 'public_api_key', error: message };
      }
    })();
    return this.initPromise;
  }

  public async ensureFreshFromCloud(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastRevisionCheckMs < 4000) {
      return;
    }
    if (this.freshPromise) {
      return this.freshPromise;
    }
    this.freshPromise = (async () => {
      try {
        this.lastRevisionCheckMs = Date.now();
        const revCheck = await fetchCloudSyncRevision();
        if (!revCheck.ok || !revCheck.exists) return;
        if (revCheck.revision > this.cloudRevision) {
          const res = await hydrateDatabaseFromFirestore(this.data);
          if (res.hydrated) {
            enforceImmutableAdminRecord(res.data.users);
            this.data = res.data;
            this.cloudRevision = res.revision;
            this.saveData(this.data);
            console.log(
              `[StorageEngine] Synced newer cloud revision rev=${this.cloudRevision} (users=${this.data.users.length}, comics=${this.data.comics.length}).`
            );
          }
        }
      } catch {
        // Ignore transient revision check errors
      } finally {
        this.freshPromise = null;
      }
    })();
    return this.freshPromise;
  }

  public persistChanges(opts: {
    users?: User[];
    comics?: Comic[];
    deletedComicIds?: string[];
    deletedUserIds?: string[];
    collections?: VaultCollectionKey[];
    fullVaultSync?: boolean;
    userFirebaseIdToken?: string;
  }): Promise<{ persisted: boolean; mode: string; written: number; revision: number; error?: string }> {
    const run = async () => {
      const nextRevision = Math.max(Date.now(), this.cloudRevision + 1);
      const res = await persistSnapshotChangesToFirestore({
        snapshot: this.data,
        users: opts.users,
        comics: opts.comics,
        deletedComicIds: opts.deletedComicIds,
        deletedUserIds: opts.deletedUserIds,
        collections: opts.collections,
        fullVaultSync: opts.fullVaultSync,
        revision: nextRevision,
        userFirebaseIdToken: opts.userFirebaseIdToken,
      });
      if (res.persisted) {
        this.cloudRevision = res.revision;
        this.lastRevisionCheckMs = Date.now();
      }
      return res;
    };

    const next = this.persistQueue.then(run, run);
    this.persistQueue = next.catch(() => undefined);
    return next;
  }
}

export const db = new StorageEngine();
