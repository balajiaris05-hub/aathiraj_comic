import React, { useState, useEffect } from 'react';
import { Comic } from '../types/comic';
import { useAuth } from '../context/AuthContext';
import {
  ChevronLeft,
  Star,
  Lock,
  Unlock,
  Play,
  IndianRupee,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ShieldCheck,
  Mail,
  RefreshCw,
  Bookmark,
  Heart
} from 'lucide-react';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';

interface ComicDetailsPageProps {
  comic: Comic;
  onBack: () => void;
  onOpenEpisode: (episodeId: string) => void | Promise<void>;
  openAuthModal: () => void;
}

export const ComicDetailsPage: React.FC<ComicDetailsPageProps> = ({
  comic,
  onBack,
  onOpenEpisode,
  openAuthModal,
}) => {
  const { user, hasActivePremium, refreshUser, toggleBookmark, toggleFavorite } = useAuth();
  const isBookmarked = Boolean(user?.bookmarks?.includes(comic.id));
  const isFavorited = Boolean(user?.favorites?.includes(comic.id));
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({
    [comic.chapters[0]?.id || '']: true,
  });

  // Real-Time Gmail Paywall Verification State (checked every time comic is accessed)
  const [gmailAccessVerified, setGmailAccessVerified] = useState<boolean>(false);
  const [paywallChecked, setPaywallChecked] = useState<boolean>(false);
  const [verifyingGmail, setVerifyingGmail] = useState<boolean>(false);
  const [verifyingEpisodeId, setVerifyingEpisodeId] = useState<string | null>(null);
  const [verifiedPlan, setVerifiedPlan] = useState<string | null>(null);
  const [verifiedExpiresAt, setVerifiedExpiresAt] = useState<string | null>(null);

  const [checkoutItem, setCheckoutItem] = useState<{
    open: boolean;
    type: 'full_comic' | 'chapter' | 'episode' | 'subscription';
    subscriptionPlan?: '1_month' | '6_months';
    chapterId?: string;
    episodeId?: string;
    title: string;
    amountInr: number;
  }>({
    open: false,
    type: 'subscription',
    subscriptionPlan: '1_month',
    title: '',
    amountInr: 49,
  });

  const verifyReaderGmailPaywall = async () => {
    if (!user) {
      setGmailAccessVerified(false);
      setPaywallChecked(true);
      return;
    }
    setVerifyingGmail(true);
    try {
      const params = new URLSearchParams();
      params.set('comicId', comic.id);
      if (user.id) params.set('userId', user.id);
      if (user.email) params.set('email', user.email);
      if (user.phone) params.set('phone', user.phone);

      const res = await fetch(`/api/payments/verify-access?${params.toString()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setGmailAccessVerified(Boolean(data.unlocked || data.hasAccess));
        setVerifiedPlan(data.plan || data.activePlan || null);
        setVerifiedExpiresAt(data.expiresAt || null);
      }
    } catch (e) {
      console.error('Error verifying Gmail paywall access:', e);
    } finally {
      setPaywallChecked(true);
      setVerifyingGmail(false);
    }
  };

  useEffect(() => {
    verifyReaderGmailPaywall();
  }, [comic.id, user?.id, user?.email, hasActivePremium]);

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => ({
      ...prev,
      [chapterId]: !prev[chapterId],
    }));
  };

  const handleReadClick = async (episodeId: string) => {
    setVerifyingEpisodeId(episodeId);
    try {
      await onOpenEpisode(episodeId);
    } finally {
      setVerifyingEpisodeId(null);
    }
  };

  const totalEpisodes = comic.chapters.reduce((sum, ch) => sum + ch.episodes.length, 0);
  const firstEpisode = comic.chapters[0]?.episodes[0];
  const isCreatorOrAdmin = Boolean(user && (user.role === 'admin' || user.id === comic.authorId));
  const isUnlockedForReader =
    comic.accessType === 'free' ||
    isCreatorOrAdmin ||
    (paywallChecked ? gmailAccessVerified : Boolean(user && hasActivePremium));
  const isFirstEpPaywalled = Boolean(
    comic.accessType === 'premium' || comic.chapters[0]?.isPremium || firstEpisode?.isPremium
  );

  return (
    <div className="space-y-10 pb-24">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to Comics Catalog</span>
      </button>

      {/* REAL-TIME GMAIL PAYWALL VERIFICATION BANNER */}
      {comic.accessType === 'premium' && (
        <div
          className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            isUnlockedForReader
              ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-900 dark:text-white'
              : 'bg-amber-500/10 border-amber-500/30 text-slate-900 dark:text-white'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isUnlockedForReader ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-slate-950'
              }`}
            >
              {isUnlockedForReader ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-sm">
                  {isUnlockedForReader
                    ? '✓ Gmail Paywall Verification Passed — All Episodes Unlocked'
                    : 'Paywalled Comic — Gmail Subscription Verification Required'}
                </span>
                {user && (
                  <span className="px-2 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 font-mono text-[11px] flex items-center gap-1">
                    <Mail className="w-3 h-3 text-rose-500" />
                    <span>{user.email}</span>
                  </span>
                )}
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                {isUnlockedForReader ? (
                  <>
                    Verified active{' '}
                    <strong>{verifiedPlan === '6_months' ? '6 Months (₹249)' : '1 Month (₹49)'}</strong> pass on your
                    Gmail{verifiedExpiresAt ? ` (valid until ${new Date(verifiedExpiresAt).toLocaleDateString()})` : ''}.
                  </>
                ) : user ? (
                  <>
                    We verified your Gmail (<strong>{user.email}</strong>) and found no active subscription. Choose{' '}
                    <strong>1 Month (₹49)</strong> or <strong>6 Months (₹249)</strong> to unlock all paywalled episodes.
                  </>
                ) : (
                  <>
                    Please log in with your <strong>Gmail or Mobile Number</strong> so we can verify your payment status
                    every time you read.
                  </>
                )}
              </p>
            </div>
          </div>

          {user ? (
            <button
              type="button"
              onClick={verifyReaderGmailPaywall}
              disabled={verifyingGmail}
              className="py-2 px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 shrink-0 hover:border-rose-500 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifyingGmail ? 'animate-spin text-rose-500' : ''}`} />
              <span>{verifyingGmail ? 'Checking Gmail...' : 'Re-Verify Gmail'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={openAuthModal}
              className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shrink-0 cursor-pointer"
            >
              Login with Gmail / Mobile
            </button>
          )}
        </div>
      )}

      {/* COMIC DETAILS HERO SPLIT */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        
        {/* Cover Art (Left column) */}
        <div className="md:col-span-4 lg:col-span-3">
          <div className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl bg-slate-950 border border-slate-200 dark:border-slate-800">
            <img
              src={comic.coverImage}
              alt={comic.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            {comic.accessType === 'premium' ? (
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg text-xs font-black bg-amber-500 text-slate-950 shadow-md">
                {isUnlockedForReader ? '✓ GMAIL UNLOCKED' : '1M ₹49 / 6M ₹249'}
              </div>
            ) : (
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-600 text-white shadow-md">
                FREE TO READ
              </div>
            )}
          </div>
        </div>

        {/* Info & Purchase Module (Right column) */}
        <div className="md:col-span-8 lg:col-span-9 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            
            {/* Zero-Pill Metadata Line */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                {comic.genre.join(' · ')}
              </span>
              <span aria-hidden="true">·</span>
              <span>Status: <strong className="text-slate-700 dark:text-slate-300">{comic.status}</strong></span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1 text-amber-500 font-bold">
                <Star className="w-3.5 h-3.5 fill-amber-500" />
                <span>{comic.averageRating} Rating</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>{comic.totalViews.toLocaleString()} views</span>
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white font-heading">
              {comic.title}
            </h1>

            {/* Creator / Author */}
            <div className="flex items-center gap-3 pt-1">
              <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-700 dark:text-slate-300">
                {comic.authorName.charAt(0)}
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Author &amp; Artist
                </span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {comic.authorName}
                </span>
              </div>
            </div>

            {/* Synopsis */}
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
              {comic.description}
            </p>
          </div>

          {/* Primary Action Buttons */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
            {firstEpisode && (
              <button
                onClick={() => handleReadClick(firstEpisode.id)}
                disabled={verifyingEpisodeId === firstEpisode.id}
                className="py-3 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-70 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 flex items-center gap-2 transition-transform hover:scale-105 cursor-pointer"
              >
                {!isFirstEpPaywalled || isUnlockedForReader ? (
                  <Play className="w-4 h-4 fill-white" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                <span>
                  {verifyingEpisodeId === firstEpisode.id
                    ? 'Verifying Access...'
                    : !isFirstEpPaywalled
                    ? 'Read Episode 1 Free'
                    : isUnlockedForReader
                    ? 'Read Now (Unlocked)'
                    : 'Read (Premium Required)'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (!user) {
                  openAuthModal();
                  return;
                }
                toggleBookmark(comic.id);
              }}
              className={`py-3 px-4 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                isBookmarked
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-amber-500'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-amber-500 text-amber-500' : ''}`} />
              <span>{isBookmarked ? 'Bookmarked' : 'Bookmark'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!user) {
                  openAuthModal();
                  return;
                }
                toggleFavorite(comic.id);
              }}
              className={`py-3 px-4 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                isFavorited
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-rose-500'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFavorited ? 'fill-rose-500 text-rose-500' : ''}`} />
              <span>{isFavorited ? 'Favorited' : 'Favorite'}</span>
            </button>

            {comic.accessType === 'premium' && !isUnlockedForReader && (
              <>
                <button
                  onClick={() => {
                    if (!user) {
                      openAuthModal();
                      return;
                    }
                    setCheckoutItem({
                      open: true,
                      type: 'subscription',
                      subscriptionPlan: '1_month',
                      title: '1 Month Reader Premium Pass (₹49)',
                      amountInr: 49,
                    });
                  }}
                  className="py-3 px-5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider shadow-lg flex items-center gap-1.5 transition-transform hover:scale-105 cursor-pointer border border-slate-700"
                >
                  <Sparkles className="w-4 h-4 text-rose-500" />
                  <span>1 Month Pass (₹49)</span>
                </button>

                <button
                  onClick={() => {
                    if (!user) {
                      openAuthModal();
                      return;
                    }
                    setCheckoutItem({
                      open: true,
                      type: 'subscription',
                      subscriptionPlan: '6_months',
                      title: '6 Months Reader Premium Pass (₹249)',
                      amountInr: 249,
                    });
                  }}
                  className="py-3 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg flex items-center gap-1.5 transition-transform hover:scale-105 cursor-pointer"
                >
                  <IndianRupee className="w-4 h-4" />
                  <span>6 Months Pass (₹249)</span>
                </button>
              </>
            )}

            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 ml-auto">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Gmail Paywall Verified · {totalEpisodes} Episodes</span>
            </div>
          </div>
        </div>
      </div>

      {/* CHAPTER & EPISODE HIERARCHY TREE */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white font-heading">
              Chapters &amp; Episodes ({totalEpisodes})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Structured hierarchy: Comic Book → Chapter → Episode
            </p>
          </div>
        </div>

        {/* Chapter List Accordion */}
        <div className="space-y-4">
          {comic.chapters.map((chapter) => {
            const isExpanded = !!expandedChapters[chapter.id];

            return (
              <div
                key={chapter.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm"
              >
                {/* Chapter Header */}
                <div
                  onClick={() => toggleChapter(chapter.id)}
                  className="p-4 sm:p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-xs">
                      {chapter.chapterNumber}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white font-heading">
                          Chapter {chapter.chapterNumber}: {chapter.title}
                        </h3>
                        {chapter.isPremium ? (
                          isUnlockedForReader ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              <span>Gmail Verified · Unlocked</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Paywalled (Unlock with ₹49 / 1M or ₹249 / 6M)</span>
                            </span>
                          )
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            Free Chapter
                          </span>
                        )}
                      </div>
                      {chapter.synopsis && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {chapter.synopsis}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-400">
                      {chapter.episodes.length} Episodes
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Episode Items Inside Chapter */}
                {isExpanded && (
                  <div className="border-t border-slate-100 dark:border-slate-800/80 divide-y divide-slate-100 dark:divide-slate-800/60 bg-slate-50/50 dark:bg-slate-950/40">
                    {chapter.episodes.map((episode) => {
                      const isEpPaywalled =
                        comic.accessType === 'premium' ||
                        Boolean(chapter.isPremium) ||
                        Boolean(episode.isPremium);
                      const isVerifyingEp = verifyingEpisodeId === episode.id;

                      return (
                        <div
                          key={episode.id}
                          className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors gap-4"
                        >
                          <div
                            onClick={() => handleReadClick(episode.id)}
                            className="flex items-center gap-3.5 min-w-0 flex-1 cursor-pointer group"
                          >
                            <img
                              src={episode.coverImage || episode.pages?.[0]?.imageUrl || comic.coverImage}
                              alt={episode.title}
                              className="w-10 h-14 rounded-lg object-cover border border-slate-200 dark:border-slate-800 shrink-0 shadow-sm group-hover:scale-105 transition-transform"
                            />

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                                  Ep {episode.episodeNumber}: {episode.title}
                                </h4>
                                {isEpPaywalled ? (
                                  isUnlockedForReader ? (
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5 shrink-0">
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                      <span>UNLOCKED</span>
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-0.5 shrink-0">
                                      <Lock className="w-2.5 h-2.5" />
                                      <span>PREMIUM</span>
                                    </span>
                                  )
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                                    FREE
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                {episode.synopsis || 'Read online in high quality manga viewer.'} · {episode.pages?.length || 1} Pages
                              </p>
                            </div>
                          </div>

                          {/* Read or Buy Action */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] text-slate-400 hidden sm:inline font-mono">
                              {episode.releaseDate}
                            </span>

                            <button
                              onClick={() => handleReadClick(episode.id)}
                              disabled={isVerifyingEp}
                              className="py-1.5 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-70 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              {!isEpPaywalled || isUnlockedForReader ? (
                                <Play className="w-3 h-3 fill-white" />
                              ) : (
                                <Lock className="w-3 h-3" />
                              )}
                              <span>{isVerifyingEp ? 'Verifying...' : 'Read'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* RAZORPAY CHECKOUT MODAL */}
      {checkoutItem.open && (
        <RazorpayCheckoutModal
          isOpen={checkoutItem.open}
          onClose={() => setCheckoutItem({ ...checkoutItem, open: false })}
          comicId={checkoutItem.type === 'subscription' ? 'premium_pass' : comic.id}
          comicTitle={checkoutItem.type === 'subscription' ? 'Aathirai_Comic All-Access Subscription' : comic.title}
          chapterId={checkoutItem.chapterId}
          episodeId={checkoutItem.episodeId}
          itemTitle={checkoutItem.title}
          itemType={checkoutItem.type}
          subscriptionPlan={checkoutItem.subscriptionPlan}
          amountInr={checkoutItem.amountInr}
          onPaymentSuccess={async () => {
            await refreshUser();
            await verifyReaderGmailPaywall();
          }}
        />
      )}
    </div>
  );
};
