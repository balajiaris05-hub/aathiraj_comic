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
  FileUp,
  Images,
  ArrowUp,
  ArrowDown,
  ZoomIn,
  ZoomOut,
  XCircle,
  X,
  ChevronDown,
  ChevronUp,
  FolderPlus
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
  const [showAuthorLivePreview, setShowAuthorLivePreview] = useState(false);
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

  // Author In-App Deletion Request Modal State
  interface AuthorDeleteRequestTarget {
    type: 'series' | 'chapter' | 'episode';
    comicId: string;
    comicTitle: string;
    chapterId?: string;
    chapterTitle?: string;
    episodeId?: string;
    episodeTitle?: string;
  }
  const [authorDeleteRequestTarget, setAuthorDeleteRequestTarget] = useState<AuthorDeleteRequestTarget | null>(null);
  const [deleteRequestReason, setDeleteRequestReason] = useState('');
  const [isSubmittingDeleteRequest, setIsSubmittingDeleteRequest] = useState(false);
  const [authorDeleteRequests, setAuthorDeleteRequests] = useState<any[]>([]);

  const fetchAuthorDeleteRequests = async () => {
    try {
      const res = await fetch('/api/admin/delete-requests');
      if (res.ok) {
        const data = await res.json();
        setAuthorDeleteRequests(data.deleteRequests || []);
      }
    } catch (e) {
      console.error('Error fetching delete requests:', e);
    }
  };

  useEffect(() => {
    fetchAuthorDeleteRequests();
  }, [comics]);

  const isSeriesPendingDelete = (comicId: string, moderationStatus?: string) => {
    if (moderationStatus === 'delete_requested') return true;
    return authorDeleteRequests.some(
      (r) => r.status === 'pending' && r.comicId === comicId && r.targetType === 'series'
    );
  };

  const isChapterPendingDelete = (comicId: string, chapId: string, moderationStatus?: string) => {
    if (isSeriesPendingDelete(comicId, moderationStatus)) return true;
    return authorDeleteRequests.some(
      (r) => r.status === 'pending' && r.comicId === comicId && r.targetType === 'chapter' && r.chapterId === chapId
    );
  };

  const isEpisodePendingDelete = (comicId: string, chapId: string, epId: string, moderationStatus?: string) => {
    if (isChapterPendingDelete(comicId, chapId, moderationStatus)) return true;
    return authorDeleteRequests.some(
      (r) => r.status === 'pending' && r.comicId === comicId && r.targetType === 'episode' && r.episodeId === epId
    );
  };

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
  const [episodeIsPremium, setEpisodeIsPremium] = useState(false);
  const [episodePrice, setEpisodePrice] = useState(10);
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
    // STRICT OWNERSHIP FILTER: Author only has access to his own books!
    const myComics = comics.filter(c => {
      // Never show admin publications or books belonging to other authors
      if (c.authorId === 'usr_admin' || c.authorName?.includes('(Admin)')) return false;

      if (user?.id && c.authorId === user.id) return true;
      if (user?.name && c.authorName?.toLowerCase() === user.name?.toLowerCase()) return true;
      if (user?.email && c.authorId === user.email) return true;
      // Demo author persona
      if ((user?.id === 'usr_rajesh' || user?.name === 'Rajesh Singh') && (c.authorId === 'usr_rajesh' || c.authorName === 'Rajesh Singh')) return true;
      return false;
    });

    setAuthorComics(myComics);
    if (myComics.length > 0) {
      if (!selectedComic || !myComics.find(mc => mc.id === selectedComic.id)) {
        const firstComic = myComics[0];
        setSelectedComic(firstComic);
        if (firstComic.chapters.length > 0) {
          setSelectedChapterId(firstComic.chapters[0].id);
          setModalSelectedChapterId(firstComic.chapters[0].id);
          if (firstComic.chapters[0].episodes.length > 0) {
            setModalSelectedEpisodeId(firstComic.chapters[0].episodes[0].id);
          }
        }
      } else {
        const latest = myComics.find(mc => mc.id === selectedComic.id);
        if (latest) {
          setSelectedComic(latest);
          if (latest.chapters.length > 0 && !modalSelectedChapterId) {
            setModalSelectedChapterId(latest.chapters[0].id);
            if (latest.chapters[0].episodes.length > 0 && !modalSelectedEpisodeId) {
              setModalSelectedEpisodeId(latest.chapters[0].episodes[0].id);
            }
          }
        }
      }
    } else {
      setSelectedComic(null);
    }
  }, [comics, user]);

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

  // Only Admin can delete uploaded comics — route any series deletion to Admin Request
  const handleDirectDeleteComicSeries = async () => {
    if (!selectedComic) return;
    await handleOpenDeleteRequestModal('series', selectedComic.id, selectedComic.title);
  };

  // Open Author Content Deletion Request In-App Modal AND immediately register request in Admin Portal queue
  const handleOpenDeleteRequestModal = async (
    type: 'series' | 'chapter' | 'episode',
    comicId: string,
    comicTitle: string,
    chapterId?: string,
    chapterTitle?: string,
    episodeId?: string,
    episodeTitle?: string
  ) => {
    setAuthorDeleteRequestTarget({
      type,
      comicId,
      comicTitle,
      chapterId,
      chapterTitle,
      episodeId,
      episodeTitle,
    });
    setDeleteRequestReason('');

    // Immediately register the pending deletion request in the backend so it appears in Admin Delete Requests right away
    try {
      const res = await fetch('/api/author/comics/request-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comicId,
          chapterId,
          episodeId,
          targetType: type,
          reason: `Author requested ${type} removal (Awaiting Admin approval)`,
          authorId: user?.id || 'usr_rajesh',
          authorName: user?.name || 'Rajesh Singh',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchAuthorDeleteRequests();
        onRefreshComics();
        if (data.comic) setSelectedComic(data.comic);
      }
    } catch (e) {
      console.error('Error registering initial delete request:', e);
    }
  };

  // Submit / Update Author Deletion Request Reason to Admin Portal
  const handleConfirmSubmitDeleteRequest = async () => {
    if (!authorDeleteRequestTarget) return;
    setIsSubmittingDeleteRequest(true);
    const target = authorDeleteRequestTarget;

    try {
      const res = await fetch('/api/author/comics/request-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comicId: target.comicId,
          chapterId: target.chapterId,
          episodeId: target.episodeId,
          targetType: target.type,
          reason: deleteRequestReason.trim() || `Author requested ${target.type} removal (Awaiting Admin approval)`,
          authorId: user?.id || 'usr_rajesh',
          authorName: user?.name || 'Rajesh Singh',
        }),
      });
      const data = await res.json();
      setIsSubmittingDeleteRequest(false);
      if (res.ok) {
        setAuthorDeleteRequestTarget(null);
        setIsDeleteModalOpen(false);
        await fetchAuthorDeleteRequests();
        onRefreshComics();
        if (data.comic) setSelectedComic(data.comic);
        setSubmissionFeedback(`✓ ${target.type.toUpperCase()} deletion request for "${target.episodeTitle || target.chapterTitle || target.comicTitle}" is now in the Admin Portal -> Delete Requests panel awaiting Administrator deletion!`);
        setTimeout(() => setSubmissionFeedback(null), 8000);
      } else {
        setSubmissionFeedback(data.error || 'Failed to submit deletion request.');
      }
    } catch (err) {
      setIsSubmittingDeleteRequest(false);
      console.error(err);
    }
  };

  // Legacy wrappers forwarding directly to modal & immediate registration
  const handleSubmitDeleteRequestToAdmin = async (targetType: 'series' | 'chapter' | 'episode') => {
    if (!selectedComic) return;
    const activeChap = selectedComic.chapters.find(c => c.id === modalSelectedChapterId) || selectedComic.chapters[0];
    const activeEp = activeChap?.episodes.find(e => e.id === modalSelectedEpisodeId);
    await handleOpenDeleteRequestModal(
      targetType,
      selectedComic.id,
      selectedComic.title,
      targetType !== 'series' ? activeChap?.id : undefined,
      targetType !== 'series' ? activeChap?.title : undefined,
      targetType === 'episode' ? activeEp?.id : undefined,
      targetType === 'episode' ? activeEp?.title : undefined
    );
  };

  const handleRequestComicDeletion = async () => {
    if (!selectedComic) return;
    await handleOpenDeleteRequestModal('series', selectedComic.id, selectedComic.title);
  };

  const handleSendEpisodeDeleteRequest = async (ep: Episode, chapId: string) => {
    if (!selectedComic) return;
    const ch = selectedComic.chapters.find(c => c.id === chapId);
    await handleOpenDeleteRequestModal('episode', selectedComic.id, selectedComic.title, chapId, ch?.title, ep.id, ep.title);
  };

  // Handle multiple file attachments for author comic creation & cover selection
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

  // Handle Comic Creation
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
          title: newTitle,
          authorId: user?.id || 'usr_rajesh',
          authorName: user?.name || 'Rajesh Singh',
          genre: [newGenre],
          coverImage: coverImageUrl,
          description: newDesc,
          accessType: newAccess,
          fullPriceInr: newAccess === 'premium' ? newFullPrice : 0,
          chapterPriceInr: newAccess === 'premium' ? 30 : 0,
          episodePriceInr: newAccess === 'premium' ? newEpPrice : 0,
          attachedFileName: coverPage?.fileName || 'Attached Comic Pages',
          attachedFileSize: `${newComicAttachedPages.length} files`,
          attachedFileType: 'IMAGE_ARCHIVE',
          pages: newComicAttachedPages.map(p => ({
            pageNumber: p.pageNumber,
            imageUrl: p.dataUrl,
            caption: p.caption,
          })),
        }),
      });

      const data = await res.json();

      if (res.ok && data.comic) {
        if (submitForApprovalOnCreate) {
          await fetch('/api/author/comics/submit-for-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              comicId: data.comic.id,
              attachedFileName: coverPage?.fileName,
            }),
          });
          setSubmissionFeedback(`"${data.comic.title}" was created and submitted with ${newComicAttachedPages.length} attached pages to Admin for approval! Once approved, it will be automatically published on the website.`);
          setTimeout(() => setSubmissionFeedback(null), 8000);
        }

        setIsSubmittingComic(false);
        onRefreshComics();
        setSelectedComic(data.comic);
        setActiveTab('comics');
        setNewTitle('');
        setNewDesc('');
        setNewComicAttachedPages([]);
        setSelectedCoverPageId(null);
      } else {
        setIsSubmittingComic(false);
        alert(data.error || 'Failed to create comic.');
      }
    } catch (err) {
      setIsSubmittingComic(false);
      console.error(err);
    }
  };

  // Multiple Photos Upload Handler for Author Episodes
  const handleAuthorMultipleEpisodePagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file, index) => {
      const formattedSize = file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;

      const reader = new FileReader();
      reader.onload = () => {
        setEpisodeAttachedPages(prev => {
          const newId = `p_auth_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${index}`;
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

  // Remove Page from Episode Upload
  const handleRemoveEpisodePage = (pageId: string) => {
    setEpisodeAttachedPages(prev => {
      const filtered = prev.filter(p => p.id !== pageId);
      return filtered.map((p, idx) => ({ ...p, pageNumber: idx + 1, caption: `Page ${idx + 1}` }));
    });
  };

  // Move Page order in Episode Upload
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

  // Handle Comic Edit Initiation
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
        setSubmissionFeedback(`"${data.comic.title}" was updated successfully!`);
        setTimeout(() => setSubmissionFeedback(null), 5000);
      } else {
        setComicEditError(data.error || 'Failed to update comic.');
      }
    } catch (err) {
      setIsSavingComicEdit(false);
      setComicEditError('Network error while saving changes.');
      console.error(err);
    }
  };

  // Handle Chapter Title Update
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
      }
    } catch (err) {
      setIsUpdatingChapter(false);
      console.error(err);
    }
  };

  // Handle Chapter Deletion (Routes to Admin Delete Request since only Admin can delete uploaded comics/chapters)
  const handleDeleteChapter = async (chapId: string) => {
    if (!selectedComic) return;
    const ch = selectedComic.chapters.find(c => c.id === chapId);
    await handleOpenDeleteRequestModal('chapter', selectedComic.id, selectedComic.title, chapId, ch?.title);
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
        setSubmissionFeedback(`"${editEpisodeTitle}" was updated successfully!`);
        setTimeout(() => setSubmissionFeedback(null), 5000);
      }
    } catch (err) {
      setIsUpdatingEpisode(false);
      console.error(err);
    }
  };

  // Delete Episode
  const handleDeleteEpisode = async (chapId: string, epId: string) => {
    if (!selectedComic) return;
    if (!confirm('⚠️ WARNING: Are you sure you want to delete this episode? This action is permanent and cannot be undone.')) return;

    // Optimistic local update
    setSelectedComic(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        chapters: prev.chapters.map(ch => {
          if (ch.id === chapId) {
            return {
              ...ch,
              episodes: ch.episodes.filter(ep => ep.id !== epId),
            };
          }
          return ch;
        }),
      };
    });

    try {
      const res = await fetch(`/api/comics/${selectedComic.id}/chapters/${chapId}/episodes/${epId}?authorId=${user?.id || ''}&authorName=${encodeURIComponent(user?.name || '')}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        onRefreshComics();
        setSubmissionFeedback('Episode deleted successfully.');
        setTimeout(() => setSubmissionFeedback(null), 5000);
      } else {
        alert(data.error || 'Failed to delete episode.');
        onRefreshComics();
      }
    } catch (err) {
      console.error(err);
      alert('Network error while deleting episode.');
      onRefreshComics();
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
        body: JSON.stringify({
          title: chapterTitle.trim(),
          authorId: user?.id,
          authorName: user?.name,
        }),
      });

      if (res.ok) {
        onRefreshComics();
        setChapterTitle('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Open Author Live Preview Modal
  const handleOpenAuthorLivePreview = () => {
    if (episodeAttachedPages.length === 0) {
      alert('Please attach at least one photo (comic page) before launching preview.');
      return;
    }
    if (!episodeTitle.trim()) {
      alert('Please enter an episode title before launching preview.');
      return;
    }
    setPreviewCurrentPage(1);
    setShowAuthorLivePreview(true);
  };

  // Handle Episode Creation (With Multi-Photo Support)
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
        setShowAuthorLivePreview(false);
        setEpisodeAttachedPages([]);
        setSelectedEpisodeCoverPageId(null);
        setEpisodeTitle('');
        setEpisodeSynopsis('');
        setActiveUploadChapterId(null);
        onRefreshComics();
        setSubmissionFeedback(`New episode published with ${episodeAttachedPages.length || 1} pages and cover page assigned!`);
        setTimeout(() => setSubmissionFeedback(null), 7000);
      }
    } catch (e) {
      setIsPublishingEpisode(false);
      console.error(e);
    }
  };

  return (
    <div className="space-y-8 pb-24">

      {/* Interactive Delete Chapter, Episode or Series Modal */}
      {isDeleteModalOpen && selectedComic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg p-6 rounded-3xl bg-white dark:bg-slate-900 border border-rose-500/40 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center justify-center">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white font-heading">
                    Delete Content Manager
                  </h3>
                  <span className="text-xs text-rose-500 font-semibold">
                    Series: {selectedComic.title}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode selection tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold">
              <button
                type="button"
                onClick={() => setDeleteMode('episode')}
                className={`flex-1 py-2 rounded-lg transition-colors cursor-pointer ${
                  deleteMode === 'episode'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Delete Episode
              </button>
              <button
                type="button"
                onClick={() => setDeleteMode('chapter')}
                className={`flex-1 py-2 rounded-lg transition-colors cursor-pointer ${
                  deleteMode === 'chapter'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Delete Chapter
              </button>
              <button
                type="button"
                onClick={() => setDeleteMode('series')}
                className={`flex-1 py-2 rounded-lg transition-colors cursor-pointer ${
                  deleteMode === 'series'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Delete Entire Series
              </button>
            </div>

            {/* MODE 1: DELETE EPISODE */}
            {deleteMode === 'episode' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Select a chapter and the specific episode you wish to remove permanently:
                </p>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    1. Select Chapter:
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
                    className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-medium"
                  >
                    {selectedComic.chapters.map(ch => (
                      <option key={ch.id} value={ch.id}>
                        Chapter {ch.chapterNumber}: {ch.title} ({ch.episodes.length} Episodes)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    2. Select Episode to Delete:
                  </label>
                  {(() => {
                    const activeChap = selectedComic.chapters.find(c => c.id === modalSelectedChapterId) || selectedComic.chapters[0];
                    if (!activeChap || activeChap.episodes.length === 0) {
                      return (
                        <p className="text-xs text-amber-500 italic p-2 bg-amber-500/10 rounded-lg">
                          No episodes in this chapter.
                        </p>
                      );
                    }
                    return (
                      <select
                        value={modalSelectedEpisodeId}
                        onChange={(e) => setModalSelectedEpisodeId(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-medium"
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

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsDeleteModalOpen(false)}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={!modalSelectedChapterId || !modalSelectedEpisodeId}
                    onClick={() => handleSubmitDeleteRequestToAdmin('episode')}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold shadow-md cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Send Delete Request to Admin</span>
                  </button>
                </div>
              </div>
            )}

            {/* MODE 2: DELETE CHAPTER */}
            {deleteMode === 'chapter' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Select a chapter to delete along with all episodes contained inside it:
                </p>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Select Chapter to Delete:
                  </label>
                  <select
                    value={modalSelectedChapterId}
                    onChange={(e) => setModalSelectedChapterId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-medium"
                  >
                    {selectedComic.chapters.map(ch => (
                      <option key={ch.id} value={ch.id}>
                        Chapter {ch.chapterNumber}: {ch.title} ({ch.episodes.length} Episodes)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400">
                  ⚠️ Deleting this chapter will also delete all of its episodes.
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsDeleteModalOpen(false)}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={!modalSelectedChapterId}
                    onClick={() => handleSubmitDeleteRequestToAdmin('chapter')}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold shadow-md cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Send Chapter Delete Request to Admin</span>
                  </button>
                </div>
              </div>
            )}

            {/* MODE 3: DELETE ENTIRE SERIES */}
            {deleteMode === 'series' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Only the Platform Administrator can permanently delete an uploaded comic series. Submit a deletion request for <strong className="text-slate-900 dark:text-white">"{selectedComic.title}"</strong> below:
                </p>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={async () => {
                      setIsDeleteModalOpen(false);
                      await handleRequestComicDeletion();
                    }}
                    className="w-full p-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center justify-between shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>Send Series Deletion Request to Admin</span>
                    </div>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsDeleteModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* IN-APP MODAL: AUTHOR CONTENT DELETION REQUEST TO ADMIN */}
      {authorDeleteRequestTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md p-6 rounded-3xl bg-white dark:bg-slate-900 border border-amber-500/40 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base font-heading">
                    Request Deletion from Admin
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
                    Target: {authorDeleteRequestTarget.type}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuthorDeleteRequestTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Item Details */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 space-y-1 text-xs">
              <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Item To Remove:</span>
              <p className="font-extrabold text-slate-900 dark:text-white text-sm">
                {authorDeleteRequestTarget.episodeTitle || authorDeleteRequestTarget.chapterTitle || authorDeleteRequestTarget.comicTitle}
              </p>
              {authorDeleteRequestTarget.type === 'episode' && authorDeleteRequestTarget.chapterTitle && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Chapter: <span className="font-medium text-slate-700 dark:text-slate-300">{authorDeleteRequestTarget.chapterTitle}</span>
                </p>
              )}
              {authorDeleteRequestTarget.type !== 'series' && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Series: <span className="font-medium text-slate-700 dark:text-slate-300">{authorDeleteRequestTarget.comicTitle}</span>
                </p>
              )}
            </div>

            {/* Reason input */}
            <div className="space-y-1.5 text-xs">
              <label className="block font-bold text-slate-700 dark:text-slate-300">
                Reason / Note for Administrator (Optional)
              </label>
              <textarea
                rows={3}
                value={deleteRequestReason}
                onChange={(e) => setDeleteRequestReason(e.target.value)}
                placeholder="Explain why you wish to remove this content (e.g., re-uploading revised edition, content retired, duplicate entry)..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Your request will be submitted to the Admin Portal's Delete Requests queue for review and permanent deletion.</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setAuthorDeleteRequestTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingDeleteRequest}
                onClick={handleConfirmSubmitDeleteRequest}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                {isSubmittingDeleteRequest ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5" />
                    <span>Send Request to Admin</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
                      {isSeriesPendingDelete(c.id, c.moderationStatus) ? (
                        <span className="text-[9px] font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          <span>Waiting Admin Delete</span>
                        </span>
                      ) : c.moderationStatus === 'pending' ? (
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
                  <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
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
                      {isSeriesPendingDelete(selectedComic.id, selectedComic.moderationStatus) ? (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center gap-1">
                          <Clock className="w-3 h-3 animate-pulse" />
                          <span>Waiting for Admin Delete</span>
                        </span>
                      ) : selectedComic.moderationStatus === 'pending' ? (
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

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleStartEditComic}
                      className="py-2 px-3.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-all cursor-pointer border border-slate-300 dark:border-slate-700"
                    >
                      <PenTool className="w-3.5 h-3.5 text-rose-500" />
                      <span>Edit Comic Details</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsDeleteModalOpen(true)}
                      className="py-2 px-3.5 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center gap-1.5 transition-all cursor-pointer border border-rose-500/30"
                      title="Request Admin to delete chapter, episode, or full comic series"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Request Delete (Series / Chapter / Episode)</span>
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

                {authorDeleteRequests.some(r => r.status === 'pending' && r.comicId === selectedComic.id) && (
                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2.5">
                    <Clock className="w-4 h-4 shrink-0 mt-0.5 animate-pulse" />
                    <div className="space-y-1">
                      <p>
                        <strong>Waiting for Admin Delete Approval:</strong> Only the Platform Administrator can permanently delete uploaded comics, chapters, or episodes. Your request is active in the <strong>Admin Portal → 🗑️ Delete Requests</strong> panel:
                      </p>
                      <ul className="list-disc list-inside text-[11px] font-semibold">
                        {authorDeleteRequests
                          .filter(r => r.status === 'pending' && r.comicId === selectedComic.id)
                          .map(r => (
                            <li key={r.id}>
                              {r.targetType === 'series'
                                ? `Full Series: "${r.comicTitle}"`
                                : r.targetType === 'chapter'
                                ? `Chapter: "${r.chapterTitle || 'Selected Chapter'}"`
                                : `Episode: "${r.episodeTitle || 'Selected Episode'}" (${r.chapterTitle || 'Chapter'})`}
                            </li>
                          ))}
                      </ul>
                    </div>
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
                    className="px-4 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shrink-0 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Chapter</span>
                  </button>
                </form>

                {/* Add Episode & Multi-Photo Upload Section */}
                <div
                  id="author-episode-upload-section"
                  className={`p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border transition-all space-y-4 ${
                    activeUploadChapterId
                      ? 'border-rose-500 ring-2 ring-rose-500/20 shadow-md'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                        <FileUp className="w-4 h-4 text-rose-500" />
                        <span>Upload Episode &amp; Pages to Chapter</span>
                      </h4>
                      {activeUploadChapterId && (
                        <p className="text-[11px] text-rose-500 font-semibold mt-0.5">
                          ✓ Ready to attach episode photos to selected chapter
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium">Attach Photos → Preview → Publish</span>
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
                          onChange={handleAuthorMultipleEpisodePagesUpload}
                          className="hidden"
                        />
                        <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform">
                          <FileUp className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Click to Select Photos &amp; Images or Drag &amp; Drop
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          Select multiple artwork files (JPG, PNG, WEBP) to arrange as comic pages
                        </span>
                      </label>

                      {/* Attached Files Preview & Cover Selection */}
                      {episodeAttachedPages.length > 0 && (
                        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-xs">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div>
                              <span className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider block font-heading">
                                Select Cover Page for Episode
                              </span>
                              <span className="text-[11px] text-rose-500 font-semibold">
                                Choose any image from your uploaded files to set as the official episode cover
                              </span>
                            </div>
                            <span className="text-[10px] text-emerald-500 font-mono font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                              ✓ {episodeAttachedPages.length} Files Attached
                            </span>
                          </div>

                          {/* Direct Dropdown Cover Selector */}
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0 uppercase tracking-wider">
                              Select Cover Page Image:
                            </label>
                            <select
                              value={selectedEpisodeCoverPageId || (episodeAttachedPages[0]?.id || '')}
                              onChange={(e) => setSelectedEpisodeCoverPageId(e.target.value)}
                              className="flex-1 px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500"
                            >
                              {episodeAttachedPages.map((p, idx) => (
                                <option key={p.id} value={p.id}>
                                  {selectedEpisodeCoverPageId === p.id || (!selectedEpisodeCoverPageId && idx === 0) ? '★ ' : ''}
                                  Page {p.pageNumber}: {p.fileName} ({p.size}) {selectedEpisodeCoverPageId === p.id || (!selectedEpisodeCoverPageId && idx === 0) ? '[CURRENT COVER]' : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Thumbnails Grid */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-400">
                              <span>Uploaded Files Gallery (Click any image to select as Cover):</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={handleOpenAuthorLivePreview}
                                  className="text-rose-600 hover:underline cursor-pointer"
                                >
                                  Preview Pages
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEpisodeAttachedPages([]);
                                    setSelectedEpisodeCoverPageId(null);
                                  }}
                                  className="text-rose-500 hover:underline cursor-pointer"
                                >
                                  Remove All
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 max-h-80 overflow-y-auto p-1">
                              {episodeAttachedPages.map((page, idx) => {
                                const isEpisodeCover = selectedEpisodeCoverPageId === page.id || (!selectedEpisodeCoverPageId && idx === 0);

                                return (
                                  <div
                                    key={page.id}
                                    onClick={() => setSelectedEpisodeCoverPageId(page.id)}
                                    className={`group relative rounded-xl border p-2 flex flex-col space-y-1.5 transition-all cursor-pointer ${
                                      isEpisodeCover
                                        ? 'border-amber-500 ring-2 ring-amber-500/40 bg-amber-500/10 shadow-md scale-102'
                                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:border-slate-400'
                                    }`}
                                  >
                                    <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-black/10">
                                      <img
                                        src={page.dataUrl}
                                        alt={page.caption || `Page ${page.pageNumber}`}
                                        className="w-full h-full object-cover"
                                      />
                                      <span className="absolute top-1 left-1 bg-black/75 backdrop-blur-sm text-white font-mono text-[9px] px-1.5 py-0.5 rounded font-bold">
                                        P{page.pageNumber}
                                      </span>
                                      {isEpisodeCover && (
                                        <span className="absolute bottom-1 left-1 right-1 bg-amber-500 text-slate-950 font-extrabold text-center py-1 rounded shadow-md uppercase tracking-wider text-[9px]">
                                          ★ COVER PAGE
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex flex-col gap-1 pt-1">
                                      <span className="text-[10px] text-slate-500 truncate" title={page.fileName}>
                                        {page.fileName}
                                      </span>
                                      <div className="flex items-center justify-between gap-1">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedEpisodeCoverPageId(page.id);
                                          }}
                                          className={`flex-1 py-1 px-1 rounded text-[9px] font-extrabold transition-all cursor-pointer ${
                                            isEpisodeCover
                                              ? 'bg-amber-500 text-slate-950 shadow-xs'
                                              : 'bg-slate-200 dark:bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-700 dark:text-slate-300'
                                          }`}
                                        >
                                          {isEpisodeCover ? '★ Selected' : 'Set Cover'}
                                        </button>
                                        <div className="flex items-center gap-0.5">
                                          <button
                                            type="button"
                                            disabled={idx === 0}
                                            onClick={(e) => { e.stopPropagation(); handleMoveEpisodePage(idx, 'up'); }}
                                            className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 cursor-pointer"
                                            title="Move earlier"
                                          >
                                            <ArrowUp className="w-3 h-3" />
                                          </button>
                                          <button
                                            type="button"
                                            disabled={idx === episodeAttachedPages.length - 1}
                                            onClick={(e) => { e.stopPropagation(); handleMoveEpisodePage(idx, 'down'); }}
                                            className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 cursor-pointer"
                                            title="Move later"
                                          >
                                            <ArrowDown className="w-3 h-3" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleRemoveEpisodePage(page.id); }}
                                            className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                                            title="Remove page"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      {episodeAttachedPages.length > 0 && (
                        <button
                          type="button"
                          onClick={handleOpenAuthorLivePreview}
                          className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Eye className="w-4 h-4 text-rose-500" />
                          <span>Preview Reader View</span>
                        </button>
                      )}

                      <button
                        type="submit"
                        disabled={isPublishingEpisode}
                        className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-md cursor-pointer"
                      >
                        <Upload className="w-4 h-4" />
                        <span>
                          {isPublishingEpisode
                            ? 'Publishing Episode...'
                            : episodeAttachedPages.length > 0
                            ? `Publish Episode with ${episodeAttachedPages.length} Photos`
                            : 'Publish Episode to Aathirai Network'}
                        </span>
                      </button>
                    </div>
                  </form>
                </div>

                {/* Author Submitted Delete Requests Status Banner */}
                {authorDeleteRequests.filter(r => r.comicId === selectedComic.id || r.status === 'pending').length > 0 && (
                  <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/30 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                          Submitted Delete Requests Sent to Admin ({authorDeleteRequests.filter(r => r.status === 'pending').length} Waiting for Admin)
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        Synced with Admin Portal
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {authorDeleteRequests
                        .filter(r => r.comicId === selectedComic.id || r.status === 'pending')
                        .map((req) => (
                          <div
                            key={req.id}
                            className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/15 text-rose-500 border border-rose-500/30">
                                {req.targetType}
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {req.comicTitle}
                              </span>
                              {req.chapterTitle && (
                                <span className="text-slate-500">· {req.chapterTitle}</span>
                              )}
                              {req.episodeTitle && (
                                <span className="text-rose-500 font-semibold">· {req.episodeTitle}</span>
                              )}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                req.status === 'pending'
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                  : req.status === 'approved'
                                  ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                              }`}
                            >
                              {req.status === 'pending'
                                ? '⏳ Waiting for Admin Delete'
                                : req.status === 'approved'
                                ? '✓ Deleted by Admin'
                                : '✕ Rejected by Admin'}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Existing Chapters & Episodes List with Direct Upload Buttons & Edit Controls */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Published Content in this Series:
                    </h4>
                    <span className="text-[11px] text-slate-400">
                      {selectedComic.chapters.length} Chapters · Total {selectedComic.chapters.reduce((acc, c) => acc + c.episodes.length, 0)} Episodes
                    </span>
                  </div>

                  {selectedComic.chapters.map((ch) => (
                    <div
                      key={ch.id}
                      className={`p-4 rounded-xl border transition-all space-y-3 ${
                        selectedChapterId === ch.id
                          ? 'border-rose-400 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/10'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                        {editingChapterId === ch.id ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={editChapterTitle}
                              onChange={(e) => setEditChapterTitle(e.target.value)}
                              className="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 flex-1"
                              placeholder="Chapter Title"
                            />
                            <button
                              type="button"
                              disabled={isUpdatingChapter}
                              onClick={() => handleUpdateChapter(ch.id, editChapterTitle)}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingChapterId(null)}
                              className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] cursor-pointer"
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
                              ({ch.episodes.length} episodes)
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 ml-auto">
                          {/* DIRECT CLICK TO UPLOAD FILES BUTTON */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedChapterId(ch.id);
                              setActiveUploadChapterId(ch.id);
                              document.getElementById('author-episode-upload-section')?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                            title="Click to upload files for this chapter"
                          >
                            <FileUp className="w-3 h-3" />
                            <span>Click to Upload Files</span>
                          </button>

                          {editingChapterId !== ch.id && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingChapterId(ch.id);
                                  setEditChapterTitle(ch.title);
                                }}
                                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                title="Edit Chapter Title"
                              >
                                <PenTool className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenDeleteRequestModal('chapter', selectedComic.id, selectedComic.title, ch.id, ch.title)}
                                className={`py-1 px-2 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer border ${
                                  isChapterPendingDelete(selectedComic.id, ch.id, selectedComic.moderationStatus)
                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40'
                                    : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30'
                                }`}
                                title="Request Admin to Delete Chapter"
                              >
                                {isChapterPendingDelete(selectedComic.id, ch.id, selectedComic.moderationStatus) ? (
                                  <>
                                    <Clock className="w-3 h-3 animate-pulse" />
                                    <span>Waiting for Admin Delete</span>
                                  </>
                                ) : (
                                  <>
                                    <Trash2 className="w-3 h-3" />
                                    <span>Request Admin Delete</span>
                                  </>
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Episode list under chapter */}
                      <div className="space-y-1.5 pl-2">
                        {ch.episodes.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic py-1">
                            No episodes yet. Click &quot;Click to Upload Files&quot; above to add your first episode.
                          </p>
                        ) : (
                          ch.episodes.map(ep => (
                            <div
                              key={ep.id}
                              className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <img
                                  src={ep.coverImage || ep.pages?.[0]?.imageUrl || selectedComic.coverImage}
                                  alt={ep.title}
                                  className="w-8 h-11 rounded object-cover border border-slate-200 dark:border-slate-800 shrink-0 shadow-xs"
                                />
                                <div className="min-w-0">
                                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate block">
                                    Ep {ep.episodeNumber}: {ep.title}
                                  </span>
                                  {ep.pages && ep.pages.length > 0 && (
                                    <span className="text-[9px] text-slate-400 font-mono block">
                                      {ep.pages.length} pages · Cover Assigned
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {ep.isPremium ? (
                                  <span className="text-[10px] font-bold text-amber-500 font-mono">₹{ep.priceInr}</span>
                                ) : (
                                  <span className="text-[10px] font-bold text-emerald-500">Free</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onOpenEpisode(ep.id)}
                                  className="text-[11px] text-rose-500 hover:underline font-semibold cursor-pointer"
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditEpisode(ep, ch.id)}
                                  className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                  title="Edit Episode"
                                >
                                  <PenTool className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSendEpisodeDeleteRequest(ep, ch.id)}
                                  className={`py-1 px-2.5 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer border ${
                                    isEpisodePendingDelete(selectedComic.id, ch.id, ep.id, selectedComic.moderationStatus)
                                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40'
                                      : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30'
                                  }`}
                                  title={
                                    isEpisodePendingDelete(selectedComic.id, ch.id, ep.id, selectedComic.moderationStatus)
                                      ? 'Waiting for Admin to delete this episode in Admin Portal -> Delete Requests'
                                      : 'Send Episode Deletion Request to Admin'
                                  }
                                >
                                  {isEpisodePendingDelete(selectedComic.id, ch.id, ep.id, selectedComic.moderationStatus) ? (
                                    <>
                                      <Clock className="w-3 h-3 animate-pulse" />
                                      <span>Waiting for Admin Delete</span>
                                    </>
                                  ) : (
                                    <>
                                      <Trash2 className="w-3 h-3" />
                                      <span>Request Admin Delete</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          ))
                        )}
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
                Select your comic page images. You can choose which one to set as the cover image below.
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
                      Choose any image from your uploaded drag &amp; drop files to set as the official cover
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
                        {selectedCoverPageId === p.id || (!selectedCoverPageId && idx === 0) ? '★ ' : ''}
                        Page {p.pageNumber}: {p.fileName} ({p.size}) {selectedCoverPageId === p.id || (!selectedCoverPageId && idx === 0) ? '[CURRENT COVER]' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Thumbnails Grid with Click-to-Set Cover */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-400">
                    <span>Uploaded Files Gallery (Click any image to select as Cover Page):</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNewComicAttachedPages([]);
                        setSelectedCoverPageId(null);
                      }}
                      className="text-rose-500 hover:underline cursor-pointer"
                    >
                      Remove All Files
                    </button>
                  </div>

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

      {/* LIVE READER PREVIEW MODAL FOR SELECTED PHOTOS */}
      {showAuthorLivePreview && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col">
          {/* Header Bar */}
          <div className="h-14 border-b border-white/10 px-4 sm:px-6 flex items-center justify-between text-white bg-slate-950/80 shrink-0">
            <div className="flex items-center gap-3">
              <span className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
                <Eye className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-bold text-sm text-white truncate max-w-xs sm:max-w-md">
                  Preview: {episodeTitle || 'Untitled Episode'}
                </h3>
                <p className="text-[10px] text-slate-400">
                  {episodeAttachedPages.length} Photos Attached · {selectedComic?.title}
                </p>
              </div>
            </div>

            {/* View Mode & Zoom Controls */}
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center bg-white/10 rounded-lg p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewViewMode('vertical')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                    previewViewMode === 'vertical' ? 'bg-rose-600 text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Vertical Scroll
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewViewMode('page')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                    previewViewMode === 'page' ? 'bg-rose-600 text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Page-by-Page
                </button>
              </div>

              <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewZoom(z => Math.max(50, z - 15))}
                  className="p-1 hover:text-rose-400 cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono px-1">{previewZoom}%</span>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(z => Math.min(200, z + 15))}
                  className="p-1 hover:text-rose-400 cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowAuthorLivePreview(false)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer ml-2"
                title="Close Preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Reader Body */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-start bg-slate-900/60">
            {previewViewMode === 'vertical' ? (
              <div
                className="flex flex-col items-center gap-4 transition-all"
                style={{ width: `${Math.min(100, previewZoom)}%`, maxWidth: `${previewZoom * 8}px` }}
              >
                {episodeAttachedPages.map((page) => (
                  <div
                    key={page.id}
                    className="relative w-full rounded-lg overflow-hidden bg-black/40 border border-white/10 shadow-2xl"
                  >
                    <img
                      src={page.dataUrl}
                      alt={page.caption || `Page ${page.pageNumber}`}
                      className="w-full h-auto block"
                    />
                    <span className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm text-white font-mono text-[10px] px-2 py-0.5 rounded">
                      Page {page.pageNumber} of {episodeAttachedPages.length}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center w-full max-w-3xl my-auto">
                {episodeAttachedPages[previewCurrentPage - 1] && (
                  <div className="relative rounded-xl overflow-hidden bg-black/40 border border-white/10 shadow-2xl max-h-[75vh]">
                    <img
                      src={episodeAttachedPages[previewCurrentPage - 1].dataUrl}
                      alt={`Page ${previewCurrentPage}`}
                      className="max-h-[75vh] w-auto object-contain mx-auto"
                    />
                    <span className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-sm text-white font-mono text-xs px-2.5 py-1 rounded">
                      Page {previewCurrentPage} / {episodeAttachedPages.length}
                    </span>
                  </div>
                )}

                {/* Slideshow Navigation */}
                <div className="flex items-center gap-4 mt-4">
                  <button
                    type="button"
                    disabled={previewCurrentPage <= 1}
                    onClick={() => setPreviewCurrentPage(p => Math.max(1, p - 1))}
                    className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold disabled:opacity-30 cursor-pointer"
                  >
                    ← Previous Page
                  </button>
                  <span className="text-xs text-slate-300 font-mono">
                    {previewCurrentPage} of {episodeAttachedPages.length}
                  </span>
                  <button
                    type="button"
                    disabled={previewCurrentPage >= episodeAttachedPages.length}
                    onClick={() => setPreviewCurrentPage(p => Math.min(episodeAttachedPages.length, p + 1))}
                    className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold disabled:opacity-30 cursor-pointer"
                  >
                    Next Page →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="h-16 border-t border-white/10 px-6 flex items-center justify-between bg-slate-950 shrink-0">
            <button
              type="button"
              onClick={() => setShowAuthorLivePreview(false)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              ← Back to Edit Details &amp; Pages
            </button>

            <button
              type="button"
              disabled={isPublishingEpisode}
              onClick={() => handleAddEpisode()}
              className="px-6 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>
                {isPublishingEpisode
                  ? 'Publishing Episode...'
                  : `Looks Great! Publish ${episodeAttachedPages.length} Photos Now`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* EDIT COMIC DETAILS MODAL */}
      {isEditingComicModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500">
                  <PenTool className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Edit Comic Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingComicModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {comicEditError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium">
                {comicEditError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Comic Title *
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Synopsis &amp; Description
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                />
              </div>

              {/* Genres / Categories */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Genres &amp; Categories
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['Action', 'Fantasy', 'Mythology', 'Sci-Fi', 'Cyberpunk', 'Romance', 'Slice of Life', 'Horror', 'Comedy', 'Thriller'].map(g => {
                    const isSelected = editGenres.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setEditGenres(editGenres.filter(item => item !== g));
                          } else {
                            setEditGenres([...editGenres, g]);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-rose-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {isSelected ? '✓ ' : '+ '}{g}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="Add custom genre tag..."
                    value={editCustomGenre}
                    onChange={(e) => setEditCustomGenre(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (editCustomGenre.trim() && !editGenres.includes(editCustomGenre.trim())) {
                        setEditGenres([...editGenres, editCustomGenre.trim()]);
                        setEditCustomGenre('');
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    Add Tag
                  </button>
                </div>
              </div>

              {/* Cover Image */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Cover Image URL
                </label>
                <input
                  type="text"
                  value={editCover}
                  onChange={(e) => setEditCover(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              {/* Monetization Model */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Access &amp; Pricing
                </label>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="radio"
                      name="editAccess"
                      checked={editAccessType === 'free'}
                      onChange={() => setEditAccessType('free')}
                      className="text-rose-600"
                    />
                    <span>Free Comic</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="radio"
                      name="editAccess"
                      checked={editAccessType === 'premium'}
                      onChange={() => setEditAccessType('premium')}
                      className="text-rose-600"
                    />
                    <span>Premium (Paywall)</span>
                  </label>
                </div>

                {editAccessType === 'premium' && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Full Comic Purchase Price (₹ INR)
                    </label>
                    <input
                      type="number"
                      min="5"
                      value={editFullPrice}
                      onChange={(e) => setEditFullPrice(Number(e.target.value))}
                      className="w-32 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditingComicModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingComicEdit}
                onClick={handleSaveComicEdit}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase tracking-wider shadow-md transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSavingComicEdit ? 'Saving...' : 'Save Comic Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT EPISODE MODAL */}
      {editingEpisode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500">
                  <PenTool className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Edit Episode
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingEpisode(null)}
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Episode Title *
                </label>
                <input
                  type="text"
                  value={editEpisodeTitle}
                  onChange={(e) => setEditEpisodeTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Episode Synopsis
                </label>
                <input
                  type="text"
                  value={editEpisodeSynopsis}
                  onChange={(e) => setEditEpisodeSynopsis(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={editEpisodeIsPremium}
                    onChange={(e) => setEditEpisodeIsPremium(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Premium Episode (Paywall)
                  </span>
                </label>

                {editEpisodeIsPremium && (
                  <div className="flex items-center gap-2 pt-1 text-xs">
                    <span className="text-slate-500 font-medium">Price:</span>
                    <span className="font-bold text-slate-900 dark:text-white">₹</span>
                    <input
                      type="number"
                      min="5"
                      max="100"
                      value={editEpisodePrice}
                      onChange={(e) => setEditEpisodePrice(Number(e.target.value))}
                      className="w-20 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <span className="text-slate-400 font-mono">INR</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingEpisode(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdatingEpisode}
                onClick={handleSaveEpisodeEdit}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase tracking-wider shadow-md transition-colors cursor-pointer disabled:opacity-50"
              >
                {isUpdatingEpisode ? 'Saving...' : 'Save Episode'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
