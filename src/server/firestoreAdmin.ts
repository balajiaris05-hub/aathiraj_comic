import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  User,
  Comic,
  Episode,
  Comment,
  Rating,
  Vote,
  Purchase,
  NotificationItem,
  AuthorApplication,
  DeleteRequest,
  ContentReport,
  GstBusinessSettings,
  PlatformSettings,
  AdPlacementRequest,
} from '../types/comic';
import type { DatabaseSchema } from './storage';

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(cfgPath, 'utf-8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

export const FIREBASE_APPLET_CONFIG = loadFirebaseConfig();
export const FIRESTORE_BASE_DOC_PATH = `projects/${FIREBASE_APPLET_CONFIG.projectId}/databases/${FIREBASE_APPLET_CONFIG.firestoreDatabaseId}/documents`;
export const FIRESTORE_REST_BASE_URL = `https://firestore.googleapis.com/v1/${FIRESTORE_BASE_DOC_PATH}`;

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'doc_default';
}

// =============================================================================
// FIRESTORE VALUE CODEC (JS <-> Firestore REST API Value JSON)
// =============================================================================

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export const SERVER_TIMESTAMP_SENTINEL = Symbol('SERVER_TIMESTAMP');

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { doubleValue: 0 };
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => toFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined && v !== SERVER_TIMESTAMP_SENTINEL) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((v) => fromFirestoreValue(v));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function fromFirestoreDocument(doc: any): Record<string, unknown> | null {
  if (!doc || !doc.fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields as Record<string, FirestoreValue>)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

// =============================================================================
// AUTHENTICATION / CREDENTIAL MANAGER (Service Account JWT + Native ADC + ID Token)
// =============================================================================

let cachedServiceToken: { token: string; expiresAtMs: number } | null = null;
let cachedAdcInfo: { checked: boolean; sameProject: boolean } = { checked: false, sameProject: false };
let cachedAdcToken: { token: string; expiresAtMs: number } | null = null;

function parseServiceAccountFromEnv(): ServiceAccountCredentials | null {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const jsonPath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  try {
    if (rawJson) {
      const parsed = JSON.parse(rawJson) as ServiceAccountCredentials;
      if (parsed.client_email && parsed.private_key) return parsed;
    }
    if (jsonPath && fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as ServiceAccountCredentials;
      if (parsed.client_email && parsed.private_key) return parsed;
    }
  } catch (err) {
    console.warn('[FirestoreAdmin] Failed to parse service account credentials:', err instanceof Error ? err.message : err);
  }
  return null;
}

async function getServiceAccountAccessToken(): Promise<string | null> {
  const sa = parseServiceAccountFromEnv();
  if (!sa) return null;

  const nowMs = Date.now();
  if (cachedServiceToken && cachedServiceToken.expiresAtMs - 60_000 > nowMs) {
    return cachedServiceToken.token;
  }

  const nowSec = Math.floor(nowMs / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  ).toString('base64url');

  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key.replace(/\\n/g, '\n')).toString('base64url');
  const assertion = `${signingInput}.${signature}`;

  const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    console.warn('[FirestoreAdmin] OAuth2 token exchange failed:', tokenRes.status, errText.slice(0, 200));
    return null;
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (tokenJson.access_token) {
    cachedServiceToken = {
      token: tokenJson.access_token,
      expiresAtMs: nowMs + (tokenJson.expires_in || 3500) * 1000,
    };
    return tokenJson.access_token;
  }
  return null;
}

