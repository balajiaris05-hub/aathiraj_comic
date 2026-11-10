import React, { useState } from 'react';
import { Comic } from '../types/comic';
import { ComicCard } from '../components/ComicCard';
import { Search, Filter, SlidersHorizontal, ArrowUpDown } from 'lucide-react';

interface BooksPageProps {
  comics: Comic[];
  onSelectComic: (comic: Comic) => void;
}

export const BooksPage: React.FC<BooksPageProps> = ({ comics, onSelectComic }) => {
  const [search, setSearch] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [accessFilter, setAccessFilter] = useState<'all' | 'free' | 'premium'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'rating' | 'popular'>('popular');

  const genres = ['All', 'Action', 'Fantasy', 'Mythology', 'Sci-Fi', 'Cyberpunk', 'Romance', 'Slice of Life'];

  // Filter & Sort
  const filtered = comics
    .filter((c) => {
      const matchSearch =
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.authorName.toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase());
      const matchGenre = selectedGenre === 'All' || c.genre.includes(selectedGenre);
      const matchAccess =
        accessFilter === 'all' ||
        (accessFilter === 'free' && c.accessType === 'free') ||
        (accessFilter === 'premium' && c.accessType === 'premium');
      return matchSearch && matchGenre && matchAccess;
    })
    .sort((a, b) => {
      if (sortBy === 'rating') return b.averageRating - a.averageRating;
      if (sortBy === 'popular') return b.totalViews - a.totalViews;
      if (sortBy === 'latest') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return 0;
    });

  return (
    <div className="space-y-8 pb-20">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-heading">
          All Published Comic Books &amp; Series
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
          Explore {comics.length} serialized stories, high-octane sagas, and gentle slice-of-life manga from top creators.
        </p>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          
          {/* Search Box */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search comics by title, author, or keyword..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          {/* Access Filter Tabs (All / Free / Premium) */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl shrink-0">
            <button
              onClick={() => setAccessFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                accessFilter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Comics
            </button>
            <button
              onClick={() => setAccessFilter('free')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                accessFilter === 'free'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Free Comics
            </button>
            <button
              onClick={() => setAccessFilter('premium')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
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

        {/* Genre Pill Selection */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 font-semibold shrink-0 mr-1">Genres:</span>
          {genres.map((g) => (
            <button
              key={g}
              onClick={() => setSelectedGenre(g)}
              className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition-colors ${
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

      {/* Grid of Results */}
      {filtered.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No comic books match your search or filter criteria.
          </p>
          <button
            onClick={() => { setSearch(''); setSelectedGenre('All'); setAccessFilter('all'); }}
            className="px-4 py-2 text-xs font-bold bg-rose-600 text-white rounded-lg hover:bg-rose-500"
          >
            Clear All Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {filtered.map((comic) => (
            <ComicCard
              key={comic.id}
              comic={comic}
              onClick={() => onSelectComic(comic)}
            />
          ))}
        </div>
      )}

    </div>
  );
};
