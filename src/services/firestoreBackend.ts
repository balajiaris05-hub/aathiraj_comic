import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import {
  db,
  auth,
  handleFirestoreError,
  OperationType,
  sanitizeFirestoreId,
} from '../firebase';
import type {
  Comic,
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

function ensureVerifiedUser() {
  const u = auth.currentUser;
  if (!u || !u.emailVerified) return null;
  return u;
}

const adminUidCache = new Map<string, boolean>();

async function checkIsFirestoreAdmin(uid: string): Promise<boolean> {
  if (!uid) return false;
  if (adminUidCache.has(uid)) return Boolean(adminUidCache.get(uid));
  try {
    const safeId = sanitizeFirestoreId(uid);
    const snap = await getDoc(doc(db, 'admins', safeId));
    const isAdmin = snap.exists();
    adminUidCache.set(uid, isAdmin);
    return isAdmin;
  } catch {
    return false;
  }
}

// =============================================================================
// 1. USERS & ISOLATED PRIVATE INFO (/users/{userId} & /users/{userId}/private/info)
// =============================================================================

export async function upsertUserAndPrivateInfoInFirestore(params: {
  uid: string;
  name: string;
  role?: 'reader' | 'author' | 'admin';
  email: string;
  phone?: string;
  upiId?: string;
  age?: number;
  paidPlan?: 'free' | '1_month' | '6_months';
  paymentMethod?: string;
  transactionId?: string;
}) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const userId = sanitizeFirestoreId(params.uid || currentUser.uid);
  const safeName = (params.name || 'Reader').trim().slice(0, 80) || 'Reader';
  const safeRole: 'reader' | 'author' | 'admin' =
    params.role === 'admin' ? 'admin' : params.role === 'author' ? 'author' : 'reader';
  const isAdminSession = await checkIsFirestoreAdmin(currentUser.uid);
  const safeEmail = (params.email || currentUser.email || 'reader@gmail.com').trim().slice(0, 120);
  const safePhone = (params.phone && params.phone.trim().length >= 3 ? params.phone.trim() : 'Not provided').slice(0, 32);
  const safeUpiId = (params.upiId && params.upiId.trim().length >= 3 ? params.upiId.trim() : 'Not provided').slice(0, 100);
  const safeAge = Math.min(110, Math.max(5, Number(params.age) || 24));
  const safePlan: 'free' | '1_month' | '6_months' =
    params.paidPlan === '6_months' ? '6_months' : params.paidPlan === '1_month' ? '1_month' : 'free';
  const safePaymentMethod = (params.paymentMethod || 'UPI (Google Pay / PhonePe)').trim().slice(0, 80);
  const safeTxId = (params.transactionId || `UPI-${userId.slice(0, 12)}`).trim().slice(0, 80);
  const amountPaidInr = safePlan === '6_months' ? 249 : safePlan === '1_month' ? 49 : 0;

  const userPath = `users/${userId}`;
  const userRef = doc(db, 'users', userId);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        userId,
        name: safeName,
        role: isAdminSession ? safeRole : 'reader',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        name: safeName,
        ...(isAdminSession ? { role: safeRole } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  const privatePath = `users/${userId}/private/info`;
  const privateRef = doc(db, 'users', userId, 'private', 'info');
  try {
    const privSnap = await getDoc(privateRef);
    if (!privSnap.exists()) {
      await setDoc(privateRef, {
        userId,
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

  return { userId, safeEmail, safePlan, amountPaidInr };
}

export async function ensurePublicUserProfileExists(userIdRaw: string, name: string, role: 'reader' | 'author' | 'admin' = 'author') {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;
  const isAdminSession = await checkIsFirestoreAdmin(currentUser.uid);
  const userId = sanitizeFirestoreId(userIdRaw);
  const userPath = `users/${userId}`;
  const ref = doc(db, 'users', userId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userId,
        name: (name || 'Creator').trim().slice(0, 80) || 'Creator',
        role: isAdminSession ? role : 'reader',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
  return userId;
}

// =============================================================================
// 2. COMICS & NESTED EPISODES (/comics/{comicId} & /comics/{comicId}/episodes/{episodeId})
// =============================================================================

export async function upsertComicAndEpisodesInFirestore(comic: Comic) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const comicId = sanitizeFirestoreId(comic.id);
  const authorId = sanitizeFirestoreId(comic.authorId || currentUser.uid);
  await ensurePublicUserProfileExists(authorId, comic.authorName || 'Creator', 'author');

  const genreStr = (Array.isArray(comic.genre) ? comic.genre.join(', ') : String(comic.genre || 'Action'))
    .trim()
    .slice(0, 50) || 'Action';
  const status: 'pending' | 'published' | 'rejected' =
    comic.moderationStatus === 'pending'
      ? 'pending'
      : comic.moderationStatus === 'rejected'
        ? 'rejected'
        : 'published';

  const comicPath = `comics/${comicId}`;
  const comicRef = doc(db, 'comics', comicId);
  try {
    const existing = await getDoc(comicRef);
    if (!existing.exists()) {
      await setDoc(comicRef, {
        comicId,
        title: (comic.title || 'Untitled Comic').trim().slice(0, 140) || 'Untitled Comic',
        authorId,
        authorName: (comic.authorName || 'Creator').trim().slice(0, 80) || 'Creator',
        genre: genreStr,
        accessType: comic.accessType === 'premium' ? 'premium' : 'free',
        fullUnlockPriceInr: Math.min(10000, Math.max(0, Number(comic.fullPriceInr) || 0)),
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(comicRef, {
        title: (comic.title || 'Untitled Comic').trim().slice(0, 140) || 'Untitled Comic',
        genre: genreStr,
        accessType: comic.accessType === 'premium' ? 'premium' : 'free',
        fullUnlockPriceInr: Math.min(10000, Math.max(0, Number(comic.fullPriceInr) || 0)),
        status,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, comicPath);
  }

  let episodesSynced = 0;
  for (const ch of comic.chapters || []) {
    const chapterId = sanitizeFirestoreId(ch.id);
    const chapterNumber = Math.min(5000, Math.max(1, Number(ch.chapterNumber) || 1));
    const chapterTitle = (ch.title || `Chapter ${chapterNumber}`).trim().slice(0, 140);
    for (const ep of ch.episodes || []) {
      const episodeId = sanitizeFirestoreId(ep.id);
      const epPath = `comics/${comicId}/episodes/${episodeId}`;
      const epRef = doc(db, 'comics', comicId, 'episodes', episodeId);
      const epStatus: 'pending' | 'published' | 'rejected' =
        ep.isPublished === false ? 'pending' : status;

      try {
        const epSnap = await getDoc(epRef);
        if (!epSnap.exists()) {
          await setDoc(epRef, {
            episodeId,
            comicId,
            chapterId,
            chapterNumber,
            chapterTitle,
            episodeNumber: Math.min(10000, Math.max(1, Number(ep.episodeNumber) || 1)),
            title: (ep.title || 'Episode').trim().slice(0, 140),
            authorId,
            isPremium: Boolean(ep.isPremium),
            priceInr: Math.min(10000, Math.max(0, Number(ep.priceInr) || 0)),
            pagesCount: Math.min(500, Math.max(0, ep.pages?.length || 0)),
            status: epStatus,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(epRef, {
            chapterId,
            chapterNumber,
            chapterTitle,
            episodeNumber: Math.min(10000, Math.max(1, Number(ep.episodeNumber) || 1)),
            title: (ep.title || 'Episode').trim().slice(0, 140),
            isPremium: Boolean(ep.isPremium),
            priceInr: Math.min(10000, Math.max(0, Number(ep.priceInr) || 0)),
            pagesCount: Math.min(500, Math.max(0, ep.pages?.length || 0)),
            status: epStatus,
            updatedAt: serverTimestamp(),
          });
        }
        episodesSynced++;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, epPath);
      }
    }
  }

  return { comicId, episodesSynced };
}

export async function fetchPublishedComicsFromFirestore(): Promise<Record<string, unknown>[]> {
  const path = 'comics';
  try {
    const q = query(collection(db, path), where('status', '==', 'published'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeToPublishedComics(
  onUpdate: (comics: Record<string, unknown>[]) => void
): Unsubscribe {
  const path = 'comics';
  const q = query(collection(db, path), where('status', '==', 'published'));
  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => d.data()));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// =============================================================================
// 3. ENGAGEMENT COLLECTIONS (/comments, /ratings, /votes, /reports)
// =============================================================================

export async function upsertCommentInFirestore(comment: Comment, comicIdRaw: string) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const commentId = sanitizeFirestoreId(comment.id);
  const comicId = sanitizeFirestoreId(comicIdRaw);
  const episodeId = sanitizeFirestoreId(comment.episodeId);
  const userId = sanitizeFirestoreId(currentUser.uid);
  await ensurePublicUserProfileExists(userId, comment.userName || currentUser.displayName || 'Reader', 'reader');

  const path = `comments/${commentId}`;
  const ref = doc(db, 'comments', commentId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        commentId,
        comicId,
        episodeId,
        userId,
        userName: (comment.userName || 'Reader').trim().slice(0, 80) || 'Reader',
        content: (comment.content || 'Nice!').trim().slice(0, 1000) || 'Nice!',
        likesCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        content: (comment.content || 'Nice!').trim().slice(0, 1000) || 'Nice!',
        updatedAt: serverTimestamp(),
      });
    }
    return commentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCommentInFirestore(commentIdRaw: string) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const commentId = sanitizeFirestoreId(commentIdRaw);
  const path = `comments/${commentId}`;
  const ref = doc(db, 'comments', commentId);
  try {
    await deleteDoc(ref);
    return commentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertRatingInFirestore(rating: Rating, comicIdRaw: string) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const ratingId = sanitizeFirestoreId(rating.id);
  const comicId = sanitizeFirestoreId(comicIdRaw);
  const episodeId = sanitizeFirestoreId(rating.episodeId);
  const userId = sanitizeFirestoreId(currentUser.uid);
  await ensurePublicUserProfileExists(userId, currentUser.displayName || 'Reader', 'reader');

  const path = `ratings/${ratingId}`;
  const ref = doc(db, 'ratings', ratingId);
  try {
    const snap = await getDoc(ref);
    const stars = Math.min(5, Math.max(1, Math.round(Number(rating.stars) || 5)));
    if (!snap.exists()) {
      await setDoc(ref, {
        ratingId,
        comicId,
        episodeId,
        userId,
        stars,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        stars,
        updatedAt: serverTimestamp(),
      });
    }
    return ratingId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchEpisodeEngagementFromFirestore(episodeIdRaw: string): Promise<{
  comments: Comment[];
  ratings: Rating[];
}> {
  const episodeId = sanitizeFirestoreId(episodeIdRaw);
  const commentsPath = 'comments';
  const ratingsPath = 'ratings';

  let comments: Comment[] = [];
  let ratings: Rating[] = [];

  try {
    const cQuery = query(
      collection(db, commentsPath),
      where('likesCount', '>=', 0)
    );
    const cSnap = await getDocs(cQuery);
    comments = cSnap.docs
      .map((d) => {
        const raw = d.data() as Record<string, any>;
        const userName = String(raw.userName || 'Comic Reader').trim() || 'Comic Reader';
        const createdAt = raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : new Date().toISOString();
        const updatedAt = raw.updatedAt?.toDate ? raw.updatedAt.toDate().toISOString() : createdAt;
        return {
          id: String(raw.commentId || d.id),
          episodeId: String(raw.episodeId || ''),
          userId: String(raw.userId || 'usr_guest'),
          userName,
          userAvatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userName)}`,
          userRole: 'reader' as const,
          content: String(raw.content || ''),
          createdAt,
          updatedAt,
          likesCount: Math.max(0, Number(raw.likesCount) || 0),
          likedBy: [],
        } as Comment;
      })
      .filter((c) => c.episodeId === episodeId && Boolean(c.content.trim()))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, commentsPath);
  }

  try {
    const rQuery = query(
      collection(db, ratingsPath),
      where('stars', '>=', 1)
    );
    const rSnap = await getDocs(rQuery);
    ratings = rSnap.docs
      .map((d) => {
        const raw = d.data() as Record<string, any>;
        const stars = Math.min(5, Math.max(1, Math.round(Number(raw.stars) || 0)));
        const createdAt = raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : new Date().toISOString();
        const updatedAt = raw.updatedAt?.toDate ? raw.updatedAt.toDate().toISOString() : createdAt;
        return {
          id: String(raw.ratingId || d.id),
          episodeId: String(raw.episodeId || ''),
          userId: String(raw.userId || ''),
          stars,
          createdAt,
          updatedAt,
        } as Rating;
      })
      .filter((r) => r.episodeId === episodeId && Boolean(r.userId && r.stars >= 1));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, ratingsPath);
  }

  return { comments, ratings };
}

export async function upsertVoteInFirestore(vote: Vote, comicIdRaw: string) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const voteId = sanitizeFirestoreId(vote.id);
  const comicId = sanitizeFirestoreId(comicIdRaw);
  const episodeId = sanitizeFirestoreId(vote.episodeId);
  const userId = sanitizeFirestoreId(currentUser.uid);
  await ensurePublicUserProfileExists(userId, currentUser.displayName || 'Reader', 'reader');

  const path = `votes/${voteId}`;
  const ref = doc(db, 'votes', voteId);
  try {
    const snap = await getDoc(ref);
    const voteType = vote.type === 'dislike' ? 'dislike' : 'like';
    if (!snap.exists()) {
      await setDoc(ref, {
        voteId,
        comicId,
        episodeId,
        userId,
        voteType,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        voteType,
        updatedAt: serverTimestamp(),
      });
    }
    return voteId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createReportInFirestore(report: ContentReport) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const reportId = sanitizeFirestoreId(report.id);
  const reporterId = sanitizeFirestoreId(currentUser.uid);
  await ensurePublicUserProfileExists(reporterId, currentUser.displayName || 'Reader', 'reader');

  const path = `reports/${reportId}`;
  const ref = doc(db, 'reports', reportId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        reportId,
        reporterId,
        targetType: report.targetType === 'comic' ? 'comic' : report.targetType === 'episode' ? 'episode' : 'comment',
        targetId: sanitizeFirestoreId(report.targetId),
        reason: (report.reason || 'Content report').trim().slice(0, 300),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return reportId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// =============================================================================
// 4. AUTHOR APPLICATIONS, DELETE REQUESTS, NOTIFICATIONS, PURCHASES, SETTINGS
// =============================================================================

export async function upsertAuthorApplicationInFirestore(app: AuthorApplication) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const applicationId = sanitizeFirestoreId(app.id);
  const userId = sanitizeFirestoreId(app.userId || currentUser.uid);
  await ensurePublicUserProfileExists(userId, app.authorName || 'Creator', app.status === 'approved' ? 'author' : 'reader');

  const path = `authorApplications/${applicationId}`;
  const ref = doc(db, 'authorApplications', applicationId);
  const isAdminSession = await checkIsFirestoreAdmin(currentUser.uid);
  try {
    const snap = await getDoc(ref);
    const status = app.status === 'approved' ? 'approved' : app.status === 'rejected' ? 'rejected' : 'pending';
    if (!snap.exists()) {
      await setDoc(ref, {
        applicationId,
        userId,
        penName: (app.authorName || 'Creator').trim().slice(0, 80) || 'Creator',
        bio: (app.bio || 'Creator bio').trim().slice(0, 600),
        status: isAdminSession ? status : 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        penName: (app.authorName || 'Creator').trim().slice(0, 80) || 'Creator',
        bio: (app.bio || 'Creator bio').trim().slice(0, 600),
        ...(isAdminSession ? { status } : {}),
        updatedAt: serverTimestamp(),
      });
    }
    return applicationId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertDeleteRequestInFirestore(dr: DeleteRequest) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const isAdminSession = await checkIsFirestoreAdmin(currentUser.uid);
  const requestId = sanitizeFirestoreId(dr.id);
  const path = `deleteRequests/${requestId}`;
  const ref = doc(db, 'deleteRequests', requestId);
  try {
    const snap = await getDoc(ref);
    const status = dr.status === 'approved' ? 'approved' : dr.status === 'rejected' ? 'rejected' : 'pending';
    if (!snap.exists()) {
      await setDoc(ref, {
        requestId,
        comicId: sanitizeFirestoreId(dr.comicId),
        comicTitle: (dr.comicTitle || 'Comic').trim().slice(0, 140),
        targetType: dr.targetType === 'chapter' ? 'chapter' : dr.targetType === 'episode' ? 'episode' : 'series',
        authorId: sanitizeFirestoreId(dr.authorId || currentUser.uid),
        authorName: (dr.authorName || 'Creator').trim().slice(0, 80),
        reason: (dr.reason || 'Author deletion request').trim().slice(0, 300),
        status: isAdminSession ? status : 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        reason: (dr.reason || 'Author deletion request').trim().slice(0, 300),
        ...(isAdminSession ? { status } : {}),
        updatedAt: serverTimestamp(),
      });
    }
    return requestId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertPurchaseRecordInFirestore(p: Purchase) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const purchaseId = sanitizeFirestoreId(p.id);
  const userId = sanitizeFirestoreId(p.userId || currentUser.uid);
  await ensurePublicUserProfileExists(userId, p.customerName || 'Reader', 'reader');

  const path = `purchases/${purchaseId}`;
  const ref = doc(db, 'purchases', purchaseId);
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

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        purchaseId,
        userId,
        comicId: sanitizeFirestoreId(p.comicId || 'premium_pass'),
        itemTitle: (p.comicTitle || 'Premium Pass').trim().slice(0, 140),
        planType,
        amountInr: Math.min(50000, Math.max(1, Number(p.amountInr) || 49)),
        upiId: (p.userUpiId || 'Not provided').trim().slice(0, 100),
        paymentMethod: (p.paymentMethod || 'UPI / Razorpay').trim().slice(0, 80),
        receiptNumber: (p.receiptNumber || `INV-${purchaseId.slice(0, 12)}`).trim().slice(0, 64),
        status: 'success',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if ((await checkIsFirestoreAdmin(currentUser.uid)) && p.status === 'refunded') {
      await updateDoc(ref, {
        status: 'refunded',
        updatedAt: serverTimestamp(),
      });
    }
    return purchaseId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertNotificationInFirestore(n: NotificationItem) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser || !(await checkIsFirestoreAdmin(currentUser.uid))) return null;

  const notificationId = sanitizeFirestoreId(n.id);
  const path = `notifications/${notificationId}`;
  const ref = doc(db, 'notifications', notificationId);
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

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        notificationId,
        userId: sanitizeFirestoreId(n.userId || 'all'),
        type: safeType,
        title: (n.title || 'Aathirai_Comic').trim().slice(0, 140),
        message: (n.message || 'Update available').trim().slice(0, 400),
        targetId: String(n.targetId || n.comicId || 'platform').trim().slice(0, 128) || 'platform',
        isPaywalled: Boolean(n.isPaywalled),
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        read: Boolean(n.read),
        title: (n.title || 'Aathirai_Comic').trim().slice(0, 140),
        message: (n.message || 'Update available').trim().slice(0, 400),
        updatedAt: serverTimestamp(),
      });
    }
    return notificationId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function markNotificationReadInFirestore(notificationIdRaw: string) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return;
  const notificationId = sanitizeFirestoreId(notificationIdRaw);
  const path = `notifications/${notificationId}`;
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      read: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteNotificationInFirestore(notificationIdRaw: string) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return;
  const notificationId = sanitizeFirestoreId(notificationIdRaw);
  const path = `notifications/${notificationId}`;
  try {
    await deleteDoc(doc(db, 'notifications', notificationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserNotifications(
  userIdRaw: string,
  onUpdate: (items: Record<string, unknown>[]) => void
): Unsubscribe {
  const path = 'notifications';
  const q = query(collection(db, path), where('userId', '==', sanitizeFirestoreId(userIdRaw)));
  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => d.data()));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function upsertPlatformSettingsInFirestore(
  settings: Partial<PlatformSettings>,
  updatedByEmail?: string
) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const settingId = 'global_config';
  const path = `platformSettings/${settingId}`;
  const ref = doc(db, 'platformSettings', settingId);
  const payload = {
    settingId,
    merchantUpiId: (settings.merchantUpiId || 'merchant@upi').trim().slice(0, 100),
    merchantUpiName: (settings.merchantUpiName || 'Aathirai_Comic Official').trim().slice(0, 100),
    razorpay1MonthUrl: 'https://rzp.io/rzp/eMyTbngF',
    razorpay6MonthsUrl: 'https://rzp.io/rzp/E077NNn',
    updatedByEmail: (updatedByEmail || currentUser.email || 'admin@aathirai.com').trim().slice(0, 120),
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

export async function syncGstBusinessSettingsToFirestore(params: {
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
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const settingId = 'business_profile';
  const path = `gstSettings/${settingId}`;
  const ref = doc(db, 'gstSettings', settingId);

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
    updatedByEmail: (params.updatedByEmail || currentUser.email || 'admin@aathirai.com').trim().slice(0, 120),
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

export async function upsertAdRequestInFirestore(adReq: AdPlacementRequest) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) return null;

  const requestId = sanitizeFirestoreId(adReq.id);
  const path = `adRequests/${requestId}`;
  const ref = doc(db, 'adRequests', requestId);
  const status: 'pending' | 'contacted' | 'approved' | 'rejected' =
    adReq.status === 'contacted' || adReq.status === 'approved' || adReq.status === 'rejected' ? adReq.status : 'pending';
  const placementType: 'character_promotion' | 'sponsored_page' | 'episode_sponsor' =
    adReq.placementType === 'sponsored_page' || adReq.placementType === 'episode_sponsor'
      ? adReq.placementType
      : 'character_promotion';

  const isAdminSession = await checkIsFirestoreAdmin(currentUser.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        requestId,
        companyName: (adReq.companyName || 'Sponsor Brand').trim().slice(0, 120) || 'Sponsor Brand',
        contactName: (adReq.contactName || 'Marketing Lead').trim().slice(0, 80) || 'Marketing Lead',
        contactEmail: (adReq.contactEmail || 'aathiraicomic@gmail.com').trim().slice(0, 120) || 'aathiraicomic@gmail.com',
        contactPhone: (adReq.contactPhone || '').trim().slice(0, 32),
        placementType,
        targetComicTitle: (adReq.targetComicTitle || 'Any Popular Comic Series').trim().slice(0, 140) || 'Any Popular Comic Series',
        budgetRange: (adReq.budgetRange || 'Custom Campaign').trim().slice(0, 64) || 'Custom Campaign',
        description: (adReq.description || 'In-comic character promotion request.').trim().slice(0, 1000) || 'In-comic character promotion request.',
        status: isAdminSession ? status : 'pending',
        submittedByUserId: sanitizeFirestoreId(currentUser.uid),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (isAdminSession) {
      await updateDoc(ref, {
        status,
        updatedAt: serverTimestamp(),
      });
    }
    return { requestId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchAdRequestsFromFirestore(): Promise<AdPlacementRequest[]> {
  const currentUser = ensureVerifiedUser();
  if (!currentUser || !(await checkIsFirestoreAdmin(currentUser.uid))) return [];
  const path = 'adRequests';
  try {
    const snap = await getDocs(collection(db, path));
    const items: AdPlacementRequest[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as any;
      items.push({
        id: d.requestId || docSnap.id,
        companyName: d.companyName || '',
        contactName: d.contactName || '',
        contactEmail: d.contactEmail || '',
        contactPhone: d.contactPhone || '',
        placementType: d.placementType || 'character_promotion',
        targetComicTitle: d.targetComicTitle || 'Any Popular Comic Series',
        budgetRange: d.budgetRange || '',
        description: d.description || '',
        status: d.status || 'pending',
        submittedByUserId: d.submittedByUserId || 'guest_sponsor',
        createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
        updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
      });
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// =============================================================================
// 5. FULL PLATFORM SNAPSHOT SYNC (USED BY ADMIN CONSOLE 1-CLICK SYNC)
// =============================================================================

export async function syncFullPlatformSnapshotToFirestore(params: {
  readers: any[];
  comics: Comic[];
  purchases?: Purchase[];
  authorApplications?: AuthorApplication[];
  deleteRequests?: DeleteRequest[];
  reports?: ContentReport[];
  notifications?: NotificationItem[];
  gstSettings?: GstBusinessSettings;
  platformSettings?: PlatformSettings;
}) {
  const currentUser = ensureVerifiedUser();
  if (!currentUser) {
    throw new Error('Verified Google Sign-In required to sync directly from browser.');
  }

  let syncedReaders = 0;
  let syncedComics = 0;
  let syncedEpisodes = 0;
  let syncedPurchases = 0;
  let syncedApplications = 0;
  let syncedDeleteRequests = 0;
  let syncedReports = 0;
  let syncedNotifications = 0;

  const isAdminSession = await checkIsFirestoreAdmin(currentUser.uid);

  // 1. Readers & Private Info
  for (const r of params.readers) {
    if (r.role === 'admin' || r.isImmutableAdmin) continue;
    const uid = sanitizeFirestoreId(r.id || currentUser.uid);
    await upsertUserAndPrivateInfoInFirestore({
      uid,
      name: r.name || 'Reader',
      role: r.role === 'author' ? 'author' : 'reader',
      email: r.email || 'reader@gmail.com',
      age: Number(r.age) || 24,
      phone: r.phone || 'Not provided',
      upiId: r.upiId || r.subscription?.upiId || 'Not provided',
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

  // 2. Comics & Episodes
  for (const c of params.comics) {
    const res = await upsertComicAndEpisodesInFirestore(c);
    syncedComics++;
    syncedEpisodes += res?.episodesSynced || 0;
  }

  // 3. Purchases
  for (const p of params.purchases || []) {
    await upsertPurchaseRecordInFirestore(p);
    syncedPurchases++;
  }

  // 4. Author Applications
  for (const app of params.authorApplications || []) {
    await upsertAuthorApplicationInFirestore(app);
    syncedApplications++;
  }

  // 5. Delete Requests
  for (const dr of params.deleteRequests || []) {
    await upsertDeleteRequestInFirestore(dr);
    syncedDeleteRequests++;
  }

  // 6. Reports
  for (const rep of params.reports || []) {
    await createReportInFirestore(rep);
    syncedReports++;
  }

  // 7. Notifications (latest 30)
  if (isAdminSession) {
    for (const n of (params.notifications || []).slice(0, 30)) {
      await upsertNotificationInFirestore(n);
      syncedNotifications++;
    }
  }

  // 8. GST Settings & Platform Settings
  if (params.gstSettings && isAdminSession) {
    await syncGstBusinessSettingsToFirestore({
      legalBusinessName: params.gstSettings.legalBusinessName,
      tradeName: params.gstSettings.tradeName,
      gstin: params.gstSettings.gstin,
      stateCode: params.gstSettings.stateCode,
      stateName: params.gstSettings.stateName,
      registeredAddress: params.gstSettings.registeredAddress,
      invoicePrefix: params.gstSettings.invoicePrefix,
      defaultSacCode: params.gstSettings.defaultSacCode,
      applicableGstRate: params.gstSettings.applicableGstRate,
      updatedByEmail: currentUser.email || 'admin@aathirai.com',
    });
  }

  if (params.platformSettings && isAdminSession) {
    await upsertPlatformSettingsInFirestore(
      params.platformSettings,
      currentUser.email || 'admin@aathirai.com'
    );
  }

  // 9. Purge any leftover demo records from Firestore if present
  if (isAdminSession) {
    const demoTargets: Array<[string, ...string[]]> = [
      ['users', 'usr_rajesh', 'private', 'info'],
      ['users', 'usr_rajesh'],
      ['users', 'usr_reader', 'private', 'info'],
      ['users', 'usr_reader'],
      ['users', 'usr_kavitha_pending', 'private', 'info'],
      ['users', 'usr_kavitha_pending'],
      ['users', 'usr_ananya'],
      ['users', 'usr_luna'],
      ['authorApplications', 'app_kavitha'],
      ['authorApplications', 'app_rajesh'],
      ['comics', 'comic_virasen'],
      ['comics', 'comic_neomadras'],
      ['comics', 'comic_mahishur'],
      ['comics', 'comic_monsoon'],
      ['comics', 'comic_shadows_thanjavur'],
      ['comics', 'comic_1794271496067'],
      ['comics', 'comic_1794272179041'],
      ['purchases', 'pur_demo1'],
      ['comments', 'c_1'],
      ['comments', 'c_2'],
      ['ratings', 'r_1'],
      ['ratings', 'r_2'],
      ['votes', 'v_1'],
      ['votes', 'v_2'],
      ['notifications', 'notif_welcome_1'],
      ['notifications', 'notif_author_1'],
    ];
    await Promise.all(
      demoTargets.map(([first, ...rest]) => deleteDoc(doc(db, first, ...rest)).catch(() => null))
    );
  }

  return {
    syncedReaders,
    syncedComics,
    syncedEpisodes,
    syncedPurchases,
    syncedApplications,
    syncedDeleteRequests,
    syncedReports,
    syncedNotifications,
    adminEmail: currentUser.email,
  };
}
