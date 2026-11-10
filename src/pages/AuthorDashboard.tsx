import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Comic, Episode, Chapter } from '../types/comic';
import {
  PenTool,
  Plus,
  BookOpen,
  IndianRupee,
  Eye,
  Star,
  Layers,
  Upload,
  Trash2,
  Edit3,
  Calendar,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  ArrowRight,
  TrendingUp,
  Sliders,
  Paperclip,
  FileUp
} from 'lucide-react';

interface AuthorDashboardProps {
  comics: Comic[];
  onRefreshComics: () => void;
  onOpenEpisode: (episodeId: string) => void;
  setCurrentTab: (tab: string) => void;
}

export const AuthorDashboard: React.FC<AuthorDashboardProps> = ({
  comics,
  onRefreshComics,
  onOpenEpisode,
  setCurrentTab,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'comics' | 'new-comic' | 'episodes' | 'earnings'>('comics');
  const [authorComics, setAuthorComics] = useState<Comic[]>([]);
  const [selectedComic, setSelectedComic] = useState<Comic | null>(null);

  // New Comic Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newGenre, setNewGenre] = useState('Fantasy');
  const [newCover, setNewCover] = useState('/src/assets/images/comic_cover_blade_1794269871791.jpg');
  const [newAccess, setNewAccess] = useState<'free' | 'premium'>('free');
  const [newFullPrice, setNewFullPrice] = useState(99);
  const [newEpPrice, setNewEpPrice] = useState(10);
  const [isSubmittingComic, setIsSubmittingComic] = useState(false);

  // New Chapter Form State
  const [chapterTitle, setChapterTitle] = useState('');

  // Attached Comic File State (Author)
  const [attachedComicFile, setAttachedComicFile] = useState<{
    name: string;
    size: string;
    type: string;
    dataUrl?: string;
  } | null>(null);

  // Submission to Admin State
  const [isSubmittingForApproval, setIsSubmittingForApproval] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<string | null>(null);
  const [submitForApprovalOnCreate, setSubmitForApprovalOnCreate] = useState(true);

  // New Episode Form State
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeSynopsis, setEpisodeSynopsis] = useState('');
  const [episodeIsPremium, setEpisodeIsPremium] = useState(true);
  const [episodePrice, setEpisodePrice] = useState(10);
  const [episodePagesCount, setEpisodePagesCount] = useState(4);
  const [isPublishingEpisode, setIsPublishingEpisode] = useState(false);

  // Earnings data
  const [analytics, setAnalytics] = useState<{
    totalEarningsInr: number;
    purchasesCount: number;
    totalViews: number;
    recentTransactions: any[];
  }>({
    totalEarningsInr: 2840.0,
    purchasesCount: 14,
    totalViews: 87350,
    recentTransactions: [],
  });

  const [payoutRequested, setPayoutRequested] = useState(false);

  useEffect(() => {
    // Filter author comics (or default to user id / rajesh)
    const myComics = comics.filter(c => c.authorId === user?.id || c.authorName === user?.name || user?.role === 'author');
    setAuthorComics(myComics);
    if (myComics.length > 0 && !selectedComic) {
      setSelectedComic(myComics[0]);
      if (myComics[0].chapters.length > 0) {
        setSelectedChapterId(myComics[0].chapters[0].id);
      }
    }
  }, [comics, user]);

  useEffect(() => {
    if (user) {
      fetch(`/api/author/analytics?authorId=${user.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.totalEarningsInr !== undefined) {
            setAnalytics(data);
          }
        })
        .catch(console.error);
    }
  }, [user]);

  // Handle Author Comic Submission for Admin Approval
  const handleSubmitComicForReview = async (comicId: string) => {
    setIsSubmittingForApproval(true);
    setSubmissionFeedback(null);
    try {
      const res = await fetch('/api/author/comics/submit-for-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comicId }),
      });
      const data = await res.json();
      setIsSubmittingForApproval(false);
      if (res.ok) {
        setSubmissionFeedback(`"${data.comic?.title || 'Your comic'}" has been submitted to the Administrator for approval! Once approved, it will be automatically published live on the website.`);
        onRefreshComics();
        if (data.comic) setSelectedComic(data.comic);
        setTimeout(() => setSubmissionFeedback(null), 8000);
      }
    } catch (e) {
      setIsSubmittingForApproval(false);
      console.error(e);
    }
  };

  // Handle file attachment for author comic creation
  const handleAuthorFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formattedSize = file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(file.size / 1024).toFixed(1)} KB`;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedComicFile({
          name: file.name,
          size: formattedSize,
          type: file.type || 'image',
          dataUrl: reader.result as string,
        });
      };
      reader.readAsDataURL(file);
    } else {
      setAttachedComicFile({
        name: file.name,
        size: formattedSize,
        type: file.name.split('.').pop()?.toUpperCase() || 'DOCUMENT',
      });
    }
  };

  // Handle Comic Creation
  const handleCreateComic = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingComic(true);

    try {
      const res = await fetch('/api/comics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          authorId: user?.id || 'usr_rajesh',
          authorName: user?.name || 'Rajesh Singh',
          genre: [newGenre],
          coverImage: newCover,
          description: newDesc,
          accessType: newAccess,
          fullPriceInr: newAccess === 'premium' ? newFullPrice : 0,
          chapterPriceInr: newAccess === 'premium' ? 30 : 0,
          episodePriceInr: newAccess === 'premium' ? newEpPrice : 0,
          attachedFileName: attachedComicFile?.name,
          attachedFileSize: attachedComicFile?.size,
          attachedFileType: attachedComicFile?.type,
        }),
      });

      const data = await res.json();

      if (res.ok && data.comic) {
        if (submitForApprovalOnCreate) {
          // Send immediately for admin approval with attached file info
          await fetch('/api/author/comics/submit-for-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              comicId: data.comic.id,
              attachedFileName: attachedComicFile?.name,
              attachedFileSize: attachedComicFile?.size,
              attachedFileType: attachedComicFile?.type,
            }),
          });
          setSubmissionFeedback(`"${data.comic.title}" was created and submitted with attached file to Admin for approval! Once approved, it will be automatically published on the website.`);
          setTimeout(() => setSubmissionFeedback(null), 8000);
        }

        setIsSubmittingComic(false);
        onRefreshComics();
        setSelectedComic(data.comic);
        setActiveTab('comics');
        setNewTitle('');
        setNewDesc('');
        setAttachedComicFile(null);
      } else {
        setIsSubmittingComic(false);
      }
    } catch (err) {
      setIsSubmittingComic(false);
      console.error(err);
    }
  };

  // Handle Chapter Creation
  const handleAddChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComic || !chapterTitle.trim()) return;

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: chapterTitle.trim() }),
      });

      if (res.ok) {
        onRefreshComics();
        setChapterTitle('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Episode Creation
  const handleAddEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComic || !selectedChapterId || !episodeTitle.trim()) return;

    setIsPublishingEpisode(true);

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters/${selectedChapterId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: episodeTitle,
          synopsis: episodeSynopsis,
          isPremium: episodeIsPremium,
          priceInr: episodeIsPremium ? episodePrice : 0,
        }),
      });

      setIsPublishingEpisode(false);
      if (res.ok) {
        onRefreshComics();
        setEpisodeTitle('');
        setEpisodeSynopsis('');
        setActiveTab('comics');
      }
    } catch (e) {
      setIsPublishingEpisode(false);
      console.error(e);
    }
  };

  return (
    <div className="space-y-8 pb-24">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
              <PenTool className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white font-heading">
              Author Publishing Studio
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Logged in as <strong className="text-slate-800 dark:text-slate-200">{user?.name}</strong> · Verified Creator Privileges Active
          </p>
        </div>

        <button
          onClick={() => setActiveTab('new-comic')}
          className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Comic Book</span>
        </button>
      </div>

      {/* KPI STATS ROW */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            My Published Series
          </span>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono mt-1">
            {authorComics.length}
          </div>
          <span className="text-[10px] text-emerald-500 font-semibold mt-1 block">Active on Catalog</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Total Reader Reads
          </span>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono mt-1">
            {analytics.totalViews.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Across all episodes</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Total Author Earnings
          </span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1">
            ₹{analytics.totalEarningsInr.toFixed(2)}
          </div>
          <span className="text-[10px] text-emerald-500 font-semibold mt-1 block">70% Net Revenue Share</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Paid Unlocks
          </span>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono mt-1">
            {analytics.purchasesCount}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Episodes &amp; Chapters</span>
        </div>
      </div>

      {/* DASHBOARD TABS */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 max-w-lg">
        <button
          onClick={() => setActiveTab('comics')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
            activeTab === 'comics'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          My Comics &amp; Episodes
        </button>
        <button
          onClick={() => setActiveTab('new-comic')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
            activeTab === 'new-comic'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Upload Comic
        </button>
        <button
          onClick={() => setActiveTab('earnings')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
            activeTab === 'earnings'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          INR Payouts (₹)
        </button>
      </div>

      {/* TAB 1: COMICS & EPISODES MANAGER */}
      {activeTab === 'comics' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Comics List (Left) */}
          <div className="lg:col-span-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Select Series to Manage:
            </h3>

            <div className="space-y-3">
              {authorComics.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedComic(c)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                    selectedComic?.id === c.id
                      ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-500 shadow-sm'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <img
                    src={c.coverImage}
                    alt={c.title}
                    className="w-12 h-16 rounded-lg object-cover shrink-0"
                  />
                    <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                        {c.title}
                      </h4>
                      {c.moderationStatus === 'pending' ? (
                        <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                          Pending Approval
                        </span>
                      ) : c.moderationStatus === 'approved' ? (
                        <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                          Live
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold text-slate-400 bg-slate-500/10 border border-slate-500/20 px-1.5 py-0.5 rounded">
                          Draft
                        </span>
                      )}
                      {c.accessType === 'premium' ? (
                        <span className="text-[10px] font-bold text-amber-500 ml-auto">₹{c.fullPriceInr}</span>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-500 ml-auto">Free</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {c.genre.join(', ')} · {c.chapters.length} Chapters
                    </p>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 font-mono">
                      <span>{c.totalViews.toLocaleString()} views</span>
                      <span>★ {c.averageRating}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chapter & Episode Breakdown (Right) */}
          <div className="lg:col-span-7 space-y-6">
            {selectedComic ? (
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
                
                {/* Submission Toast / Feedback */}
                {submissionFeedback && (
                  <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{submissionFeedback}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-heading">
                        {selectedComic.title}
                      </h3>
                      {selectedComic.moderationStatus === 'pending' ? (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Pending Admin Approval</span>
                        </span>
                      ) : selectedComic.moderationStatus === 'approved' ? (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Live Published</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          <span>Draft / Not Submitted</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <p className="text-xs text-slate-500">
                        Organize content hierarchy: Comic Book → Chapters → Episodes → Pages
                      </p>
                      {selectedComic.attachedFileName && (
                        <span className="text-[10px] text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1">
                          <Paperclip className="w-3 h-3" />
                          <span>Attached Manuscript: {selectedComic.attachedFileName} ({selectedComic.attachedFileSize || 'Uploaded'})</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSubmitComicForReview(selectedComic.id)}
                      disabled={isSubmittingForApproval}
                      className={`py-2 px-3.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-all cursor-pointer ${
                        selectedComic.moderationStatus === 'pending'
                          ? 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30'
                          : 'bg-rose-600 hover:bg-rose-500 text-white'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {isSubmittingForApproval
                          ? 'Submitting...'
                          : selectedComic.moderationStatus === 'pending'
                          ? 'Update & Re-Submit'
                          : 'Send Comic for Admin Approval'}
                      </span>
                    </button>
                  </div>
                </div>

                {selectedComic.moderationStatus === 'pending' && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                    <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Submission in Admin Queue:</strong> This comic has been submitted to the platform administrator. Once approved, it will be automatically uploaded and visible live to readers!
                    </span>
                  </div>
                )}

                {/* Add Chapter Quick Form */}
                <form onSubmit={handleAddChapter} className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="New Chapter Title (e.g. Chapter 3: The Siege)"
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shrink-0 transition-colors cursor-pointer"
                  >
                    Add Chapter
                  </button>
                </form>

                {/* Add Episode Form inside this chapter */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Upload Episode to Chapter
                    </h4>
                    <span className="text-[11px] text-slate-400">Step 2: Add Episode &amp; Pages</span>
                  </div>

                  <form onSubmit={handleAddEpisode} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Select Chapter *
                        </label>
                        <select
                          value={selectedChapterId}
                          onChange={(e) => setSelectedChapterId(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none"
                        >
                          {selectedComic.chapters.map(ch => (
                            <option key={ch.id} value={ch.id}>
                              Chapter {ch.chapterNumber}: {ch.title}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Episode Title *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Episode 4: Fire on the Shore"
                          value={episodeTitle}
                          onChange={(e) => setEpisodeTitle(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Episode Synopsis
                      </label>
                      <input
                        type="text"
                        placeholder="Brief summary shown to readers..."
                        value={episodeSynopsis}
                        onChange={(e) => setEpisodeSynopsis(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={episodeIsPremium}
                          onChange={(e) => setEpisodeIsPremium(e.target.checked)}
                          className="rounded text-rose-600 focus:ring-rose-500"
                        />
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          Mark as Premium Episode (Pay-per-read)
                        </span>
                      </label>

                      {episodeIsPremium && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Price:</span>
                          <span className="font-bold text-slate-900 dark:text-white">₹</span>
                          <input
                            type="number"
                            min="5"
                            max="100"
                            value={episodePrice}
                            onChange={(e) => setEpisodePrice(Number(e.target.value))}
                            className="w-16 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                          <span className="text-slate-400 font-mono">INR</span>
                        </div>
                      )}
                    </div>

                    {/* Comic Pages Manager Preview */}
                    <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Episode Pages: ({episodePagesCount} high-res graphic panels)</span>
                        <span className="text-emerald-500 text-[11px]">Ready to Render</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center text-[10px] text-slate-400">
                        <div className="p-2 rounded bg-slate-100 dark:bg-slate-800">Panel 1 (Title)</div>
                        <div className="p-2 rounded bg-slate-100 dark:bg-slate-800">Panel 2 (Combat)</div>
                        <div className="p-2 rounded bg-slate-100 dark:bg-slate-800">Panel 3 (Dialog)</div>
                        <div className="p-2 rounded bg-slate-100 dark:bg-slate-800">Panel 4 (Cliffhanger)</div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isPublishingEpisode}
                      className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                    >
                      {isPublishingEpisode ? 'Publishing Episode...' : 'Publish Episode to Aathirai Network'}
                    </button>
                  </form>
                </div>

                {/* Existing Chapters & Episodes List */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Published Content in this Series:
                  </h4>

                  {selectedComic.chapters.map((ch) => (
                    <div key={ch.id} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between font-bold text-xs text-slate-900 dark:text-white">
                        <span>Chapter {ch.chapterNumber}: {ch.title}</span>
                        <span className="text-slate-400 font-normal">{ch.episodes.length} episodes</span>
                      </div>

                      <div className="space-y-1.5 pl-2">
                        {ch.episodes.map(ep => (
                          <div key={ep.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                            <span className="text-slate-600 dark:text-slate-300">
                              Ep {ep.episodeNumber}: {ep.title}
                            </span>
                            <div className="flex items-center gap-2">
                              {ep.isPremium ? (
                                <span className="text-[10px] font-bold text-amber-500">₹{ep.priceInr}</span>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-500">Free</span>
                              )}
                              <button
                                onClick={() => onOpenEpisode(ep.id)}
                                className="text-[11px] text-rose-500 hover:underline font-semibold"
                              >
                                Preview
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400 text-xs">
                Select a comic from the left panel to manage chapters and episodes.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: UPLOAD NEW COMIC BOOK FORM */}
      {activeTab === 'new-comic' && (
        <form
          onSubmit={handleCreateComic}
          className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-w-3xl mx-auto space-y-6"
        >
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
              Create New Comic Series
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Set up title, genres, cover artwork, and commercial access options.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Comic Book Title *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Chronicles of Coromandel"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Primary Genre *
              </label>
              <select
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none"
              >
                <option>Action</option>
                <option>Fantasy</option>
                <option>Mythology</option>
                <option>Sci-Fi</option>
                <option>Cyberpunk</option>
                <option>Romance</option>
                <option>Slice of Life</option>
                <option>Horror</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Cover Image Selection
            </label>
            <div className="grid grid-cols-4 gap-3">
              {[
                { name: 'Virasen Warrior', path: '/src/assets/images/comic_cover_blade_1794269871791.jpg' },
                { name: 'Neo Madras Cyber', path: '/src/assets/images/comic_cover_cyber_1794269871978.jpg' },
                { name: 'Mahishur Mystic', path: '/src/assets/images/comic_cover_mystic_1794269871981.jpg' },
                { name: 'Monsoon Romance', path: '/src/assets/images/comic_cover_chronicles_1794269872270.jpg' },
              ].map(img => (
                <div
                  key={img.path}
                  onClick={() => setNewCover(img.path)}
                  className={`p-1 rounded-xl border cursor-pointer overflow-hidden transition-all ${
                    newCover === img.path ? 'border-rose-500 ring-2 ring-rose-500/30' : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  <img src={img.path} alt={img.name} className="w-full aspect-[3/4] object-cover rounded-lg" />
                  <span className="text-[10px] text-center block mt-1 truncate font-medium">{img.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Attach Comic Book File */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-rose-500" />
                <span>Attach Comic Book File *</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                Supported: PDF, CBZ, CBR, ZIP, PNG, JPG (up to 50MB)
              </span>
            </label>

            {!attachedComicFile ? (
              <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-500 dark:hover:border-rose-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-800/40 group">
                <input
                  type="file"
                  accept=".pdf,.cbz,.cbr,.zip,.png,.jpg,.jpeg"
                  onChange={handleAuthorFileChange}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                  <FileUp className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Click to Browse or Drag &amp; Drop Comic File
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  Attach your completed comic manuscript, PDF issue, or archive of page panels
                </span>
              </label>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0 font-bold text-xs uppercase">
                    {attachedComicFile.type.slice(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {attachedComicFile.name}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <span className="font-mono">{attachedComicFile.size}</span>
                      <span>·</span>
                      <span className="text-emerald-500 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Ready to Submit
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setAttachedComicFile(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                  title="Remove attached file"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Series Synopsis &amp; Description *
            </label>
            <textarea
              rows={3}
              required
              placeholder="Tell readers about your comic world, conflicts, and main characters..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
            />
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Access &amp; Monetization Model
            </label>
            
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                <input
                  type="radio"
                  name="access"
                  checked={newAccess === 'free'}
                  onChange={() => setNewAccess('free')}
                  className="text-rose-600"
                />
                <span>Free to Read (Ad-supported &amp; community)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                <input
                  type="radio"
                  name="access"
                  checked={newAccess === 'premium'}
                  onChange={() => setNewAccess('premium')}
                  className="text-rose-600"
                />
                <span>Premium Series (Paid episodes / full unlock)</span>
              </label>
            </div>

            {newAccess === 'premium' && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Complete Comic Unlock (₹ INR)
                  </label>
                  <input
                    type="number"
                    value={newFullPrice}
                    onChange={(e) => setNewFullPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Single Episode Default Price (₹ INR)
                  </label>
                  <input
                    type="number"
                    value={newEpPrice}
                    onChange={(e) => setNewEpPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Submission to Admin Option */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400 block">
                Submit for Administrator Approval &amp; Live Publication
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Your comic will be sent to the Admin queue and automatically published live on the website upon approval.
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={submitForApprovalOnCreate}
                onChange={(e) => setSubmitForApprovalOnCreate(e.target.checked)}
                className="w-4 h-4 text-rose-600 rounded focus:ring-rose-500"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={isSubmittingComic}
            className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Upload className="w-4 h-4" />
            <span>
              {isSubmittingComic
                ? 'Processing Comic...'
                : submitForApprovalOnCreate
                ? 'Create & Send Comic for Admin Approval'
                : 'Create Comic as Draft'}
            </span>
          </button>
        </form>
      )}

      {/* TAB 3: EARNINGS & INDIAN PAYOUTS */}
      {activeTab === 'earnings' && (
        <div className="space-y-6 max-w-4xl mx-auto">
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-heading">
                  Creator Earnings &amp; Revenue Share
                </h3>
                <p className="text-xs text-slate-500">
                  You receive <strong className="text-emerald-500 font-bold">70%</strong> of gross INR sales from your premium episodes and comics.
                </p>
              </div>

              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Available Balance</span>
                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  ₹{analytics.totalEarningsInr.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Payout Request Card */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                  Direct Bank Transfer / UPI Payout
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Minimum withdrawal threshold: ₹500. Transfer initiated within 2 business days.
                </p>
              </div>

              <button
                onClick={() => setPayoutRequested(true)}
                disabled={payoutRequested || analytics.totalEarningsInr < 500}
                className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-colors disabled:opacity-40 shrink-0"
              >
                {payoutRequested ? 'Payout Request Pending Review' : 'Request Payout (₹' + analytics.totalEarningsInr.toFixed(2) + ')'}
              </button>
            </div>

            {payoutRequested && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Your withdrawal request for ₹{analytics.totalEarningsInr.toFixed(2)} has been queued for administrator bank processing!</span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
