import React, { useState } from 'react';
import { Comic } from '../types/comic';
import { ComicCard } from '../components/ComicCard';
import {
  Search,
  ArrowUpDown,
  LayoutGrid,
  List,
  Star,
  Eye,
  BookOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface BooksPageProps {
  comics: Comic[];
  onSelectComic: (comic: Comic) => void;
}

const ITEMS_PER_PAGE = 8;

export const BooksPage: React.FC<BooksPageProps> = ({ comics, onSelectComic }) => {
  const [search, setSearch] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Ongoing' | 'Completed'>('All');
  const [accessFilter, setAccessFilter] = useState<'all' | 'free' | 'premium'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'rating' | 'popular'>('popular');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [currentPage, setCurrentPage] = useState(1);

  const genres = ['All', 'Action', 'Fantasy', 'Mythology', 'Sci-Fi', 'Cyberpunk', 'Romance', 'Slice of Life'];

  // Filter & Sort
  const filtered = comics
    .filter((c) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q);
      const matchGenre = selectedGenre === 'All' || c.genre.includes(selectedGenre);
      const matchStatus = statusFilter === 'All' || c.status === statusFilter;
      const matchAccess =
        accessFilter === 'all' ||
        (accessFilter === 'free' && c.accessType === 'free') ||
        (accessFilter === 'premium' && c.accessType === 'premium');
      return matchSearch && matchGenre && matchStatus && matchAccess;
    })
    .sort((a, b) => {
      if (sortBy === 'rating') return b.averageRating - a.averageRating;
      if (sortBy === 'popular') return b.totalViews - a.totalViews;
      if (sortBy === 'latest') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return 0;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedComics = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-heading">
            All Published Comic Books &amp; Series
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Explore {comics.length} serialized stories, high-octane sagas, and gentle slice-of-life manga from top
            creators.
          </p>
        </div>

        {/* Grid vs List View Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 self-start">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-rose-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'list'
                ? 'bg-rose-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
        <div className="flex flex-col lg:flex-row items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search comics by title, author, or keyword..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl shrink-0">
            {(['All', 'Ongoing', 'Completed'] as const).map((st) => (
              <button
                key={st}
                onClick={() => {
                  setStatusFilter(st);
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Access Filter Tabs (All / Free / Premium) */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl shrink-0">
            <button
              onClick={() => {
                setAccessFilter('all');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                accessFilter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => {
                setAccessFilter('free');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                accessFilter === 'free'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Free
            </button>
            <button
              onClick={() => {
                setAccessFilter('premium');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                accessFilter === 'premium'
                  ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Premium (INR ₹)
            </button>
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto">
            <ArrowUpDown className="w-4 h-4 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
            >
              <option value="popular">Most Popular</option>
              <option value="rating">Highest Rated</option>
              <option value="latest">Latest Uploads</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Genre Selection */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 font-semibold shrink-0 mr-1">Genres:</span>
          {genres.map((g) => (
            <button
              key={g}
              onClick={() => {
                setSelectedGenre(g);
                setCurrentPage(1);
              }}
              className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer ${
                selectedGenre === g
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Results View (Grid or List) */}
      {paginatedComics.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No comic books match your search or filter criteria.
          </p>
          <button
            onClick={() => {
              setSearch('');
              setSelectedGenre('All');
              setStatusFilter('All');
              setAccessFilter('all');
              setCurrentPage(1);
            }}
            className="px-4 py-2 text-xs font-bold bg-rose-600 text-white rounded-lg hover:bg-rose-500 cursor-pointer"
          >
            Clear All Filters
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {paginatedComics.map((comic) => (
            <ComicCard key={comic.id} comic={comic} onClick={() => onSelectComic(comic)} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedComics.map((comic) => {
            const epCount = comic.chapters.reduce((acc, ch) => acc + ch.episodes.length, 0);
            return (
              <div
                key={comic.id}
                onClick={() => onSelectComic(comic)}
                className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-rose-500 transition-all flex flex-col sm:flex-row items-start sm:items-center gap-5 cursor-pointer group shadow-sm"
              >
                <img
                  src={comic.coverImage}
                  alt={comic.title}
                  className="w-24 h-32 rounded-xl object-cover shrink-0 border border-slate-200 dark:border-slate-800"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      {comic.genre.join(' · ')}
                    </span>
                    <span>·</span>
                    <span className="font-semibold text-slate-500">{comic.status}</span>
                    <span>·</span>
                    <span
                      className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                        comic.accessType === 'premium'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {comic.accessType === 'premium' ? 'PREMIUM (₹49 / ₹249)' : 'FREE SERIES'}
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-white group-hover:text-rose-500 transition-colors font-heading">
                    {comic.title}
                  </h3>
                  <p className="text-xs text-slate-500">By {comic.authorName}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                    {comic.description}
                  </p>
                </div>
                <div className="flex sm:flex-col items-end justify-between gap-2 text-xs text-slate-500 shrink-0">
                  <span className="flex items-center gap-1 font-bold text-amber-500">
                    <Star className="w-3.5 h-3.5 fill-amber-500" />
                    <span>{comic.averageRating}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" />
                    <span>{comic.totalViews.toLocaleString()}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{epCount} Episodes</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Prev</span>
          </button>
          <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
            Page {safePage} of {totalPages} ({filtered.length} comics)
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
