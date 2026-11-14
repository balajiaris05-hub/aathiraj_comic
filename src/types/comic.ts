export type UserRole = 'reader' | 'author' | 'admin';

export interface PremiumPaymentDetail {
  plan: '1_month' | '6_months' | 'free';
  amountPaidInr: number;
  upiId?: string;
  paymentMethod?: string;
  transactionId?: string;
  receiptNumber?: string;
  paidAt?: string;
  expiresAt?: string;
  status: 'paid' | 'unpaid';
  environment?: 'test' | 'live';
}

export interface ReadingProgressItem {
  episodeId: string;
  comicId: string;
  comicTitle: string;
  episodeTitle: string;
  episodeNumber: number;
  chapterNumber: number;
  coverImage?: string;
  pageIndex: number;
  totalPages: number;
  updatedAt: string;
}

export interface User {
  id: string;
  firebaseUid?: string;
  name: string;
  email: string;
  password?: string;
  passwordHash?: string;
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
  welcomeEmailSent?: boolean;
  welcomeEmailSentAt?: string;
  age?: number;
  dob?: string;
  notifyGmail?: boolean;
  notifyMobile?: boolean;
  upiId?: string;
  role: UserRole;
  isVerified: boolean;
  emailVerified?: boolean;
  isSuspended?: boolean;
  suspendedReason?: string;
  avatar: string;
  phone?: string;
  countryCode?: string;
  countryName?: string;
  bio?: string;
  socialLinks?: {
    website?: string;
    instagram?: string;
    twitter?: string;
    artstation?: string;
  };
  bookmarks?: string[];
  favorites?: string[];
  readingHistory?: ReadingProgressItem[];
  createdAt: string;
  lastLoginAt?: string;
  premiumPlan?: '1_month' | '6_months' | null;
  premiumStartedAt?: string;
  premiumExpiresAt?: string;
  premiumPaymentDetail?: PremiumPaymentDetail;
  sessionToken?: string;
}

export interface AuthorApplication {
  id: string;
  userId: string;
  authorName: string;
  email: string;
  authorAvatar?: string;
  bio: string;
  portfolioUrl: string;
  sampleComicTitle: string;
  sampleSynopsis: string;
  samplePagesCount: number;
  sampleImages?: string[];
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  adminNote?: string;
  adminExplicitlyReviewed?: boolean;
}

export interface ComicPage {
  id: string;
  pageNumber: number;
  imageUrl: string;
  thumbnailUrl?: string;
  caption?: string;
}

export interface Episode {
  id: string;
  chapterId: string;
  comicId: string;
  episodeNumber: number;
  title: string;
  synopsis: string;
  releaseDate: string;
  isPremium: boolean;
  priceInr: number;
  coverImage?: string;
  pages: ComicPage[];
  likesCount: number;
  dislikesCount: number;
  averageRating: number;
  totalRatings: number;
  isPublished: boolean;
  isDraft?: boolean;
}

export interface Chapter {
  id: string;
  comicId: string;
  chapterNumber: number;
  title: string;
  synopsis?: string;
  isPremium?: boolean;
  priceInr?: number;
  episodes: Episode[];
}

export interface Comic {
  id: string;
  title: string;
  slug: string;
  authorId: string;
  authorName: string;
  genre: string[];
  tags?: string[];
  coverImage: string;
  bannerImage?: string;
  description: string;
  status: 'Ongoing' | 'Completed';
  accessType: 'free' | 'premium';
  fullPriceInr: number;
  chapterPriceInr: number;
  episodePriceInr: number;
  featured: boolean;
  trending: boolean;
  popular: boolean;
  recommended: boolean;
  chapters: Chapter[];
  totalViews: number;
  averageRating: number;
  createdAt: string;
  updatedAt: string;
  moderationStatus: 'approved' | 'pending' | 'rejected' | 'delete_requested' | 'draft';
  submittedAt?: string;
  moderatedAt?: string;
  adminReviewNote?: string;
  authorComments?: string;
  attachedPages?: ComicPage[];
  isPublishedDirectlyByAdmin?: boolean;
  attachedFileName?: string;
  attachedFileSize?: string;
  attachedFileType?: string;
}

export interface Comment {
  id: string;
  episodeId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  userRole: UserRole;
  content: string;
  createdAt: string;
  updatedAt?: string;
  isEdited?: boolean;
  likesCount?: number;
  likedBy?: string[];
  isReported?: boolean;
  reportReason?: string;
  parentId?: string;
  replies?: Comment[];
}

export interface Rating {
  id: string;
  episodeId: string;
  userId: string;
  stars: number;
  createdAt: string;
  updatedAt: string;
  auditedByAdmin?: boolean;
}

export interface Vote {
  id: string;
  episodeId: string;
  userId: string;
  type: 'like' | 'dislike';
  createdAt: string;
}

export type GstTaxType = 'CGST_SGST' | 'IGST' | 'NONE';

export interface SellerGstSnapshot {
  legalBusinessName: string;
  tradeName?: string;
  gstin: string;
  isGstRegistered: boolean;
  stateCode: string;
  stateName: string;
  registeredAddress: string;
  hsnSacCode: string;
  hsnSacDescription: string;
}

export interface GstAuditEntry {
  id: string;
  timestamp: string;
  adminId: string;
  adminEmail: string;
  action: string;
  summary: string;
  previousGstin?: string;
  newGstin?: string;
}