async function getNativeProjectAdcToken(): Promise<string | null> {
  const nowMs = Date.now();
  if (cachedAdcToken && cachedAdcToken.expiresAtMs - 60_000 > nowMs) {
    return cachedAdcToken.token;
  }

  if (!cachedAdcInfo.checked) {
    cachedAdcInfo.checked = true;
    try {
      const projRes = await fetch('http://metadata.google.internal/computeMetadata/v1/project/project-id', {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1200),
      });
      if (projRes.ok) {
        const projId = (await projRes.text()).trim();
        cachedAdcInfo.sameProject = projId === FIREBASE_APPLET_CONFIG.projectId;
      }
    } catch {
      cachedAdcInfo.sameProject = false;
    }
  }

  if (!cachedAdcInfo.sameProject) {
    return null;
  }

  try {
    const tokRes = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(1500),
    });
    if (tokRes.ok) {
      const data = (await tokRes.json()) as { access_token?: string; expires_in?: number };
      if (data.access_token) {
        cachedAdcToken = {
          token: data.access_token,
          expiresAtMs: nowMs + (data.expires_in || 3000) * 1000,
        };
        return data.access_token;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function extractFirebaseIdToken(rawAuthHeader?: string): string | undefined {
  if (!rawAuthHeader || !rawAuthHeader.startsWith('Bearer ')) return undefined;
  const token = rawAuthHeader.slice(7).trim();
  const segments = token.split('.');
  if (segments.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf-8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      payload &&
      payload.aud === FIREBASE_APPLET_CONFIG.projectId &&
      payload.iss === `https://securetoken.google.com/${FIREBASE_APPLET_CONFIG.projectId}` &&
      payload.exp > nowSec
    ) {
      return token;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type CredentialMode = 'service_account' | 'native_adc' | 'firebase_id_token' | 'public_api_key';

async function resolveAuthContext(userFirebaseIdToken?: string): Promise<{
  bearerToken?: string;
  mode: CredentialMode;
}> {
  const saToken = await getServiceAccountAccessToken();
  if (saToken) return { bearerToken: saToken, mode: 'service_account' };

  const adcToken = await getNativeProjectAdcToken();
  if (adcToken) return { bearerToken: adcToken, mode: 'native_adc' };

  if (userFirebaseIdToken) {
    return { bearerToken: userFirebaseIdToken, mode: 'firebase_id_token' };
  }

  return { mode: 'public_api_key' };
}

// =============================================================================
// CORE FIRESTORE REST OPERATIONS (COMMIT WITH SERVER_TIME TRANSFORMS + QUERY)
// =============================================================================

export interface CommitWriteItem {
  docPath: string; // relative to documents/, e.g., "users/usr_admin"
  fields: Record<string, unknown>;
  preserveCreatedAt?: boolean;
  serverTimeFields?: string[]; // default ['updatedAt'] or ['createdAt', 'updatedAt']
}

async function fetchFirestoreDocument(docPath: string, bearerToken?: string): Promise<Record<string, unknown> | null> {
  const url = `${FIRESTORE_REST_BASE_URL}/${docPath}?key=${encodeURIComponent(FIREBASE_APPLET_CONFIG.apiKey)}`;
  const headers: Record<string, string> = {};
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const json = await res.json();
  return fromFirestoreDocument(json);
}

export async function commitFirestoreWrites(
  items: CommitWriteItem[],
  userFirebaseIdToken?: string
): Promise<{ success: boolean; mode: CredentialMode; written: number; error?: string }> {
  if (items.length === 0) {
    return { success: true, mode: 'public_api_key', written: 0 };
  }

  const { bearerToken, mode } = await resolveAuthContext(userFirebaseIdToken);
  if (!bearerToken) {
    return {
      success: false,
      mode,
      written: 0,
      error: 'No Service Account, project ADC, or Firebase Auth ID token available for Firestore write.',
    };
  }

  const MAX_WRITES_PER_COMMIT = 80;
  const MAX_BYTES_PER_COMMIT = 3_200_000;

  let totalWritten = 0;
  let index = 0;
  while (index < items.length) {
    const chunk: CommitWriteItem[] = [];
    let estimatedBytes = 0;

    while (index < items.length && chunk.length < MAX_WRITES_PER_COMMIT) {
      const candidate = items[index];
      const approxLen = JSON.stringify(candidate.fields).length + 256;
      if (chunk.length > 0 && estimatedBytes + approxLen > MAX_BYTES_PER_COMMIT) {
        break;
      }
      chunk.push(candidate);
      estimatedBytes += approxLen;
      index += 1;
    }

    const writes = await Promise.all(
      chunk.map(async (item) => {
        const existingDoc = item.preserveCreatedAt ? await fetchFirestoreDocument(item.docPath, bearerToken) : null;
        const fieldsPayload: Record<string, FirestoreValue> = {};
        const transformFields: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = [];

        for (const [k, v] of Object.entries(item.fields)) {
          if (k === 'createdAt' && existingDoc && existingDoc.createdAt) {
            fieldsPayload.createdAt = { timestampValue: String(existingDoc.createdAt) };
          } else if (k === 'createdAt' || k === 'updatedAt' || item.serverTimeFields?.includes(k)) {
            transformFields.push({ fieldPath: k, setToServerValue: 'REQUEST_TIME' });
          } else {
            fieldsPayload[k] = toFirestoreValue(v);
          }
        }

        const writeObj: Record<string, unknown> = {
          update: {
            name: `${FIRESTORE_BASE_DOC_PATH}/${item.docPath}`,
            fields: fieldsPayload,
          },
        };
        if (transformFields.length > 0) {
          writeObj.updateTransforms = transformFields;
        }
        return writeObj;
      })
    );

    const commitRes = await fetch(
      `${FIRESTORE_REST_BASE_URL}:commit?key=${encodeURIComponent(FIREBASE_APPLET_CONFIG.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ writes }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!commitRes.ok) {
      const errBody = await commitRes.text().catch(() => '');
      return {
        success: false,
        mode,
        written: totalWritten,
        error: `Firestore commit HTTP ${commitRes.status}: ${errBody.slice(0, 300)}`,
      };
    }

    totalWritten += chunk.length;
  }

  return { success: true, mode, written: totalWritten };
}

export async function listFirestoreCollection(
  collectionId: string,
  userFirebaseIdToken?: string
): Promise<{
  ok: boolean;
  status: number;
  mode: CredentialMode;
  docs: Array<{ id: string; fields: Record<string, unknown> }>;
  error?: string;
}> {
  const { bearerToken, mode } = await resolveAuthContext(userFirebaseIdToken);
  if (!bearerToken) {
    return {
      ok: false,
      status: 401,
      mode,
      docs: [],
      error: 'No server credentials available for listing collection.',
    };
  }

  const docs: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let pageToken = '';

  try {
    do {
      const params = new URLSearchParams({
        pageSize: '200',
        key: FIREBASE_APPLET_CONFIG.apiKey,
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`${FIRESTORE_REST_BASE_URL}/${collectionId}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          return { ok: true, status: 200, mode, docs };
        }
        const errBody = await res.text().catch(() => '');
        return {
          ok: false,
          status: res.status,
          mode,
          docs,
          error: `Firestore list ${collectionId} HTTP ${res.status}: ${errBody.slice(0, 250)}`,
        };
      }

      const json = (await res.json()) as {
        documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>;
        nextPageToken?: string;
      };

      for (const rawDoc of json.documents || []) {
        const parsed = fromFirestoreDocument(rawDoc);
        const docName = String(rawDoc.name || '');
        const docId = docName.split('/').pop() || '';
        if (parsed && docId) {
          docs.push({ id: docId, fields: parsed });
        }
      }

      pageToken = json.nextPageToken || '';
    } while (pageToken);

    return { ok: true, status: 200, mode, docs };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      mode,
      docs,
      error: err instanceof Error ? err.message : 'List collection failed',
    };
  }
}

export async function runFirestoreQuery(
  structuredQuery: Record<string, unknown>,
  userFirebaseIdToken?: string
): Promise<{ ok: boolean; status: number; docs: Record<string, unknown>[]; error?: string }> {
  const { bearerToken } = await resolveAuthContext(userFirebaseIdToken);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  try {
    const res = await fetch(
      `${FIRESTORE_REST_BASE_URL}:runQuery?key=${encodeURIComponent(FIREBASE_APPLET_CONFIG.apiKey)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ structuredQuery }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, docs: [], error: errText.slice(0, 250) };
    }
    const rows = (await res.json()) as Array<{ document?: any }>;
    const docs: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (row.document) {
        const parsed = fromFirestoreDocument(row.document);
        if (parsed) docs.push(parsed);
      }
    }
    return { ok: true, status: 200, docs };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      docs: [],
      error: err instanceof Error ? err.message : 'Query failed',
    };
  }
}

export async function deleteFirestoreDoc(
  docPath: string,
  userFirebaseIdToken?: string
): Promise<boolean> {
  const { bearerToken } = await resolveAuthContext(userFirebaseIdToken);
  if (!bearerToken) return false;
  try {
    const res = await fetch(
      `${FIRESTORE_REST_BASE_URL}/${docPath}?key=${encodeURIComponent(FIREBASE_APPLET_CONFIG.apiKey)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(6000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// SCHEMA-STRICT DOCUMENT BUILDERS (ALIGNED WITH firebase-blueprint.json & RULES)
// =============================================================================

export function buildUserWriteItems(u: User): CommitWriteItem[] {
  const userId = sanitizeFirestoreId(u.firebaseUid || u.id);
  const safeName = (u.name || 'Reader').trim().slice(0, 80) || 'Reader';
  const safeRole: 'reader' | 'author' | 'admin' =
    u.role === 'admin' ? 'admin' : u.role === 'author' ? 'author' : 'reader';
  const safeEmail = (u.email || 'reader@gmail.com').trim().slice(0, 120);
  const safePhone = (u.phone && u.phone.trim().length >= 3 ? u.phone.trim() : safeRole === 'admin' ? '+91 8610950780' : 'Not provided').slice(0, 32);
  const safeUpiId = (u.upiId && u.upiId.trim().length >= 3 ? u.upiId.trim() : safeRole === 'admin' ? 'balajiaris05@okaxis' : 'Not provided').slice(0, 100);
  const safeAge = Math.min(110, Math.max(5, Number(u.age) || 24));
  const safePlan: 'free' | '1_month' | '6_months' =
    u.premiumPlan === '6_months' ? '6_months' : u.premiumPlan === '1_month' ? '1_month' : 'free';
  const safePaymentMethod = (
    u.premiumPaymentDetail?.paymentMethod || 'UPI (Google Pay / PhonePe)'
  )
    .trim()
    .slice(0, 80);
  const safeTransactionId = (
    u.premiumPaymentDetail?.transactionId ||
    u.premiumPaymentDetail?.receiptNumber ||
    `REG-${userId.slice(0, 12)}`
  )
    .trim()
    .slice(0, 80);
  const amountPaidInr = safePlan === '6_months' ? 249 : safePlan === '1_month' ? 49 : 0;

  return [
    {
      docPath: `users/${userId}`,
      preserveCreatedAt: true,
      serverTimeFields: ['createdAt', 'updatedAt'],
      fields: {
        userId,
        name: safeName,
        role: safeRole,
        createdAt: SERVER_TIMESTAMP_SENTINEL,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      },
    },
    {
      docPath: `users/${userId}/private/info`,
      preserveCreatedAt: true,
      serverTimeFields: ['createdAt', 'updatedAt'],
      fields: {
        userId,
        email: safeEmail,
        phone: safePhone,
        upiId: safeUpiId,
        age: safeAge,
        premiumPlan: safePlan,
        paymentMethod: safePaymentMethod,
        transactionId: safeTransactionId,
        amountPaidInr,
        createdAt: SERVER_TIMESTAMP_SENTINEL,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      },
    },
  ];
}

export function buildComicAndEpisodeWriteItems(comic: Comic, fallbackAuthorId?: string): CommitWriteItem[] {
  const comicId = sanitizeFirestoreId(comic.id);
  const authorId = sanitizeFirestoreId(comic.authorId || fallbackAuthorId || 'usr_admin');
  const genreStr = (Array.isArray(comic.genre) ? comic.genre.join(', ') : String(comic.genre || 'Action'))
    .trim()
    .slice(0, 50) || 'Action';
  const status: 'pending' | 'published' | 'rejected' =
    comic.moderationStatus === 'pending'
      ? 'pending'
      : comic.moderationStatus === 'rejected'
        ? 'rejected'
        : 'published';

  const items: CommitWriteItem[] = [
    {
      docPath: `comics/${comicId}`,
      preserveCreatedAt: true,
      serverTimeFields: ['createdAt', 'updatedAt'],
      fields: {
        comicId,
        title: (comic.title || 'Untitled Comic').trim().slice(0, 140) || 'Untitled Comic',
        authorId,
        authorName: (comic.authorName || 'Creator').trim().slice(0, 80) || 'Creator',
        genre: genreStr,
        accessType: comic.accessType === 'premium' ? 'premium' : 'free',
        fullUnlockPriceInr: Math.min(10000, Math.max(0, Number(comic.fullPriceInr) || 0)),
        status,
        createdAt: SERVER_TIMESTAMP_SENTINEL,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      },
    },
  ];

  for (const ch of comic.chapters || []) {
    const chapterId = sanitizeFirestoreId(ch.id);
    const chapterNumber = Math.min(5000, Math.max(1, Number(ch.chapterNumber) || 1));
    const chapterTitle = (ch.title || `Chapter ${chapterNumber}`).trim().slice(0, 140);
    for (const ep of ch.episodes || []) {
      items.push(
        buildEpisodeWriteItem({
          episode: ep,
          comicId,
          chapterId,
          chapterNumber,
          chapterTitle,
          authorId,
          comicStatus: status,
        })
      );
    }
  }

  return items;
}

export function buildEpisodeWriteItem(params: {
  episode: Episode;
  comicId: string;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  authorId: string;
  comicStatus?: 'pending' | 'published' | 'rejected';
}): CommitWriteItem {
  const episodeId = sanitizeFirestoreId(params.episode.id);
  const comicId = sanitizeFirestoreId(params.comicId);
  const chapterId = sanitizeFirestoreId(params.chapterId);
  const authorId = sanitizeFirestoreId(params.authorId);
  const epStatus: 'pending' | 'published' | 'rejected' =
    params.episode.isPublished === false
      ? 'pending'
      : params.comicStatus === 'rejected'
        ? 'rejected'
        : params.comicStatus === 'pending'
          ? 'pending'
          : 'published';

  return {
    docPath: `comics/${comicId}/episodes/${episodeId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      episodeId,
      comicId,
      chapterId,
      chapterNumber: Math.min(5000, Math.max(1, Number(params.chapterNumber) || 1)),
      chapterTitle: (params.chapterTitle || 'Chapter 1').trim().slice(0, 140),
      episodeNumber: Math.min(10000, Math.max(1, Number(params.episode.episodeNumber) || 1)),
      title: (params.episode.title || 'Episode').trim().slice(0, 140),
      authorId,
      isPremium: Boolean(params.episode.isPremium),
      priceInr: Math.min(10000, Math.max(0, Number(params.episode.priceInr) || 0)),
      pagesCount: Math.min(500, Math.max(0, params.episode.pages?.length || 0)),
      status: epStatus,
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildPurchaseWriteItem(p: Purchase): CommitWriteItem {
  const purchaseId = sanitizeFirestoreId(p.id);
  const userId = sanitizeFirestoreId(p.userId || p.userEmail || 'guest_buyer');
  const comicId = sanitizeFirestoreId(p.comicId || 'premium_pass');
  const planType =
    p.subscriptionPlan === '6_months'
      ? '6_months'
      : p.subscriptionPlan === '1_month'
        ? '1_month'
        : p.type === 'chapter'
          ? 'chapter'
          : p.type === 'full_comic'
            ? 'full_comic'
            : p.type === 'episode'
              ? 'episode'
              : Number(p.amountInr) >= 249
                ? '6_months'
                : '1_month';

  return {
    docPath: `purchases/${purchaseId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      purchaseId,
      userId,
      comicId,
      itemTitle: (p.comicTitle || 'Premium Pass').trim().slice(0, 140) || 'Premium Pass',
      planType,
      amountInr: Math.min(50000, Math.max(1, Number(p.amountInr) || 49)),
      upiId: (p.userUpiId || 'Not provided').trim().slice(0, 100),
      paymentMethod: (p.paymentMethod || 'UPI / Razorpay').trim().slice(0, 80),
      receiptNumber: (p.receiptNumber || `INV-${purchaseId.slice(0, 12)}`).trim().slice(0, 64),
      status: p.status === 'refunded' ? 'refunded' : 'success',
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildCommentWriteItem(c: Comment, comicId: string): CommitWriteItem {
  const commentId = sanitizeFirestoreId(c.id);
  return {
    docPath: `comments/${commentId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      commentId,
      comicId: sanitizeFirestoreId(comicId),
      episodeId: sanitizeFirestoreId(c.episodeId),
      userId: sanitizeFirestoreId(c.userId),
      userName: (c.userName || 'Reader').trim().slice(0, 80) || 'Reader',
      content: (c.content || 'Great episode!').trim().slice(0, 1000) || 'Great episode!',
      likesCount: Math.min(1_000_000, Math.max(0, Number(c.likesCount) || 0)),
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildRatingWriteItem(r: Rating, comicId: string): CommitWriteItem {
  const ratingId = sanitizeFirestoreId(r.id);
  return {
    docPath: `ratings/${ratingId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      ratingId,
      comicId: sanitizeFirestoreId(comicId),
      episodeId: sanitizeFirestoreId(r.episodeId),
      userId: sanitizeFirestoreId(r.userId),
      stars: Math.min(5, Math.max(1, Math.round(Number(r.stars) || 5))),
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildVoteWriteItem(v: Vote, comicId: string): CommitWriteItem {
  const voteId = sanitizeFirestoreId(v.id);
  return {
    docPath: `votes/${voteId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      voteId,
      comicId: sanitizeFirestoreId(comicId),
      episodeId: sanitizeFirestoreId(v.episodeId),
      userId: sanitizeFirestoreId(v.userId),
      voteType: v.type === 'dislike' ? 'dislike' : 'like',
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildNotificationWriteItem(n: NotificationItem): CommitWriteItem {
  const notificationId = sanitizeFirestoreId(n.id);
  const allowedTypes = new Set([
    'new_comic',
    'new_episode',
    'payment_success',
    'author_approved',
    'author_rejected',
    'comic_approved',
    'comic_rejected',
    'comment_reply',
    'system',
  ]);
  const safeType = allowedTypes.has(n.type) ? n.type : 'system';
  return {
    docPath: `notifications/${notificationId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      notificationId,
      userId: sanitizeFirestoreId(n.userId || 'all'),
      type: safeType,
      title: (n.title || 'Aathirai_Comic Update').trim().slice(0, 140),
      message: (n.message || 'New update on Aathirai_Comic').trim().slice(0, 400),
      targetId: String(n.targetId || n.comicId || 'platform').trim().slice(0, 128) || 'platform',
      isPaywalled: Boolean(n.isPaywalled),
      read: Boolean(n.read),
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildAuthorApplicationWriteItem(app: AuthorApplication): CommitWriteItem {
  const applicationId = sanitizeFirestoreId(app.id);
  return {
    docPath: `authorApplications/${applicationId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      applicationId,
      userId: sanitizeFirestoreId(app.userId),
      penName: (app.authorName || 'Creator').trim().slice(0, 80) || 'Creator',
      bio: (app.bio || 'Comic creator applying for studio access.').trim().slice(0, 600),
      status: app.status === 'approved' ? 'approved' : app.status === 'rejected' ? 'rejected' : 'pending',
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildDeleteRequestWriteItem(dr: DeleteRequest): CommitWriteItem {
  const requestId = sanitizeFirestoreId(dr.id);
  return {
    docPath: `deleteRequests/${requestId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      requestId,
      comicId: sanitizeFirestoreId(dr.comicId),
      comicTitle: (dr.comicTitle || 'Comic Series').trim().slice(0, 140),
      targetType: dr.targetType === 'chapter' ? 'chapter' : dr.targetType === 'episode' ? 'episode' : 'series',
      authorId: sanitizeFirestoreId(dr.authorId),
      authorName: (dr.authorName || 'Creator').trim().slice(0, 80),
      reason: (dr.reason || 'Requested deletion by creator').trim().slice(0, 300),
      status: dr.status === 'approved' ? 'approved' : dr.status === 'rejected' ? 'rejected' : 'pending',
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildReportWriteItem(rep: ContentReport): CommitWriteItem {
  const reportId = sanitizeFirestoreId(rep.id);
  return {
    docPath: `reports/${reportId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      reportId,
      reporterId: sanitizeFirestoreId(rep.reporterId || 'anonymous_reporter'),
      targetType: rep.targetType === 'comic' ? 'comic' : rep.targetType === 'episode' ? 'episode' : 'comment',
      targetId: sanitizeFirestoreId(rep.targetId),
      reason: (rep.reason || 'Content review').trim().slice(0, 300),
      status: rep.status === 'resolved' ? 'resolved' : rep.status === 'dismissed' ? 'dismissed' : 'pending',
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildGstSettingsWriteItem(gst: GstBusinessSettings): CommitWriteItem {
  const settingId = 'business_profile';
  const cleanGstin = (gst.gstin || '').trim().toUpperCase().slice(0, 15);
  const validGstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return {
    docPath: `gstSettings/${settingId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      settingId,
      legalBusinessName: (gst.legalBusinessName || 'Aathirai Media & Publishing Pvt Ltd').trim().slice(0, 140),
      tradeName: (gst.tradeName || 'Aathirai_Comic').trim().slice(0, 100),
      gstin: validGstinRegex.test(cleanGstin) ? cleanGstin : '',
      stateCode: (gst.stateCode || '33').trim().padStart(2, '0').slice(0, 2),
      stateName: (gst.stateName || 'Tamil Nadu').trim().slice(0, 80),
      registeredAddress: (gst.registeredAddress || 'Chennai, Tamil Nadu, India').trim().slice(0, 300),
      invoicePrefix: (gst.invoicePrefix || 'AAC/2627/').trim().slice(0, 12),
      defaultSacCode: (gst.defaultSacCode || '998431').trim().slice(0, 10),
      applicableGstRate: Math.min(28, Math.max(0, Number(gst.applicableGstRate) || 18)),
      updatedByEmail: (gst.updatedByEmail || 'balajiaris05@gmail.com').trim().slice(0, 120),
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildPlatformSettingsWriteItem(settings: PlatformSettings, updatedByEmail = 'balajiaris05@gmail.com'): CommitWriteItem {
  const settingId = 'global_config';
  return {
    docPath: `platformSettings/${settingId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      settingId,
      merchantUpiId: (settings.merchantUpiId || 'balajiaris05@okaxis').trim().slice(0, 100),
      merchantUpiName: (settings.merchantUpiName || 'Aathirai_Comic Official').trim().slice(0, 100),
      razorpay1MonthUrl: 'https://rzp.io/rzp/eMyTbngF',
      razorpay6MonthsUrl: 'https://rzp.io/rzp/E077NNn',
      updatedByEmail: updatedByEmail.trim().slice(0, 120),
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

export function buildAdRequestWriteItem(req: AdPlacementRequest): CommitWriteItem {
  const requestId = sanitizeFirestoreId(req.id);
  const status: 'pending' | 'contacted' | 'approved' | 'rejected' =
    req.status === 'contacted' || req.status === 'approved' || req.status === 'rejected' ? req.status : 'pending';
  const placementType: 'character_promotion' | 'sponsored_page' | 'episode_sponsor' =
    req.placementType === 'sponsored_page' || req.placementType === 'episode_sponsor'
      ? req.placementType
      : 'character_promotion';
  return {
    docPath: `adRequests/${requestId}`,
    preserveCreatedAt: true,
    serverTimeFields: ['createdAt', 'updatedAt'],
    fields: {
      requestId,
      companyName: (req.companyName || 'Sponsor Brand').trim().slice(0, 120) || 'Sponsor Brand',
      contactName: (req.contactName || 'Marketing Lead').trim().slice(0, 80) || 'Marketing Lead',
      contactEmail: (req.contactEmail || 'aathiraicomic@gmail.com').trim().slice(0, 120) || 'aathiraicomic@gmail.com',
      contactPhone: (req.contactPhone || '').trim().slice(0, 32),
      placementType,
      targetComicTitle: (req.targetComicTitle || 'Any Popular Comic Series').trim().slice(0, 140) || 'Any Popular Comic Series',
      budgetRange: (req.budgetRange || 'Custom Campaign').trim().slice(0, 64) || 'Custom Campaign',
      description: (req.description || 'In-comic character promotion request.').trim().slice(0, 1000) || 'In-comic character promotion request.',
      status,
      submittedByUserId: sanitizeFirestoreId(req.submittedByUserId || 'guest_sponsor'),
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    },
  };
}

// =============================================================================
// FULL SNAPSHOT SYNC & LIVE FIRESTORE DIAGNOSTICS
// =============================================================================

export async function syncDatabaseSnapshotToFirestore(
  snapshot: DatabaseSchema,
  userFirebaseIdToken?: string
) {
  const writes: CommitWriteItem[] = [];

  // 1. Users + Private PII Info (must come first for relational rules)
  for (const u of snapshot.users || []) {
    writes.push(...buildUserWriteItems(u));
  }

  // Ensure any referenced author/user IDs from comics/applications exist
  const knownUserIds = new Set(snapshot.users.map((u) => sanitizeFirestoreId(u.firebaseUid || u.id)));
  const comicEpisodeLookup = new Map<string, string>();

  // 2. Comics & Episodes
  for (const c of snapshot.comics || []) {
    const authorId = sanitizeFirestoreId(c.authorId || 'usr_admin');
    if (!knownUserIds.has(authorId)) {
      knownUserIds.add(authorId);
      writes.unshift({
        docPath: `users/${authorId}`,
        preserveCreatedAt: true,
        serverTimeFields: ['createdAt', 'updatedAt'],
        fields: {
          userId: authorId,
          name: (c.authorName || 'Creator').trim().slice(0, 80) || 'Creator',
          role: 'author',
          createdAt: SERVER_TIMESTAMP_SENTINEL,
          updatedAt: SERVER_TIMESTAMP_SENTINEL,
        },
      });
    }
    const comicId = sanitizeFirestoreId(c.id);
    for (const ch of c.chapters || []) {
      for (const ep of ch.episodes || []) {
        comicEpisodeLookup.set(ep.id, comicId);
      }
    }
    writes.push(...buildComicAndEpisodeWriteItems(c));
  }

  // 3. Author Applications
  for (const app of snapshot.authorApplications || []) {
    const uid = sanitizeFirestoreId(app.userId);
    if (!knownUserIds.has(uid)) {
      knownUserIds.add(uid);
      writes.unshift({
        docPath: `users/${uid}`,
        preserveCreatedAt: true,
        serverTimeFields: ['createdAt', 'updatedAt'],
        fields: {
          userId: uid,
          name: (app.authorName || 'Creator').trim().slice(0, 80) || 'Creator',
          role: app.status === 'approved' ? 'author' : 'reader',
          createdAt: SERVER_TIMESTAMP_SENTINEL,
          updatedAt: SERVER_TIMESTAMP_SENTINEL,
        },
      });
    }
    writes.push(buildAuthorApplicationWriteItem(app));
  }

  // 4. Comments, Ratings, Votes
  for (const comment of snapshot.comments || []) {
    const comicId = comicEpisodeLookup.get(comment.episodeId) || snapshot.comics[0]?.id || 'platform_comic';
    writes.push(buildCommentWriteItem(comment, comicId));
  }
  for (const rating of snapshot.ratings || []) {
    const comicId = comicEpisodeLookup.get(rating.episodeId) || snapshot.comics[0]?.id || 'platform_comic';
    writes.push(buildRatingWriteItem(rating, comicId));
  }
  for (const vote of snapshot.votes || []) {
    const comicId = comicEpisodeLookup.get(vote.episodeId) || snapshot.comics[0]?.id || 'platform_comic';
    writes.push(buildVoteWriteItem(vote, comicId));
  }

  // 5. Purchases
  for (const p of snapshot.purchases || []) {
    writes.push(buildPurchaseWriteItem(p));
  }

  // 6. Notifications (most recent 100)
  for (const n of (snapshot.notifications || []).slice(0, 100)) {
    writes.push(buildNotificationWriteItem(n));
  }

  // 7. Delete Requests & Reports
  for (const dr of snapshot.deleteRequests || []) {
    writes.push(buildDeleteRequestWriteItem(dr));
  }
  for (const rep of snapshot.reports || []) {
    writes.push(buildReportWriteItem(rep));
  }
  for (const adReq of snapshot.adRequests || []) {
    writes.push(buildAdRequestWriteItem(adReq));
  }

  // 8. GST Settings & Platform Settings
  if (snapshot.gstSettings) {
    writes.push(buildGstSettingsWriteItem(snapshot.gstSettings));
  }
  if (snapshot.settings) {
    writes.push(buildPlatformSettingsWriteItem(snapshot.settings));
  }

  // Purge any leftover known demo records in Firestore when performing full sync
  const demoDocPaths = [
    'users/usr_rajesh/private/info',
    'users/usr_rajesh',
    'users/usr_reader/private/info',
    'users/usr_reader',
    'users/usr_kavitha_pending/private/info',
    'users/usr_kavitha_pending',
    'users/usr_ananya',
    'users/usr_luna',
    'authorApplications/app_kavitha',
    'authorApplications/app_rajesh',
    'comics/comic_virasen',
    'comics/comic_neomadras',
    'comics/comic_mahishur',
    'comics/comic_monsoon',
    'comics/comic_shadows_thanjavur',
    'comics/comic_1794271496067',
    'comics/comic_1794272179041',
    'purchases/pur_demo1',
    'comments/c_1',
    'comments/c_2',
    'ratings/r_1',
    'ratings/r_2',
    'votes/v_1',
    'votes/v_2',
    'notifications/notif_welcome_1',
    'notifications/notif_author_1',
  ];
  await Promise.all(demoDocPaths.map((p) => deleteFirestoreDoc(p, userFirebaseIdToken).catch(() => false)));

  const result = await commitFirestoreWrites(writes, userFirebaseIdToken);

  // Also sync full durable vault (users with passwordHash, comics with covers/pages, collections)
  const vaultResult = await persistSnapshotChangesToFirestore({
    snapshot,
    fullVaultSync: true,
    userFirebaseIdToken,
  });

  return {
    ...result,
    success: result.success && vaultResult.persisted,
    vaultPersisted: vaultResult.persisted,
    vaultWritten: vaultResult.written,
    vaultError: vaultResult.error,
    attempted: writes.length + vaultResult.written,
    projectId: FIREBASE_APPLET_CONFIG.projectId,
    databaseId: FIREBASE_APPLET_CONFIG.firestoreDatabaseId,
  };
}

export async function getFirestoreLiveStatus(userFirebaseIdToken?: string) {
  const authCtx = await resolveAuthContext(userFirebaseIdToken);

  // Run public published comics query to verify Firestore REST endpoint connectivity & security rules
  const publishedProbe = await runFirestoreQuery(
    {
      from: [{ collectionId: 'comics' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'published' },
        },
      },
      limit: 50,
    },
    userFirebaseIdToken
  );

  // When authenticated (service account, native ADC, or verified Admin Firebase token), gather collection counts
  const collectionNames = [
    'users',
    'comics',
    'comments',
    'ratings',
    'votes',
    'purchases',
    'notifications',
    'authorApplications',
    'deleteRequests',
    'reports',
    'adRequests',
    'gstSettings',
    'platformSettings',
    'server_users',
    'server_comics',
    'server_comic_assets',
  ];

  const liveCounts: Record<string, number> = {};
  if (authCtx.mode !== 'public_api_key') {
    await Promise.all(
      collectionNames.map(async (col) => {
        const q = await runFirestoreQuery(
          {
            from: [{ collectionId: col }],
            select: { fields: [{ fieldPath: '__name__' }] },
            limit: 500,
          },
          userFirebaseIdToken
        );
        if (q.ok) {
          liveCounts[col] = q.docs.length;
        }
      })
    );
  }

  return {
    connected: publishedProbe.ok,
    projectId: FIREBASE_APPLET_CONFIG.projectId,
    databaseId: FIREBASE_APPLET_CONFIG.firestoreDatabaseId,
    authDomain: FIREBASE_APPLET_CONFIG.authDomain,
    credentialMode: authCtx.mode,
    serviceAccountConfigured: Boolean(parseServiceAccountFromEnv()),
    publishedComicsInFirestore: publishedProbe.docs.length,
    liveCounts,
    cloudVaultStatus: lastCloudSyncStatus,
    checkedAt: new Date().toISOString(),
    error: publishedProbe.ok ? undefined : publishedProbe.error,
  };
}

// =============================================================================
// FULL SERVER VAULT PERSISTENCE & HYDRATION (USERS/PASSWORDS + COMICS/PAGES)
// =============================================================================

const ASSET_PTR_PREFIX = 'asset://';
const ASSET_INLINE_LIMIT = 16_000;
const ASSET_CHUNK_SIZE = 380_000;

export interface CloudSyncStatusSnapshot {
  ok: boolean;
  mode: CredentialMode;
  revision: number;
  lastHydratedAt?: string;
  lastSyncedAt?: string;
  error?: string;
}

let lastCloudSyncStatus: CloudSyncStatusSnapshot = {
  ok: false,
  mode: 'public_api_key',
  revision: 0,
};

export function getLastCloudSyncStatus(): CloudSyncStatusSnapshot {
  return { ...lastCloudSyncStatus };
}

function externalizeLargeString(
  assetKey: string,
  rawValue: string | undefined,
  ownerComicId: string,
  assetWrites: CommitWriteItem[]
): string | undefined {
  if (!rawValue || typeof rawValue !== 'string') return rawValue;
  if (rawValue.startsWith(ASSET_PTR_PREFIX) || rawValue.length <= ASSET_INLINE_LIMIT) {
    return rawValue;
  }

  const safeKey = sanitizeFirestoreId(assetKey);
  const totalChunks = Math.ceil(rawValue.length / ASSET_CHUNK_SIZE);
  for (let idx = 0; idx < totalChunks; idx += 1) {
    const slice = rawValue.slice(idx * ASSET_CHUNK_SIZE, (idx + 1) * ASSET_CHUNK_SIZE);
    assetWrites.push({
      docPath: `server_comic_assets/${safeKey}__${idx}`,
      fields: {
        assetKey: safeKey,
        comicId: ownerComicId,
        chunkIndex: idx,
        totalChunks,
        data: slice,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  return `${ASSET_PTR_PREFIX}${safeKey}:${totalChunks}`;
}

function restoreAssetString(
  rawValue: unknown,
  assetChunksMap: Map<string, Map<number, string>>
): string | undefined {
  if (typeof rawValue !== 'string') return undefined;
  if (!rawValue.startsWith(ASSET_PTR_PREFIX)) return rawValue;
  const spec = rawValue.slice(ASSET_PTR_PREFIX.length);
  const colonIdx = spec.lastIndexOf(':');
  if (colonIdx <= 0) return rawValue;
  const assetKey = spec.slice(0, colonIdx);
  const totalChunks = Math.max(1, Number(spec.slice(colonIdx + 1)) || 1);
  const chunks = assetChunksMap.get(assetKey);
  if (!chunks) return rawValue;
  const parts: string[] = [];
  for (let i = 0; i < totalChunks; i += 1) {
    const part = chunks.get(i);
    if (part === undefined) return rawValue;
    parts.push(part);
  }
  return parts.join('');
}

function buildFullUserVaultWriteItems(user: User): CommitWriteItem[] {
  const safeUserId = sanitizeFirestoreId(user.id);
  const writes: CommitWriteItem[] = [];
  const clone: Record<string, unknown> = {
    ...user,
    id: user.id,
    email: user.email,
    bookmarks: Array.isArray(user.bookmarks) ? user.bookmarks : [],
    favorites: Array.isArray(user.favorites) ? user.favorites : [],
    readingHistory: Array.isArray(user.readingHistory)
      ? user.readingHistory.slice(0, 20)
      : [],
  };
  delete clone.password;
  if (typeof clone.avatar === 'string' && clone.avatar.length > ASSET_INLINE_LIMIT) {
    clone.avatar = externalizeLargeString(`usr_avatar_${safeUserId}`, clone.avatar, `user_${safeUserId}`, writes);
  }
  writes.push({
    docPath: `server_users/${safeUserId}`,
    fields: {
      payload: clone,
      updatedAt: new Date().toISOString(),
    },
  });
  return writes;
}

function buildFullComicVaultWriteItems(comic: Comic): CommitWriteItem[] {
  const safeComicId = sanitizeFirestoreId(comic.id);
  const writes: CommitWriteItem[] = [];

  const serializedCover = externalizeLargeString(
    `comic_${safeComicId}_cover`,
    comic.coverImage,
    safeComicId,
    writes
  );

  const serializedAttachedPages = Array.isArray(comic.attachedPages)
    ? comic.attachedPages.map((p, idx) => ({
        ...p,
        imageUrl:
          externalizeLargeString(
            `comic_${safeComicId}_att_${idx}_${sanitizeFirestoreId(p.id)}`,
            p.imageUrl,
            safeComicId,
            writes
          ) || '',
      }))
    : undefined;

  const serializedChapters = (comic.chapters || []).map((ch, chIdx) => ({
    ...ch,
    episodes: (ch.episodes || []).map((ep, epIdx) => ({
      ...ep,
      coverImage: externalizeLargeString(
        `comic_${safeComicId}_ch${chIdx}_ep${epIdx}_cov`,
        ep.coverImage,
        safeComicId,
        writes
      ),
      pages: (ep.pages || []).map((pg, pgIdx) => ({
        ...pg,
        imageUrl:
          externalizeLargeString(
            `comic_${safeComicId}_ch${chIdx}_ep${epIdx}_pg${pgIdx}`,
            pg.imageUrl,
            safeComicId,
            writes
          ) || '',
      })),
    })),
  }));

  const comicPayload: Record<string, unknown> = {
    ...comic,
    coverImage: serializedCover || comic.coverImage,
    chapters: serializedChapters,
  };
  if (serializedAttachedPages) {
    comicPayload.attachedPages = serializedAttachedPages;
  } else {
    delete comicPayload.attachedPages;
  }

  writes.push({
    docPath: `server_comics/${safeComicId}`,
    fields: {
      comicId: comic.id,
      payload: comicPayload,
      updatedAt: comic.updatedAt || new Date().toISOString(),
    },
  });

  return writes;
}

export type VaultCollectionKey =
  | 'authorApplications'
  | 'purchases'
  | 'paymentTransactions'
  | 'comments'
  | 'ratings'
  | 'votes'
  | 'notifications'
  | 'reports'
  | 'deleteRequests'
  | 'adRequests'
  | 'copyrightDocs'
  | 'settings'
  | 'activityLogs'
  | 'otps';

const ALL_VAULT_COLLECTION_KEYS: VaultCollectionKey[] = [
  'authorApplications',
  'purchases',
  'paymentTransactions',
  'comments',
  'ratings',
  'votes',
  'notifications',
  'reports',
  'deleteRequests',
  'adRequests',
  'copyrightDocs',
  'settings',
  'activityLogs',
  'otps',
];

function buildVaultCollectionWrites(snapshot: DatabaseSchema, keys: VaultCollectionKey[]): CommitWriteItem[] {
  const nowIso = new Date().toISOString();
  const writes: CommitWriteItem[] = [];

  for (const key of keys) {
    if (key === 'settings') {
      writes.push({
        docPath: 'server_collections/settings',
        fields: {
          settings: snapshot.settings,
          gstSettings: snapshot.gstSettings,
          creditNotes: snapshot.creditNotes || [],
          updatedAt: nowIso,
        },
      });
    } else if (key === 'otps') {
      writes.push({
        docPath: 'server_collections/otps',
        fields: {
          otps: snapshot.otps || {},
          adminOtp: snapshot.adminOtp || null,
          updatedAt: nowIso,
        },
      });
    } else {
      const items = Array.isArray((snapshot as any)[key]) ? ((snapshot as any)[key] as unknown[]) : [];
      writes.push({
        docPath: `server_collections/${key}`,
        fields: {
          items,
          updatedAt: nowIso,
        },
      });
    }
  }

  return writes;
}

export async function fetchCloudSyncRevision(
  userFirebaseIdToken?: string
): Promise<{ ok: boolean; revision: number; mode: CredentialMode; exists: boolean }> {
  const authCtx = await resolveAuthContext(userFirebaseIdToken);
  if (authCtx.mode === 'public_api_key' || !authCtx.bearerToken) {
    return { ok: false, revision: 0, mode: authCtx.mode, exists: false };
  }

  const doc = await fetchFirestoreDocument('server_meta/sync_state', authCtx.bearerToken);
  if (!doc) {
    return { ok: true, revision: 0, mode: authCtx.mode, exists: false };
  }
  return {
    ok: true,
    revision: Number(doc.revision) || 0,
    mode: authCtx.mode,
    exists: true,
  };
}

export async function persistSnapshotChangesToFirestore(params: {
  snapshot: DatabaseSchema;
  users?: User[];
  comics?: Comic[];
  deletedComicIds?: string[];
  deletedUserIds?: string[];
  collections?: VaultCollectionKey[];
  fullVaultSync?: boolean;
  revision?: number;
  userFirebaseIdToken?: string;
}): Promise<{ persisted: boolean; mode: CredentialMode; written: number; revision: number; error?: string }> {
  const authCtx = await resolveAuthContext(params.userFirebaseIdToken);
  if (authCtx.mode === 'public_api_key' || !authCtx.bearerToken) {
    lastCloudSyncStatus = {
      ...lastCloudSyncStatus,
      ok: false,
      mode: authCtx.mode,
    };
    return {
      persisted: false,
      mode: authCtx.mode,
      written: 0,
      revision: params.revision || lastCloudSyncStatus.revision,
      error: 'No server credentials (service account or project ADC) available in this runtime.',
    };
  }

  const writes: CommitWriteItem[] = [];
  const comicEpisodeLookup = new Map<string, string>();
  for (const c of params.snapshot.comics || []) {
    for (const ch of c.chapters || []) {
      for (const ep of ch.episodes || []) {
        comicEpisodeLookup.set(ep.id, c.id);
      }
    }
  }

  const targetUsers = params.fullVaultSync ? params.snapshot.users || [] : params.users || [];
  const targetComics = params.fullVaultSync ? params.snapshot.comics || [] : params.comics || [];
  const targetCollections = params.fullVaultSync ? ALL_VAULT_COLLECTION_KEYS : params.collections || [];

  for (const u of targetUsers) {
    writes.push(...buildFullUserVaultWriteItems(u));
    writes.push(...buildUserWriteItems(u));
  }

  for (const c of targetComics) {
    writes.push(...buildFullComicVaultWriteItems(c));
    writes.push(...buildComicAndEpisodeWriteItems(c));
  }

  if (targetCollections.length > 0) {
    writes.push(...buildVaultCollectionWrites(params.snapshot, targetCollections));
  }

  // Delete removed comics / users in vault & public mirror
  for (const delComicId of params.deletedComicIds || []) {
    const safeCid = sanitizeFirestoreId(delComicId);
    await deleteFirestoreDoc(`server_comics/${safeCid}`, params.userFirebaseIdToken).catch(() => false);
    await deleteFirestoreDoc(`comics/${safeCid}`, params.userFirebaseIdToken).catch(() => false);
  }
  for (const delUserId of params.deletedUserIds || []) {
    const safeUid = sanitizeFirestoreId(delUserId);
    await deleteFirestoreDoc(`server_users/${safeUid}`, params.userFirebaseIdToken).catch(() => false);
    await deleteFirestoreDoc(`users/${safeUid}/private/info`, params.userFirebaseIdToken).catch(() => false);
    await deleteFirestoreDoc(`users/${safeUid}`, params.userFirebaseIdToken).catch(() => false);
  }

  const nextRevision =
    typeof params.revision === 'number' && params.revision > 0
      ? params.revision
      : Math.max(Date.now(), (lastCloudSyncStatus.revision || 0) + 1);

  writes.push({
    docPath: 'server_meta/sync_state',
    fields: {
      revision: nextRevision,
      updatedAt: new Date().toISOString(),
      usersCount: (params.snapshot.users || []).length,
      comicsCount: (params.snapshot.comics || []).length,
    },
  });

  const commitRes = await commitFirestoreWrites(writes, params.userFirebaseIdToken);
  lastCloudSyncStatus = {
    ok: commitRes.success,
    mode: commitRes.mode,
    revision: commitRes.success ? nextRevision : lastCloudSyncStatus.revision,
    lastHydratedAt: lastCloudSyncStatus.lastHydratedAt,
    lastSyncedAt: commitRes.success ? new Date().toISOString() : lastCloudSyncStatus.lastSyncedAt,
    error: commitRes.error,
  };

  if (!commitRes.success) {
    console.warn(`[FirestoreVault] Persist failed (${commitRes.mode}):`, commitRes.error);
  }

  return {
    persisted: commitRes.success,
    mode: commitRes.mode,
    written: commitRes.written,
    revision: lastCloudSyncStatus.revision,
    error: commitRes.error,
  };
}

export async function hydrateDatabaseFromFirestore(
  fallbackData: DatabaseSchema,
  userFirebaseIdToken?: string
): Promise<{
  hydrated: boolean;
  seeded: boolean;
  revision: number;
  mode: CredentialMode;
  data: DatabaseSchema;
  error?: string;
}> {
  const authCtx = await resolveAuthContext(userFirebaseIdToken);
  if (authCtx.mode === 'public_api_key' || !authCtx.bearerToken) {
    lastCloudSyncStatus = {
      ...lastCloudSyncStatus,
      ok: false,
      mode: authCtx.mode,
    };
    return {
      hydrated: false,
      seeded: false,
      revision: 0,
      mode: authCtx.mode,
      data: fallbackData,
    };
  }

  const [syncMetaDoc, usersRes, comicsRes, assetsRes, collectionsRes] = await Promise.all([
    fetchFirestoreDocument('server_meta/sync_state', authCtx.bearerToken),
    listFirestoreCollection('server_users', userFirebaseIdToken),
    listFirestoreCollection('server_comics', userFirebaseIdToken),
    listFirestoreCollection('server_comic_assets', userFirebaseIdToken),
    listFirestoreCollection('server_collections', userFirebaseIdToken),
  ]);

  if (!usersRes.ok || !comicsRes.ok || !assetsRes.ok || !collectionsRes.ok) {
    const err = usersRes.error || comicsRes.error || assetsRes.error || collectionsRes.error;
    lastCloudSyncStatus = {
      ...lastCloudSyncStatus,
      ok: false,
      mode: authCtx.mode,
      error: err,
    };
    return {
      hydrated: false,
      seeded: false,
      revision: 0,
      mode: authCtx.mode,
      data: fallbackData,
      error: err,
    };
  }

  const hasCloudData =
    Boolean(syncMetaDoc) ||
    usersRes.docs.length > 0 ||
    comicsRes.docs.length > 0 ||
    collectionsRes.docs.length > 0;

  // First-ever boot on App Hosting with empty cloud vault: seed cloud vault from fallbackData
  if (!hasCloudData) {
    const seedRes = await persistSnapshotChangesToFirestore({
      snapshot: fallbackData,
      fullVaultSync: true,
      revision: 1,
      userFirebaseIdToken,
    });
    lastCloudSyncStatus = {
      ok: seedRes.persisted,
      mode: authCtx.mode,
      revision: seedRes.revision,
      lastHydratedAt: new Date().toISOString(),
      lastSyncedAt: seedRes.persisted ? new Date().toISOString() : undefined,
      error: seedRes.error,
    };
    return {
      hydrated: seedRes.persisted,
      seeded: seedRes.persisted,
      revision: seedRes.revision,
      mode: authCtx.mode,
      data: fallbackData,
      error: seedRes.error,
    };
  }

  // Reconstruct asset chunks map
  const assetChunksMap = new Map<string, Map<number, string>>();
  for (const assetDoc of assetsRes.docs) {
    const f = assetDoc.fields;
    const key = typeof f.assetKey === 'string' ? f.assetKey : '';
    const idx = Number(f.chunkIndex);
    const data = typeof f.data === 'string' ? f.data : '';
    if (!key || !Number.isFinite(idx)) continue;
    let map = assetChunksMap.get(key);
    if (!map) {
      map = new Map<number, string>();
      assetChunksMap.set(key, map);
    }
    map.set(idx, data);
  }

  const nextData: DatabaseSchema = {
    ...fallbackData,
  };

  // Restore users (including passwordHash, lockout counters, bookmarks, etc.)
  if (usersRes.docs.length > 0) {
    const restoredUsers: User[] = [];
    for (const docItem of usersRes.docs) {
      const payload = docItem.fields.payload as Record<string, unknown> | undefined;
      if (!payload || typeof payload !== 'object') continue;
      const userObj = { ...(payload as unknown as User) };
      if (typeof userObj.avatar === 'string' && userObj.avatar.startsWith(ASSET_PTR_PREFIX)) {
        userObj.avatar = restoreAssetString(userObj.avatar, assetChunksMap) || userObj.avatar;
      }
      if (!Array.isArray(userObj.bookmarks)) userObj.bookmarks = [];
      if (!Array.isArray(userObj.favorites)) userObj.favorites = [];
      if (!Array.isArray(userObj.readingHistory)) userObj.readingHistory = [];
      restoredUsers.push(userObj);
    }

    // Ensure usr_admin exists with authoritative details
    const hasAdmin = restoredUsers.some((u) => u.id === 'usr_admin' || u.role === 'admin');
    if (!hasAdmin) {
      const fallbackAdmin = fallbackData.users.find((u) => u.id === 'usr_admin' || u.role === 'admin');
      if (fallbackAdmin) restoredUsers.unshift(fallbackAdmin);
    }
    nextData.users = restoredUsers;
  }

  // Restore comics (with full coverImage, attachedPages, chapters, episodes, pages)
  const restoredComics: Comic[] = [];
  for (const docItem of comicsRes.docs) {
    const payload = docItem.fields.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') continue;
    const comicObj = { ...(payload as unknown as Comic) };
    comicObj.coverImage =
      restoreAssetString(comicObj.coverImage, assetChunksMap) ||
      comicObj.coverImage ||
      '/src/assets/images/comic_cover_blade_1794269871791.jpg';

    if (Array.isArray(comicObj.attachedPages)) {
      comicObj.attachedPages = comicObj.attachedPages.map((p) => ({
        ...p,
        imageUrl: restoreAssetString(p.imageUrl, assetChunksMap) || p.imageUrl,
      }));
    }

    comicObj.chapters = (comicObj.chapters || []).map((ch) => ({
      ...ch,
      episodes: (ch.episodes || []).map((ep) => ({
        ...ep,
        coverImage: restoreAssetString(ep.coverImage, assetChunksMap) || ep.coverImage,
        pages: (ep.pages || []).map((pg) => ({
          ...pg,
          imageUrl: restoreAssetString(pg.imageUrl, assetChunksMap) || pg.imageUrl,
        })),
      })),
    }));

    restoredComics.push(comicObj);
  }
  restoredComics.sort(
    (a, b) =>
      new Date(b.createdAt || b.updatedAt || 0).getTime() -
      new Date(a.createdAt || a.updatedAt || 0).getTime()
  );
  nextData.comics = restoredComics;

  // Restore collections
  for (const colDoc of collectionsRes.docs) {
    const id = colDoc.id as VaultCollectionKey;
    if (id === 'settings') {
      if (colDoc.fields.settings && typeof colDoc.fields.settings === 'object') {
        nextData.settings = colDoc.fields.settings as unknown as PlatformSettings;
      }
      if (colDoc.fields.gstSettings && typeof colDoc.fields.gstSettings === 'object') {
        nextData.gstSettings = colDoc.fields.gstSettings as any;
      }
      if (Array.isArray(colDoc.fields.creditNotes)) {
        nextData.creditNotes = colDoc.fields.creditNotes as any[];
      }
    } else if (id === 'otps') {
      if (colDoc.fields.otps && typeof colDoc.fields.otps === 'object') {
        nextData.otps = colDoc.fields.otps as any;
      }
      if (colDoc.fields.adminOtp && typeof colDoc.fields.adminOtp === 'object') {
        nextData.adminOtp = colDoc.fields.adminOtp as any;
      } else {
        delete nextData.adminOtp;
      }
    } else if (Array.isArray(colDoc.fields.items)) {
      (nextData as any)[id] = colDoc.fields.items;
    }
  }

  const revision = Number(syncMetaDoc?.revision) || 1;
  lastCloudSyncStatus = {
    ok: true,
    mode: authCtx.mode,
    revision,
    lastHydratedAt: new Date().toISOString(),
    lastSyncedAt: lastCloudSyncStatus.lastSyncedAt,
  };

  return {
    hydrated: true,
    seeded: false,
    revision,
    mode: authCtx.mode,
    data: nextData,
  };
}

// Fire-and-forget safe mirror helper for API routes
export function mirrorWritesInBackground(
  label: string,
  writes: CommitWriteItem[],
  userFirebaseIdToken?: string
) {
  commitFirestoreWrites(writes, userFirebaseIdToken)
    .then((res) => {
      if (!res.success && res.mode !== 'public_api_key') {
        console.warn(`[FirestoreBridge:${label}] Mirror skipped/failed (${res.mode}):`, res.error);
      }
    })
    .catch((err) => {
      console.warn(`[FirestoreBridge:${label}] Unexpected error:`, err instanceof Error ? err.message : err);
    });
}
