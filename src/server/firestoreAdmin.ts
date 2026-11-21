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
let cachedAdcInfo: { sameProject: boolean; retryAfterMs: number } = { sameProject: false, retryAfterMs: 0 };
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

  // Re-check metadata server if not confirmed or if negative TTL expired (prevents permanent lockout on cold start timeout)
  if (!cachedAdcInfo.sameProject && nowMs >= cachedAdcInfo.retryAfterMs) {
    let confirmedDifferentProject = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const projRes = await fetch('http://metadata.google.internal/computeMetadata/v1/project/project-id', {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(attempt === 0 ? 2500 : 3500),
        });
        if (projRes.ok) {
          const projId = (await projRes.text()).trim();
          if (projId === FIREBASE_APPLET_CONFIG.projectId) {
            cachedAdcInfo = { sameProject: true, retryAfterMs: Number.MAX_SAFE_INTEGER };
            break;
          } else {
            confirmedDifferentProject = true;
            // Cache confirmed different project (e.g. AI Studio sandbox) for 10 minutes
            cachedAdcInfo = { sameProject: false, retryAfterMs: nowMs + 10 * 60 * 1000 };
            break;
          }
        }
      } catch {
        // Transient cold-start timeout or non-GCP runtime: retry briefly, never lock out permanently
      }
    }
    if (!cachedAdcInfo.sameProject && !confirmedDifferentProject) {
      // Retry after 15 seconds in case metadata server was still warming up on Cloud Run cold start
      cachedAdcInfo = { sameProject: false, retryAfterMs: nowMs + 15_000 };
    }
  }

  if (!cachedAdcInfo.sameProject) {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const tokRes = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(attempt === 0 ? 2500 : 4000),
        }
      );
      if (tokRes.ok) {
        const data = (await tokRes.json()) as { access_token?: string; expires_in?: number };
        if (data.access_token) {
          cachedAdcToken = {
            token: data.access_token,
            expiresAtMs: Date.now() + (data.expires_in || 3000) * 1000,
          };
          return data.access_token;
        }
      }
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
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

async function fetchFirestoreDocument(
  docPath: string,
  bearerToken?: string,
  timeoutMs = 10_000
): Promise<Record<string, unknown> | null> {
  const url = `${FIRESTORE_REST_BASE_URL}/${docPath}?key=${encodeURIComponent(FIREBASE_APPLET_CONFIG.apiKey)}`;
  const headers: Record<string, string> = {};
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return null;
      if (res.ok) {
        const json = await res.json();
        return fromFirestoreDocument(json);
      }
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return null;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  return null;
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

  // Keep commit payloads safely compact (~1.2 MB max, 20 writes max) to prevent REST commit size/timeout failures
  const MAX_WRITES_PER_COMMIT = 20;
  const MAX_BYTES_PER_COMMIT = 1_200_000;

  let totalWritten = 0;
  let index = 0;
  while (index < items.length) {
    const chunk: CommitWriteItem[] = [];
    let estimatedBytes = 0;

    while (index < items.length && chunk.length < MAX_WRITES_PER_COMMIT) {
      const candidate = items[index];
      const approxLen = JSON.stringify(candidate.fields).length + 512;
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

    const requestBody = JSON.stringify({ writes });
    let batchSucceeded = false;
    let lastErr = '';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const commitRes = await fetch(
          `${FIRESTORE_REST_BASE_URL}:commit?key=${encodeURIComponent(FIREBASE_APPLET_CONFIG.apiKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${bearerToken}`,
            },
            body: requestBody,
            signal: AbortSignal.timeout(30_000),
          }
        );

        if (commitRes.ok) {
          batchSucceeded = true;
          break;
        }

        const errBody = await commitRes.text().catch(() => '');
        lastErr = `Firestore commit HTTP ${commitRes.status}: ${errBody.slice(0, 300)}`;
        // Retry only on transient status codes (429 / 5xx)
        if ((commitRes.status === 429 || commitRes.status >= 500) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : 'Commit request failed';
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    if (!batchSucceeded) {
      return {
        success: false,
        mode,
        written: totalWritten,
        error: lastErr || 'Firestore commit batch failed',
      };
    }

    totalWritten += chunk.length;
  }

  return { success: true, mode, written: totalWritten };
}

