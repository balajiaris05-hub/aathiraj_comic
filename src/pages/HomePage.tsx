import React, { useState, useEffect } from 'react';
import { Comic } from '../types/comic';
import { ComicCard } from '../components/ComicCard';
import { useAuth } from '../context/AuthContext';
import {
  Search,
  Sparkles,
  Flame,
  TrendingUp,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  PenTool,
  IndianRupee,
  Layers,
  Clock,
  Award,
  Users,
  Play,
} from 'lucide-react';

interface HomePageProps {
  comics: Comic[];
  onSelectComic: (comic: Comic) => void;
  onOpenEpisode: (episodeId: string) => void;
  setCurrentTab: (tab: string) => void;
}

const GENRES = ['All', 'Action', 'Fantasy', 'Mythology', 'Sci-Fi', 'Cyberpunk', 'Romance', 'Slice of Life'];

export const HomePage: React.FC<HomePageProps> = ({
  comics,
  onSelectComic,
  onOpenEpisode,
  setCurrentTab,
}) => {
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');

  // Debounced search (250ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim().toLowerCase());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Filtered comics based on debounced search and genre
  const filteredComics = comics.filter((c) => {
    const matchesSearch =
      !debouncedQuery ||
      c.title.toLowerCase().includes(debouncedQuery) ||
      c.authorName.toLowerCase().includes(debouncedQuery) ||
      c.genre.some((g) => g.toLowerCase().includes(debouncedQuery));
    const matchesGenre = selectedGenre === 'All' || c.genre.includes(selectedGenre);
    return matchesSearch && matchesGenre;
  });

  const featuredComics = filteredComics.filter((c) => c.featured);
  const trendingComics = filteredComics.filter((c) => c.trending);
  const recommendedComics = filteredComics.filter((c) => c.recommended);
  const newReleases = [...filteredComics].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const premiumComics = comics.filter((c) => c.accessType === 'premium');
  const continueReading = user?.readingHistory?.slice(0, 3) || [];

  return (
    <div className="space-y-16 pb-20">
      {/* HERO SECTION */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-2xl">
        <div className="absolute inset-0 z-0">
          <img
            src="/src/assets/images/tamil_nadu_temple_anime_1794618935009.jpg"
            alt="Anime-style Tamil Nadu twilight landscape with Dravidian temple gopurams and coastline"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center opacity-50 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/70 to-transparent" />
        </div>

        <div className="relative z-10 max-w-4xl px-6 py-16 sm:px-12 sm:py-24 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" />
            <span>India’s Leading Digital Comic &amp; Manga Network</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight font-heading text-balance">
            Discover, Read &amp; Publish Original Comics in Full Glory
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
            Step into the mythological battles of <span className="text-amber-400 font-semibold">Virasen</span>, the
            neon rain of <span className="text-cyan-400 font-semibold">Neo Madras 2099</span>, and romantic journeys
            across Tamil Nadu. Empowering creators with direct author publishing and Indian INR payments.
          </p>

          {/* Instant Debounced Search Bar */}
          <div className="pt-2 max-w-xl">
            <div className="relative flex items-center">
              <Search className="w-5 h-5 absolute left-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search comics by title, genre, or author..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-12 pr-28 py-3.5 rounded-xl bg-slate-950/90 border border-slate-700/80 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500 shadow-xl backdrop-blur-md"
              />
              <button
                onClick={() => setCurrentTab('books')}
                className="absolute right-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Explore All
              </button>
            </div>
          </div>

          {/* Highlights Metrics */}
          <div className="pt-4 flex flex-wrap items-center gap-6 text-xs text-slate-300 font-medium">
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-rose-500" />
              <span>Full-HD Webtoon &amp; Manga Readers</span>
            </div>
            <div className="flex items-center gap-1.5">
              <IndianRupee className="w-4 h-4 text-emerald-500" />
              <span>Official Razorpay INR Checkout</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-amber-500" />
              <span>100% Author IP Protection</span>
            </div>
          </div>
        </div>
      </section>

      {/* CONTINUE READING STRIP (IF LOGGED IN & HAS READING HISTORY) */}
      {continueReading.length > 0 && (
        <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-rose-600" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Continue Reading
              </h2>
            </div>
            <button
              onClick={() => setCurrentTab('reader_profile')}
              className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
            >
              View Full Reading History
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {continueReading.map((item) => (
              <div
                key={item.episodeId}
                onClick={() => onOpenEpisode(item.episodeId)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-rose-500 transition-colors cursor-pointer group"
              >
                {item.coverImage && (
                  <img
                    src={item.coverImage}
                    alt={item.comicTitle}
                    className="w-12 h-16 rounded-lg object-cover shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
                    Ch.{item.chapterNumber} Ep.{item.episodeNumber} · Page {item.pageIndex + 1}/{item.totalPages}
                  </span>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
                    {item.episodeTitle}
                  </h4>
                  <p className="text-[11px] text-slate-500 truncate">{item.comicTitle}</p>
                </div>
                <Play className="w-4 h-4 text-rose-500 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* GENRE SELECTOR BUTTONS */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-heading">
            Browse by Genre Collection
          </h2>
          <button
            onClick={() => setCurrentTab('books')}
            className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>View All Genres</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {GENRES.map((g) => (
            <button
              key={g}
              onClick={() => setSelectedGenre(g)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedGenre === g
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </section>

      {/* FEATURED COMICS SECTION */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-rose-600 fill-rose-600" />
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white font-heading">
              Featured Series
            </h2>
          </div>
          <button
            onClick={() => setCurrentTab('books')}
            className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
          >
            See Catalog ({filteredComics.length})
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {(featuredComics.length > 0 ? featuredComics : filteredComics).slice(0, 4).map((comic) => (
            <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
          ))}
        </div>
      </section>

      {/* TRENDING & POPULAR SECTION */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-500" />
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white font-heading">
              Trending This Week
            </h2>
          </div>
          <span className="text-xs text-slate-500">Updated Hourly</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {(trendingComics.length > 0 ? trendingComics : filteredComics).slice(0, 4).map((comic) => (
            <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
          ))}
        </div>
      </section>

      {/* LATEST CHAPTERS & EPISODES STRIP */}
      <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-rose-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-heading">
              Recently Updated Episodes
            </h2>
          </div>
          <span className="text-xs text-slate-500">Read the newest cliffhangers</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filteredComics.slice(0, 6).map((comic) => {
            const latest = comic.chapters[comic.chapters.length - 1]?.episodes?.slice(-1)[0];
            if (!latest) return null;
            return (
              <div
                key={comic.id + '_' + latest.id}
                onClick={() => onOpenEpisode(latest.id)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-rose-500 transition-colors cursor-pointer group"
              >
                <img
                  src={comic.coverImage}
                  alt={comic.title}
                  className="w-12 h-16 rounded-lg object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
                    Ep {latest.episodeNumber} · {latest.releaseDate}
                  </span>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
                    {latest.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 truncate">{comic.title}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-rose-500 group-hover:translate-x-1 transition-all shrink-0" />
              </div>
            );
          })}
        </div>
      </section>

      {/* NEW RELEASES & RECOMMENDED FOR YOU */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-sky-500" />
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white font-heading">
              New Releases &amp; Recommended For You
            </h2>
          </div>
          <button
            onClick={() => setCurrentTab('books')}
            className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
          >
            Browse Library
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {(recommendedComics.length > 0 ? recommendedComics : newReleases).slice(0, 4).map((comic) => (
            <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
          ))}
        </div>
      </section>

      {/* POPULAR AUTHORS SPOTLIGHT */}
      <section className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-500" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-heading">
              Popular Indian &amp; Global Comic Creators
            </h2>
          </div>
          <button
            onClick={() => setCurrentTab('authors')}
            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
          >
            Explore All Authors →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              name: 'Rajesh Singh',
              role: 'Mythic Fantasy & Cyberpunk Creator',
              avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&h=200&q=80',
              reads: '87.3K Reads',
            },
            {
              name: 'Ananya Sundaram',
              role: 'Dravidian Lore & Dark Fantasy',
              avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
              reads: '28.4K Reads',
            },
            {
              name: 'Luna & Sky',
              role: 'Slice-of-Life Webtoon Studio',
              avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&h=200&q=80',
              reads: '52.1K Reads',
            },
          ].map((creator) => (
            <div
              key={creator.name}
              onClick={() => setCurrentTab('authors')}
              className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 transition-colors cursor-pointer"
            >
              <img
                src={creator.avatar}
                alt={creator.name}
                className="w-12 h-12 rounded-xl object-cover border border-emerald-500/30"
              />
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {creator.name}
                </h4>
                <p className="text-[11px] text-slate-500 truncate">{creator.role}</p>
                <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {creator.reads}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PREMIUM COMICS SHOWCASE */}
      {premiumComics.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <IndianRupee className="w-5 h-5 text-emerald-500" />
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white font-heading">
                Premium Vault
              </h2>
            </div>
            <button
              onClick={() => setCurrentTab('premium')}
              className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              Membership Passes (₹49 / 1M · ₹249 / 6M)
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {premiumComics.map((comic) => (
              <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
            ))}
          </div>
        </section>
      )}

      {/* BECOME AN AUTHOR CALLOUT */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-rose-950 via-slate-900 to-amber-950 p-8 sm:p-12 border border-rose-900/40 text-white shadow-xl">
        <div className="max-w-2xl space-y-4">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
            For Manga Artists &amp; Writers
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-heading">
            Publish Your Comic on Aathirai_Comic
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Submit your creator application with your sample pages. Once approved by our editorial administrator,
            unlock your comprehensive Author Studio to manage chapters, upload episodes, set INR pricing, and earn 70%
            revenue share with direct Indian payouts.
          </p>
          <div className="pt-2">
            <button
              onClick={() => setCurrentTab('become_author')}
              className="py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition-transform hover:scale-105 flex items-center gap-2 cursor-pointer"
            >
              <PenTool className="w-4 h-4" />
              <span>Apply for Author Account</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
