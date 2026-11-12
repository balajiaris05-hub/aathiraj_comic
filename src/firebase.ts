import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { firebaseConfig, onAuthStateChanged, signOut };
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
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
    email: fbUser.email || 'reader@gmail.com',
    age: options.age || 24,
    phone: options.phone || '+91 8610950780',
    upiId: options.upiId || 'balajiaris05@okaxis',
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
  const safeEmail = (params.email || currentUser.email || 'reader@gmail.com').trim().slice(0, 120);
  const safePhone = (params.phone || '+91 8610950780').trim().slice(0, 32);
  const safeUpiId = (params.upiId || 'balajiaris05@okaxis').trim().slice(0, 100);
  const safeAge = Math.min(110, Math.max(5, Number(params.age) || 24));
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
      upiId: (params.upiId || 'balajiaris05@okaxis').slice(0, 100),
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
 * 1-Click Admin Sync: Signs in with Google (if not already signed in) and stores all
 * Reader Accounts (with UPI IDs & Paid Plans) and Comics into Firestore (`aathiraicomic`).
 */
export async function syncAllPlatformDataToFirestore(params: {
  readers: any[];
  comics: any[];
}) {
  let currentUser = auth.currentUser;
  if (!currentUser) {
    const cred = await signInWithPopup(auth, googleProvider);
    currentUser = cred.user;
  }

  let syncedReaders = 0;
  let syncedComics = 0;

  for (const r of params.readers) {
    const uid = sanitizeFirestoreId(r.id || currentUser.uid);
    await syncReaderAccountToFirestore({
      uid,
      name: r.name || 'Reader',
      email: r.email || 'reader@gmail.com',
      age: Number(r.age) || 24,
      phone: r.phone || '+91 8610950780',
      upiId: r.upiId || r.subscription?.upiId || 'balajiaris05@okaxis',
      paidPlan:
        r.subscription?.plan === '6_months'
          ? '6_months'
          : r.subscription?.plan === '1_month'
            ? '1_month'
            : 'free',
      paymentMethod: r.subscription?.paymentMethod || 'UPI',
      transactionId: r.subscription?.receiptNumber || 'UPI-SYNC',
    });
    syncedReaders++;
  }

  for (const c of params.comics) {
    const comicId = sanitizeFirestoreId(c.id || 'comic_default');
    const authorId = sanitizeFirestoreId(c.authorId || currentUser.uid);

    // Ensure author exists in /users/{authorId}
    const authorRef = doc(db, 'users', authorId);
    const authorSnap = await getDoc(authorRef);
    if (!authorSnap.exists()) {
      await setDoc(authorRef, {
        userId: authorId,
        name: (c.authorName || 'Creator').slice(0, 80),
        role: 'author',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const comicRef = doc(db, 'comics', comicId);
    const comicSnap = await getDoc(comicRef);
    if (!comicSnap.exists()) {
      await setDoc(comicRef, {
        comicId,
        title: (c.title || 'Untitled Comic').slice(0, 140),
        authorId,
        authorName: (c.authorName || 'Creator').slice(0, 80),
        genre: (c.genre || 'Action').slice(0, 50),
        accessType: c.accessType === 'premium' ? 'premium' : 'free',
        fullUnlockPriceInr: Math.min(10000, Math.max(0, Number(c.fullUnlockPriceInr) || 0)),
        status: c.status === 'pending' ? 'pending' : c.status === 'rejected' ? 'rejected' : 'published',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(comicRef, {
        title: (c.title || 'Untitled Comic').slice(0, 140),
        genre: (c.genre || 'Action').slice(0, 50),
        accessType: c.accessType === 'premium' ? 'premium' : 'free',
        fullUnlockPriceInr: Math.min(10000, Math.max(0, Number(c.fullUnlockPriceInr) || 0)),
        status: c.status === 'pending' ? 'pending' : c.status === 'rejected' ? 'rejected' : 'published',
        updatedAt: serverTimestamp(),
      });
    }
    syncedComics++;
  }

  return { syncedReaders, syncedComics, adminEmail: currentUser.email };
}
