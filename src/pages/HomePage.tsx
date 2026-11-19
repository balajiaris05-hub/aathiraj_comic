import React, { useState, useEffect } from 'react';
import { Comic } from '../types/comic';
import { ComicCard } from '../components/ComicCard';
import { useAuth } from '../context/AuthContext';
import { upsertAdRequestInFirestore } from '../services/firestoreBackend';
import { matchesComicSearchQuery } from '../utils/seo';
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
  Megaphone,
  Mail,
  Copy,
  Check,
  CheckCircle2,
  Send,
  Building2,
  X,
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
  const { user, getAuthHeaders } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');

  // Company Ad Placement Request State
  const [showAdRequestForm, setShowAdRequestForm] = useState(false);
  const [adCompanyName, setAdCompanyName] = useState('');
  const [adContactName, setAdContactName] = useState(user?.name || '');
  const [adContactEmail, setAdContactEmail] = useState(user?.email || '');
  const [adContactPhone, setAdContactPhone] = useState(user?.phone || '');
  const [adPlacementType, setAdPlacementType] = useState<'character_promotion' | 'sponsored_page' | 'episode_sponsor'>('character_promotion');
  const [adTargetComic, setAdTargetComic] = useState('Any Popular Comic Series');
  const [adBudgetRange, setAdBudgetRange] = useState('₹15,000 – ₹50,000');
  const [adDescription, setAdDescription] = useState('');
  const [isSubmittingAd, setIsSubmittingAd] = useState(false);
  const [adSubmitError, setAdSubmitError] = useState<string | null>(null);
  const [adSubmitSuccess, setAdSubmitSuccess] = useState<{
    companyName: string;
    placementType: string;
    targetComicTitle: string;
    description: string;
    contactEmail: string;
  } | null>(null);
  const [copiedAdminEmail, setCopiedAdminEmail] = useState(false);

  // Debounced search (250ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim().toLowerCase());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Filtered comics based on debounced search and genre
  const filteredComics = comics.filter((c) => {
    const matchesSearch = matchesComicSearchQuery(c, debouncedQuery);
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

  const handleCopyAdminEmail = () => {
    try {
      navigator.clipboard?.writeText('aathiraicomic@gmail.com');
      setCopiedAdminEmail(true);
      setTimeout(() => setCopiedAdminEmail(false), 2500);
    } catch {
      // Fallback handled by mailto link
    }
  };

  const handleSubmitCompanyAdRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdSubmitError(null);

    if (!adCompanyName.trim() || !adContactName.trim() || !adContactEmail.trim() || adDescription.trim().length < 5) {
      setAdSubmitError('Please fill in Company Name, Contact Name, Work Email, and how our comic characters should promote your brand.');
      return;
    }

    setIsSubmittingAd(true);
    try {
      const matchedComic = comics.find(c => c.title === adTargetComic);
      const headers = await getAuthHeaders();
      const res = await fetch('/api/ads/request', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyName: adCompanyName.trim(),
          contactName: adContactName.trim(),
          contactEmail: adContactEmail.trim(),
          contactPhone: adContactPhone.trim(),
          placementType: adPlacementType,
          targetComicId: matchedComic?.id || '',
          targetComicTitle: adTargetComic,
          budgetRange: adBudgetRange,
          description: adDescription.trim(),
          submittedByUserId: user?.firebaseUid || user?.id || 'guest_sponsor',
        }),
      });
      const data = await res.json();
      setIsSubmittingAd(false);

      if (res.ok && data.adRequest) {
        await upsertAdRequestInFirestore(data.adRequest).catch(() => null);
        setAdSubmitSuccess({
          companyName: adCompanyName.trim(),
          placementType: adPlacementType,
          targetComicTitle: adTargetComic,
          description: adDescription.trim(),
          contactEmail: adContactEmail.trim(),
        });
        setShowAdRequestForm(false);
        setAdCompanyName('');
        setAdDescription('');
      } else {
        setAdSubmitError(data.error || 'Unable to submit your ad request right now.');
      }
    } catch {
      setIsSubmittingAd(false);
      setAdSubmitError('Network error while submitting request. You can email aathiraicomic@gmail.com directly.');
    }
  };

  return (
    <div className="space-y-16 pb-20">
      {/* HERO SECTION */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-2xl">
        <div className="absolute inset-0 z-0">
          <img
            src="/assets/og-hero-banner.jpg"
            alt="Aathirai Comic - Tamil Nadu temple twilight banner for original Tamil & Indian comics"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center opacity-50 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/70 to-transparent" />
        </div>

        <div className="relative z-10 max-w-4xl px-6 py-16 sm:px-12 sm:py-24 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" />
            <span>Online Tamil Comics &amp; Indian Digital Comics Network</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight font-heading text-balance">
            Aathirai Comic: Read Original Tamil &amp; Indian Comics Online
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
            Discover mythological epics, futuristic realms, and original graphic stories on Aathirai Comic. Read online Tamil comics and Indian digital comics free or with instant INR access.
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
            <button
              type="button"
              onClick={() => {
                setShowAdRequestForm(true);
                document.getElementById('company-ad-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 font-semibold transition-colors cursor-pointer"
            >
              <Megaphone className="w-3.5 h-3.5 text-amber-400" />
              <span>Put My Company&apos;s Ad in Comic</span>
            </button>
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
                    alt={`${item.comicTitle} Tamil comic cover - Aathirai Comic`}
                    className="w-12 h-16 rounded-lg object-cover shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
                    Ch.{item.chapterNumber} Ep.{item.episodeNumber} · Page {item.pageIndex + 1}/{item.totalPages}
                  </span>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
                    {item.episodeTitle}
                  </h3>
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

        {(featuredComics.length > 0 ? featuredComics : filteredComics).length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            No comic series published yet. Authors and administrators can publish new comics from their studio.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {(featuredComics.length > 0 ? featuredComics : filteredComics).slice(0, 4).map((comic) => (
              <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
            ))}
          </div>
        )}
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

        {(trendingComics.length > 0 ? trendingComics : filteredComics).length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            Trending titles will appear once comics are published and read.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {(trendingComics.length > 0 ? trendingComics : filteredComics).slice(0, 4).map((comic) => (
              <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
            ))}
          </div>
        )}
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

        {filteredComics.some((c) => c.chapters[c.chapters.length - 1]?.episodes?.length) ? (
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
                    alt={`${comic.title} Tamil comic cover - Aathirai Comic`}
                    className="w-12 h-16 rounded-lg object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
                      Ep {latest.episodeNumber} · {latest.releaseDate}
                    </span>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
                      {latest.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 truncate">{comic.title}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-rose-500 group-hover:translate-x-1 transition-all shrink-0" />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No episodes have been released yet.
          </div>
        )}
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

        {(recommendedComics.length > 0 ? recommendedComics : newReleases).length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            New releases will appear here as soon as comics are published.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {(recommendedComics.length > 0 ? recommendedComics : newReleases).slice(0, 4).map((comic) => (
              <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
            ))}
          </div>
        )}
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

        {(() => {
          const creatorMap = new Map<string, { name: string; genres: Set<string>; totalViews: number; coverImage: string }>();
          comics.forEach((comic) => {
            const key = (comic.authorId || comic.authorName || 'Creator').trim();
            const existing = creatorMap.get(key);
            if (existing) {
              existing.totalViews += Number(comic.totalViews || 0);
              (comic.genre || []).forEach((g) => existing.genres.add(g));
            } else {
              creatorMap.set(key, {
                name: comic.authorName || 'Comic Creator',
                genres: new Set(comic.genre || []),
                totalViews: Number(comic.totalViews || 0),
                coverImage: comic.coverImage || '',
              });
            }
          });
          const activeCreators = Array.from(creatorMap.values()).slice(0, 3);

          if (activeCreators.length === 0) {
            return (
              <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Be the first creator to publish your original comic series on Aathirai_Comic.
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentTab('become_author')}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                >
                  Become the first featured creator
                </button>
              </div>
            );
          }

          return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {activeCreators.map((creator) => (
                <div
                  key={creator.name}
                  onClick={() => setCurrentTab('authors')}
                  className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 transition-colors cursor-pointer"
                >
                  {creator.coverImage ? (
                    <img
                      src={creator.coverImage}
                      alt={`${creator.name} - Tamil & Indian comic creator on Aathirai Comic`}
                      className="w-12 h-12 rounded-xl object-cover border border-emerald-500/30"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/15 text-emerald-500 font-extrabold flex items-center justify-center border border-emerald-500/30">
                      {creator.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {creator.name}
                    </h3>
                    <p className="text-[11px] text-slate-500 truncate">
                      {Array.from(creator.genres).slice(0, 2).join(' · ') || 'Original Comic Creator'}
                    </p>
                    <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {creator.totalViews.toLocaleString()} Reads
                    </span>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
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

      {/* PUT MY COMPANY'S AD IN COMIC (BRAND SPONSORSHIP & IN-COMIC CHARACTER PROMOTION) */}
      <section
        id="company-ad-section"
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 sm:p-10 border border-indigo-500/30 text-white shadow-2xl space-y-6"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-300 text-[11px] font-bold uppercase tracking-wider">
              <Megaphone className="w-3.5 h-3.5 text-amber-400" />
              <span>Brand Collaborations &amp; In-Comic Ads</span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-heading text-white">
              Put My Company&apos;s Ad Inside Aathirai_Comic Pages
            </h2>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Want your company or product promoted natively to thousands of engaged comic readers? Companies can
              request bespoke <strong className="text-amber-300">In-Comic Character Promotions</strong>—where the main
              characters inside our comic pages wear, use, or dialogue-promote your brand naturally inside the story
              panels—as well as full sponsored comic pages and episode sponsorships.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-[11px] text-indigo-100">
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="font-bold text-amber-300 block">1. Character Promotion</span>
                <span className="text-slate-300">Comic heroes showcase your product right in the story panels.</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="font-bold text-cyan-300 block">2. Sponsored Comic Page</span>
                <span className="text-slate-300">Dedicated illustrated brand page placed between chapters.</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="font-bold text-emerald-300 block">3. Episode Sponsor</span>
                <span className="text-slate-300">Presented-by brand badge &amp; CTA link on trending episodes.</span>
              </div>
            </div>
          </div>

          {/* Primary CTA Buttons: Put My Company's Ad + Contact Admin (aathiraicomic@gmail.com) */}
          <div className="flex flex-col gap-3 shrink-0 lg:w-80">
            <button
              type="button"
              onClick={() => {
                setShowAdRequestForm(!showAdRequestForm);
                setAdSubmitError(null);
              }}
              className="w-full py-3.5 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs uppercase tracking-wider shadow-lg transition-all hover:scale-[1.02] flex items-center justify-center gap-2 cursor-pointer"
            >
              <Building2 className="w-4 h-4" />
              <span>{showAdRequestForm ? 'Hide Ad Request Form' : "Put My Company's Ad"}</span>
            </button>

            <a
              href="mailto:aathiraicomic@gmail.com?subject=Company%20Ad%20Request%20on%20Aathirai_Comic%20(In-Comic%20Character%20Promotion)"
              className="w-full py-3 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-colors flex items-center justify-center gap-2"
            >
              <Mail className="w-4 h-4" />
              <span>Contact Admin · aathiraicomic@gmail.com</span>
            </a>

            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-950/70 border border-slate-700/80 text-[11px]">
              <div className="truncate">
                <span className="text-slate-400 mr-1.5">Admin Gmail:</span>
                <span className="font-mono font-bold text-amber-300 select-all">aathiraicomic@gmail.com</span>
              </div>
              <button
                type="button"
                onClick={handleCopyAdminEmail}
                className="ml-2 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                title="Copy Admin Gmail"
              >
                {copiedAdminEmail ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedAdminEmail ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Submission Success Card */}
        {adSubmitSuccess && (
          <div className="p-5 rounded-2xl bg-emerald-950/70 border border-emerald-500/40 space-y-3 animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h3 className="font-extrabold text-sm text-emerald-300">
                    Ad Request Received for &ldquo;{adSubmitSuccess.companyName}&rdquo;
                  </h3>
                  <p className="text-slate-200 leading-relaxed">
                    Your <strong>In-Comic Ad Request</strong> has been saved for our Admin &amp; Creator team. You can
                    also send your logo/assets directly via Gmail to{' '}
                    <strong className="font-mono text-amber-300">aathiraicomic@gmail.com</strong>.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdSubmitSuccess(null)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`mailto:aathiraicomic@gmail.com?subject=${encodeURIComponent(
                  `Company Ad Request: ${adSubmitSuccess.companyName} (${adSubmitSuccess.targetComicTitle})`
                )}&body=${encodeURIComponent(
                  `Company: ${adSubmitSuccess.companyName}\nReply Email: ${adSubmitSuccess.contactEmail}\nPlacement: ${adSubmitSuccess.placementType}\nSeries: ${adSubmitSuccess.targetComicTitle}\n\nCampaign Description:\n${adSubmitSuccess.description}`
                )}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Send Brand Assets to aathiraicomic@gmail.com</span>
              </a>
            </div>
          </div>
        )}

        {/* Interactive Ad Placement Request Form */}
        {showAdRequestForm && (
          <form
            onSubmit={handleSubmitCompanyAdRequest}
            className="p-5 sm:p-6 rounded-2xl bg-slate-950/90 border border-indigo-400/30 space-y-4 text-xs animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-white font-heading">
                  Request Company Ad &amp; Character Promotion in Comic Pages
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Describe how you want our comic character to promote your product or service. Direct queries:{' '}
                  <a href="mailto:aathiraicomic@gmail.com" className="text-amber-300 underline font-mono">
                    aathiraicomic@gmail.com
                  </a>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdRequestForm(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {adSubmitError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 font-semibold">
                {adSubmitError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Company / Brand Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Zest Beverages Pvt Ltd"
                  value={adCompanyName}
                  onChange={(e) => setAdCompanyName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Contact Person *</label>
                <input
                  type="text"
                  required
                  placeholder="Your Full Name"
                  value={adContactName}
                  onChange={(e) => setAdContactName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Work / Business Email *</label>
                <input
                  type="email"
                  required
                  placeholder="brand@company.com"
                  value={adContactEmail}
                  onChange={(e) => setAdContactEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Phone / WhatsApp (Optional)</label>
                <input
                  type="text"
                  placeholder="+91 98XXXXXXXX"
                  value={adContactPhone}
                  onChange={(e) => setAdContactPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Ad Placement Type *</label>
                <select
                  value={adPlacementType}
                  onChange={(e) => setAdPlacementType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="character_promotion">In-Comic Character Promotion (Character promotes inside comic pages)</option>
                  <option value="sponsored_page">Full Sponsored Comic Page (Inside Episode)</option>
                  <option value="episode_sponsor">Episode &amp; Series Sponsor Banner</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Target Comic Series</label>
                <select
                  value={adTargetComic}
                  onChange={(e) => setAdTargetComic(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="Any Popular Comic Series">Any Popular Comic Series</option>
                  {comics.map((c) => (
                    <option key={c.id} value={c.title}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Estimated Campaign Budget</label>
                <select
                  value={adBudgetRange}
                  onChange={(e) => setAdBudgetRange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="₹5,000 – ₹15,000">₹5,000 – ₹15,000 (Single Episode Spotlight)</option>
                  <option value="₹15,000 – ₹50,000">₹15,000 – ₹50,000 (Multi-Page Character Integration)</option>
                  <option value="₹50,000+ / Custom Campaign">₹50,000+ / Custom Brand Arc</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">
                Campaign Description &amp; How Our Comic Character Should Promote Your Company *
              </label>
              <textarea
                rows={3}
                required
                placeholder="Example: Feature our energy drink or app naturally inside our sci-fi or fantasy comic scene where the main character drinks/recommends it in 2 comic panels with our brand tagline..."
                value={adDescription}
                onChange={(e) => setAdDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <a
                href="mailto:aathiraicomic@gmail.com?subject=Company%20Ad%20Inquiry%20-%20Aathirai_Comic"
                className="inline-flex items-center gap-1.5 text-amber-300 hover:text-amber-200 font-bold"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Or email Admin directly: aathiraicomic@gmail.com</span>
              </a>

              <button
                type="submit"
                disabled={isSubmittingAd}
                className="py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-extrabold uppercase tracking-wider flex items-center gap-2 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmittingAd ? 'Submitting Request...' : 'Submit Company Ad Request'}</span>
              </button>
            </div>
          </form>
        )}
      </section>

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
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setCurrentTab('become_author')}
              className="py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition-transform hover:scale-105 flex items-center gap-2 cursor-pointer"
            >
              <PenTool className="w-4 h-4" />
              <span>Apply for Author Account</span>
            </button>
            <a
              href="mailto:aathiraicomic@gmail.com?subject=Contact%20Admin%20-%20Aathirai_Comic"
              className="py-3 px-5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs uppercase tracking-wider transition-colors flex items-center gap-2"
            >
              <Mail className="w-4 h-4 text-amber-400" />
              <span>Contact Admin · aathiraicomic@gmail.com</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};
