import React, { useState, useEffect } from 'react';
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
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  Sliders,
  Paperclip,
  FileUp,
  Images,
  ArrowUp,
  ArrowDown,
  ZoomIn,
  ZoomOut,
  X,
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface AdminPublishingStudioProps {
  comics: Comic[];
  onRefreshComics: () => void;
  fetchAdminData?: () => Promise<void>;
  user: any;
}

export const AdminPublishingStudio: React.FC<AdminPublishingStudioProps> = ({
  comics,
  onRefreshComics,
  fetchAdminData,
  user,
}) => {
  const [activeTab, setActiveTab] = useState<'comics' | 'new-comic'>('comics');
  const [selectedComic, setSelectedComic] = useState<Comic | null>(null);

  // New Comic Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newGenre, setNewGenre] = useState('Fantasy');
  const [newAccess, setNewAccess] = useState<'free' | 'premium'>('free');
  const [newFullPrice, setNewFullPrice] = useState(99);
  const [newEpPrice, setNewEpPrice] = useState(10);
  const [isSubmittingComic, setIsSubmittingComic] = useState(false);

  // New Chapter Form State
  const [chapterTitle, setChapterTitle] = useState('');

  // Multiple Photos Attachment State for Episode Upload
  const [episodeAttachedPages, setEpisodeAttachedPages] = useState<{
    id: string;
    fileName: string;
    size: string;
    type: string;
    dataUrl: string;
    pageNumber: number;
    caption?: string;
  }[]>([]);

  // Multiple Photos Attachment State for New Comic Creation
  const [newComicAttachedPages, setNewComicAttachedPages] = useState<{
    id: string;
    fileName: string;
    size: string;
    type: string;
    dataUrl: string;
    pageNumber: number;
    caption?: string;
  }[]>([]);
  const [selectedCoverPageId, setSelectedCoverPageId] = useState<string | null>(null);
  const [selectedEpisodeCoverPageId, setSelectedEpisodeCoverPageId] = useState<string | null>(null);

  // Live Reader Preview Modal State
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState<'vertical' | 'page'>('vertical');
  const [previewCurrentPage, setPreviewCurrentPage] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(100);

  // Comic Editing State
  const [isEditingComicModalOpen, setIsEditingComicModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editGenres, setEditGenres] = useState<string[]>([]);
  const [editCustomGenre, setEditCustomGenre] = useState('');
  const [editCover, setEditCover] = useState('');
  const [editAccessType, setEditAccessType] = useState<'free' | 'premium'>('free');
  const [editFullPrice, setEditFullPrice] = useState(99);
  const [isSavingComicEdit, setIsSavingComicEdit] = useState(false);
  const [comicEditError, setComicEditError] = useState<string | null>(null);

  // Chapter Editing State
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editChapterTitle, setEditChapterTitle] = useState('');
  const [isUpdatingChapter, setIsUpdatingChapter] = useState(false);

  // Episode Editing State
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [editEpisodeTitle, setEditEpisodeTitle] = useState('');
  const [editEpisodeSynopsis, setEditEpisodeSynopsis] = useState('');
  const [editEpisodeIsPremium, setEditEpisodeIsPremium] = useState(false);
  const [editEpisodePrice, setEditEpisodePrice] = useState(10);
  const [isUpdatingEpisode, setIsUpdatingEpisode] = useState(false);

  // Direct Chapter Upload Trigger State
  const [activeUploadChapterId, setActiveUploadChapterId] = useState<string | null>(null);

  // Manual Deletion Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'episode' | 'chapter' | 'series'>('episode');
  const [modalSelectedChapterId, setModalSelectedChapterId] = useState<string>('');
  const [modalSelectedEpisodeId, setModalSelectedEpisodeId] = useState<string>('');
  const [isDeletingItem, setIsDeletingItem] = useState(false);

  // Feedback State
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // New Episode Form State
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeSynopsis, setEpisodeSynopsis] = useState('');
  const [episodeIsPremium, setEpisodeIsPremium] = useState(false);
  const [episodePrice, setEpisodePrice] = useState(10);
  const [isPublishingEpisode, setIsPublishingEpisode] = useState(false);

  // Auto-select comic
  useEffect(() => {
    if (comics.length > 0) {
      if (!selectedComic || !comics.find(c => c.id === selectedComic.id)) {
        const firstComic = comics[0];
        setSelectedComic(firstComic);
        if (firstComic.chapters.length > 0) {
          setSelectedChapterId(firstComic.chapters[0].id);
          setModalSelectedChapterId(firstComic.chapters[0].id);
          if (firstComic.chapters[0].episodes.length > 0) {
            setModalSelectedEpisodeId(firstComic.chapters[0].episodes[0].id);
          }
        }
      } else {
        const latest = comics.find(c => c.id === selectedComic.id);
        if (latest) {
          setSelectedComic(latest);
        }
      }
    } else {
      setSelectedComic(null);
    }
  }, [comics]);

  useEffect(() => {
    if (selectedComic && selectedComic.chapters.length > 0) {
      const activeChap = selectedComic.chapters.find(c => c.id === modalSelectedChapterId) || selectedComic.chapters[0];
      setModalSelectedChapterId(activeChap.id);
      if (activeChap.episodes.length > 0) {
        setModalSelectedEpisodeId(activeChap.episodes[0].id);
      } else {
        setModalSelectedEpisodeId('');
      }
    }
  }, [selectedComic]);

  const showToast = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 6000);
  };

  // Multiple files change for new comic creation
  const handleNewComicFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file, index) => {
      const formattedSize = file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setNewComicAttachedPages(prev => {
            const updated = [
              ...prev,
              {
                id: `p_new_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${index}`,
                fileName: file.name,
                size: formattedSize,
                type: file.type || 'image',
                dataUrl: reader.result as string,
                pageNumber: prev.length + 1,
                caption: `Page ${prev.length + 1}`,
              },
            ];
            if (!selectedCoverPageId && updated.length > 0) {
              setSelectedCoverPageId(updated[0].id);
            }
            return updated;
          });
        };
        reader.readAsDataURL(file);
      }
    });
    e.target.value = '';
  };

  // Create new comic series
  const handleCreateComic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newComicAttachedPages.length === 0) {
      alert('Please attach at least one comic page / image file.');
      return;
    }
    setIsSubmittingComic(true);

    const coverPage = newComicAttachedPages.find(p => p.id === selectedCoverPageId) || newComicAttachedPages[0];
    const coverImageUrl = coverPage?.dataUrl || '/src/assets/images/comic_cover_blade_1794269871791.jpg';

    try {
      const res = await fetch('/api/comics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          authorId: user?.id || 'usr_admin',
          authorName: user?.name ? `${user.name} (Admin)` : 'Aathirai Editorial (Admin)',
          genre: [newGenre],
          coverImage: coverImageUrl,
          description: newDesc.trim(),
          accessType: newAccess,
          fullPriceInr: newAccess === 'premium' ? newFullPrice : 0,
          chapterPriceInr: newAccess === 'premium' ? 30 : 0,
          episodePriceInr: newAccess === 'premium' ? newEpPrice : 0,
          attachedFileName: coverPage?.fileName || 'Attached Comic Pages',
          attachedFileSize: `${newComicAttachedPages.length} files`,
          attachedFileType: 'IMAGE_ARCHIVE',
          moderationStatus: 'approved',
          pages: newComicAttachedPages.map(p => ({
            pageNumber: p.pageNumber,
            imageUrl: p.dataUrl,
            caption: p.caption,
          })),
        }),
      });

      const data = await res.json();
      setIsSubmittingComic(false);

      if (res.ok && data.comic) {
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        setSelectedComic(data.comic);
        setActiveTab('comics');
        setNewTitle('');
        setNewDesc('');
        setNewComicAttachedPages([]);
        setSelectedCoverPageId(null);
        showToast(`✓ Comic series "${data.comic.title}" was created and published live on the website!`);
      } else {
        alert(data.error || 'Failed to create comic.');
      }
    } catch (err) {
      setIsSubmittingComic(false);
      console.error(err);
      alert('Network error while creating comic.');
    }
  };

  // Multiple files change for episode upload
  const handleMultipleEpisodePagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file, index) => {
      const formattedSize = file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;

      const reader = new FileReader();
      reader.onload = () => {
        setEpisodeAttachedPages(prev => {
          const newId = `p_adm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${index}`;
          const updated = [
            ...prev,
            {
              id: newId,
              fileName: file.name,
              size: formattedSize,
              type: file.type || 'image',
              dataUrl: reader.result as string,
              pageNumber: prev.length + 1,
              caption: `Page ${prev.length + 1}`,
            },
          ];
          if (!selectedEpisodeCoverPageId && updated.length > 0) {
            setSelectedEpisodeCoverPageId(updated[0].id);
          }
          return updated;
        });
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const handleRemoveEpisodePage = (pageId: string) => {
    setEpisodeAttachedPages(prev => {
      const filtered = prev.filter(p => p.id !== pageId);
      return filtered.map((p, idx) => ({ ...p, pageNumber: idx + 1, caption: `Page ${idx + 1}` }));
    });
  };

  const handleMoveEpisodePage = (index: number, direction: 'up' | 'down') => {
    setEpisodeAttachedPages(prev => {
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy.map((p, idx) => ({ ...p, pageNumber: idx + 1, caption: `Page ${idx + 1}` }));
    });
  };

  // Add Chapter
  const handleAddChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComic || !chapterTitle.trim()) return;

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: chapterTitle.trim(),
          authorId: user?.id,
          authorName: user?.name,
        }),
      });

      if (res.ok) {
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        setChapterTitle('');
        showToast('Chapter created successfully.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Update Chapter Title
  const handleUpdateChapter = async (chapId: string, newTitle: string) => {
    if (!selectedComic || !newTitle.trim()) return;
    setIsUpdatingChapter(true);

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters/${chapId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          authorId: user?.id,
          authorName: user?.name,
        }),
      });

      setIsUpdatingChapter(false);
      if (res.ok) {
        setEditingChapterId(null);
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        showToast('Chapter updated.');
      }
    } catch (err) {
      setIsUpdatingChapter(false);
      console.error(err);
    }
  };

  // Delete Chapter
  const handleDeleteChapter = async (chapId: string) => {
    if (!selectedComic) return;
    if (!confirm('⚠️ Are you sure you want to delete this chapter and all its episodes permanently?')) return;

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters/${chapId}?authorId=${user?.id || ''}&authorName=${encodeURIComponent(user?.name || '')}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        showToast('Chapter deleted.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Edit Comic Initiation
  const handleStartEditComic = () => {
    if (!selectedComic) return;
    setEditTitle(selectedComic.title);
    setEditDesc(selectedComic.description);
    setEditGenres(selectedComic.genre || ['Fantasy']);
    setEditCover(selectedComic.coverImage);
    setEditAccessType(selectedComic.accessType);
    setEditFullPrice(selectedComic.fullPriceInr || 99);
    setComicEditError(null);
    setIsEditingComicModalOpen(true);
  };

  // Save Comic Edit
  const handleSaveComicEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComic) return;
    setIsSavingComicEdit(true);
    setComicEditError(null);

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDesc.trim(),
          genre: editGenres,
          coverImage: editCover,
          accessType: editAccessType,
          fullPriceInr: editAccessType === 'premium' ? editFullPrice : 0,
          authorId: user?.id,
          authorName: user?.name,
        }),
      });

      const data = await res.json();
      setIsSavingComicEdit(false);

      if (res.ok) {
        setIsEditingComicModalOpen(false);
        setSelectedComic(data.comic);
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        showToast(`"${data.comic.title}" was updated successfully.`);
      } else {
        setComicEditError(data.error || 'Failed to update comic.');
      }
    } catch (err) {
      setIsSavingComicEdit(false);
      setComicEditError('Network error while saving changes.');
      console.error(err);
    }
  };

  // Start Editing Episode
  const handleStartEditEpisode = (ep: Episode, chapId: string) => {
    setSelectedChapterId(chapId);
    setEditingEpisode(ep);
    setEditEpisodeTitle(ep.title);
    setEditEpisodeSynopsis(ep.synopsis || '');
    setEditEpisodeIsPremium(ep.isPremium);
    setEditEpisodePrice(ep.priceInr || 10);
  };

  // Save Episode Edit
  const handleSaveEpisodeEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComic || !selectedChapterId || !editingEpisode) return;
    setIsUpdatingEpisode(true);

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters/${selectedChapterId}/episodes/${editingEpisode.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editEpisodeTitle.trim(),
          synopsis: editEpisodeSynopsis.trim(),
          isPremium: editEpisodeIsPremium,
          priceInr: editEpisodeIsPremium ? editEpisodePrice : 0,
          authorId: user?.id,
          authorName: user?.name,
        }),
      });

      setIsUpdatingEpisode(false);
      if (res.ok) {
        setEditingEpisode(null);
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        showToast(`"${editEpisodeTitle}" was updated successfully!`);
      }
    } catch (err) {
      setIsUpdatingEpisode(false);
      console.error(err);
    }
  };

  // Delete Episode
  const handleDeleteEpisode = async (chapId: string, epId: string) => {
    if (!selectedComic) return;
    if (!confirm('⚠️ Are you sure you want to permanently delete this episode?')) return;

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters/${chapId}/episodes/${epId}?authorId=${user?.id || ''}&authorName=${encodeURIComponent(user?.name || '')}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        showToast('Episode deleted successfully.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Entire Comic Series directly (Admin has master privileges)
  const handleDirectDeleteComicSeries = async () => {
    if (!selectedComic) return;
    if (!confirm(`⚠️ CRITICAL: Permanently delete "${selectedComic.title}" and ALL its chapters/episodes?`)) return;

    setIsDeletingItem(true);
    try {
      const res = await fetch(`/api/comics/${selectedComic.id}`, {
        method: 'DELETE',
      });
      setIsDeletingItem(false);
      if (res.ok) {
        setIsDeleteModalOpen(false);
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        setSelectedComic(null);
        showToast(`Comic series was permanently deleted.`);
      }
    } catch (err) {
      setIsDeletingItem(false);
      console.error(err);
    }
  };

  // Open Live Reader Preview
  const handleOpenLivePreview = () => {
    if (episodeAttachedPages.length === 0) {
      alert('Please attach at least one photo (comic page) before launching preview.');
      return;
    }
    if (!episodeTitle.trim()) {
      alert('Please enter an episode title before launching preview.');
      return;
    }
    setPreviewCurrentPage(1);
    setShowLivePreview(true);
  };

  // Publish Episode
  const handleAddEpisode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedComic || !selectedChapterId || !episodeTitle.trim()) return;

    setIsPublishingEpisode(true);

    const selectedEpCoverPage = episodeAttachedPages.find(p => p.id === selectedEpisodeCoverPageId) || episodeAttachedPages[0];
    const episodeCoverUrl = selectedEpCoverPage?.dataUrl || selectedComic.coverImage;

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters/${selectedChapterId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: episodeTitle.trim(),
          synopsis: episodeSynopsis.trim(),
          isPremium: episodeIsPremium,
          priceInr: episodeIsPremium ? episodePrice : 0,
          authorId: user?.id,
          authorName: user?.name,
          coverImage: episodeCoverUrl,
          pages: episodeAttachedPages.map(p => ({
            pageNumber: p.pageNumber,
            imageUrl: p.dataUrl,
            caption: p.caption,
          })),
        }),
      });

      setIsPublishingEpisode(false);
      if (res.ok) {
        setShowLivePreview(false);
        setEpisodeAttachedPages([]);
        setSelectedEpisodeCoverPageId(null);
        setEpisodeTitle('');
        setEpisodeSynopsis('');
        setActiveUploadChapterId(null);
        onRefreshComics();
        if (fetchAdminData) fetchAdminData();
        showToast(`✓ New episode published with ${episodeAttachedPages.length || 1} pages and cover page assigned!`);
      }
    } catch (e) {
      setIsPublishingEpisode(false);
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">

      {/* MODAL 1: EDIT COMIC DETAILS */}
      {isEditingComicModalOpen && selectedComic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-base font-heading">
                Edit Comic Details
              </h3>
              <button
                type="button"
                onClick={() => setIsEditingComicModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {comicEditError && (
              <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500 text-xs font-semibold">
                {comicEditError}
              </div>
            )}

            <form onSubmit={handleSaveComicEdit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Comic Title *
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Synopsis / Description *
                </label>
                <textarea
                  rows={3}
                  required
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Access Type
                  </label>
                  <select
                    value={editAccessType}
                    onChange={(e: any) => setEditAccessType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  >
                    <option value="free">100% Free</option>
                    <option value="premium">Premium (Paywall)</option>
                  </select>
                </div>

                {editAccessType === 'premium' && (
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Full Series Price (INR ₹)
                    </label>
                    <input
                      type="number"
                      min="10"
                      value={editFullPrice}
                      onChange={(e) => setEditFullPrice(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditingComicModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingComicEdit}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSavingComicEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: DELETE CONTENT MANAGER */}
      {isDeleteModalOpen && selectedComic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg p-6 rounded-3xl bg-white dark:bg-slate-900 border border-rose-500/40 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-500" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white font-heading">
                  Delete Content Manager
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode selection tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border text-xs font-bold">
              <button
                type="button"
                onClick={() => setDeleteMode('episode')}
                className={`flex-1 py-1.5 rounded-lg transition-colors ${
                  deleteMode === 'episode' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Delete Episode
              </button>
              <button
                type="button"
                onClick={() => setDeleteMode('chapter')}
                className={`flex-1 py-1.5 rounded-lg transition-colors ${
                  deleteMode === 'chapter' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Delete Chapter
              </button>
              <button
                type="button"
                onClick={() => setDeleteMode('series')}
                className={`flex-1 py-1.5 rounded-lg transition-colors ${
                  deleteMode === 'series' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Delete Entire Series
              </button>
            </div>

            {deleteMode === 'episode' && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Select Chapter:
                  </label>
                  <select
                    value={modalSelectedChapterId}
                    onChange={(e) => {
                      setModalSelectedChapterId(e.target.value);
                      const targetChap = selectedComic.chapters.find(c => c.id === e.target.value);
                      if (targetChap && targetChap.episodes.length > 0) {
                        setModalSelectedEpisodeId(targetChap.episodes[0].id);
                      } else {
                        setModalSelectedEpisodeId('');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  >
                    {selectedComic.chapters.map(ch => (
                      <option key={ch.id} value={ch.id}>
                        Chapter {ch.chapterNumber}: {ch.title} ({ch.episodes.length} Episodes)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Select Episode to Delete:
                  </label>
                  {(() => {
                    const activeChap = selectedComic.chapters.find(c => c.id === modalSelectedChapterId) || selectedComic.chapters[0];
                    if (!activeChap || activeChap.episodes.length === 0) {
                      return <p className="text-amber-500 italic">No episodes in this chapter.</p>;
                    }
                    return (
                      <select
                        value={modalSelectedEpisodeId}
                        onChange={(e) => setModalSelectedEpisodeId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                      >
                        {activeChap.episodes.map(ep => (
                          <option key={ep.id} value={ep.id}>
                            Episode {ep.episodeNumber}: {ep.title} ({ep.pages?.length || 0} pages)
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsDeleteModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!modalSelectedChapterId || !modalSelectedEpisodeId}
                    onClick={async () => {
                      await handleDeleteEpisode(modalSelectedChapterId, modalSelectedEpisodeId);
                      setIsDeleteModalOpen(false);
                    }}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
                  >
                    Permanently Delete Episode
                  </button>
                </div>
              </div>
            )}

            {deleteMode === 'chapter' && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Select Chapter to Delete:
                  </label>
                  <select
                    value={modalSelectedChapterId}
                    onChange={(e) => setModalSelectedChapterId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  >
                    {selectedComic.chapters.map(ch => (
                      <option key={ch.id} value={ch.id}>
                        Chapter {ch.chapterNumber}: {ch.title} ({ch.episodes.length} Episodes)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-rose-500/10 text-rose-400 text-xs">
                  ⚠️ Deleting this chapter will remove all of its contained episodes.
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsDeleteModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!modalSelectedChapterId}
                    onClick={async () => {
                      await handleDeleteChapter(modalSelectedChapterId);
                      setIsDeleteModalOpen(false);
                    }}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
                  >
                    Permanently Delete Chapter
                  </button>
                </div>
              </div>
            )}

            {deleteMode === 'series' && (
              <div className="space-y-4 text-xs">
                <p className="text-slate-300">
                  Permanently delete entire series <strong>"{selectedComic.title}"</strong> along with all chapters, episodes, and images.
                </p>

                <button
                  type="button"
                  disabled={isDeletingItem}
                  onClick={handleDirectDeleteComicSeries}
                  className="w-full p-3.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold flex items-center justify-between shadow-md cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    <span>Confirm Delete Entire Comic Series</span>
                  </div>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 3: LIVE READER PREVIEW */}
      {showLivePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-5xl h-[92vh] flex flex-col rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden text-slate-100">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-slate-900/80">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 font-mono uppercase">
                    <Eye className="w-3 h-3" /> Live Reader Preview
                  </span>
                  <span className="text-xs text-slate-400">
                    {selectedComic?.title} &gt; {episodeTitle} ({episodeAttachedPages.length} Pages)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center p-1 rounded-xl bg-slate-800 border border-slate-700 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewViewMode('vertical')}
                    className={`py-1 px-2.5 rounded-lg transition-colors ${
                      previewViewMode === 'vertical' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Vertical Scroll
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewViewMode('page')}
                    className={`py-1 px-2.5 rounded-lg transition-colors ${
                      previewViewMode === 'page' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Page-by-Page
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowLivePreview(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Viewport */}
            <div className="flex-1 overflow-y-auto p-4 flex justify-center bg-slate-900/40">
              {previewViewMode === 'vertical' ? (
                <div className="max-w-2xl w-full space-y-4">
                  {episodeAttachedPages.map((p) => (
                    <div key={p.id} className="relative rounded-xl overflow-hidden bg-black shadow-lg">
                      <img src={p.dataUrl} alt={p.caption} className="w-full h-auto object-contain" />
                      <span className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 text-white font-mono text-[10px] rounded">
                        Page {p.pageNumber}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="max-w-2xl w-full flex flex-col items-center justify-center space-y-4">
                  {episodeAttachedPages[previewCurrentPage - 1] && (
                    <div className="relative rounded-xl overflow-hidden bg-black shadow-2xl max-h-[70vh]">
                      <img
                        src={episodeAttachedPages[previewCurrentPage - 1].dataUrl}
                        alt="Current Page"
                        className="max-h-[70vh] w-auto object-contain"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={previewCurrentPage <= 1}
                      onClick={() => setPreviewCurrentPage(prev => Math.max(1, prev - 1))}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold"
                    >
                      &larr; Previous Page
                    </button>
                    <span className="text-xs font-mono font-bold">
                      {previewCurrentPage} / {episodeAttachedPages.length}
                    </span>
                    <button
                      type="button"
                      disabled={previewCurrentPage >= episodeAttachedPages.length}
                      onClick={() => setPreviewCurrentPage(prev => Math.min(episodeAttachedPages.length, prev + 1))}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-bold"
                    >
                      Next Page &rarr;
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Action Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-4 shrink-0">
              <button
                type="button"
                onClick={() => setShowLivePreview(false)}
                className="py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800"
              >
                &larr; Back to Editor
              </button>

              <button
                type="button"
                disabled={isPublishingEpisode}
                onClick={() => handleAddEpisode()}
                className="py-2.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isPublishingEpisode ? 'Publishing Live...' : 'Publish Episode Live on Website'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Feedback Banner */}
      {feedbackMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* DUAL STUDIO SUB-TABS */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 max-w-md">
        <button
          type="button"
          onClick={() => setActiveTab('comics')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'comics'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 text-rose-500" />
          <span>My Comics &amp; Episodes</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('new-comic')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'new-comic'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Upload New Comic</span>
        </button>
      </div>

      {/* SUB-VIEW 1: MY COMICS & EPISODES BREAKDOWN */}
      {activeTab === 'comics' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Comics List Sidebar (Left) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Select Comic to Manage ({comics.length}):
              </h3>
              <button
                type="button"
                onClick={() => setActiveTab('new-comic')}
                className="text-xs font-bold text-rose-500 hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ New Series</span>
              </button>
            </div>

            <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1">
              {comics.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedComic(c)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                    selectedComic?.id === c.id
                      ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-500 shadow-sm ring-1 ring-rose-500/30'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <img
                    src={c.coverImage}
                    alt={c.title}
                    className="w-12 h-16 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                        {c.title}
                      </h4>
                      {c.moderationStatus === 'pending' ? (
                        <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                          Pending
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                          Live
                        </span>
                      )}
                      {c.accessType === 'premium' ? (
                        <span className="text-[10px] font-bold text-amber-500 ml-auto">₹{c.fullPriceInr}</span>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-500 ml-auto">Free</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {c.genre.join(', ')} · {c.chapters.length} Chapters · By {c.authorName}
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

          {/* Chapter & Episode Breakdown Workspace (Right) */}
          <div className="lg:col-span-7 space-y-6">
            {selectedComic ? (
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
                
                {/* Comic Series Header Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-heading">
                        {selectedComic.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                        Live Published
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Hierarchy: Comic Series &gt; Chapters &gt; Episodes &gt; Attached Pages
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleStartEditComic}
                      className="py-2 px-3 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-all cursor-pointer border border-slate-300 dark:border-slate-700"
                    >
                      <PenTool className="w-3.5 h-3.5 text-rose-500" />
                      <span>Edit Series</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsDeleteModalOpen(true)}
                      className="py-2 px-3 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center gap-1.5 transition-all cursor-pointer border border-rose-500/30"
                      title="Delete chapter, episode, or full series"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Manager</span>
                    </button>
                  </div>
                </div>

                {/* Add Chapter Form */}
                <form onSubmit={handleAddChapter} className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="New Chapter Title (e.g. Chapter 3: The Awakening)"
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shrink-0 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Chapter</span>
                  </button>
                </form>

                {/* Upload Episode & Multi-Photo Pages Section */}
                <div
                  id="admin-episode-upload-section"
                  className={`p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border transition-all space-y-4 ${
                    activeUploadChapterId
                      ? 'border-rose-500 ring-2 ring-rose-500/20 shadow-md'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                      <FileUp className="w-4 h-4 text-rose-500" />
                      <span>Upload Episode &amp; Pages to Chapter</span>
                    </h4>
                    <span className="text-[11px] text-slate-400 font-medium">Attach Photos → Pick Cover → Preview → Publish</span>
                  </div>

                  <form onSubmit={handleAddEpisode} className="space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Target Chapter *
                        </label>
                        <select
                          value={selectedChapterId}
                          onChange={(e) => {
                            setSelectedChapterId(e.target.value);
                            setActiveUploadChapterId(null);
                          }}
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
                          placeholder="e.g. Episode 2: The Rising Tempest"
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
                        placeholder="Brief summary of this episode..."
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
                          Mark as Premium Episode (Paywall)
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
                            className="w-16 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                          />
                          <span className="text-slate-400 font-mono">INR</span>
                        </div>
                      )}
                    </div>

                    {/* Multi-Photo & Image Upload Dropzone */}
                    <div className="space-y-2.5 pt-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Images className="w-3.5 h-3.5 text-rose-500" />
                          <span>Attach Comic Episode Pages / Artwork Photos (Multiple Supported) *</span>
                        </label>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {episodeAttachedPages.length} {episodeAttachedPages.length === 1 ? 'Photo' : 'Photos'} Attached
                        </span>
                      </div>

                      {/* Dropzone */}
                      <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-500 dark:hover:border-rose-500 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-white dark:bg-slate-900 group">
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={handleMultipleEpisodePagesUpload}
                          className="hidden"
                        />
                        <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform">
                          <FileUp className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Click to Select Multiple Photos or Drag &amp; Drop
                        </span>
                        <span className="text-[11px] text-slate-400 mt-0.5">
                          Upload full episode sequence (JPG, PNG, WebP)
                        </span>
                      </label>

                      {/* Attached Gallery and Cover Selection */}
                      {episodeAttachedPages.length > 0 && (
                        <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                            <div>
                              <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider block">
                                Choose Cover Page for this Episode:
                              </span>
                              <span className="text-[11px] text-rose-500 font-semibold">
                                Click any thumbnail below or pick from dropdown to set as episode cover
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEpisodeAttachedPages([])}
                              className="text-[11px] text-rose-500 hover:underline self-end"
                            >
                              Clear All Pages
                            </button>
                          </div>

                          {/* Direct Dropdown Cover Selector */}
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0">
                              Cover Page:
                            </label>
                            <select
                              value={selectedEpisodeCoverPageId || (episodeAttachedPages[0]?.id || '')}
                              onChange={(e) => setSelectedEpisodeCoverPageId(e.target.value)}
                              className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none"
                            >
                              {episodeAttachedPages.map((p, idx) => (
                                <option key={p.id} value={p.id}>
                                  Page {p.pageNumber}: {p.fileName} {idx === 0 ? '(Default First Page)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Interactive Thumbnail Gallery with Cover Selection */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-64 overflow-y-auto p-1">
                            {episodeAttachedPages.map((page, idx) => {
                              const isCover = selectedEpisodeCoverPageId === page.id || (!selectedEpisodeCoverPageId && idx === 0);

                              return (
                                <div
                                  key={page.id}
                                  onClick={() => setSelectedEpisodeCoverPageId(page.id)}
                                  className={`p-1.5 rounded-lg border flex flex-col space-y-1 transition-all cursor-pointer ${
                                    isCover
                                      ? 'border-rose-500 ring-2 ring-rose-500/40 bg-rose-500/10 shadow-sm'
                                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-slate-400'
                                  }`}
                                >
                                  <div className="relative aspect-[3/4] rounded overflow-hidden bg-black/10">
                                    <img
                                      src={page.dataUrl}
                                      alt={page.caption}
                                      className="w-full h-full object-cover"
                                    />
                                    <span className="absolute top-1 left-1 bg-black/75 text-white font-mono text-[9px] px-1 py-0.5 rounded font-bold">
                                      P{page.pageNumber}
                                    </span>
                                    {isCover && (
                                      <span className="absolute bottom-1 inset-x-1 bg-rose-600 text-white text-[8px] font-extrabold text-center py-0.5 rounded uppercase tracking-wider">
                                        ★ COVER PAGE
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center justify-between pt-1">
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleMoveEpisodePage(idx, 'up');
                                        }}
                                        className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                                        title="Move Earlier"
                                      >
                                        <ArrowUp className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === episodeAttachedPages.length - 1}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleMoveEpisodePage(idx, 'down');
                                        }}
                                        className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                                        title="Move Later"
                                      >
                                        <ArrowDown className="w-3 h-3" />
                                      </button>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveEpisodePage(page.id);
                                      }}
                                      className="p-1 rounded text-slate-400 hover:text-rose-500 cursor-pointer"
                                      title="Remove Page"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action buttons: Preview First & Publish Direct */}
                    <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={handleOpenLivePreview}
                        className="w-full sm:flex-1 py-2.5 px-4 rounded-xl border border-rose-600 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                      >
                        <Eye className="w-4 h-4" />
                        <span>Preview Episode Before Publishing</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isPublishingEpisode || !selectedChapterId || !episodeTitle.trim() || episodeAttachedPages.length === 0}
                        className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider shadow-md shadow-rose-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{isPublishingEpisode ? 'Publishing...' : 'Publish Episode to Chapter'}</span>
                      </button>
                    </div>
                  </form>
                </div>

                {/* Chapters & Episodes List Hierarchy */}
                <div className="space-y-4 pt-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Chapters &amp; Published Episodes ({selectedComic.chapters.length} Chapters):
                  </h4>

                  {selectedComic.chapters.length === 0 ? (
                    <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                      No chapters created yet. Use the form above to add Chapter 1.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedComic.chapters.map((ch) => (
                        <div
                          key={ch.id}
                          className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/60 pb-2">
                            {editingChapterId === ch.id ? (
                              <div className="flex items-center gap-2 flex-1">
                                <input
                                  type="text"
                                  value={editChapterTitle}
                                  onChange={(e) => setEditChapterTitle(e.target.value)}
                                  className="px-2.5 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 flex-1"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleUpdateChapter(ch.id, editChapterTitle)}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingChapterId(null)}
                                  className="px-2.5 py-1 rounded-lg border text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-slate-900 dark:text-white">
                                  Chapter {ch.chapterNumber}: {ch.title}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  ({ch.episodes.length} Episodes)
                                </span>
                              </div>
                            )}

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedChapterId(ch.id);
                                  setActiveUploadChapterId(ch.id);
                                  const uploadSection = document.getElementById('admin-episode-upload-section');
                                  if (uploadSection) uploadSection.scrollIntoView({ behavior: 'smooth' });
                                }}
                                className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>+ Upload Episode</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingChapterId(ch.id);
                                  setEditChapterTitle(ch.title);
                                }}
                                className="p-1 rounded text-slate-400 hover:text-white"
                                title="Edit Chapter Title"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteChapter(ch.id)}
                                className="p-1 rounded text-slate-400 hover:text-rose-500"
                                title="Delete Chapter"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Episodes in this Chapter */}
                          {ch.episodes.length === 0 ? (
                            <p className="text-[11px] text-slate-400 italic">
                              No episodes in this chapter yet. Attach pages to upload Episode 1.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {ch.episodes.map(ep => (
                                <div
                                  key={ep.id}
                                  className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shadow-xs"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <img
                                      src={ep.coverImage || selectedComic.coverImage}
                                      alt={ep.title}
                                      className="w-10 h-14 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-slate-800"
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                          {ep.title}
                                        </span>
                                        {ep.isPremium ? (
                                          <span className="text-[9px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1 py-0.2 rounded font-mono font-bold">
                                            ₹{ep.priceInr}
                                          </span>
                                        ) : (
                                          <span className="text-[9px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1 py-0.2 rounded font-bold">
                                            Free
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                                        📸 {ep.pages?.length || 0} Pages · Ep {ep.episodeNumber}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditEpisode(ep, ch.id)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                      title="Edit Episode"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteEpisode(ch.id, ep.id)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500"
                                      title="Delete Episode"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <BookOpen className="w-12 h-12 text-slate-300 mx-auto" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">No Comic Selected</h4>
                <p className="text-xs text-slate-400">Select a comic from the left to view chapters and episodes.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: UPLOAD NEW COMIC BOOK SERIES */}
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
              Set up title, primary genre, cover artwork, and monetization access. Instantly approved &amp; live.
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
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Primary Genre *
              </label>
              <select
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none text-slate-900 dark:text-white"
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

          {/* Attach Comic Book Files & Select Cover Page */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-rose-500" />
                <span>Attach Comic Book Files / Pages (Multiple Supported) *</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {newComicAttachedPages.length} Files Attached
              </span>
            </label>

            <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-500 dark:hover:border-rose-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-800/40 group">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleNewComicFilesChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                <FileUp className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Click to Select Multiple Comic Pages &amp; Images or Drag &amp; Drop
              </span>
              <span className="text-[11px] text-slate-400 mt-0.5">
                Upload your comic page images. You can choose which one to set as the cover image below.
              </span>
            </label>

            {/* Attached Files Preview & Cover Selection */}
            {newComicAttachedPages.length > 0 && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider block font-heading">
                      Select Cover Page for Comic Series
                    </span>
                    <span className="text-[11px] text-rose-500 font-semibold">
                      Choose any image from your uploaded files to set as the official series cover
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-500 font-mono font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                    ✓ {newComicAttachedPages.length} Files Uploaded
                  </span>
                </div>

                {/* Direct Dropdown Cover Selector */}
                <div className="p-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0 uppercase tracking-wider">
                    Select Cover Page Image:
                  </label>
                  <select
                    value={selectedCoverPageId || (newComicAttachedPages[0]?.id || '')}
                    onChange={(e) => setSelectedCoverPageId(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    {newComicAttachedPages.map((p, idx) => (
                      <option key={p.id} value={p.id}>
                        Page {p.pageNumber}: {p.fileName} ({p.size}) {idx === 0 ? '- Default First Page' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setNewComicAttachedPages([]);
                      setSelectedCoverPageId(null);
                    }}
                    className="text-xs text-rose-500 hover:underline font-semibold"
                  >
                    Remove All Files
                  </button>
                </div>

                {/* Visual Thumbnail Gallery with Cover Badge */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 max-h-80 overflow-y-auto p-1">
                  {newComicAttachedPages.map((page, idx) => {
                    const isCover = selectedCoverPageId === page.id || (!selectedCoverPageId && idx === 0);

                    return (
                      <div
                        key={page.id}
                        onClick={() => setSelectedCoverPageId(page.id)}
                        className={`group relative rounded-xl border p-2 flex flex-col space-y-1.5 transition-all cursor-pointer ${
                          isCover
                            ? 'border-rose-500 ring-2 ring-rose-500/40 bg-rose-500/10 shadow-md scale-102'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:border-slate-400'
                        }`}
                      >
                        <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-black/10">
                          <img
                            src={page.dataUrl}
                            alt={page.fileName}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute top-1 left-1 bg-black/75 backdrop-blur-sm text-white font-mono text-[9px] px-1.5 py-0.5 rounded font-bold">
                            P{page.pageNumber}
                          </span>
                          {isCover && (
                            <span className="absolute bottom-1 left-1 right-1 bg-rose-600 text-white text-[9px] font-extrabold text-center py-1 rounded shadow-md uppercase tracking-wider">
                              ★ COVER PAGE
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col gap-1 pt-1">
                          <span className="text-[10px] text-slate-500 truncate" title={page.fileName}>
                            {page.fileName}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCoverPageId(page.id);
                            }}
                            className={`py-1 px-2 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
                              isCover
                                ? 'bg-rose-600 text-white shadow-xs'
                                : 'bg-slate-200 dark:bg-slate-800 hover:bg-rose-500 hover:text-white text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {isCover ? '★ Selected Cover' : 'Set as Cover'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white resize-none"
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
                  name="admin_comic_access"
                  checked={newAccess === 'free'}
                  onChange={() => setNewAccess('free')}
                  className="text-rose-600"
                />
                <span>Free to Read (100% Free)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                <input
                  type="radio"
                  name="admin_comic_access"
                  checked={newAccess === 'premium'}
                  onChange={() => setNewAccess('premium')}
                  className="text-rose-600"
                />
                <span>Premium Paywall (INR)</span>
              </label>
            </div>

            {newAccess === 'premium' && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Full Comic Series Price (INR)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs font-bold">₹</span>
                    <input
                      type="number"
                      min="10"
                      value={newFullPrice}
                      onChange={(e) => setNewFullPrice(Number(e.target.value))}
                      className="w-full pl-7 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Default Price Per Episode (INR)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs font-bold">₹</span>
                    <input
                      type="number"
                      min="5"
                      value={newEpPrice}
                      onChange={(e) => setNewEpPrice(Number(e.target.value))}
                      className="w-full pl-7 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmittingComic}
            className="w-full py-4 px-6 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmittingComic ? (
              <span>Creating &amp; Publishing Series...</span>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Create &amp; Publish Comic Series to Website</span>
              </>
            )}
          </button>
        </form>
      )}

    </div>
  );
};
