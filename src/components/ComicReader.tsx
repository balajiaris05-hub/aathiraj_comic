import React, { useState, useEffect, useRef } from 'react';
import { Episode, Comic, Chapter, Comment } from '../types/comic';
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
  IndianRupee,
  Eye,
  Sliders,
  Send,
  Trash2,
  CornerDownRight,
  BookOpen
} from 'lucide-react';
import { RazorpayCheckoutModal } from './RazorpayCheckoutModal';

interface ComicReaderProps {
  episodeId: string;
  onClose: () => void;
  onSelectEpisode: (epId: string) => void;
  openAuthModal: () => void;
}

export const ComicReader: React.FC<ComicReaderProps> = ({
  episodeId,
  onClose,
  onSelectEpisode,
  openAuthModal,
}) => {
  const { user, role } = useAuth();
  const [data, setData] = useState<{
    episode: Episode;
    comic: { id: string; title: string; authorName: string; accessType: string; coverImage: string };
    chapter: { id: string; title: string; chapterNumber: number };
    hasAccess: boolean;
    userVote: 'like' | 'dislike' | null;
    userRating: number | null;
    comments: Comment[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [readingMode, setReadingMode] = useState<'vertical' | 'page'>('vertical');
  const [fitMode, setFitMode] = useState<'width' | 'screen'>('width');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHud, setShowHud] = useState(true);

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

  // Payment checkout modal state
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const readerContainerRef = useRef<HTMLDivElement>(null);

  // Fetch episode data
  const fetchEpisode = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}?userId=${user?.id || ''}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
        setLikesCount(json.episode.likesCount || 0);
        setDislikesCount(json.episode.dislikesCount || 0);
        setUserVote(json.userVote || null);
        setUserRating(json.userRating || 0);
        setAvgRating(json.episode.averageRating || 5.0);
        setTotalRatings(json.episode.totalRatings || 0);
        setComments(json.comments || []);
        setCurrentPageIndex(0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisode();
  }, [episodeId, user?.id]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        if (readingMode === 'page' && data && currentPageIndex < data.episode.pages.length - 1) {
          setCurrentPageIndex(prev => prev + 1);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (readingMode === 'page' && currentPageIndex > 0) {
          setCurrentPageIndex(prev => prev - 1);
        }
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (isFullscreen) {
          toggleFullscreen();
        } else {
          onClose();
        }
      } else if (e.key === 'h' || e.key === 'H') {
        setShowHud(prev => !prev);
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

  // Zoom handlers
  const zoomIn = () => setZoomLevel(prev => Math.min(prev + 15, 200));
  const zoomOut = () => setZoomLevel(prev => Math.max(prev - 15, 60));
  const resetZoom = () => setZoomLevel(100);

  // Voting
  const handleVote = async (type: 'like' | 'dislike') => {
    if (!user) {
      openAuthModal();
      return;
    }
    try {
      const res = await fetch(`/api/episodes/${episodeId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`/api/episodes/${episodeId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`/api/episodes/${episodeId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          setComments(prev =>
            prev.map(c => {
              if (c.id === parentId) {
                return { ...c, replies: [...(c.replies || []), resData.comment] };
              }
              return c;
            })
          );
          setReplyParentId(null);
          setReplyContent('');
        } else {
          setComments(prev => [resData.comment, ...prev]);
          setNewComment('');
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Comment
  const handleDeleteComment = async (commentId: string) => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id, role }),
      });
      if (res.ok) {
        setComments(prev =>
          prev
            .filter(c => c.id !== commentId)
            .map(c => ({
              ...c,
              replies: c.replies ? c.replies.filter(r => r.id !== commentId) : [],
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

  const { episode, comic, chapter, hasAccess } = data;
  const pages = episode.pages || [];

  return (
    <div
      ref={readerContainerRef}
      className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none"
    >
      {/* TOP HUD / CONTROLS BAR */}
      <div
        className={`transition-all duration-300 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-2.5 flex items-center justify-between gap-4 ${
          showHud ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Info */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            title="Exit Reader (ESC)"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-bold text-white truncate font-heading">
              {comic.title}
            </h2>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
              <span>Ch. {chapter.chapterNumber}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-rose-400 truncate">Ep {episode.episodeNumber}: {episode.title}</span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">By {comic.authorName}</span>
            </div>
          </div>
        </div>

        {/* Center: Reading Mode & View Controls */}
        <div className="hidden md:flex items-center gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => setReadingMode('vertical')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              readingMode === 'vertical' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Vertical (Webtoon)
          </button>

          <button
            onClick={() => setReadingMode('page')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              readingMode === 'page' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Page-by-Page
          </button>

          <div className="w-[1px] h-4 bg-slate-800 mx-1" />

          {/* Fit Toggle */}
          <button
            onClick={() => setFitMode(fitMode === 'width' ? 'screen' : 'width')}
            className="px-2 py-1 text-[11px] text-slate-300 hover:text-white"
          >
            {fitMode === 'width' ? 'Fit to Width' : 'Fit to Screen'}
          </button>
        </div>

        {/* Right: Zoom & Fullscreen */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-slate-950 rounded-lg border border-slate-800 p-0.5">
            <button
              onClick={zoomOut}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-slate-300 tabular-nums">
              {zoomLevel}%
            </span>
            <button
              onClick={zoomIn}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={resetZoom}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Reset Zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Fullscreen Mode (F)"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* FLOATING HUD TOGGLE BUTTON (distraction-free mode) */}
      <button
        onClick={() => setShowHud(prev => !prev)}
        className="fixed bottom-4 right-4 z-40 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-300 shadow-xl backdrop-blur-md transition-all"
        title="Toggle Distraction-free View (H)"
      >
        <Sliders className="w-4 h-4" />
      </button>

      {/* MAIN READING CANVAS VIEWPORT */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col items-center relative">
        
        {/* PREMIUM LOCK OVERLAY (If user does not have access) */}
        {!hasAccess ? (
          <div className="w-full max-w-lg mx-auto my-auto p-8 text-center space-y-6 bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl backdrop-blur-md mt-16 mb-16">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 mx-auto flex items-center justify-center">
              <Lock className="w-8 h-8" />
            </div>

            <div>
              <span className="text-xs uppercase font-extrabold tracking-wider text-amber-500">
                Premium Episode
              </span>
              <h3 className="text-xl font-bold text-white mt-1">
                {comic.title} · Ep {episode.episodeNumber}
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                This episode is part of the author's premium publication. Unlock it instantly with Indian UPI, cards, or net banking via Razorpay.
              </p>
            </div>

            {/* Pricing Options */}
            <div className="space-y-3">
              <button
                onClick={() => setCheckoutOpen(true)}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-extrabold text-sm shadow-xl flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
              >
                <span>Unlock Episode {episode.episodeNumber} for ₹{episode.priceInr || 10}</span>
                <IndianRupee className="w-4 h-4" />
              </button>

              <p className="text-[11px] text-slate-400">
                70% of revenue goes directly to the creator {comic.authorName}.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-center gap-4">
              <span>UPI Payments</span>
              <span>·</span>
              <span>RuPay / Visa</span>
              <span>·</span>
              <span>Instant Read</span>
            </div>
          </div>
        ) : (
          /* COMIC PAGES CONTENT */
          <div
            className="w-full flex flex-col items-center py-6 px-2 transition-all duration-200"
            style={{
              maxWidth: fitMode === 'width' ? `${Math.min(zoomLevel * 8, 1200)}px` : `${Math.min(zoomLevel * 6, 800)}px`,
            }}
          >
            {readingMode === 'vertical' ? (
              /* VERTICAL WEBTOON MODE */
              <div className="w-full space-y-4">
                {pages.map((p, idx) => (
                  <div
                    key={p.id || idx}
                    className="w-full rounded-lg overflow-hidden shadow-2xl border border-slate-800/60 bg-slate-900"
                  >
                    <img
                      src={p.imageUrl}
                      alt={`Page ${p.pageNumber || idx + 1}`}
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
            ) : (
              /* PAGE BY PAGE MODE */
              <div className="w-full flex flex-col items-center space-y-4">
                {pages[currentPageIndex] && (
                  <div className="w-full rounded-xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-900">
                    <img
                      src={pages[currentPageIndex].imageUrl}
                      alt={`Page ${currentPageIndex + 1}`}
                      className="w-full h-auto block select-none pointer-events-none"
                    />
                  </div>
                )}

                {/* Page Navigation Controls */}
                <div className="flex items-center justify-between w-full max-w-md pt-2 px-4">
                  <button
                    onClick={() => setCurrentPageIndex(prev => Math.max(0, prev - 1))}
                    disabled={currentPageIndex === 0}
                    className="py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous Page</span>
                  </button>

                  <span className="text-xs font-mono font-bold text-slate-400">
                    Page {currentPageIndex + 1} of {pages.length}
                  </span>

                  <button
                    onClick={() => setCurrentPageIndex(prev => Math.min(pages.length - 1, prev + 1))}
                    disabled={currentPageIndex >= pages.length - 1}
                    className="py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <span>Next Page</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* END OF EPISODE / NEXT EPISODE NAVIGATION */}
            <div className="w-full max-w-xl mx-auto my-12 p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-rose-500 font-bold text-xs uppercase tracking-wider">
                <BookOpen className="w-4 h-4" />
                <span>You Finished Reading Episode {episode.episodeNumber}</span>
              </div>
              <h4 className="text-base font-bold text-white">
                {episode.title}
              </h4>
              <p className="text-xs text-slate-400">
                Support the author by leaving a rating or comment below!
              </p>
            </div>

            {/* INTERACTION SECTION: RATINGS, LIKES, DISLIKES, COMMENTS */}
            <div className="w-full max-w-3xl mx-auto px-4 pb-20 space-y-8">
              
              {/* Engagement Bar: Likes, Dislikes & 5-Star Rating */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                
                {/* 5-Star Rating Widget */}
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
                    className={`flex items-center gap-1.5 py-2 px-3.5 rounded-xl border text-xs font-bold transition-all ${
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
                    className={`flex items-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
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

                {/* Comment Input */}
                <form onSubmit={(e) => handlePostComment(e)} className="space-y-2">
                  <textarea
                    rows={3}
                    placeholder={user ? "Write your comment about this episode..." : "Log in to post a comment"}
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
                      className="py-2 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40"
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
                                  <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                                    Author
                                  </span>
                                )}
                                {comment.userRole === 'admin' && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                                    Admin
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-500">
                                {new Date(comment.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          {/* Delete affordance for owner or admin */}
                          {(user?.id === comment.userId || role === 'admin') && (
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded"
                              title="Delete comment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed pl-9">
                          {comment.content}
                        </p>

                        {/* Reply trigger */}
                        <div className="pl-9 flex items-center gap-3">
                          <button
                            onClick={() => setReplyParentId(replyParentId === comment.id ? null : comment.id)}
                            className="text-[11px] font-semibold text-rose-400 hover:underline flex items-center gap-1"
                          >
                            <CornerDownRight className="w-3 h-3" />
                            <span>Reply</span>
                          </button>
                        </div>

                        {/* Reply box if active */}
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
                                    <span className="text-[11px] font-bold text-white">{reply.userName}</span>
                                    {reply.userRole === 'author' && (
                                      <span className="text-[9px] text-emerald-400 font-bold">(Author)</span>
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
      {checkoutOpen && (
        <RazorpayCheckoutModal
          isOpen={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          comicId={comic.id}
          comicTitle={comic.title}
          chapterId={chapter.id}
          episodeId={episode.id}
          itemTitle={`Episode ${episode.episodeNumber}: ${episode.title}`}
          itemType="episode"
          amountInr={episode.priceInr || 10}
          onPaymentSuccess={() => {
            fetchEpisode();
          }}
        />
      )}
    </div>
  );
};
