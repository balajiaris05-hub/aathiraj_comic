import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  setLogLevel,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Suppress internal @firebase/firestore WebChannel transport timeout warnings in iframe environments
try {
  setLogLevel('silent');
} catch {
  // ignore
}

const app = initializeApp(firebaseConfig);
export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
})();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export {
  firebaseConfig,
  onAuthStateChanged,
  signOut,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
};
export type { FirebaseUser };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.warn('Firestore Operation Notice: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot without triggering fatal console.error overlays on offline/permission checks
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.info('Firestore client operating in offline-capable mode.');
    }
  }
}
testConnection();

// Sanitize ID to match ^[a-zA-Z0-9_\-]+$ and length 1..128
export function sanitizeFirestoreId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'doc_default';
}

/**
 * Retrieve the current Firebase ID Token if a Firebase user is signed in
 */
export async function getCurrentFirebaseIdToken(): Promise<string | null> {
  try {
    if (auth.currentUser) {
      return await auth.currentUser.getIdToken();
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Sign in with Google Popup via Firebase Auth and sync the reader's public & isolated private
 * records (Gmail, Age, Mobile, UPI ID, Paid Detail of Premium) into Firestore (`aathiraicomic`).
 */
export async function signInWithGoogleAndSyncToFirestore(options: {
  age?: number;
  phone?: string;
  upiId?: string;
  paidPlan?: 'free' | '1_month' | '6_months';
  paymentMethod?: string;
  transactionId?: string;
}) {
  const cred = await signInWithPopup(auth, googleProvider);
  const fbUser = cred.user;
  await syncReaderAccountToFirestore({
    uid: fbUser.uid,
    name: fbUser.displayName || (fbUser.email ? fbUser.email.split('@')[0] : 'Reader'),
    email: fbUser.email || '',
    age: options.age || 0,
    phone: options.phone || 'Not provided',
    upiId: options.upiId || 'Not provided',
    paidPlan: options.paidPlan || 'free',
    paymentMethod: options.paymentMethod || 'UPI (Google Pay / PhonePe)',
    transactionId: options.transactionId || 'UPI-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
  });
  return fbUser;
}

/**
 * Syncs a reader's public profile (/users/{uid}) and isolated PII + UPI + Paid Plan
 * (/users/{uid}/private/info) to Firestore when authenticated with Firebase Auth.
 */
export async function syncReaderAccountToFirestore(params: {
  uid?: string;
  name: string;
  email: string;
  age: number;
  phone: string;
  upiId: string;
  paidPlan: 'free' | '1_month' | '6_months';
  paymentMethod?: string;
  transactionId?: string;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return null;
  }

  const targetUid = sanitizeFirestoreId(params.uid || currentUser.uid);
  const safeName = (params.name || 'Reader').trim().slice(0, 80) || 'Reader';
  const safeEmail = (params.email || currentUser.email || '').trim().slice(0, 120);
  const safePhone = (params.phone || 'Not provided').trim().slice(0, 32);
  const safeUpiId = (params.upiId || 'Not provided').trim().slice(0, 100);
  const safeAge = Number(params.age) >= 5 ? Math.min(110, Math.round(Number(params.age))) : 18;
  const safePlan: 'free' | '1_month' | '6_months' =
    params.paidPlan === '6_months' ? '6_months' : params.paidPlan === '1_month' ? '1_month' : 'free';
  const safePaymentMethod = (params.paymentMethod || 'UPI (Google Pay / PhonePe)').trim().slice(0, 80);
  const safeTxId = (
    params.transactionId ||
    'UPI-' + Math.random().toString(36).substring(2, 10).toUpperCase()
  )
    .trim()
    .slice(0, 80);
  const amountPaidInr = safePlan === '6_months' ? 249 : safePlan === '1_month' ? 49 : 0;

  // 1. Upsert /users/{targetUid}
  const publicPath = `users/${targetUid}`;
  const publicRef = doc(db, 'users', targetUid);
  try {
    const existingPublic = await getDoc(publicRef);
    if (!existingPublic.exists()) {
      await setDoc(publicRef, {
        userId: targetUid,
        name: safeName,
        role: 'reader',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(publicRef, {
        name: safeName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, publicPath);
  }

  // 2. Upsert /users/{targetUid}/private/info (Isolated PII, UPI ID & Paid Detail of Premium)
  const privatePath = `users/${targetUid}/private/info`;
  const privateRef = doc(db, 'users', targetUid, 'private', 'info');
  try {
    const existingPrivate = await getDoc(privateRef);
    if (!existingPrivate.exists()) {
      await setDoc(privateRef, {
        userId: targetUid,
        email: safeEmail,
        phone: safePhone,
        upiId: safeUpiId,
        age: safeAge,
        premiumPlan: safePlan,
        paymentMethod: safePaymentMethod,
        transactionId: safeTxId,
        amountPaidInr,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(privateRef, {
        email: safeEmail,
        phone: safePhone,
        upiId: safeUpiId,
        age: safeAge,
        premiumPlan: safePlan,
        paymentMethod: safePaymentMethod,
        transactionId: safeTxId,
        amountPaidInr,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }

  return { targetUid, safeEmail, safeUpiId, safePlan, amountPaidInr };
}

/**
 * Records a completed customer UPI / Razorpay purchase in Firestore (/purchases/{purchaseId})
 * when the buyer is authenticated with Firebase Auth.
 */
export async function syncPurchaseToFirestore(params: {
  purchaseId: string;
  comicId: string;
  itemTitle: string;
  planType: '1_month' | '6_months' | 'episode' | 'chapter' | 'full_comic';
  amountInr: number;
  upiId?: string;
  paymentMethod: string;
  receiptNumber: string;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return null;
  }

  const uid = sanitizeFirestoreId(currentUser.uid);
  const purchaseId = sanitizeFirestoreId(params.purchaseId);
  const comicId = sanitizeFirestoreId(params.comicId || 'premium_pass');

  // Ensure /users/{uid} exists before creating /purchases/{purchaseId}
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        userId: uid,
        name: (currentUser.displayName || currentUser.email?.split('@')[0] || 'Reader').slice(0, 80),
        role: 'reader',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }

  const purchasePath = `purchases/${purchaseId}`;
  try {
    await setDoc(doc(db, 'purchases', purchaseId), {
      purchaseId,
      userId: uid,
      comicId,
      itemTitle: (params.itemTitle || 'Premium Pass').slice(0, 140),
      planType: params.planType,
      amountInr: Math.min(50000, Math.max(1, Number(params.amountInr) || 49)),
      upiId: (params.upiId || 'Not provided').slice(0, 100),
      paymentMethod: (params.paymentMethod || 'UPI').slice(0, 80),
      receiptNumber: (params.receiptNumber || 'INV-1001').slice(0, 64),
      status: 'success',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, purchasePath);
  }
}

/**
 * 1-Click Admin Sync: Signs in with Google (if not already signed in) and migrates all
 * Reader Accounts (with isolated PII, UPI IDs & Paid Plans) and Comics into Firestore (`aathiraicomic`).
 */
export async function syncAllPlatformDataToFirestore(params: {
  readers: any[];
  comics: any[];
  purchases?: any[];
  authorApplications?: any[];
  deleteRequests?: any[];
  reports?: any[];
  notifications?: any[];
  gstSettings?: any;
  platformSettings?: any;
}) {
  let currentUser = auth.currentUser;
  if (!currentUser) {
    const cred = await signInWithPopup(auth, googleProvider);
    currentUser = cred.user;
  }

  const { syncFullPlatformSnapshotToFirestore } = await import('./services/firestoreBackend');
  return syncFullPlatformSnapshotToFirestore(params);
}

/**
 * Syncs the Administrator's Business GST Settings into Firestore (`/gstSettings/business_profile`)
 * when authenticated as an administrator.
 */
export async function syncGstSettingsToFirestore(params: {
  legalBusinessName: string;
  tradeName: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  registeredAddress: string;
  invoicePrefix: string;
  defaultSacCode: string;
  applicableGstRate: number;
  updatedByEmail?: string;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return null;
  }

  const settingId = 'business_profile';
  const ref = doc(db, 'gstSettings', settingId);
  const path = `gstSettings/${settingId}`;

  const payload = {
    settingId,
    legalBusinessName: (params.legalBusinessName || 'Aathirai Media & Publishing Pvt Ltd').trim().slice(0, 140),
    tradeName: (params.tradeName || 'Aathirai_Comic').trim().slice(0, 100),
    gstin: (params.gstin || '').trim().toUpperCase().slice(0, 15),
    stateCode: (params.stateCode || '33').trim().padStart(2, '0').slice(0, 2),
    stateName: (params.stateName || 'Tamil Nadu').trim().slice(0, 80),
    registeredAddress: (params.registeredAddress || 'Chennai, Tamil Nadu, India').trim().slice(0, 300),
    invoicePrefix: (params.invoicePrefix || 'AAC/2627/').trim().slice(0, 12),
    defaultSacCode: (params.defaultSacCode || '998431').trim().slice(0, 10),
    applicableGstRate: Math.min(28, Math.max(0, Number(params.applicableGstRate) || 18)),
    updatedByEmail: (params.updatedByEmail || currentUser.email || 'balajiaris05@gmail.com').trim().slice(0, 120),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