export async function listFirestoreCollection(
  collectionId: string,
  userFirebaseIdToken?: string,
  options?: { pageSize?: number; timeoutMs?: number }
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

  const pageSize = Math.min(200, Math.max(5, options?.pageSize || 100));
  const timeoutMs = options?.timeoutMs || 20_000;
  const docs: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let pageToken = '';

  try {
    do {
      const params = new URLSearchParams({
        pageSize: String(pageSize),
        key: FIREBASE_APPLET_CONFIG.apiKey,
      });
      if (pageToken) params.set('pageToken', pageToken);

      let pageJson: {
        documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>;
        nextPageToken?: string;
      } | null = null;
      let lastStatus = 500;
      let lastErr = '';

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await fetch(`${FIRESTORE_REST_BASE_URL}/${collectionId}?${params.toString()}`, {
            headers: { Authorization: `Bearer ${bearerToken}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
          lastStatus = res.status;
          if (res.status === 404) {
            return { ok: true, status: 200, mode, docs };
          }
          if (res.ok) {
            pageJson = (await res.json()) as {
              documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>;
              nextPageToken?: string;
            };
            break;
          }
          const errBody = await res.text().catch(() => '');
          lastErr = `Firestore list ${collectionId} HTTP ${res.status}: ${errBody.slice(0, 250)}`;
          if ((res.status === 429 || res.status >= 500) && attempt === 0) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : 'List collection failed';
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }

      if (!pageJson) {
        return {
          ok: false,
          status: lastStatus,
          mode,
          docs,
          error: lastErr || `Firestore list ${collectionId} failed`,
        };
      }

      for (const rawDoc of pageJson.documents || []) {
        const parsed = fromFirestoreDocument(rawDoc);
        const docName = String(rawDoc.name || '');
        const docId = docName.split('/').pop() || '';
        if (parsed && docId) {
          docs.push({ id: docId, fields: parsed });
        }
      }

      pageToken = pageJson.nextPageToken || '';
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
  const isProtectedVaultAccount =
    safeRole === 'admin' ||
    u.id === 'usr_admin' ||
    u.id === 'usr_admin_reader' ||
    Boolean(u.isProtectedOwnerReader);
  const safeEmail = (
    safeRole === 'admin' ? 'protected@admin.vault' : u.email || 'reader@gmail.com'
  )
    .trim()
    .slice(0, 120);
  const safePhone = isProtectedVaultAccount
    ? 'Protected Backend Vault'
    : (u.phone && u.phone.trim().length >= 3 ? u.phone.trim() : 'Not provided').slice(0, 32);
  const safeUpiId = isProtectedVaultAccount
    ? 'Not provided'
    : (u.upiId && u.upiId.trim().length >= 3 ? u.upiId.trim() : 'Not provided').slice(0, 100);
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
const COMIC_ASSET_HTTP_PREFIX = '/api/comic-assets/';
const ASSET_INLINE_LIMIT = 16_000;
const ASSET_CHUNK_SIZE = 380_000;

// Bounded in-memory LRU cache for decoded comic covers & pages (max 64 MB)
const MAX_ASSET_CACHE_BYTES = 64 * 1024 * 1024;
interface CachedComicAsset {
  contentType: string;
  buffer: Buffer;
  sizeBytes: number;
  cachedAt: number;
}
const comicAssetLruCache = new Map<string, CachedComicAsset>();
let comicAssetCacheTotalBytes = 0;

function decodeDataUriToAsset(rawDataUri: string): CachedComicAsset | null {
  const match = rawDataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  try {
    const contentType = match[1].trim() || 'image/jpeg';
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) return null;
    return {
      contentType,
      buffer,
      sizeBytes: buffer.length,
      cachedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function cacheComicAssetFromDataUri(assetKey: string, rawDataUri: string): void {
  const safeKey = sanitizeFirestoreId(assetKey);
  const decoded = decodeDataUriToAsset(rawDataUri);
  if (!decoded || decoded.sizeBytes > MAX_ASSET_CACHE_BYTES / 2) return;

  const existing = comicAssetLruCache.get(safeKey);
  if (existing) {
    comicAssetCacheTotalBytes -= existing.sizeBytes;
    comicAssetLruCache.delete(safeKey);
  }
  comicAssetLruCache.set(safeKey, decoded);
  comicAssetCacheTotalBytes += decoded.sizeBytes;

  while (comicAssetCacheTotalBytes > MAX_ASSET_CACHE_BYTES && comicAssetLruCache.size > 1) {
    const oldestKey = comicAssetLruCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = comicAssetLruCache.get(oldestKey);
    if (oldest) {
      comicAssetCacheTotalBytes -= oldest.sizeBytes;
    }
    comicAssetLruCache.delete(oldestKey);
  }
}

export function getCachedComicAsset(assetKey: string): CachedComicAsset | null {
  const safeKey = sanitizeFirestoreId(assetKey);
  const entry = comicAssetLruCache.get(safeKey);
  if (!entry) return null;
  // Refresh LRU order
  comicAssetLruCache.delete(safeKey);
  comicAssetLruCache.set(safeKey, entry);
  return entry;
}

export function parseComicAssetHttpUrl(rawValue: unknown): { assetKey: string; totalChunks: number } | null {
  if (typeof rawValue !== 'string' || !rawValue.startsWith(COMIC_ASSET_HTTP_PREFIX)) return null;
  const rest = rawValue.slice(COMIC_ASSET_HTTP_PREFIX.length);
  const [rawKey, query] = rest.split('?');
  const assetKey = sanitizeFirestoreId(decodeURIComponent(rawKey || ''));
  if (!assetKey || assetKey === 'doc_default') return null;
  let totalChunks = 1;
  if (query) {
    const params = new URLSearchParams(query);
    const parsed = Number(params.get('chunks'));
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) {
      totalChunks = Math.floor(parsed);
    }
  }
  return { assetKey, totalChunks };
}

export function assetPointerToHttpUrl(rawValue: unknown): string | undefined {
  if (typeof rawValue !== 'string') return undefined;
  if (!rawValue.startsWith(ASSET_PTR_PREFIX)) return rawValue;
  const spec = rawValue.slice(ASSET_PTR_PREFIX.length);
  const colonIdx = spec.lastIndexOf(':');
  if (colonIdx <= 0) return rawValue;
  const assetKey = sanitizeFirestoreId(spec.slice(0, colonIdx));
  const totalChunks = Math.max(1, Number(spec.slice(colonIdx + 1)) || 1);
  return `${COMIC_ASSET_HTTP_PREFIX}${encodeURIComponent(assetKey)}?chunks=${totalChunks}`;
}

function httpUrlToAssetPointer(rawValue: string): string {
  const parsed = parseComicAssetHttpUrl(rawValue);
  if (!parsed) return rawValue;
  return `${ASSET_PTR_PREFIX}${parsed.assetKey}:${parsed.totalChunks}`;
}

export async function fetchComicAssetByKey(
  rawAssetKey: string,
  expectedChunks?: number,
  userFirebaseIdToken?: string
): Promise<{ contentType: string; buffer: Buffer } | null> {
  const safeKey = sanitizeFirestoreId(rawAssetKey);
  if (!safeKey || safeKey === 'doc_default') return null;

  const cached = getCachedComicAsset(safeKey);
  if (cached) {
    return { contentType: cached.contentType, buffer: cached.buffer };
  }

  const authCtx = await resolveAuthContext(userFirebaseIdToken);
  if (authCtx.mode === 'public_api_key' || !authCtx.bearerToken) {
    return null;
  }

  // Fetch chunk 0 first to confirm totalChunks accurately (or all chunks in parallel if expectedChunks is known)
  let totalChunks =
    typeof expectedChunks === 'number' && Number.isFinite(expectedChunks) && expectedChunks >= 1
      ? Math.min(100, Math.floor(expectedChunks))
      : 0;

  const chunkDocs: Array<Record<string, unknown> | null> = [];
  if (totalChunks > 0 && totalChunks <= 8) {
    const fetched = await Promise.all(
      Array.from({ length: totalChunks }, (_, idx) =>
        fetchFirestoreDocument(`server_comic_assets/${safeKey}__${idx}`, authCtx.bearerToken, 12_000)
      )
    );
    chunkDocs.push(...fetched);
    const metaTotal = Number(fetched[0]?.totalChunks);
    if (Number.isFinite(metaTotal) && metaTotal > totalChunks && metaTotal <= 100) {
      const remaining = await Promise.all(
        Array.from({ length: metaTotal - totalChunks }, (_, offset) =>
          fetchFirestoreDocument(`server_comic_assets/${safeKey}__${totalChunks + offset}`, authCtx.bearerToken, 12_000)
        )
      );
      chunkDocs.push(...remaining);
      totalChunks = metaTotal;
    }
  } else {
    const firstDoc = await fetchFirestoreDocument(`server_comic_assets/${safeKey}__0`, authCtx.bearerToken, 12_000);
    if (!firstDoc) return null;
    chunkDocs.push(firstDoc);
    const metaTotal = Math.min(100, Math.max(1, Number(firstDoc.totalChunks) || totalChunks || 1));
    totalChunks = metaTotal;
    if (totalChunks > 1) {
      const remaining = await Promise.all(
        Array.from({ length: totalChunks - 1 }, (_, offset) =>
          fetchFirestoreDocument(`server_comic_assets/${safeKey}__${offset + 1}`, authCtx.bearerToken, 12_000)
        )
      );
      chunkDocs.push(...remaining);
    }
  }

  const parts: string[] = [];
  for (let idx = 0; idx < totalChunks; idx += 1) {
    const doc = chunkDocs[idx];
    if (!doc || typeof doc.data !== 'string') {
      return null;
    }
    parts.push(doc.data);
  }

  const rawDataUri = parts.join('');
  const decoded = decodeDataUriToAsset(rawDataUri);
  if (!decoded) return null;

  cacheComicAssetFromDataUri(safeKey, rawDataUri);
  return { contentType: decoded.contentType, buffer: decoded.buffer };
}

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
): { storedValue: string | undefined; httpUrl?: string } {
  if (!rawValue || typeof rawValue !== 'string') return { storedValue: rawValue };

  // Preserve already-externalized HTTP asset URLs cleanly as asset:// pointers without re-uploading chunks
  if (rawValue.startsWith(COMIC_ASSET_HTTP_PREFIX)) {
    return { storedValue: httpUrlToAssetPointer(rawValue), httpUrl: rawValue };
  }
  if (rawValue.startsWith(ASSET_PTR_PREFIX)) {
    return { storedValue: rawValue, httpUrl: assetPointerToHttpUrl(rawValue) };
  }
  if (rawValue.length <= ASSET_INLINE_LIMIT) {
    return { storedValue: rawValue };
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

  // Keep decoded image warm in LRU cache so reads are instantaneous
  cacheComicAssetFromDataUri(safeKey, rawValue);

  const ptr = `${ASSET_PTR_PREFIX}${safeKey}:${totalChunks}`;
  return {
    storedValue: ptr,
    httpUrl: `${COMIC_ASSET_HTTP_PREFIX}${encodeURIComponent(safeKey)}?chunks=${totalChunks}`,
  };
}

function buildFullUserVaultWriteItems(user: User): {
  assetWrites: CommitWriteItem[];
  docWrites: CommitWriteItem[];
} {
  const safeUserId = sanitizeFirestoreId(user.id);
  const assetWrites: CommitWriteItem[] = [];
  const docWrites: CommitWriteItem[] = [];
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
  if (typeof clone.avatar === 'string') {
    const ext = externalizeLargeString(`usr_avatar_${safeUserId}`, clone.avatar, `user_${safeUserId}`, assetWrites);
    if (ext.storedValue !== undefined) {
      clone.avatar = ext.storedValue;
    }
  }
  docWrites.push({
    docPath: `server_users/${safeUserId}`,
    fields: {
      payload: clone,
      updatedAt: new Date().toISOString(),
    },
  });
  return { assetWrites, docWrites };
}

function buildFullComicVaultWriteItems(comic: Comic): {
  assetWrites: CommitWriteItem[];
  docWrites: CommitWriteItem[];
  compactComicInPlace: () => void;
} {
  const safeComicId = sanitizeFirestoreId(comic.id);
  const assetWrites: CommitWriteItem[] = [];
  const docWrites: CommitWriteItem[] = [];
  const pendingCompactions: Array<() => void> = [];

  const serializedCover = externalizeLargeString(
    `comic_${safeComicId}_cover`,
    comic.coverImage,
    safeComicId,
    assetWrites
  );
  if (serializedCover.httpUrl && comic.coverImage !== serializedCover.httpUrl) {
    const nextUrl = serializedCover.httpUrl;
    pendingCompactions.push(() => {
      comic.coverImage = nextUrl;
    });
  }

  const serializedBanner = comic.bannerImage
    ? externalizeLargeString(`comic_${safeComicId}_banner`, comic.bannerImage, safeComicId, assetWrites)
    : { storedValue: undefined, httpUrl: undefined };
  if (serializedBanner.httpUrl && comic.bannerImage !== serializedBanner.httpUrl) {
    const nextUrl = serializedBanner.httpUrl;
    pendingCompactions.push(() => {
      comic.bannerImage = nextUrl;
    });
  }

  const serializedAttachedPages = Array.isArray(comic.attachedPages)
    ? comic.attachedPages.map((p, idx) => {
        const ext = externalizeLargeString(
          `comic_${safeComicId}_att_${idx}_${sanitizeFirestoreId(p.id)}`,
          p.imageUrl,
          safeComicId,
          assetWrites
        );
        if (ext.httpUrl && p.imageUrl !== ext.httpUrl) {
          const nextUrl = ext.httpUrl;
          pendingCompactions.push(() => {
            p.imageUrl = nextUrl;
          });
        }
        return {
          ...p,
          imageUrl: ext.storedValue || '',
        };
      })
    : undefined;

  const serializedChapters = (comic.chapters || []).map((ch, chIdx) => ({
    ...ch,
    episodes: (ch.episodes || []).map((ep, epIdx) => {
      const epCov = externalizeLargeString(
        `comic_${safeComicId}_ch${chIdx}_ep${epIdx}_cov`,
        ep.coverImage,
        safeComicId,
        assetWrites
      );
      if (epCov.httpUrl && ep.coverImage !== epCov.httpUrl) {
        const nextUrl = epCov.httpUrl;
        pendingCompactions.push(() => {
          ep.coverImage = nextUrl;
        });
      }
      return {
        ...ep,
        coverImage: epCov.storedValue,
        pages: (ep.pages || []).map((pg, pgIdx) => {
          const pgExt = externalizeLargeString(
            `comic_${safeComicId}_ch${chIdx}_ep${epIdx}_pg${pgIdx}`,
            pg.imageUrl,
            safeComicId,
            assetWrites
          );
          if (pgExt.httpUrl && pg.imageUrl !== pgExt.httpUrl) {
            const nextUrl = pgExt.httpUrl;
            pendingCompactions.push(() => {
              pg.imageUrl = nextUrl;
            });
          }
          return {
            ...pg,
            imageUrl: pgExt.storedValue || '',
          };
        }),
      };
    }),
  }));

  const comicPayload: Record<string, unknown> = {
    ...comic,
    coverImage: serializedCover.storedValue || comic.coverImage,
    chapters: serializedChapters,
  };
  if (serializedBanner.storedValue) {
    comicPayload.bannerImage = serializedBanner.storedValue;
  } else {
    delete comicPayload.bannerImage;
  }
  if (serializedAttachedPages) {
    comicPayload.attachedPages = serializedAttachedPages;
  } else {
    delete comicPayload.attachedPages;
  }
  // Never leave raw unchunked attachedFileData inside server_comics (prevents 1 MiB Firestore document overflow)
  delete (comicPayload as any).attachedFileData;

  docWrites.push({
    docPath: `server_comics/${safeComicId}`,
    fields: {
      comicId: comic.id,
      payload: comicPayload,
      updatedAt: comic.updatedAt || new Date().toISOString(),
    },
  });

  return {
    assetWrites,
    docWrites,
    compactComicInPlace: () => {
      for (const fn of pendingCompactions) fn();
    },
  };
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
  | 'otps'
  | 'freeTrialClaims';

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
  'freeTrialClaims',
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

/**
 * Public-safe Firestore catalog recovery: queries published /comics and their /episodes subcollections.
 * Works across ALL credential modes (service_account, native_adc, firebase_id_token, AND public_api_key)
 * so published comics in Firestore are never silently lost or hidden.
 */
export async function fetchPublishedComicsCatalogFromFirestore(
  userFirebaseIdToken?: string
): Promise<Comic[]> {
  const queryRes = await runFirestoreQuery(
    {
      from: [{ collectionId: 'comics' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'published' },
        },
      },
      limit: 100,
    },
    userFirebaseIdToken
  );

  if (!queryRes.ok || queryRes.docs.length === 0) {
    return [];
  }

  const authCtx = await resolveAuthContext(userFirebaseIdToken);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authCtx.bearerToken) {
    headers['Authorization'] = `Bearer ${authCtx.bearerToken}`;
  }

  const recovered: Comic[] = await Promise.all(
    queryRes.docs.map(async (rawComic) => {
      const comicId = String(rawComic.comicId || '').trim();
      const title = String(rawComic.title || 'Untitled Comic').trim();
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || comicId;
      const authorId = String(rawComic.authorId || 'usr_admin').trim();
      const authorName = String(rawComic.authorName || 'Aathirai Creator').trim();
      const rawGenre = String(rawComic.genre || 'Action');
      const genreList = rawGenre
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);
      const accessType: 'free' | 'premium' = rawComic.accessType === 'premium' ? 'premium' : 'free';
      const fullPriceInr = Math.max(0, Number(rawComic.fullUnlockPriceInr) || 0);
      const createdAt = String(rawComic.createdAt || new Date().toISOString());
      const updatedAt = String(rawComic.updatedAt || createdAt);

      // Query published episodes subcollection for this comic
      let episodeDocs: Record<string, unknown>[] = [];
      try {
        const epRes = await fetch(
          `${FIRESTORE_REST_BASE_URL}/comics/${encodeURIComponent(comicId)}:runQuery?key=${encodeURIComponent(FIREBASE_APPLET_CONFIG.apiKey)}`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: 'episodes' }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: 'status' },
                    op: 'EQUAL',
                    value: { stringValue: 'published' },
                  },
                },
                limit: 200,
              },
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
        if (epRes.ok) {
          const rows = (await epRes.json()) as Array<{ document?: any }>;
          episodeDocs = rows
            .map((r) => (r.document ? fromFirestoreDocument(r.document) : null))
            .filter((d): d is Record<string, unknown> => Boolean(d));
        }
      } catch {
        // Keep comic even if episodes subcollection query fails transiently
      }

      // Never stamp fake sample comic artwork onto real Firestore comics
      const defaultCover = '';
      const chapterMap = new Map<
        string,
        {
          id: string;
          comicId: string;
          chapterNumber: number;
          title: string;
          synopsis: string;
          isPremium: boolean;
          priceInr: number;
          episodes: Episode[];
        }
      >();

      episodeDocs.sort((a, b) => {
        const chDiff = (Number(a.chapterNumber) || 1) - (Number(b.chapterNumber) || 1);
        if (chDiff !== 0) return chDiff;
        return (Number(a.episodeNumber) || 1) - (Number(b.episodeNumber) || 1);
      });

      for (const epDoc of episodeDocs) {
        const epId = String(epDoc.episodeId || `ep_${comicId}`);
        const chId = String(epDoc.chapterId || `chap_${comicId}_1`);
        const chNum = Math.max(1, Number(epDoc.chapterNumber) || 1);
        const chTitle = String(epDoc.chapterTitle || `Chapter ${chNum}`);
        const epNum = Math.max(1, Number(epDoc.episodeNumber) || 1);
        const epTitle = String(epDoc.title || `Episode ${epNum}`);
        const isPremium = Boolean(epDoc.isPremium);
        const priceInr = Math.max(0, Number(epDoc.priceInr) || 0);
        const pagesCount = Math.min(200, Math.max(1, Number(epDoc.pagesCount) || 1));
        const epCreatedAt = String(epDoc.createdAt || createdAt);

        let chapter = chapterMap.get(chId);
        if (!chapter) {
          chapter = {
            id: chId,
            comicId,
            chapterNumber: chNum,
            title: chTitle,
            synopsis: `${chTitle} of ${title}`,
            isPremium,
            priceInr: isPremium ? Math.max(priceInr, 30) : 0,
            episodes: [],
          };
          chapterMap.set(chId, chapter);
        }

        const pages = Array.from({ length: pagesCount }, (_, idx) => ({
          id: `pg_${epId}_${idx + 1}`,
          pageNumber: idx + 1,
          imageUrl: defaultCover,
          caption: `Page ${idx + 1}`,
        }));

        chapter.episodes.push({
          id: epId,
          chapterId: chId,
          comicId,
          episodeNumber: epNum,
          title: epTitle,
          synopsis: `${epTitle} — ${title}`,
          releaseDate: epCreatedAt.split('T')[0],
          isPremium,
          priceInr,
          coverImage: defaultCover,
          pages,
          likesCount: 0,
          dislikesCount: 0,
          averageRating: 5.0,
          totalRatings: 0,
          isPublished: true,
        });
      }

      const chapters = Array.from(chapterMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber);
      if (chapters.length === 0) {
        const fallbackChapId = `chap_${comicId}_1`;
        chapters.push({
          id: fallbackChapId,
          comicId,
          chapterNumber: 1,
          title: 'Chapter 1',
          synopsis: `Chapter 1 of ${title}`,
          isPremium: accessType === 'premium',
          priceInr: accessType === 'premium' ? 30 : 0,
          episodes: [],
        });
      }

      return {
        id: comicId,
        title,
        slug,
        authorId,
        authorName,
        genre: genreList.length > 0 ? genreList : ['Action'],
        coverImage: defaultCover,
        description: `Original comic series "${title}" by ${authorName} on Aathirai Comic.`,
        status: 'Ongoing',
        accessType,
        fullPriceInr,
        chapterPriceInr: accessType === 'premium' ? 30 : 0,
        episodePriceInr: accessType === 'premium' ? 10 : 0,
        featured: true,
        trending: true,
        popular: false,
        recommended: true,
        chapters,
        totalViews: 0,
        averageRating: 5.0,
        createdAt,
        updatedAt,
        moderationStatus: 'approved',
        isPublishedDirectlyByAdmin: authorId === 'usr_admin',
      } as Comic;
    })
  );

  recovered.sort(
    (a, b) =>
      new Date(b.createdAt || b.updatedAt || 0).getTime() -
      new Date(a.createdAt || a.updatedAt || 0).getTime()
  );

  return recovered;
}

/**
 * Public-safe Firestore loader for episode comments (/comments) and star ratings (/ratings).
 * Works across ALL credential modes (service_account, native_adc, firebase_id_token, AND public_api_key).
 */
export async function fetchPublicCommentsAndRatingsFromFirestore(
  userFirebaseIdToken?: string
): Promise<{ comments: Comment[]; ratings: Rating[] }> {
  const [commentsRes, ratingsRes] = await Promise.all([
    runFirestoreQuery(
      {
        from: [{ collectionId: 'comments' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'likesCount' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: { integerValue: '0' },
          },
        },
        limit: 500,
      },
      userFirebaseIdToken
    ).catch(() => ({ ok: false, docs: [] as Record<string, unknown>[] })),
    runFirestoreQuery(
      {
        from: [{ collectionId: 'ratings' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'stars' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: { integerValue: '1' },
          },
        },
        limit: 1000,
      },
      userFirebaseIdToken
    ).catch(() => ({ ok: false, docs: [] as Record<string, unknown>[] })),
  ]);

  const comments: Comment[] = commentsRes.ok
    ? commentsRes.docs
        .map((raw) => {
          const id = String(raw.commentId || '').trim();
          const episodeId = String(raw.episodeId || '').trim();
          const content = String(raw.content || '').trim();
          if (!id || !episodeId || !content) return null;
          const userName = String(raw.userName || 'Comic Reader').trim() || 'Comic Reader';
          const createdAt = String(raw.createdAt || new Date().toISOString());
          const updatedAt = String(raw.updatedAt || createdAt);
          return {
            id,
            episodeId,
            userId: String(raw.userId || 'usr_guest').trim(),
            userName,
            userAvatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userName)}`,
            userRole: 'reader' as const,
            content,
            createdAt,
            updatedAt,
            likesCount: Math.max(0, Number(raw.likesCount) || 0),
            likedBy: [],
          } as Comment;
        })
        .filter((c): c is Comment => Boolean(c))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  const ratings: Rating[] = ratingsRes.ok
    ? ratingsRes.docs
        .map((raw) => {
          const id = String(raw.ratingId || '').trim();
          const episodeId = String(raw.episodeId || '').trim();
          const userId = String(raw.userId || '').trim();
          const stars = Math.min(5, Math.max(1, Math.round(Number(raw.stars) || 0)));
          if (!id || !episodeId || !userId || stars < 1) return null;
          const createdAt = String(raw.createdAt || new Date().toISOString());
          const updatedAt = String(raw.updatedAt || createdAt);
          return {
            id,
            episodeId,
            userId,
            stars,
            createdAt,
            updatedAt,
          } as Rating;
        })
        .filter((r): r is Rating => Boolean(r))
    : [];

  return { comments, ratings };
}

function mergeCommentsById(primary: Comment[], incoming: Comment[]): Comment[] {
  const map = new Map<string, Comment>();
  for (const c of primary || []) {
    if (c && c.id) map.set(c.id, c);
  }
  for (const inc of incoming || []) {
    if (!inc || !inc.id) continue;
    const existing = map.get(inc.id);
    if (!existing) {
      map.set(inc.id, inc);
    } else {
      // Keep richer local/vault fields (userAvatar, userRole, replies, likedBy) while syncing latest content/likesCount
      const incUpdated = new Date(inc.updatedAt || inc.createdAt || 0).getTime();
      const exUpdated = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      if (incUpdated > exUpdated) {
        map.set(inc.id, {
          ...existing,
          content: inc.content || existing.content,
          likesCount: Math.max(existing.likesCount || 0, inc.likesCount || 0),
          updatedAt: inc.updatedAt || existing.updatedAt,
        });
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

function mergeRatingsById(primary: Rating[], incoming: Rating[]): Rating[] {
  const byEpisodeUser = new Map<string, Rating>();
  const addRating = (r: Rating) => {
    if (!r || !r.episodeId || !r.userId) return;
    const key = `${r.episodeId}::${r.userId}`;
    const existing = byEpisodeUser.get(key);
    if (!existing) {
      byEpisodeUser.set(key, r);
      return;
    }
    const nextTs = new Date(r.updatedAt || r.createdAt || 0).getTime();
    const prevTs = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
    if (nextTs >= prevTs) {
      byEpisodeUser.set(key, r);
    }
  };
  for (const r of primary || []) addRating(r);
  for (const r of incoming || []) addRating(r);
  return Array.from(byEpisodeUser.values());
}

export function applyRatingsToComics(comics: Comic[], ratings: Rating[]): void {
  const statsByEp = new Map<string, { sum: number; count: number }>();
  for (const r of ratings || []) {
    if (!r || !r.episodeId) continue;
    const stars = Number(r.stars);
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) continue;
    const cur = statsByEp.get(r.episodeId) || { sum: 0, count: 0 };
    cur.sum += stars;
    cur.count += 1;
    statsByEp.set(r.episodeId, cur);
  }

  for (const comic of comics || []) {
    let comicSum = 0;
    let comicCount = 0;
    for (const ch of comic.chapters || []) {
      for (const ep of ch.episodes || []) {
        const st = statsByEp.get(ep.id);
        if (st && st.count > 0) {
          ep.totalRatings = st.count;
          ep.averageRating = Number((st.sum / st.count).toFixed(1));
          comicSum += st.sum;
          comicCount += st.count;
        } else {
          ep.totalRatings = 0;
          ep.averageRating = 0;
        }
      }
    }
    if (comicCount > 0) {
      comic.averageRating = Number((comicSum / comicCount).toFixed(1));
    }
  }
}

export async function persistSnapshotChangesToFirestore(params: {
  snapshot: DatabaseSchema;
  users?: User[];
  comics?: Comic[];
  changedComments?: Comment[];
  changedRatings?: Rating[];
  deletedComicIds?: string[];
  deletedUserIds?: string[];
  deletedCommentIds?: string[];
  deletedRatingIds?: string[];
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

  const assetWrites: CommitWriteItem[] = [];
  const docWrites: CommitWriteItem[] = [];
  const publicMirrorWrites: CommitWriteItem[] = [];
  const compactCallbacks: Array<() => void> = [];

  const targetUsers = params.fullVaultSync ? params.snapshot.users || [] : params.users || [];
  const targetComics = params.fullVaultSync ? params.snapshot.comics || [] : params.comics || [];
  const targetCollections = params.fullVaultSync ? ALL_VAULT_COLLECTION_KEYS : params.collections || [];

  for (const u of targetUsers) {
    const built = buildFullUserVaultWriteItems(u);
    assetWrites.push(...built.assetWrites);
    docWrites.push(...built.docWrites);
    const pubUserWrites = buildUserWriteItems(u);
    docWrites.push(...pubUserWrites);
    publicMirrorWrites.push(...pubUserWrites);
  }

  for (const c of targetComics) {
    const built = buildFullComicVaultWriteItems(c);
    assetWrites.push(...built.assetWrites);
    docWrites.push(...built.docWrites);
    const pubComicWrites = buildComicAndEpisodeWriteItems(c);
    docWrites.push(...pubComicWrites);
    publicMirrorWrites.push(...pubComicWrites);
    compactCallbacks.push(built.compactComicInPlace);
  }

  // Build episodeId -> comicId map for normalized /comments and /ratings writes
  const comicEpisodeLookup = new Map<string, string>();
  for (const c of params.snapshot.comics || []) {
    for (const ch of c.chapters || []) {
      for (const ep of ch.episodes || []) {
        comicEpisodeLookup.set(ep.id, c.id);
      }
    }
  }

  if (targetCollections.length > 0) {
    docWrites.push(...buildVaultCollectionWrites(params.snapshot, targetCollections));
  }

  // Always mirror normalized /comments/{commentId} documents to Firestore
  const commentsToMirror: Comment[] = [];
  if (Array.isArray(params.changedComments) && params.changedComments.length > 0) {
    commentsToMirror.push(...params.changedComments);
  } else if (targetCollections.includes('comments')) {
    for (const c of params.snapshot.comments || []) {
      commentsToMirror.push(c);
      if (Array.isArray(c.replies)) {
        for (const rep of c.replies) {
          commentsToMirror.push(rep);
        }
      }
    }
  }
  for (const comment of commentsToMirror) {
    const comicId = comicEpisodeLookup.get(comment.episodeId) || params.snapshot.comics[0]?.id || 'platform_comic';
    const commentWrite = buildCommentWriteItem(comment, comicId);
    docWrites.push(commentWrite);
    publicMirrorWrites.push(commentWrite);
  }

  // Always mirror normalized /ratings/{ratingId} documents to Firestore
  const ratingsToMirror: Rating[] =
    Array.isArray(params.changedRatings) && params.changedRatings.length > 0
      ? params.changedRatings
      : targetCollections.includes('ratings')
        ? params.snapshot.ratings || []
        : [];
  for (const rating of ratingsToMirror) {
    const comicId = comicEpisodeLookup.get(rating.episodeId) || params.snapshot.comics[0]?.id || 'platform_comic';
    const ratingWrite = buildRatingWriteItem(rating, comicId);
    docWrites.push(ratingWrite);
    publicMirrorWrites.push(ratingWrite);
  }

  // Delete removed comics / users / comments / ratings in vault & public mirror
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
  for (const delCommentId of params.deletedCommentIds || []) {
    const safeCommentId = sanitizeFirestoreId(delCommentId);
    await deleteFirestoreDoc(`comments/${safeCommentId}`, params.userFirebaseIdToken).catch(() => false);
  }
  for (const delRatingId of params.deletedRatingIds || []) {
    const safeRatingId = sanitizeFirestoreId(delRatingId);
    await deleteFirestoreDoc(`ratings/${safeRatingId}`, params.userFirebaseIdToken).catch(() => false);
  }

  // When authenticated via end-user Firebase ID token (without server IAM ADC),
  // write directly to schema-validated public /comics, /episodes, /users, /comments & /ratings collections allowed by firestore.rules.
  if (authCtx.mode === 'firebase_id_token') {
    const pubRes = await commitFirestoreWrites(publicMirrorWrites, params.userFirebaseIdToken);
    lastCloudSyncStatus = {
      ok: pubRes.success,
      mode: pubRes.mode,
      revision: lastCloudSyncStatus.revision,
      lastHydratedAt: lastCloudSyncStatus.lastHydratedAt,
      lastSyncedAt: pubRes.success ? new Date().toISOString() : lastCloudSyncStatus.lastSyncedAt,
      error: pubRes.error,
    };
    return {
      persisted: pubRes.success,
      mode: pubRes.mode,
      written: pubRes.written,
      revision: lastCloudSyncStatus.revision,
      error: pubRes.error,
    };
  }

  // Step 1: Commit large image asset chunks FIRST so server_comics never references missing chunks
  let totalWritten = 0;
  if (assetWrites.length > 0) {
    const assetCommit = await commitFirestoreWrites(assetWrites, params.userFirebaseIdToken);
    totalWritten += assetCommit.written;
    if (!assetCommit.success) {
      lastCloudSyncStatus = {
        ...lastCloudSyncStatus,
        ok: false,
        mode: assetCommit.mode,
        error: assetCommit.error,
      };
      console.warn(`[FirestoreVault] Asset chunk commit failed (${assetCommit.mode}):`, assetCommit.error);
      return {
        persisted: false,
        mode: assetCommit.mode,
        written: totalWritten,
        revision: lastCloudSyncStatus.revision,
        error: assetCommit.error,
      };
    }
  }

  const nextRevision =
    typeof params.revision === 'number' && params.revision > 0
      ? params.revision
      : Math.max(Date.now(), (lastCloudSyncStatus.revision || 0) + 1);

  docWrites.push({
    docPath: 'server_meta/sync_state',
    fields: {
      revision: nextRevision,
      updatedAt: new Date().toISOString(),
      usersCount: (params.snapshot.users || []).length,
      comicsCount: (params.snapshot.comics || []).length,
    },
  });

  // Step 2: Commit metadata documents (server_comics, comics, episodes, users, collections, sync_state)
  const commitRes = await commitFirestoreWrites(docWrites, params.userFirebaseIdToken);
  totalWritten += commitRes.written;

  // Compact in-memory comic base64 strings to lightweight /api/comic-assets/... URLs ONLY after durable cloud commit succeeds
  if (commitRes.success && compactCallbacks.length > 0) {
    for (const compactFn of compactCallbacks) {
      try {
        compactFn();
      } catch {
        // Ignore compaction errors
      }
    }
  }

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
    written: totalWritten,
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

  // Even in public_api_key mode (e.g. local sandbox without ADC), recover published comics, comments & ratings from Firestore
  if (authCtx.mode === 'public_api_key' || !authCtx.bearerToken) {
    const [publicComics, publicEngagement] = await Promise.all([
      fetchPublishedComicsCatalogFromFirestore().catch(() => [] as Comic[]),
      fetchPublicCommentsAndRatingsFromFirestore().catch(() => ({ comments: [] as Comment[], ratings: [] as Rating[] })),
    ]);
    lastCloudSyncStatus = {
      ...lastCloudSyncStatus,
      ok: false,
      mode: authCtx.mode,
    };
    const mergedMap = new Map<string, Comic>();
    for (const localComic of fallbackData.comics || []) {
      mergedMap.set(localComic.id, localComic);
    }
    for (const pubComic of publicComics) {
      if (!mergedMap.has(pubComic.id)) {
        mergedMap.set(pubComic.id, pubComic);
      }
    }
    const mergedComics = Array.from(mergedMap.values()).sort(
      (a, b) =>
        new Date(b.createdAt || b.updatedAt || 0).getTime() -
        new Date(a.createdAt || a.updatedAt || 0).getTime()
    );
    const mergedComments = mergeCommentsById(fallbackData.comments || [], publicEngagement.comments);
    const mergedRatings = mergeRatingsById(fallbackData.ratings || [], publicEngagement.ratings);
    applyRatingsToComics(mergedComics, mergedRatings);

    if (publicComics.length > 0 || publicEngagement.comments.length > 0 || publicEngagement.ratings.length > 0) {
      return {
        hydrated: true,
        seeded: false,
        revision: 0,
        mode: authCtx.mode,
        data: {
          ...fallbackData,
          comics: mergedComics,
          comments: mergedComments,
          ratings: mergedRatings,
        },
      };
    }
    return {
      hydrated: false,
      seeded: false,
      revision: 0,
      mode: authCtx.mode,
      data: {
        ...fallbackData,
        comics: mergedComics,
        comments: mergedComments,
        ratings: mergedRatings,
      },
    };
  }

  // IMPORTANT: Fetch ONLY lightweight metadata collections (NEVER list all of server_comic_assets!).
  // Comic cover & page image chunks are fetched on-demand via /api/comic-assets/:assetKey with LRU caching.
  const [syncMetaDoc, usersRes, comicsRes, collectionsRes, publicComics, publicEngagement] = await Promise.all([
    fetchFirestoreDocument('server_meta/sync_state', authCtx.bearerToken, 12_000),
    listFirestoreCollection('server_users', userFirebaseIdToken, { pageSize: 100, timeoutMs: 20_000 }),
    listFirestoreCollection('server_comics', userFirebaseIdToken, { pageSize: 50, timeoutMs: 20_000 }),
    listFirestoreCollection('server_collections', userFirebaseIdToken, { pageSize: 50, timeoutMs: 20_000 }),
    fetchPublishedComicsCatalogFromFirestore(userFirebaseIdToken).catch(() => [] as Comic[]),
    fetchPublicCommentsAndRatingsFromFirestore(userFirebaseIdToken).catch(() => ({
      comments: [] as Comment[],
      ratings: [] as Rating[],
    })),
  ]);

  // If ALL vault collections failed, fall back gracefully while preserving any recovered public comics, comments & ratings
  if (!usersRes.ok && !comicsRes.ok && !collectionsRes.ok) {
    const err = usersRes.error || comicsRes.error || collectionsRes.error;
    lastCloudSyncStatus = {
      ...lastCloudSyncStatus,
      ok: false,
      mode: authCtx.mode,
      error: err,
    };
    const mergedMap = new Map<string, Comic>();
    for (const c of fallbackData.comics || []) mergedMap.set(c.id, c);
    for (const c of publicComics) {
      if (!mergedMap.has(c.id)) mergedMap.set(c.id, c);
    }
    const mergedComics = Array.from(mergedMap.values());
    const mergedComments = mergeCommentsById(fallbackData.comments || [], publicEngagement.comments);
    const mergedRatings = mergeRatingsById(fallbackData.ratings || [], publicEngagement.ratings);
    applyRatingsToComics(mergedComics, mergedRatings);

    if (publicComics.length > 0 || publicEngagement.comments.length > 0 || publicEngagement.ratings.length > 0) {
      return {
        hydrated: true,
        seeded: false,
        revision: 0,
        mode: authCtx.mode,
        data: {
          ...fallbackData,
          comics: mergedComics,
          comments: mergedComments,
          ratings: mergedRatings,
        },
        error: err,
      };
    }
    return {
      hydrated: false,
      seeded: false,
      revision: 0,
      mode: authCtx.mode,
      data: fallbackData,
      error: err,
    };
  }

  const allVaultListsOk = usersRes.ok && comicsRes.ok && collectionsRes.ok;
  const hasCloudData =
    Boolean(syncMetaDoc) ||
    usersRes.docs.length > 0 ||
    comicsRes.docs.length > 0 ||
    collectionsRes.docs.length > 0 ||
    publicComics.length > 0;

  // First-ever boot on truly empty Firestore project: seed cloud vault ONLY when ALL lists succeeded AND zero comics exist anywhere
  if (!hasCloudData && allVaultListsOk) {
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

  const nextData: DatabaseSchema = {
    ...fallbackData,
  };

  // 1. Restore users (convert any asset:// avatar pointers to fast on-demand HTTP URLs)
  if (usersRes.ok && usersRes.docs.length > 0) {
    const restoredUsers: User[] = [];
    for (const docItem of usersRes.docs) {
      const payload = docItem.fields.payload as Record<string, unknown> | undefined;
      if (!payload || typeof payload !== 'object') continue;
      const userObj = { ...(payload as unknown as User) };
      if (typeof userObj.avatar === 'string' && userObj.avatar.startsWith(ASSET_PTR_PREFIX)) {
        userObj.avatar = assetPointerToHttpUrl(userObj.avatar) || userObj.avatar;
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

  // 2. Restore comics from server_comics with fast on-demand /api/comic-assets/... URLs
  const restoredComicMap = new Map<string, Comic>();
  if (comicsRes.ok) {
    for (const docItem of comicsRes.docs) {
      const payload = docItem.fields.payload as Record<string, unknown> | undefined;
      if (!payload || typeof payload !== 'object') continue;
      const cleanSampleCover = (url?: string): string => {
        if (!url || typeof url !== 'string') return '';
        return /^\/src\/assets\/images\/comic_cover_/i.test(url.trim()) ? '' : url;
      };
      const comicObj = { ...(payload as unknown as Comic) };
      comicObj.coverImage = cleanSampleCover(
        assetPointerToHttpUrl(comicObj.coverImage) || comicObj.coverImage || ''
      );

      if (typeof comicObj.bannerImage === 'string' && comicObj.bannerImage.startsWith(ASSET_PTR_PREFIX)) {
        comicObj.bannerImage = assetPointerToHttpUrl(comicObj.bannerImage) || comicObj.bannerImage;
      }

      if (Array.isArray(comicObj.attachedPages)) {
        comicObj.attachedPages = comicObj.attachedPages.map((p) => ({
          ...p,
          imageUrl: cleanSampleCover(assetPointerToHttpUrl(p.imageUrl) || p.imageUrl),
        }));
      }

      comicObj.chapters = (comicObj.chapters || []).map((ch) => ({
        ...ch,
        episodes: (ch.episodes || []).map((ep) => ({
          ...ep,
          coverImage: cleanSampleCover(assetPointerToHttpUrl(ep.coverImage) || ep.coverImage),
          pages: (ep.pages || []).map((pg) => ({
            ...pg,
            imageUrl: cleanSampleCover(assetPointerToHttpUrl(pg.imageUrl) || pg.imageUrl),
          })),
        })),
      }));

      restoredComicMap.set(comicObj.id, comicObj);
    }
  } else {
    // If server_comics list transiently failed, preserve existing local comics rather than wiping them
    for (const localComic of fallbackData.comics || []) {
      restoredComicMap.set(localComic.id, localComic);
    }
  }

  // Merge any published comics present in Firestore /comics that were missing from server_comics (zero data loss)
  for (const pubComic of publicComics) {
    if (!restoredComicMap.has(pubComic.id)) {
      restoredComicMap.set(pubComic.id, pubComic);
    }
  }

  // Anti-wipe guard: never replace non-empty local comics with [] unless cloud explicitly confirmed comicsCount === 0
  const cloudExplicitlyZeroComics =
    comicsRes.ok &&
    Boolean(syncMetaDoc) &&
    Number(syncMetaDoc?.comicsCount) === 0 &&
    publicComics.length === 0;
  if (restoredComicMap.size === 0 && (fallbackData.comics || []).length > 0 && !cloudExplicitlyZeroComics) {
    for (const localComic of fallbackData.comics || []) {
      restoredComicMap.set(localComic.id, localComic);
    }
  }

  const restoredComics = Array.from(restoredComicMap.values()).sort(
    (a, b) =>
      new Date(b.createdAt || b.updatedAt || 0).getTime() -
      new Date(a.createdAt || a.updatedAt || 0).getTime()
  );
  nextData.comics = restoredComics;

  // 3. Restore collections and merge normalized Firestore /comments & /ratings
  if (collectionsRes.ok) {
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
  }

  // Merge any comments/ratings written directly to normalized Firestore /comments and /ratings collections
  nextData.comments = mergeCommentsById(nextData.comments || [], publicEngagement.comments);
  nextData.ratings = mergeRatingsById(nextData.ratings || [], publicEngagement.ratings);
  applyRatingsToComics(nextData.comics, nextData.ratings);

  const revision = Number(syncMetaDoc?.revision) || 1;
  const partialError = !allVaultListsOk
    ? usersRes.error || comicsRes.error || collectionsRes.error
    : undefined;

  lastCloudSyncStatus = {
    ok: allVaultListsOk,
    mode: authCtx.mode,
    revision,
    lastHydratedAt: new Date().toISOString(),
    lastSyncedAt: lastCloudSyncStatus.lastSyncedAt,
    error: partialError,
  };

  return {
    hydrated: true,
    seeded: false,
    revision,
    mode: authCtx.mode,
    data: nextData,
    error: partialError,
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