export interface GstBusinessSettings {
  legalBusinessName: string;
  tradeName: string;
  gstin: string;
  isGstRegistered: boolean;
  gstinVerificationStatus: 'unregistered' | 'format_valid_unverified' | 'verified';
  gstinVerifiedAt?: string;
  stateCode: string;
  stateName: string;
  registeredAddress: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  nextInvoiceSequence: number;
  nextCreditNoteSequence: number;
  defaultSacCode: string;
  defaultSacDescription: string;
  applicableGstRate: number;
  applyGstToDomesticSales: boolean;
  updatedAt: string;
  updatedByEmail?: string;
  auditHistory: GstAuditEntry[];
}

export interface CreditNoteRecord {
  id: string;
  creditNoteNumber: string;
  originalPurchaseId: string;
  originalInvoiceNumber: string;
  originalInvoiceDate: string;
  userId: string;
  customerName?: string;
  userEmail: string;
  userPhone?: string;
  customerGstin?: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyStateName: string;
  supplyType: 'INTRA' | 'INTER' | 'EXPORT';
  taxType: GstTaxType;
  hsnSacCode: string;
  hsnSacDescription: string;
  reason: string;
  grossAmountInr: number;
  taxableValue: number;
  taxRate: number;
  taxAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  sellerSnapshot: SellerGstSnapshot;
  createdAt: string;
  createdByEmail: string;
}

export interface Purchase {
  id: string;
  userId: string;
  customerName?: string;
  userEmail: string;
  userPhone?: string;
  userAge?: number;
  userUpiId?: string;
  comicId: string;
  comicTitle: string;
  chapterId?: string;
  episodeId?: string;
  type: 'full_comic' | 'chapter' | 'episode' | 'subscription';
  subscriptionPlan?: '1_month' | '6_months';
  expiresAt?: string;
  amountInr: number;
  currency: 'INR';
  paymentMethod: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signatureVerified?: boolean;
  environment?: 'test' | 'live';
  idempotencyKey?: string;
  status: 'success' | 'failed' | 'pending' | 'refunded';
  createdAt: string;
  receiptNumber: string;
  invoiceNumber?: string;
  taxableValue?: number;
  taxAmount: number;
  taxRate?: number;
  taxType?: GstTaxType;
  cgstRate?: number;
  cgstAmount?: number;
  sgstRate?: number;
  sgstAmount?: number;
  igstRate?: number;
  igstAmount?: number;
  hsnSacCode?: string;
  hsnSacDescription?: string;
  placeOfSupplyStateCode?: string;
  placeOfSupplyStateName?: string;
  isInternational?: boolean;
  supplyType?: 'INTRA' | 'INTER' | 'EXPORT';
  customerGstin?: string;
  sellerSnapshot?: SellerGstSnapshot;
  creditNoteId?: string;
  creditNoteNumber?: string;
  refundReason?: string;
  refundedAt?: string;
  authorEarningsInr: number;
  platformFeeInr: number;
}

export interface PaymentTransaction {
  id: string;
  orderId: string;
  paymentId?: string;
  userId: string;
  userEmail: string;
  comicId: string;
  itemTitle: string;
  type: 'full_comic' | 'chapter' | 'episode' | 'subscription';
  subscriptionPlan?: '1_month' | '6_months';
  amountInr: number;
  amountPaise: number;
  currency: 'INR';
  environment: 'test' | 'live';
  status: 'created' | 'verified' | 'failed' | 'refunded';
  signatureVerified: boolean;
  webhookReceived?: boolean;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  userEmail?: string;
  type:
    | 'author_approved'
    | 'author_rejected'
    | 'comic_approved'
    | 'comic_rejected'
    | 'new_comic'
    | 'new_episode'
    | 'comment_reply'
    | 'payment_success'
    | 'system';
  title: string;
  message: string;
  read: boolean;
  targetId?: string;
  comicId?: string;
  episodeId?: string;
  isPaywalled?: boolean;
  gmailSent?: boolean;
  gmailSentTo?: string;
  gmailSentAt?: string;
  createdAt: string;
}

export interface ContentReport {
  id: string;
  reporterId: string;
  reporterEmail: string;
  targetType: 'comment' | 'comic' | 'episode';
  targetId: string;
  episodeId?: string;
  targetSummary: string;
  reason: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt?: string;
  adminNote?: string;
}

export interface CopyrightDoc {
  id: string;
  title: string;
  documentNumber: string;
  registeredEntity: string;
  summary: string;
  fullText: string;
  status: 'published' | 'draft';
  effectiveDate: string;
  lastUpdated: string;
}

export interface PlatformSettings {
  siteName: string;
  tagline: string;
  merchantUpiId?: string;
  merchantUpiName?: string;
  authorRevenueSharePercent: number;
  episodeDefaultPrice: number;
  chapterDefaultPrice: number;
  fullComicDefaultPrice: number;
  monthlySubscriptionPrice: number;
  sixMonthSubscriptionPrice?: number;
  currency: string;
  termsCustomer: string;
  termsAuthor: string;
  copyrightNotice: string;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  action: string;
  actorEmail: string;
  actorRole: UserRole;
  details: string;
  targetType: string;
  targetId: string;
}

export interface DeleteRequest {
  id: string;
  comicId: string;
  comicTitle: string;
  comicCover?: string;
  chapterId?: string;
  chapterTitle?: string;
  episodeId?: string;
  episodeTitle?: string;
  targetType: 'series' | 'chapter' | 'episode';
  authorId: string;
  authorName: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  reviewedAt?: string;
  adminNote?: string;
}
