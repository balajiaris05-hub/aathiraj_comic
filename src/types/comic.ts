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
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
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
  avatar: string;
  phone?: string;
  bio?: string;
  createdAt: string;
  lastLoginAt?: string;
  premiumPlan?: '1_month' | '6_months' | null;
  premiumStartedAt?: string;
  premiumExpiresAt?: string;
  premiumPaymentDetail?: PremiumPaymentDetail;
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
}

export interface ComicPage {
  id: string;
  pageNumber: number;
  imageUrl: string;
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
  coverImage: string;
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
  moderationStatus: 'approved' | 'pending' | 'rejected' | 'delete_requested';
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

export interface Purchase {
  id: string;
  userId: string;
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
  status: 'success' | 'failed' | 'pending';
  createdAt: string;
  receiptNumber: string;
  taxAmount: number;
  authorEarningsInr: number;
  platformFeeInr: number;
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
