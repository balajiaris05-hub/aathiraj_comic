import React, { useState } from 'react';
import { Comic, Chapter, Episode } from '../types/comic';
import { useAuth } from '../context/AuthContext';
import {
  ChevronLeft,
  Star,
  BookOpen,
  Calendar,
  Lock,
  Play,
  IndianRupee,
  Share2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';

interface ComicDetailsPageProps {
  comic: Comic;
  onBack: () => void;
  onOpenEpisode: (episodeId: string) => void;
  openAuthModal: () => void;
}

export const ComicDetailsPage: React.FC<ComicDetailsPageProps> = ({
  comic,
  onBack,
  onOpenEpisode,
  openAuthModal,
}) => {
  const { user } = useAuth();
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({
    [comic.chapters[0]?.id || '']: true,
  });

  const [checkoutItem, setCheckoutItem] = useState<{
    open: boolean;
    type: 'full_comic' | 'chapter' | 'episode';
    chapterId?: string;
    episodeId?: string;
    title: string;
    amountInr: number;
  }>({
    open: false,
    type: 'full_comic',
    title: '',
    amountInr: 99,
  });

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => ({
      ...prev,
      [chapterId]: !prev[chapterId],
    }));
  };

  const totalEpisodes = comic.chapters.reduce((sum, ch) => sum + ch.episodes.length, 0);
  const firstEpisode = comic.chapters[0]?.episodes[0];

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
                ₹{comic.fullPriceInr || 99} FULL
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
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-4">
            {firstEpisode && (
              <button
                onClick={() => onOpenEpisode(firstEpisode.id)}
                className="py-3 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 flex items-center gap-2 transition-transform hover:scale-105 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Read Episode 1 Free</span>
              </button>
            )}

            {comic.accessType === 'premium' && (
              <button
                onClick={() => {
                  if (!user) {
                    openAuthModal();
                    return;
                  }
                  setCheckoutItem({
                    open: true,
                    type: 'full_comic',
                    title: `Complete Comic Access (${comic.title})`,
                    amountInr: comic.fullPriceInr || 99,
                  });
                }}
                className="py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 transition-transform hover:scale-105 cursor-pointer"
              >
                <IndianRupee className="w-4 h-4" />
                <span>Buy Complete Series (₹{comic.fullPriceInr || 99})</span>
              </button>
            )}

            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 ml-auto">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Razorpay Verified · {totalEpisodes} Episodes</span>
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
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            <span>Chapter Paywalled (₹{chapter.priceInr || 30})</span>
                          </span>
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
                    {chapter.episodes.map((episode) => (
                      <div
                        key={episode.id}
                        className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors gap-4"
                      >
                        <div
                          onClick={() => onOpenEpisode(episode.id)}
                          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group"
                        >
                          <div className="w-7 h-7 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center text-xs font-mono font-bold shrink-0 group-hover:bg-rose-600 group-hover:text-white transition-colors">
                            {episode.episodeNumber}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                                Ep {episode.episodeNumber}: {episode.title}
                              </h4>
                              {episode.isPremium ? (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-0.5 shrink-0">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>₹{episode.priceInr || 10}</span>
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                                  FREE
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {episode.synopsis || 'Read online in high quality manga viewer.'}
                            </p>
                          </div>
                        </div>

                        {/* Read or Buy Action */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-slate-400 hidden sm:inline font-mono">
                            {episode.releaseDate}
                          </span>

                          <button
                            onClick={() => onOpenEpisode(episode.id)}
                            className="py-1.5 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-white" />
                            <span>Read</span>
                          </button>
                        </div>
                      </div>
                    ))}
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
          comicId={comic.id}
          comicTitle={comic.title}
          chapterId={checkoutItem.chapterId}
          episodeId={checkoutItem.episodeId}
          itemTitle={checkoutItem.title}
          itemType={checkoutItem.type}
          amountInr={checkoutItem.amountInr}
          onPaymentSuccess={() => {
            // refreshed access
          }}
        />
      )}
    </div>
  );
};
