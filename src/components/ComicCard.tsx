import React from 'react';
import { Comic } from '../types/comic';
import { Star, BookOpen, Sparkles, IndianRupee } from 'lucide-react';

interface ComicCardProps {
  comic: Comic;
  onClick: () => void;
}

export const ComicCard: React.FC<ComicCardProps> = ({ comic, onClick }) => {
  const totalEpisodes = comic.chapters.reduce((sum, ch) => sum + ch.episodes.length, 0);
  const latestEpisode = comic.chapters[comic.chapters.length - 1]?.episodes?.slice(-1)[0];

  return (
    <div
      onClick={onClick}
      className="group flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden hover:border-slate-400 dark:hover:border-slate-700 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg"
    >
      {/* Cover Image Container (3:4 ratio) */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        <img
          src={comic.coverImage}
          alt={comic.title}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />

        {/* Access Price / Free Overlay */}
        <div className="absolute top-2.5 right-2.5">
          {comic.accessType === 'premium' ? (
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500 text-slate-950 shadow-sm flex items-center gap-0.5">
              <span>₹{comic.fullPriceInr || 99}</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-600 text-white shadow-sm">
              FREE
            </span>
          )}
        </div>

        {/* Latest Episode Indicator */}
        {latestEpisode && (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="px-2 py-1 rounded bg-slate-950/80 backdrop-blur-sm text-[10px] text-slate-200 flex items-center justify-between border border-white/10">
              <span className="font-semibold truncate">Ep {latestEpisode.episodeNumber}: {latestEpisode.title}</span>
              <span className="shrink-0 text-slate-400 font-mono text-[9px]">{latestEpisode.releaseDate}</span>
            </div>
          </div>
        )}
      </div>

      {/* Card Details */}
      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2">
        <div>
          {/* Zero-Pill Metadata Line */}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            <span>{comic.genre.slice(0, 2).join(' / ')}</span>
            <span aria-hidden="true">·</span>
            <span>{comic.status}</span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-0.5 text-amber-500 font-semibold">
              <Star className="w-3 h-3 fill-amber-500" />
              <span className="tabular-nums">{comic.averageRating}</span>
            </span>
          </div>

          {/* Title */}
          <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors line-clamp-1 font-heading">
            {comic.title}
          </h3>

          {/* Author Name */}
          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-1 mt-0.5">
            By <span className="font-medium text-slate-800 dark:text-slate-200">{comic.authorName}</span>
          </p>

          {/* Short description */}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1 leading-relaxed">
            {comic.description}
          </p>
        </div>

        {/* Bottom stats footer */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <BookOpen className="w-3 h-3 text-slate-400" />
            <span>{totalEpisodes} Episodes</span>
          </span>
          <span className="text-[10px] tabular-nums font-mono">
            {comic.totalViews.toLocaleString()} reads
          </span>
        </div>
      </div>
    </div>
  );
};
