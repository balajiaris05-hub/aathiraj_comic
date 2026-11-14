import React, { useState, useEffect, useRef } from 'react';
import { Episode, Comment } from '../types/comic';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  Star,
  MessageSquare,
  Lock,
  Sliders,
  Send,
  Trash2,
  CornerDownRight,
  BookOpen,
  Edit3,
  Flag,
  Heart,
  Bookmark,
  Columns2,
} from 'lucide-react';
import { RazorpayCheckoutModal } from './RazorpayCheckoutModal';

interface ComicReaderProps {
  episodeId: string;
  onClose: () => void;
  onSelectEpisode: (epId: string) => void;
  onRedirectToPremium?: () => void;
  openAuthModal: () => void;
}

export const ComicReader: React.FC<ComicReaderProps> = ({
  episodeId,
  onClose,
  onSelectEpisode,
  onRedirectToPremium,
  openAuthModal,
}) => {
  const {
    user,
    actualDbRole,
    refreshUser,
    getAuthHeaders,
    toggleBookmark,
    toggleFavorite,
    saveReadingProgress,
  } = useAuth();

  const [data, setData] = useState<{
    episode: Episode;
    comic: {
      id: string;
      title: string;
      authorName: string;
      accessType: string;
      coverImage: string;
    };
    chapter: { id: string; title: string; chapterNumber: number };
    prevEpisodeId?: string | null;
    nextEpisodeId?: string | null;
    allEpisodes?: { id: string; episodeNumber: number; title: string; chapterNumber: number }[];
    hasAccess: boolean;
    isPaywalled?: boolean;
    accessReason?: string;
    verification?: {
      verifiedAt: string;
      verifiedGmail: string | null;
      verifiedPhone: string | null;
      hasActiveSubscription: boolean;
      activePlan: '1_month' | '6_months' | null;
      expiresAt?: string;
      activeReceipt?: string;
    };
    userVote: 'like' | 'dislike' | null;
    userRating: number | null;
    comments: Comment[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [readingMode, setReadingMode] = useState<'vertical' | 'page' | 'single' | 'double'>('vertical');
  const [fitMode, setFitMode] = useState<'width' | 'screen'>('width');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHud, setShowHud] = useState(true);

  // Touch swipe state
  const touchStartX = useRef<number | null>(null);

  // Interaction states
  const [likesCount, setLikesCount] = useState(0);
  const [dislikesCount, setDislikesCount] = useState(0);
  const [userVote, setUserVote] = useState<'like' | 'dislike' | null>(null);
  const [userRating, setUserRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [avgRating, setAvgRating] = useState<number>(5.0);
  const [totalRatings, setTotalRatings] = useState<number>(0);

  // Comments
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);

  // Payment checkout modal state (1 Month ₹49 or 6 Months ₹249)
  const [checkoutPlan, setCheckoutPlan] = useState<{
    open: boolean;
    planKey: '1_month' | '6_months';
    title: string;
    amountInr: number;
  }>({
    open: false,
    planKey: '1_month',
    title: '1 Month Premium Pass (30 Days)',
    amountInr: 49,
  });

  const readerContainerRef = useRef<HTMLDivElement>(null);

  const fetchEpisode = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/episodes/${episodeId}?userId=${encodeURIComponent(user?.id || '')}&email=${encodeURIComponent(
          user?.email || ''
        )}&phone=${encodeURIComponent(user?.phone || '')}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (res.ok) {
        if (!json.hasAccess && onRedirectToPremium) {
          onRedirectToPremium();
          return;
        }
        setData(json);
        setLikesCount(json.episode.likesCount || 0);
        setDislikesCount(json.episode.dislikesCount || 0);
        setUserVote(json.userVote || null);
        setUserRating(json.userRating || 0);
        setAvgRating(json.episode.averageRating || 5.0);
        setTotalRatings(json.episode.totalRatings || 0);
        setComments(json.comments || []);

        // Restore saved reading progress if available
        const savedProgress = user?.readingHistory?.find((h) => h.episodeId === episodeId);
        const restoredPage =
          savedProgress && savedProgress.pageIndex < (json.episode.pages?.length || 1)
            ? savedProgress.pageIndex
            : 0;
        setCurrentPageIndex(restoredPage);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisode();
  }, [episodeId, user?.id, user?.email, user?.premiumPlan]);

  // Preload next 2 pages & save reading progress
  useEffect(() => {
    if (!data || !data.hasAccess) return;
    const pages = data.episode.pages || [];

    // Preload next 2 page images
    [currentPageIndex + 1, currentPageIndex + 2].forEach((idx) => {
      if (pages[idx]?.imageUrl) {
        const img = new Image();
        img.src = pages[idx].imageUrl;
      }
    });

    if (user) {
      saveReadingProgress({
        episodeId: data.episode.id,
        comicId: data.comic.id,
        comicTitle: data.comic.title,
        episodeTitle: data.episode.title,
        episodeNumber: data.episode.episodeNumber,
        chapterNumber: data.chapter.chapterNumber,
        coverImage: data.comic.coverImage,
        pageIndex: currentPageIndex,
        totalPages: pages.length || 1,
      });
    }
  }, [currentPageIndex, data?.episode?.id, data?.hasAccess]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const pagesLen = data?.episode?.pages?.length || 0;
      const step = readingMode === 'double' ? 2 : 1;

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        if (readingMode !== 'vertical' && currentPageIndex < pagesLen - step) {
          e.preventDefault();
          setCurrentPageIndex((prev) => Math.min(pagesLen - 1, prev + step));
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (readingMode !== 'vertical' && currentPageIndex > 0) {
          e.preventDefault();
          setCurrentPageIndex((prev) => Math.max(0, prev - step));
        }
      } else if (e.key === '+' || e.key === '=') {
        setZoomLevel((prev) => Math.min(prev + 15, 200));
      } else if (e.key === '-') {
        setZoomLevel((prev) => Math.max(prev - 15, 60));
      } else if (e.key === '0') {
        setZoomLevel(100);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (isFullscreen) {
          toggleFullscreen();
        } else {
          onClose();
        }
      } else if (e.key === 'h' || e.key === 'H') {
        setShowHud((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readingMode, currentPageIndex, data, isFullscreen]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      readerContainerRef.current?.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Touch swipe handlers for mobile page navigation
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || readingMode === 'vertical' || !data) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const deltaX = endX - touchStartX.current;
    const step = readingMode === 'double' ? 2 : 1;
    const pagesLen = data.episode.pages?.length || 0;

    if (deltaX < -50 && currentPageIndex < pagesLen - step) {
      setCurrentPageIndex((prev) => Math.min(pagesLen - 1, prev + step));
    } else if (deltaX > 50 && currentPageIndex > 0) {
      setCurrentPageIndex((prev) => Math.max(0, prev - step));
    }
    touchStartX.current = null;
  };

  // Zoom handlers
  const zoomIn = () => setZoomLevel((prev) => Math.min(prev + 15, 200));
  const zoomOut = () => setZoomLevel((prev) => Math.max(prev - 15, 60));
  const resetZoom = () => setZoomLevel(100);

  // Voting
  const handleVote = async (type: 'like' | 'dislike') => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/episodes/${episodeId}/vote`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user.id, type }),
      });
      const resData = await res.json();
      if (res.ok) {
        setLikesCount(resData.likesCount);
        setDislikesCount(resData.dislikesCount);
        setUserVote(resData.userVote);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Star Rating
  const handleRate = async (stars: number) => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/episodes/${episodeId}/rate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user.id, stars }),
      });
      const resData = await res.json();
      if (res.ok) {
        setUserRating(resData.userRating);
        setAvgRating(resData.averageRating);
        setTotalRatings(resData.totalRatings);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Add Comment
  const handlePostComment = async (e: React.FormEvent, parentId?: string) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }

    const contentToPost = parentId ? replyContent : newComment;
    if (!contentToPost.trim()) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/episodes/${episodeId}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId: user.id,
          userName: user.name,
          userAvatar: user.avatar,
          userRole: user.role,
          content: contentToPost,
          parentId,
        }),
      });

      const resData = await res.json();
      if (res.ok && resData.comment) {
        if (parentId) {
          setComments((prev) =>
            prev.map((c) => {
              if (c.id === parentId) {
                return { ...c, replies: [...(c.replies || []), resData.comment] };
              }
              return c;
            })
          );
          setReplyParentId(null);
          setReplyContent('');
        } else {
          setComments((prev) => [resData.comment, ...prev]);
          setNewComment('');
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Edit Own Comment
  const handleSaveEditComment = async (commentId: string) => {
    if (!user || !editingContent.trim()) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/episodes/${episodeId}/comments/${commentId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          userId: user.id,
          content: editingContent.trim(),
        }),
      });
      if (res.ok) {
        setComments((prev) =>
          prev.map((c) => {
            if (c.id === commentId) {
              return { ...c, content: editingContent.trim(), isEdited: true };
            }
            if (c.replies) {
              return {
                ...c,
                replies: c.replies.map((r) =>
                  r.id === commentId ? { ...r, content: editingContent.trim(), isEdited: true } : r
                ),
              };
            }
            return c;
          })
        );
        setEditingCommentId(null);
        setEditingContent('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Like Comment
  const handleLikeComment = async (commentId: string) => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/episodes/${episodeId}/comments/${commentId}/like`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user.id }),
      });
      const resData = await res.json();
      if (res.ok && resData.comment) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, ...resData.comment } : c))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Report Comment
  const handleReportComment = async (comment: Comment) => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          reporterId: user.id,
          reporterEmail: user.email,
          targetType: 'comment',
          targetId: comment.id,
          episodeId,
          targetSummary: `${comment.userName}: "${comment.content.slice(0, 80)}"`,
          reason: 'Reported by reader for moderation review',
        }),
      });
      if (res.ok) {
        setReportFeedback('Comment reported to Administrator moderation queue.');
        setTimeout(() => setReportFeedback(null), 3500);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Comment
  const handleDeleteComment = async (commentId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/episodes/${episodeId}/comments/${commentId}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ userId: user?.id, role: actualDbRole }),
      });
      if (res.ok) {
        setComments((prev) =>
          prev
            .filter((c) => c.id !== commentId)
            .map((c) => ({
              ...c,
              replies: c.replies ? c.replies.filter((r) => r.id !== commentId) : [],
            }))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center text-white">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-rose-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold tracking-wide">Loading Comic Reader...</p>
        </div>
      </div>
    );
  }

  const { episode, comic, chapter, hasAccess, prevEpisodeId, nextEpisodeId, allEpisodes } = data;
  const pages = episode.pages || [];
  const isBookmarked = Boolean(user?.bookmarks?.includes(comic.id));
  const isFavorited = Boolean(user?.favorites?.includes(comic.id));

  return (
    <div
      ref={readerContainerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none"
    >
      {/* TOP HUD / CONTROLS BAR */}
      <div
        className={`transition-all duration-300 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 sm:gap-4 ${
          showHud ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Back + Info + Episode Selector */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            title="Exit Reader (ESC)"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-bold text-white truncate font-heading">{comic.title}</h2>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
              <span>Ch. {chapter.chapterNumber}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-rose-400 truncate">
                Ep {episode.episodeNumber}: {episode.title}
              </span>
            </div>
          </div>

          {allEpisodes && allEpisodes.length > 1 && (
            <select
              value={episode.id}
              onChange={(e) => onSelectEpisode(e.target.value)}
              className="hidden sm:block ml-2 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
            >
              {allEpisodes.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  Ch.{ep.chapterNumber} Ep.{ep.episodeNumber} — {ep.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Center: 4 Reading Modes & Fit Toggle */}
        <div className="hidden lg:flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => setReadingMode('vertical')}
            className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
              readingMode === 'vertical' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Vertical (Webtoon)
          </button>

          <button
            onClick={() => setReadingMode('page')}
            className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
              readingMode === 'page' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Manga Page
          </button>

          <button
            onClick={() => setReadingMode('single')}
            className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
              readingMode === 'single' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Single Fit
          </button>

          <button
            onClick={() => setReadingMode('double')}
            className={`px-2.5 py-1 rounded font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              readingMode === 'double' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span>Double Spread</span>
          </button>

          <div className="w-[1px] h-4 bg-slate-800 mx-1" />

          <button
            onClick={() => setFitMode(fitMode === 'width' ? 'screen' : 'width')}
            className="px-2 py-1 text-[11px] text-slate-300 hover:text-white cursor-pointer"
          >
            {fitMode === 'width' ? 'Fit Width' : 'Fit Screen'}
          </button>
        </div>

        {/* Right: Bookmark, Favorite, Zoom & Fullscreen */}
        <div className="flex items-center gap-1.5 shrink-0">
          {user && (
            <>
              <button
                type="button"
                onClick={() => toggleBookmark(comic.id)}
                title={isBookmarked ? 'Remove Bookmark' : 'Bookmark Series'}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  isBookmarked
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-amber-400' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => toggleFavorite(comic.id)}
                title={isFavorited ? 'Remove from Favorites' : 'Add to Favorites'}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  isFavorited
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Heart className={`w-4 h-4 ${isFavorited ? 'fill-rose-400' : ''}`} />
              </button>
            </>
          )}

          <div className="flex items-center bg-slate-950 rounded-lg border border-slate-800 p-0.5">
            <button
              onClick={zoomOut}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-slate-300 tabular-nums">{zoomLevel}%</span>
            <button
              onClick={zoomIn}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={resetZoom}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
              title="Reset Zoom (0)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Fullscreen Mode (F)"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Close (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* MOBILE READING MODE SWITCHER BAR */}
      <div className="lg:hidden flex items-center justify-between gap-1 px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-[11px]">
        <div className="flex items-center gap-1">
          {(['vertical', 'page', 'single', 'double'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setReadingMode(m)}
              className={`px-2 py-0.5 rounded font-bold capitalize cursor-pointer ${
                readingMode === m ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="font-mono text-slate-400">
          Pg {currentPageIndex + 1}/{pages.length}
        </span>
      </div>

      {/* FLOATING HUD TOGGLE BUTTON (distraction-free mode) */}
      <button
        onClick={() => setShowHud((prev) => !prev)}
        className="fixed bottom-4 right-4 z-40 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-300 shadow-xl backdrop-blur-md transition-all cursor-pointer"
        title="Toggle Distraction-free View (H)"
      >
        <Sliders className="w-4 h-4" />
      </button>

      {/* MAIN READING CANVAS VIEWPORT */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col items-center relative">
        {/* PREMIUM LOCK OVERLAY (If user does not have access) */}
        {!hasAccess ? (
          <div className="w-full max-w-xl mx-auto my-auto p-8 text-center space-y-6 bg-slate-900/95 border border-slate-800 rounded-3xl shadow-2xl backdrop-blur-md mt-12 mb-12">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 mx-auto flex items-center justify-center border border-amber-500/20">
              <Lock className="w-8 h-8" />
            </div>

            <div>
              <span className="text-xs uppercase font-extrabold tracking-wider text-amber-500">
                Paywalled Comic · Gmail Payment Verification Required
              </span>
              <h3 className="text-xl font-bold text-white mt-1">
                {comic.title} · Ep {episode.episodeNumber}: {episode.title}
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Every time you open a paywalled comic, we verify if your connected Gmail account has an active{' '}
                <strong className="text-amber-400">1 Month (₹49)</strong> or{' '}
                <strong className="text-amber-400">6 Months (₹249)</strong> Premium Pass.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="text-left">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">
                  Gmail Verification Check
                </span>
                <span className="font-mono font-bold text-rose-400">
                  {user ? `${user.email}${user.phone ? ` (${user.phone})` : ''}` : 'Not Signed In'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
                  No Active Premium Found
                </span>
                <button
                  type="button"
                  onClick={fetchEpisode}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer"
                >
                  Re-Verify
                </button>
              </div>
            </div>

            {!user ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    openAuthModal();
                  }}
                  className="w-full py-3.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-sm shadow-xl cursor-pointer"
                >
                  Login / Register with Gmail or Mobile to Unlock
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                <div className="p-4 rounded-2xl bg-slate-950 border border-rose-500/40 space-y-3 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-rose-400 block">1 Month Premium</span>
                    <div className="text-2xl font-black text-white font-mono mt-0.5">
                      ₹49 <span className="text-xs font-normal text-slate-400">/ 30 days</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Unlocks all paywalled comics for 1 month on {user.email}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCheckoutPlan({
                        open: true,
                        planKey: '1_month',
                        title: '1 Month Premium Pass (30 Days)',
                        amountInr: 49,
                      })
                    }
                    className="w-full py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider cursor-pointer text-center"
                  >
                    Pay ₹49 (1 Month)
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-b from-amber-500/15 to-slate-950 border-2 border-amber-500/60 space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-amber-400">6 Months Premium</span>
                      <span className="text-[9px] font-bold bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded">
                        Best Value
                      </span>
                    </div>
                    <div className="text-2xl font-black text-white font-mono mt-0.5">
                      ₹249 <span className="text-xs font-normal text-slate-300">/ 180 days</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1">
                      Unlocks all paywalled comics for 6 months on {user.email}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCheckoutPlan({
                        open: true,
                        planKey: '6_months',
                        title: '6 Months Premium Pass (180 Days)',
                        amountInr: 249,
                      })
                    }
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-extrabold text-xs uppercase tracking-wider cursor-pointer text-center"
                  >
                    Pay ₹249 (6 Months)
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* COMIC PAGES CONTENT */
          <div
            className="w-full flex flex-col items-center py-6 px-2 transition-all duration-200"
            style={{
              maxWidth:
                readingMode === 'double'
                  ? `${Math.min(zoomLevel * 14, 1500)}px`
                  : fitMode === 'width'
                    ? `${Math.min(zoomLevel * 8, 1200)}px`
                    : `${Math.min(zoomLevel * 6, 800)}px`,
            }}
          >
            {data.isPaywalled && data.verification?.verifiedGmail && (
              <div className="w-full mb-4 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center justify-between">
                <span>
                  ✓ Gmail Payment Verified ({data.verification.verifiedGmail}) ·{' '}
                  {data.verification.activePlan === '6_months'
                    ? '6 Months Pass (₹249)'
                    : '1 Month Pass (₹49)'}{' '}
                  Unlocked
                </span>
                {data.verification.expiresAt && (
                  <span className="text-[11px] font-mono text-emerald-300">
                    Valid till {new Date(data.verification.expiresAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}

            {readingMode === 'vertical' ? (
              /* 1. VERTICAL WEBTOON MODE */
              <div className="w-full space-y-4">
                {pages.map((p, idx) => (
                  <div
                    key={p.id || idx}
                    className="w-full rounded-lg overflow-hidden shadow-2xl border border-slate-800/60 bg-slate-900"
                  >
                    <img
                      src={p.imageUrl}
                      alt={`Page ${p.pageNumber || idx + 1}`}
                      loading="lazy"
                      className="w-full h-auto block select-none pointer-events-none"
                    />
                    {p.caption && (
                      <div className="p-2 text-center text-xs text-slate-400 bg-slate-950/90 border-t border-slate-800">
                        {p.caption}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : readingMode === 'double' ? (
              /* 4. DOUBLE-PAGE SPREAD MODE */
              <div className="w-full flex flex-col items-center space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                  {[pages[currentPageIndex], pages[currentPageIndex + 1]].map(
                    (pg, idx) =>
                      pg && (
                        <div
                          key={pg.id || idx}
                          className="rounded-xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-900"
                        >
                          <img
                            src={pg.imageUrl}
                            alt={`Page ${currentPageIndex + idx + 1}`}
                            className="w-full h-auto block select-none pointer-events-none"
                          />
                        </div>
                      )
                  )}
                </div>

                {/* Double-Page Navigation Controls */}
                <div className="flex items-center justify-between w-full max-w-md pt-2 px-4">
                  <button
                    onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 2))}
                    disabled={currentPageIndex === 0}
                    className="py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous Spread</span>
                  </button>

                  <span className="text-xs font-mono font-bold text-slate-400">
                    Pages {currentPageIndex + 1}–{Math.min(pages.length, currentPageIndex + 2)} of {pages.length}
                  </span>

                  <button
                    onClick={() => setCurrentPageIndex((prev) => Math.min(pages.length - 1, prev + 2))}
                    disabled={currentPageIndex + 2 >= pages.length}
                    className="py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Next Spread</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              /* 2 & 3. PAGE BY PAGE MANGA / SINGLE PAGE FIT MODE */
              <div className="w-full flex flex-col items-center space-y-4">
                {pages[currentPageIndex] && (
                  <div className="w-full rounded-xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-900 flex justify-center">
                    <img
                      src={pages[currentPageIndex].imageUrl}
                      alt={`Page ${currentPageIndex + 1}`}
                      className={`${
                        readingMode === 'single' ? 'max-h-[80vh] w-auto object-contain' : 'w-full h-auto'
                      } block select-none pointer-events-none`}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between w-full max-w-md pt-2 px-4">
                  <button
                    onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                    disabled={currentPageIndex === 0}
                    className="py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous Page</span>
                  </button>

                  <span className="text-xs font-mono font-bold text-slate-400">
                    Page {currentPageIndex + 1} of {pages.length}
                  </span>

                  <button
                    onClick={() => setCurrentPageIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                    disabled={currentPageIndex >= pages.length - 1}
                    className="py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Next Page</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* END OF EPISODE / PREV & NEXT EPISODE NAVIGATION */}
            <div className="w-full max-w-xl mx-auto my-12 p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-rose-500 font-bold text-xs uppercase tracking-wider">
                <BookOpen className="w-4 h-4" />
                <span>You Finished Reading Episode {episode.episodeNumber}</span>
              </div>
              <h4 className="text-base font-bold text-white">{episode.title}</h4>
              <p className="text-xs text-slate-400">
                Support the author by leaving a rating or comment below!
              </p>

              <div className="flex items-center justify-center gap-3 pt-2">
                {prevEpisodeId && (
                  <button
                    type="button"
                    onClick={() => onSelectEpisode(prevEpisodeId)}
                    className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous Episode</span>
                  </button>
                )}
                {nextEpisodeId && (
                  <button
                    type="button"
                    onClick={() => onSelectEpisode(nextEpisodeId)}
                    className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Next Episode</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* INTERACTION SECTION: RATINGS, LIKES, DISLIKES, COMMENTS */}
            <div className="w-full max-w-3xl mx-auto px-4 pb-20 space-y-8 select-text">
              {/* Engagement Bar: Likes, Dislikes & 5-Star Rating */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-slate-300">Rate this Episode:</span>
                    <span className="text-xs font-bold text-amber-400 tabular-nums">★ {avgRating}</span>
                    <span className="text-[11px] text-slate-500">({totalRatings} ratings)</span>
                  </div>

                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => handleRate(star)}
                        className="p-1 transition-transform hover:scale-125 focus:outline-none cursor-pointer"
                        title={`Rate ${star} star`}
                      >
                        <Star
                          className={`w-5 h-5 transition-colors ${
                            star <= (hoverRating || userRating)
                              ? 'text-amber-400 fill-amber-400'
                              : 'text-slate-600'
                          }`}
                        />
                      </button>
                    ))}
                    {userRating > 0 && (
                      <span className="text-[10px] text-emerald-400 font-semibold ml-2">
                        Your Rating: {userRating}★
                      </span>
                    )}
                  </div>
                </div>

                {/* Like / Dislike Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleVote('like')}
                    className={`flex items-center gap-1.5 py-2 px-3.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      userVote === 'like'
                        ? 'bg-rose-600/20 border-rose-500 text-rose-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <ThumbsUp className="w-4 h-4" />
                    <span className="tabular-nums">{likesCount}</span>
                  </button>

                  <button
                    onClick={() => handleVote('dislike')}
                    className={`flex items-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      userVote === 'dislike'
                        ? 'bg-slate-800 border-slate-600 text-slate-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <ThumbsDown className="w-4 h-4" />
                    <span className="tabular-nums">{dislikesCount}</span>
                  </button>
                </div>
              </div>

              {/* COMMENTS SECTION */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2 font-heading">
                    <MessageSquare className="w-4 h-4 text-rose-500" />
                    <span>Reader Comments ({comments.length})</span>
                  </h3>
                  <span className="text-xs text-slate-500">Moderated by Administrator</span>
                </div>

                {reportFeedback && (
                  <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                    {reportFeedback}
                  </div>
                )}

                {/* Comment Input */}
                <form onSubmit={(e) => handlePostComment(e)} className="space-y-2">
                  <textarea
                    rows={3}
                    placeholder={
                      user ? 'Write your comment about this episode...' : 'Log in to post a comment'
                    }
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    disabled={!user}
                    className="w-full p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-500">
                      Be respectful. No spoiler tags without warning.
                    </span>
                    <button
                      type="submit"
                      disabled={!user || !newComment.trim()}
                      className="py-2 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Post Comment</span>
                    </button>
                  </div>
                </form>

                {/* Comments List */}
                <div className="space-y-4 pt-2">
                  {comments.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      No comments yet. Be the first reader to comment on this episode!
                    </div>
                  ) : (
                    comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <img
                              src={comment.userAvatar}
                              alt={comment.userName}
                              className="w-7 h-7 rounded-full object-cover border border-slate-700"
                            />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-white">{comment.userName}</span>
                                {comment.userRole === 'author' && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                                    Author
                                  </span>
                                )}
                                {comment.userRole === 'admin' && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                                    Admin
                                  </span>
                                )}
                                {comment.isEdited && (
                                  <span className="text-[10px] text-slate-500 italic">(edited)</span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-500">
                                {new Date(comment.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          {/* Edit / Report / Delete affordances */}
                          <div className="flex items-center gap-1.5">
                            {user?.id === comment.userId && (
                              <button
                                onClick={() => {
                                  setEditingCommentId(comment.id);
                                  setEditingContent(comment.content);
                                }}
                                className="text-slate-500 hover:text-sky-400 p-1 rounded cursor-pointer"
                                title="Edit your comment"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {user && user.id !== comment.userId && (
                              <button
                                onClick={() => handleReportComment(comment)}
                                className="text-slate-500 hover:text-amber-400 p-1 rounded cursor-pointer"
                                title="Report comment"
                              >
                                <Flag className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {(user?.id === comment.userId || actualDbRole === 'admin') && (
                              <button
                                onClick={() => handleDeleteComment(comment.id)}
                                className="text-slate-500 hover:text-rose-400 p-1 rounded cursor-pointer"
                                title="Delete comment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {editingCommentId === comment.id ? (
                          <div className="pl-9 space-y-2">
                            <input
                              type="text"
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingCommentId(null)}
                                className="px-2 py-1 text-[11px] text-slate-400"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditComment(comment.id)}
                                className="px-3 py-1 text-[11px] font-bold bg-rose-600 text-white rounded-md"
                              >
                                Save Edit
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-300 leading-relaxed pl-9">{comment.content}</p>
                        )}

                        {/* Like & Reply triggers */}
                        <div className="pl-9 flex items-center gap-4">
                          <button
                            onClick={() => handleLikeComment(comment.id)}
                            className={`text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                              comment.likedBy?.includes(user?.id || '')
                                ? 'text-rose-400'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            <ThumbsUp className="w-3 h-3" />
                            <span>{comment.likesCount || 0}</span>
                          </button>

                          <button
                            onClick={() =>
                              setReplyParentId(replyParentId === comment.id ? null : comment.id)
                            }
                            className="text-[11px] font-semibold text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <CornerDownRight className="w-3 h-3" />
                            <span>Reply</span>
                          </button>
                        </div>

                        {replyParentId === comment.id && (
                          <form
                            onSubmit={(e) => handlePostComment(e, comment.id)}
                            className="pl-9 pt-2 space-y-2"
                          >
                            <input
                              type="text"
                              placeholder={`Reply to ${comment.userName}...`}
                              value={replyContent}
                              onChange={(e) => setReplyContent(e.target.value)}
                              className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setReplyParentId(null)}
                                className="px-2 py-1 text-[11px] text-slate-400 hover:text-white"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="px-3 py-1 text-[11px] font-bold bg-rose-600 hover:bg-rose-500 text-white rounded-md"
                              >
                                Send Reply
                              </button>
                            </div>
                          </form>
                        )}

                        {/* Threaded Replies */}
                        {comment.replies && comment.replies.length > 0 && (
                          <div className="pl-9 pt-2 space-y-2 border-l border-slate-800 ml-4">
                            {comment.replies.map((reply) => (
                              <div key={reply.id} className="p-2.5 rounded-lg bg-slate-950/80 space-y-1">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-bold text-white">
                                      {reply.userName}
                                    </span>
                                    {reply.userRole === 'author' && (
                                      <span className="text-[9px] text-emerald-400 font-bold">
                                        (Author)
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[9px] text-slate-500">
                                    {new Date(reply.createdAt).toLocaleDateString()}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-300">{reply.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* RAZORPAY CHECKOUT MODAL IF PURCHASE CLICKED */}
      {checkoutPlan.open && (
        <RazorpayCheckoutModal
          isOpen={checkoutPlan.open}
          onClose={() => setCheckoutPlan({ ...checkoutPlan, open: false })}
          comicId="global_subscription"
          comicTitle={`Aathirai ${checkoutPlan.planKey === '6_months' ? '6 Months' : '1 Month'} Premium Pass`}
          chapterId={chapter.id}
          episodeId={episode.id}
          itemTitle={checkoutPlan.title}
          itemType="subscription"
          subscriptionPlan={checkoutPlan.planKey}
          amountInr={checkoutPlan.amountInr}
          onPaymentSuccess={async () => {
            await refreshUser();
            await fetchEpisode();
          }}
        />
      )}
    </div>
  );
};
