import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Comic, AuthorApplication, Purchase, CopyrightDoc, PlatformSettings, ActivityLog, DeleteRequest } from '../types/comic';
import {
  Shield,
  Users,
  PenTool,
  BookOpen,
  IndianRupee,
  MessageSquare,
  Star,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Search,
  Filter,
  Trash2,
  Edit,
  Eye,
  Sliders,
  Sparkles,
  Download,
  Plus,
  Lock,
  Unlock,
  ChevronDown,
  ChevronUp,
  Upload,
  Globe2,
  Paperclip,
  FileUp,
  Mail,
  Phone,
  KeyRound,
  ShieldAlert,
  Info,
  Images,
  Layers,
  ArrowUp,
  ArrowDown,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FolderPlus
} from 'lucide-react';

interface AdminDashboardProps {
  comics: Comic[];
  onRefreshComics: () => void;
  setCurrentTab: (tab: string) => void;
  initialSubTab?: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  comics,
  onRefreshComics,
  setCurrentTab,
  initialSubTab,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'publish-direct' | 'comic-queue' | 'delete-requests' | 'comics' | 'authors' | 'financial' | 'comments' | 'ratings' | 'copyright' | 'settings' | 'logs'
  >(() => {
    if (initialSubTab === 'delete-requests') return 'delete-requests';
    return 'overview';
  });

  const [stats, setStats] = useState<any>({
    totalUsers: 14,
    totalAuthors: 2,
    pendingApplications: 1,
    approvedAuthors: 1,
    totalComics: 4,
    totalChapters: 6,
    totalEpisodes: 12,
    totalComments: 8,
    totalTransactions: 16,
    totalRevenueInr: 3420.0,
    totalAuthorEarningsInr: 2394.0,
  });

  const [allComicsWithPending, setAllComicsWithPending] = useState<Comic[]>([]);
  const [deleteRequests, setDeleteRequests] = useState<DeleteRequest[]>([]);
  const [deleteReviewNote, setDeleteReviewNote] = useState('');
  const [applications, setApplications] = useState<AuthorApplication[]>([]);
  const [transactions, setTransactions] = useState<Purchase[]>([]);
  const [copyrightDocs, setCopyrightDocs] = useState<CopyrightDoc[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [allComments, setAllComments] = useState<any[]>([]);
  const [allRatings, setAllRatings] = useState<any[]>([]);

  // Direct Comic & Episode Publishing state
  const [publishMode, setPublishMode] = useState<'add_episode' | 'new_series'>('add_episode');
  const [selectedComicId, setSelectedComicId] = useState<string>('');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeSynopsis, setEpisodeSynopsis] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>(['Action', 'Fantasy']);
  const [customGenreInput, setCustomGenreInput] = useState('');

  // Multiple Photos (Comic Pages) State
  const [attachedPages, setAttachedPages] = useState<{
    id: string;
    fileName: string;
    size: string;
    type: string;
    dataUrl: string;
    pageNumber: number;
    caption?: string;
  }[]>([]);

  // Live Preview Modal State
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState<'vertical' | 'page'>('vertical');
  const [previewCurrentPage, setPreviewCurrentPage] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [publishedEpisodeInfo, setPublishedEpisodeInfo] = useState<{
    comicTitle: string;
    chapterTitle: string;
    episodeTitle: string;
    pageCount: number;
  } | null>(null);

  const [directTitle, setDirectTitle] = useState('');
  const [directDesc, setDirectDesc] = useState('');
  const [isDirectPublishing, setIsDirectPublishing] = useState(false);
  const [directPublishSuccess, setDirectPublishSuccess] = useState<string | null>(null);

  // Paywall modal / controls
  const [paywallComicId, setPaywallComicId] = useState<string | null>(null);
  const [paywallPrice, setPaywallPrice] = useState(10);
  const [expandedComicPaywall, setExpandedComicPaywall] = useState<Record<string, boolean>>({});

  // Submission review note
  const [comicReviewNote, setComicReviewNote] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Search/Filters in Financial Tab
  const [txSearch, setTxSearch] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState<'all' | 'success' | 'failed'>('all');

  // Dedicated Admin 2FA Security Gate State
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(() => {
    return sessionStorage.getItem('aathirai_admin_unlocked') === 'true';
  });

  // Admin Login Inputs (Security: input is empty by default so no email or number is shown)
  const [adminCredentialInput, setAdminCredentialInput] = useState('');
  const [adminChannelChoice, setAdminChannelChoice] = useState<'email' | 'sms'>('email');
  const [adminOtpInput, setAdminOtpInput] = useState('');
  const [otpStep, setOtpStep] = useState<'enter_credential' | 'enter_otp'>('enter_credential');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccessMessage, setOtpSuccessMessage] = useState<string | null>(null);
  const [mockOtpPreview, setMockOtpPreview] = useState<string | null>(null);
  const [otpDestinationMasked, setOtpDestinationMasked] = useState<string>('');

  // Delete Comic Confirmation Modal State
  const [comicToDelete, setComicToDelete] = useState<Comic | null>(null);
  const [isDeletingComic, setIsDeletingComic] = useState(false);

  // New Copyright Doc Form
  const [newCpyTitle, setNewCpyTitle] = useState('');
  const [newCpySummary, setNewCpySummary] = useState('');
  const [newCpyText, setNewCpyText] = useState('');

  // Author Application Action Note
  const [reviewNote, setReviewNote] = useState('');

  // Fetch all admin data (including pending comics and delete requests)
  const fetchAdminData = async () => {
    try {
      const [statsRes, authRes, txRes, cpyRes, setRes, logRes, cmtRes, ratRes, allComicsRes, delReqRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/authors'),
        fetch('/api/admin/transactions'),
        fetch('/api/admin/copyright'),
        fetch('/api/admin/settings'),
        fetch('/api/admin/logs'),
        fetch('/api/admin/comments'),
        fetch('/api/admin/ratings'),
        fetch('/api/comics?includePending=true&role=admin'),
        fetch('/api/admin/delete-requests'),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (authRes.ok) {
        const d = await authRes.json();
        setApplications(d.applications || []);
      }
      if (txRes.ok) {
        const d = await txRes.json();
        setTransactions(d.transactions || []);
      }
      if (cpyRes.ok) {
        const d = await cpyRes.json();
        setCopyrightDocs(d.copyrightDocs || []);
      }
      if (setRes.ok) {
        const d = await setRes.json();
        setSettings(d.settings);
      }
      if (logRes.ok) {
        const d = await logRes.json();
        setActivityLogs(d.logs || []);
      }
      if (cmtRes.ok) {
        const d = await cmtRes.json();
        setAllComments(d.comments || []);
      }
      if (ratRes.ok) {
        const d = await ratRes.json();
        setAllRatings(d.ratings || []);
      }
      if (allComicsRes.ok) {
        const d = await allComicsRes.json();
        setAllComicsWithPending(d.comics || []);
      }
      if (delReqRes.ok) {
        const d = await delReqRes.json();
        setDeleteRequests(d.deleteRequests || []);
      }
    } catch (e) {
      console.error('Error fetching admin data:', e);
    }
  };

  // Admin approves or rejects author's deletion request
  const handleModerateDeleteRequest = async (requestId: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch(`/api/admin/delete-requests/${requestId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNote: deleteReviewNote }),
      });

      const data = await res.json();
      if (res.ok) {
        setActionMessage(data.message);
        setDeleteReviewNote('');
        onRefreshComics();
        fetchAdminData();
        setTimeout(() => setActionMessage(null), 5000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isAdminUnlocked) {
      fetchAdminData();
    }
  }, [isAdminUnlocked]);

  useEffect(() => {
    if (initialSubTab === 'delete-requests') {
      setActiveTab('delete-requests');
    }
  }, [initialSubTab]);

  // Request 2FA OTP
  const handleRequestAdminOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminCredentialInput.trim()) return;

    setOtpLoading(true);
    setOtpError(null);
    setOtpSuccessMessage(null);

    try {
      const res = await fetch('/api/admin-auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: adminCredentialInput.trim(),
          channel: adminChannelChoice,
        }),
      });

      const data = await res.json();
      setOtpLoading(false);

      if (!res.ok) {
        setOtpError(data.error || 'Access Denied: Unrecognized credentials.');
        return;
      }

      setOtpStep('enter_otp');
      setOtpDestinationMasked(data.destinationMasked || '');
      setOtpSuccessMessage(data.message);
      if (data.mockOtp) {
        setMockOtpPreview(data.mockOtp);
      }
    } catch (err: any) {
      setOtpLoading(false);
      setOtpError('Network error while requesting verification OTP.');
    }
  };

  // Verify 2FA OTP
  const handleVerifyAdminOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminOtpInput.trim()) return;

    setOtpLoading(true);
    setOtpError(null);

    try {
      const res = await fetch('/api/admin-auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: adminCredentialInput.trim(),
          otp: adminOtpInput.trim(),
        }),
      });

      const data = await res.json();
      setOtpLoading(false);

      if (!res.ok) {
        setOtpError(data.error || 'Invalid 6-digit verification code.');
        return;
      }

      sessionStorage.setItem('aathirai_admin_unlocked', 'true');
      setIsAdminUnlocked(true);
      setActionMessage('Admin Authentication Verified! Terminal Unlocked.');
      fetchAdminData();
      onRefreshComics();
      setTimeout(() => setActionMessage(null), 5000);
    } catch (err: any) {
      setOtpLoading(false);
      setOtpError('Network error while verifying OTP.');
    }
  };

  // Lock Admin Console
  const handleLockAdminConsole = () => {
    sessionStorage.removeItem('aathirai_admin_unlocked');
    setIsAdminUnlocked(false);
    setOtpStep('enter_credential');
    setAdminCredentialInput('');
    setAdminOtpInput('');
    setOtpError(null);
    setOtpSuccessMessage(null);
    setMockOtpPreview(null);
  };

  // Comic deletion handler with modal confirmation
  const handleConfirmDeleteComic = async () => {
    if (!comicToDelete) return;
    setIsDeletingComic(true);

    try {
      const res = await fetch(`/api/comics/${comicToDelete.id}`, { method: 'DELETE' });
      const data = await res.json();
      setIsDeletingComic(false);

      if (res.ok) {
        setActionMessage(data.message || `"${comicToDelete.title}" has been permanently removed.`);
        setComicToDelete(null);
        onRefreshComics();
        fetchAdminData();
        setTimeout(() => setActionMessage(null), 5000);
      } else {
        alert(data.error || 'Failed to delete comic.');
      }
    } catch (err) {
      setIsDeletingComic(false);
      console.error(err);
    }
  };

  // Auto-select comic & chapter when comics load
  useEffect(() => {
    const list = allComicsWithPending.length > 0 ? allComicsWithPending : comics;
    if (list.length > 0 && !selectedComicId) {
      const firstComic = list[0];
      setSelectedComicId(firstComic.id);
      setSelectedGenres(firstComic.genre || ['Action', 'Fantasy']);
      if (firstComic.chapters && firstComic.chapters.length > 0) {
        setSelectedChapterId(firstComic.chapters[0].id);
        const epNum = firstComic.chapters[0].episodes.length + 1;
        setEpisodeTitle(`Episode ${epNum}: The Awakening`);
      } else {
        setSelectedChapterId('new');
        setNewChapterTitle('Chapter 1: The Beginning');
        setEpisodeTitle('Episode 1: Premiere Issue');
      }
    }
  }, [allComicsWithPending, comics, selectedComicId]);

  // When changing selected comic in add_episode mode
  const handleSelectComic = (cId: string) => {
    setSelectedComicId(cId);
    const list = allComicsWithPending.length > 0 ? allComicsWithPending : comics;
    const comic = list.find(c => c.id === cId);
    if (comic) {
      setSelectedGenres(comic.genre || ['Action', 'Fantasy']);
      if (comic.chapters && comic.chapters.length > 0) {
        const firstChap = comic.chapters[0];
        setSelectedChapterId(firstChap.id);
        const epNum = firstChap.episodes.length + 1;
        setEpisodeTitle(`Episode ${epNum}: The Next Phase`);
      } else {
        setSelectedChapterId('new');
        setNewChapterTitle('Chapter 1: The Beginning');
        setEpisodeTitle('Episode 1: Premiere Issue');
      }
    }
  };

  // When changing chapter in the selected comic
  const handleSelectChapter = (chapId: string) => {
    setSelectedChapterId(chapId);
    const list = allComicsWithPending.length > 0 ? allComicsWithPending : comics;
    const comic = list.find(c => c.id === selectedComicId);
    if (comic) {
      if (chapId === 'new') {
        const nextChapNum = comic.chapters.length + 1;
        setNewChapterTitle(`Chapter ${nextChapNum}: New Arc`);
        setEpisodeTitle('Episode 1: Prologue');
      } else {
        const chap = comic.chapters.find(ch => ch.id === chapId);
        if (chap) {
          const epNum = chap.episodes.length + 1;
          setEpisodeTitle(`Episode ${epNum}: Continuing the Story`);
        }
      }
    }
  };

  // Category (Genre) toggle and custom category addition
  const handleToggleGenre = (genreName: string) => {
    setSelectedGenres(prev =>
      prev.includes(genreName)
        ? prev.filter(g => g !== genreName)
        : [...prev, genreName]
    );
  };

  const handleAddCustomGenre = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customGenreInput.trim();
    if (!clean) return;
    if (!selectedGenres.includes(clean)) {
      setSelectedGenres(prev => [...prev, clean]);
    }
    setCustomGenreInput('');
  };

  // Multiple Photos (Comic Pages) File Upload Handler
  const handleMultiplePagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file, index) => {
      const formattedSize = file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;

      const reader = new FileReader();
      reader.onload = () => {
        setAttachedPages(prev => {
          const newPage = {
            id: `page_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${index}`,
            fileName: file.name,
            size: formattedSize,
            type: file.type || 'image',
            dataUrl: reader.result as string,
            pageNumber: prev.length + 1,
            caption: `Page ${prev.length + 1}`,
          };
          return [...prev, newPage];
        });
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  // Remove single page from attached pages list
  const handleRemovePage = (pageId: string) => {
    setAttachedPages(prev => {
      const filtered = prev.filter(p => p.id !== pageId);
      return filtered.map((p, idx) => ({ ...p, pageNumber: idx + 1, caption: `Page ${idx + 1}` }));
    });
  };

  // Re-order attached pages
  const handleMovePage = (index: number, direction: 'up' | 'down') => {
    setAttachedPages(prev => {
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy.map((p, idx) => ({ ...p, pageNumber: idx + 1, caption: `Page ${idx + 1}` }));
    });
  };

  // Launch Live Preview Modal before publishing
  const handleOpenLivePreview = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPreviewError(null);

    if (attachedPages.length === 0) {
      setPreviewError('Please attach at least one photo (comic page) before launching preview.');
      return;
    }

    if (publishMode === 'add_episode') {
      if (!selectedComicId) {
        setPreviewError('Please select a target comic book series.');
        return;
      }
      if (!episodeTitle.trim()) {
        setPreviewError('Please provide an episode title.');
        return;
      }
    } else {
      if (!directTitle.trim()) {
        setPreviewError('Please provide a title for the new comic book.');
        return;
      }
    }

    setPreviewCurrentPage(1);
    setShowLivePreview(true);
  };

  // Execute Publishing to Website (from form or live preview modal)
  const handleDirectPublish = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsDirectPublishing(true);
    setDirectPublishSuccess(null);
    setPreviewError(null);

    try {
      const payload = {
        mode: publishMode,
        comicId: publishMode === 'add_episode' ? selectedComicId : undefined,
        chapterId: publishMode === 'add_episode' ? selectedChapterId : undefined,
        newChapterTitle: newChapterTitle.trim() || undefined,
        episodeTitle: publishMode === 'add_episode' ? episodeTitle.trim() : (episodeTitle.trim() || 'Episode 1: Premiere Issue'),
        episodeSynopsis: episodeSynopsis.trim() || directDesc.trim() || undefined,
        title: publishMode === 'new_series' ? directTitle.trim() : undefined,
        description: publishMode === 'new_series' ? directDesc.trim() : undefined,
        genre: selectedGenres.length > 0 ? selectedGenres : ['Action', 'Fantasy'],
        pages: attachedPages.map(p => ({
          pageNumber: p.pageNumber,
          imageUrl: p.dataUrl,
          caption: p.caption,
          fileName: p.fileName,
        })),
        attachedFileName: attachedPages[0]?.fileName,
        attachedFileSize: `${attachedPages.length} Photos`,
        attachedFileType: 'IMAGE_GALLERY',
      };

      const res = await fetch('/api/admin/comics/publish-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setIsDirectPublishing(false);

      if (res.ok) {
        setShowLivePreview(false);
        setPublishedEpisodeInfo({
          comicTitle: data.comic.title,
          chapterTitle: data.chapter ? data.chapter.title : (data.comic.chapters[0]?.title || 'Chapter 1'),
          episodeTitle: data.episode ? data.episode.title : 'New Episode',
          pageCount: attachedPages.length,
        });
        setDirectPublishSuccess(data.message || 'Comic episode published live on website!');
        setAttachedPages([]);
        if (publishMode === 'new_series') {
          setDirectTitle('');
          setDirectDesc('');
        }
        onRefreshComics();
        fetchAdminData();
      } else {
        setPreviewError(data.error || 'Failed to publish episode.');
      }
    } catch (err) {
      setIsDirectPublishing(false);
      setPreviewError('Network error while publishing episode.');
      console.error(err);
    }
  };

  // Admin approves or rejects author's submitted comic
  const handleModerateComicSubmission = async (comicId: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch(`/api/admin/comics/${comicId}/moderate-submission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNote: comicReviewNote }),
      });

      const data = await res.json();
      if (res.ok) {
        setActionMessage(data.message);
        setComicReviewNote('');
        onRefreshComics();
        fetchAdminData();
        setTimeout(() => setActionMessage(null), 5000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle Paywall for Comic, Chapter, or Episode
  const handleTogglePaywall = async (params: {
    comicId: string;
    chapterId?: string;
    episodeId?: string;
    isPremium: boolean;
    priceInr?: number;
  }) => {
    try {
      const res = await fetch('/api/admin/paywall-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (res.ok) {
        setActionMessage(data.message);
        onRefreshComics();
        fetchAdminData();
        setTimeout(() => setActionMessage(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Author Application Approval
  const handleAppAction = async (appId: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch(`/api/admin/author-applications/${appId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNote: reviewNote }),
      });
      if (res.ok) {
        setReviewNote('');
        fetchAdminData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Refund
  const handleRefund = async (txId: string) => {
    if (!confirm('Issue refund for this transaction?')) return;
    try {
      const res = await fetch(`/api/admin/transactions/${txId}/refund`, { method: 'POST' });
      if (res.ok) fetchAdminData();
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Comic
  const handleDeleteComic = async (comicId: string) => {
    if (!confirm('Delete this comic series permanently?')) return;
    try {
      const res = await fetch(`/api/comics/${comicId}`, { method: 'DELETE' });
      if (res.ok) {
        onRefreshComics();
        fetchAdminData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Add Copyright Doc
  const handleAddCopyrightDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/copyright', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newCpyTitle,
          summary: newCpySummary,
          fullText: newCpyText,
          status: 'published',
        }),
      });
      if (res.ok) {
        setNewCpyTitle('');
        setNewCpySummary('');
        setNewCpyText('');
        fetchAdminData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        alert('Settings saved successfully!');
        fetchAdminData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const pendingComics = allComicsWithPending.filter(c => c.moderationStatus === 'pending' || c.moderationStatus === 'delete_requested');
  const filteredTransactions = transactions.filter(t => {
    const matchSearch =
      t.userEmail.toLowerCase().includes(txSearch.toLowerCase()) ||
      t.comicTitle.toLowerCase().includes(txSearch.toLowerCase()) ||
      t.receiptNumber.toLowerCase().includes(txSearch.toLowerCase()) ||
      t.razorpayPaymentId.toLowerCase().includes(txSearch.toLowerCase());
    const matchStatus = txStatusFilter === 'all' || t.status === txStatusFilter;
    return matchSearch && matchStatus;
  });

  // IF ADMIN IS LOCKED: Render 2-Factor Authentication Security Gate
  if (!isAdminUnlocked) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4 space-y-6">
        {/* Security Shield Card */}
        <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl relative overflow-hidden">
          {/* Ambient security gradient header */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500" />
          
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 inline-block mb-1">
                Restricted Terminal · 2FA Security
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white font-heading">
                Admin Authentication Gate
              </h2>
            </div>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
            For platform integrity, administrator access is protected with 2-Factor Authentication (OTP). Enter your registered admin credentials to receive your verification code.
          </p>

          {otpError && (
            <div className="p-3.5 mb-5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{otpError}</span>
            </div>
          )}

          {otpSuccessMessage && (
            <div className="p-3.5 mb-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{otpSuccessMessage}</span>
            </div>
          )}

          {otpStep === 'enter_credential' ? (
            <form onSubmit={handleRequestAdminOtp} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                  Enter Administrator Credential
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={adminCredentialInput}
                    onChange={(e) => setAdminCredentialInput(e.target.value)}
                    placeholder="Enter registered Gmail or Indian Mobile (+91...)"
                    autoComplete="off"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    required
                  />
                  <div className="absolute left-3.5 top-3.5 text-slate-400">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Notice: Your contact details are not displayed on-screen for security. Please type your authorized email or Indian phone.
                </p>
              </div>

              {/* Delivery Channel Radio Choice */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                  Select OTP Dispatch Channel
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      adminChannelChoice === 'email'
                        ? 'border-amber-500 bg-amber-500/10 text-slate-900 dark:text-white font-bold shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="adminChannel"
                      value="email"
                      checked={adminChannelChoice === 'email'}
                      onChange={() => setAdminChannelChoice('email')}
                      className="text-amber-500 focus:ring-amber-500"
                    />
                    <div className="flex items-center gap-2 text-xs">
                      <Mail className="w-4 h-4 text-rose-500" />
                      <span>Send OTP to Gmail</span>
                    </div>
                  </label>

                  <label
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      adminChannelChoice === 'sms'
                        ? 'border-amber-500 bg-amber-500/10 text-slate-900 dark:text-white font-bold shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="adminChannel"
                      value="sms"
                      checked={adminChannelChoice === 'sms'}
                      onChange={() => setAdminChannelChoice('sms')}
                      className="text-amber-500 focus:ring-amber-500"
                    />
                    <div className="flex items-center gap-2 text-xs">
                      <Phone className="w-4 h-4 text-emerald-500" />
                      <span>Send OTP to SMS (+91)</span>
                    </div>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={otpLoading || !adminCredentialInput.trim()}
                className="w-full py-3.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {otpLoading ? (
                  <span>Dispatching OTP...</span>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Send 6-Digit OTP</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyAdminOtp} className="space-y-5">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 dark:text-slate-300">OTP Sent To:</span>
                  <span className="font-mono text-amber-600 dark:text-amber-400 font-bold">{otpDestinationMasked}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500">
                  <span>Validity:</span>
                  <span className="text-emerald-500 font-semibold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> 10 Minutes (600 seconds)
                  </span>
                </div>
              </div>

              {mockOtpPreview && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-bold block">Developer Preview Test OTP:</span>
                    <span className="font-mono text-base font-black tracking-widest text-amber-600 dark:text-amber-400">
                      {mockOtpPreview}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdminOtpInput(mockOtpPreview)}
                    className="py-1 px-3 rounded-lg bg-amber-500 text-slate-950 font-bold text-[11px] hover:bg-amber-400 cursor-pointer shadow-sm"
                  >
                    Auto-Fill Code
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                  Enter 6-Digit Verification Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={adminOtpInput}
                  onChange={(e) => setAdminOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • • • •"
                  className="w-full text-center tracking-[0.5em] text-2xl font-black font-mono py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setOtpStep('enter_credential');
                    setAdminOtpInput('');
                    setOtpError(null);
                  }}
                  className="py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-semibold transition-colors"
                >
                  Change Channel / ID
                </button>

                <button
                  type="submit"
                  disabled={otpLoading || adminOtpInput.length < 6}
                  className="flex-1 py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {otpLoading ? (
                    <span>Verifying...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Unlock Admin Console</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Persistence & Lifecycle Explainer: "When will it reset?" */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-xs space-y-3">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
            <Info className="w-4 h-4 text-amber-500" />
            <span>Platform Data &amp; Reset Policy ("When will it reset?")</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] pt-1">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 space-y-1">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">📚 Comics &amp; Chapters</span>
              <p className="text-slate-500 dark:text-slate-400">
                Stored permanently on disk (<code className="text-amber-500">aathirai_db.json</code>). They <strong className="text-emerald-500">NEVER reset</strong> automatically unless manually deleted by admin.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 space-y-1">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">⏱️ 2FA Security OTPs</span>
              <p className="text-slate-500 dark:text-slate-400">
                One-time passwords expire and reset after exactly <strong className="text-amber-500">10 minutes</strong> (600 seconds) for cryptographic security.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 space-y-1">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">🔒 Admin Session</span>
              <p className="text-slate-500 dark:text-slate-400">
                Stays unlocked for your browser session. You can re-lock anytime by clicking the <strong>"Lock Console"</strong> button.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-24">
      
      {/* Permanent Delete Comic Confirmation Modal */}
      {comicToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md p-6 rounded-2xl bg-white dark:bg-slate-900 border border-rose-500/40 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                  Delete Comic Series Permanently?
                </h3>
                <span className="text-xs text-rose-500 font-semibold">Irreversible Action</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
              <img
                src={comicToDelete.coverImage}
                alt={comicToDelete.title}
                className="w-12 h-16 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-slate-700"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-900 dark:text-white block">{comicToDelete.title}</span>
                <span className="text-slate-500">By {comicToDelete.authorName}</span>
                <span className="text-slate-400 text-[10px] block mt-0.5">
                  {comicToDelete.chapters.length} Chapters · {comicToDelete.chapters.reduce((s, c) => s + c.episodes.length, 0)} Episodes
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-900 dark:text-white">"{comicToDelete.title}"</strong>? This will permanently remove the comic book, all associated chapters, uploaded episodes, reader comments, and ratings from the database.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeletingComic}
                onClick={() => setComicToDelete(null)}
                className="py-2 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingComic}
                onClick={handleConfirmDeleteComic}
                className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-rose-600/20 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingComic ? 'Deleting...' : 'Yes, Permanently Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
              <Shield className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white font-heading">
              Platform Administration Console
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Publish direct comics, approve publisher submissions, control chapter paywalls, and manage series.
            </p>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded font-mono font-semibold">
              ● Storage: Persistent (Never resets)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('publish-direct')}
            className="py-2 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Publish My Comic</span>
          </button>

          <button
            onClick={handleLockAdminConsole}
            className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-rose-500 hover:border-rose-500 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Lock administrator terminal"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lock Console</span>
          </button>
        </div>
      </div>

      {/* Global Action Banner Toast */}
      {actionMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* ADMIN SUB-NAVIGATION TABS */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs font-bold border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'overview', label: 'Overview Metrics' },
          { id: 'publish-direct', label: '★ Publish My Comic (Direct)' },
          { id: 'comic-queue', label: `Comic Approvals Queue (${pendingComics.length})` },
          { id: 'delete-requests', label: `🗑️ Delete Requests (${deleteRequests.filter(r => r.status === 'pending').length})` },
          { id: 'comics', label: 'Paywall & Catalog Moderation' },
          { id: 'authors', label: `Author Profiles (${applications.filter(a => a.status === 'pending').length})` },
          { id: 'financial', label: 'Financial & Payments' },
          { id: 'comments', label: 'Comments' },
          { id: 'ratings', label: 'Ratings Audit' },
          { id: 'copyright', label: 'Copyright Docs' },
          { id: 'settings', label: 'Settings & Terms' },
          { id: 'logs', label: 'Activity Logs' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => {
              setActiveTab(t.id as any);
              if (isAdminUnlocked) fetchAdminData();
            }}
            className={`py-2 px-3.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === t.id
                ? 'bg-amber-500 text-slate-950 font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW METRICS */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Total Users
              </span>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-mono mt-1">
                {stats.totalUsers}
              </div>
              <span className="text-[10px] text-slate-400">Registered readers</span>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Comics Awaiting Approval
              </span>
              <div className="text-2xl font-black text-rose-500 font-mono mt-1">
                {pendingComics.length}
              </div>
              <span className="text-[10px] text-rose-500 font-semibold">Submissions Queue</span>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Pending Author Apps
              </span>
              <div className="text-2xl font-black text-amber-500 font-mono mt-1">
                {stats.pendingApplications}
              </div>
              <span className="text-[10px] text-amber-500 font-semibold">Vetting Required</span>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Gross Platform Revenue
              </span>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1">
                ₹{stats.totalRevenueInr?.toFixed(2)}
              </div>
              <span className="text-[10px] text-emerald-500 font-semibold">Indian Rupees (INR)</span>
            </div>
          </div>

          {/* Quick Shortcuts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div
              onClick={() => setActiveTab('publish-direct')}
              className="p-6 rounded-2xl bg-gradient-to-tr from-rose-500/10 to-amber-500/10 border border-rose-500/30 hover:border-rose-500 transition-all cursor-pointer space-y-2 group"
            >
              <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold">
                <Upload className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-rose-500">
                Direct Comic Publisher
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Publish your own comics immediately to the catalog without going through moderation queues.
              </p>
            </div>

            <div
              onClick={() => setActiveTab('comic-queue')}
              className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-500 transition-all cursor-pointer space-y-2 group"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-amber-500">
                Author Comic Approval Queue ({pendingComics.length})
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Review submitted full comics from authors and 1-click publish them live to readers.
              </p>
            </div>

            <div
              onClick={() => setActiveTab('comics')}
              className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 transition-all cursor-pointer space-y-2 group"
            >
              <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-emerald-500">
                Paywall Control Center
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Put any comic, chapter, or episode behind paywalls (or toggle back to 100% Free) at any time.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DIRECT COMIC & EPISODE PUBLISHING */}
      {activeTab === 'publish-direct' && (
        <div className="max-w-4xl mx-auto space-y-6">
          
          {/* Header Card */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 mb-1">
                  <Globe2 className="w-3 h-3" />
                  <span>Admin Direct Publishing Studio</span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
                  Publish Comic &amp; New Episodes
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Attach multiple high-resolution photos for your episode, pick previous chapter categories, and preview live before publishing to the website.
                </p>
              </div>

              {/* Mode Switcher Toggle */}
              <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setPublishMode('add_episode')}
                  className={`py-1.5 px-3 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                    publishMode === 'add_episode'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Add Episode to Chapter</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPublishMode('new_series')}
                  className={`py-1.5 px-3 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                    publishMode === 'new_series'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>New Comic Series</span>
                </button>
              </div>
            </div>

            {/* Success Celebration Toast */}
            {directPublishSuccess && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold space-y-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                  <span className="font-bold text-sm">{directPublishSuccess}</span>
                </div>
                {publishedEpisodeInfo && (
                  <div className="pl-7 flex flex-wrap items-center gap-3 pt-1">
                    <span className="text-slate-600 dark:text-slate-300">
                      Published to: <strong>{publishedEpisodeInfo.comicTitle}</strong> &gt; {publishedEpisodeInfo.chapterTitle} &gt; {publishedEpisodeInfo.episodeTitle} ({publishedEpisodeInfo.pageCount} Pages)
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentTab('books')}
                      className="py-1 px-3 rounded-lg bg-emerald-600 text-white font-bold text-[11px] hover:bg-emerald-500 transition-colors cursor-pointer"
                    >
                      View Live on Books Page
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Error Banner */}
            {previewError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{previewError}</span>
              </div>
            )}

            {/* PUBLISH FORM */}
            <form onSubmit={handleOpenLivePreview} className="space-y-6 pt-2">
              
              {/* SECTION 1: TARGET COMIC & CHAPTER SELECTION (When in add_episode mode) */}
              {publishMode === 'add_episode' ? (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    <Layers className="w-4 h-4 text-amber-500" />
                    <span>1. Target Comic Series &amp; Specific Chapter</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Select Comic Series */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Choose Comic Series *
                      </label>
                      <select
                        value={selectedComicId}
                        onChange={(e) => handleSelectComic(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white font-medium"
                      >
                        {(allComicsWithPending.length > 0 ? allComicsWithPending : comics).map(c => (
                          <option key={c.id} value={c.id}>
                            {c.title} ({c.chapters.length} Chapters) · {c.authorName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Select Chapter */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                        <span>Choose Specific Chapter *</span>
                        <span className="text-[10px] text-slate-400 font-normal">Add episode into chapter</span>
                      </label>
                      {(() => {
                        const list = allComicsWithPending.length > 0 ? allComicsWithPending : comics;
                        const currentComic = list.find(c => c.id === selectedComicId) || list[0];
                        return (
                          <select
                            value={selectedChapterId}
                            onChange={(e) => handleSelectChapter(e.target.value)}
                            className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white font-medium"
                          >
                            {currentComic?.chapters.map(ch => (
                              <option key={ch.id} value={ch.id}>
                                {ch.title} ({ch.episodes.length} Episodes currently)
                              </option>
                            ))}
                            <option value="new">+ Add New Chapter to this Comic</option>
                          </select>
                        );
                      })()}
                    </div>
                  </div>

                  {/* If user selected "Add New Chapter" */}
                  {selectedChapterId === 'new' && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1.5 animate-fade-in">
                      <label className="block text-xs font-bold text-amber-700 dark:text-amber-300">
                        New Chapter Title *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Chapter 3: The Coromandel Siege"
                        value={newChapterTitle}
                        onChange={(e) => setNewChapterTitle(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-slate-900 dark:text-white focus:outline-none"
                        required
                      />
                    </div>
                  )}

                  {/* Episode Title & Synopsis */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Episode Title *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Episode 4: Fire on the Waters"
                        value={episodeTitle}
                        onChange={(e) => setEpisodeTitle(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Episode Synopsis (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="Brief summary of this episode..."
                        value={episodeSynopsis}
                        onChange={(e) => setEpisodeSynopsis(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* SECTION 1B: NEW COMIC BOOK DETAILS (When in new_series mode) */
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    <Sparkles className="w-4 h-4 text-rose-500" />
                    <span>1. New Comic Series Details</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                      Comic Series Title *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Guardians of Kumari Kandam"
                      value={directTitle}
                      onChange={(e) => setDirectTitle(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                      Comic Series Description &amp; Premise *
                    </label>
                    <textarea
                      rows={3}
                      required
                      placeholder="Provide the premise, character lore, and story overview..."
                      value={directDesc}
                      onChange={(e) => setDirectDesc(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Initial Chapter Title
                      </label>
                      <input
                        type="text"
                        placeholder="Chapter 1: The Beginning"
                        value={newChapterTitle}
                        onChange={(e) => setNewChapterTitle(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Premiere Episode Title
                      </label>
                      <input
                        type="text"
                        placeholder="Episode 1: Premiere Issue"
                        value={episodeTitle}
                        onChange={(e) => setEpisodeTitle(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:outline-none text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 2: CATEGORY / GENRE SELECTION & INHERITANCE */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    <Filter className="w-4 h-4 text-emerald-500" />
                    <span>2. Comic Categories &amp; Genres</span>
                  </div>
                  {publishMode === 'add_episode' && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                      Inherited from selected comic: {selectedGenres.join(', ')}
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Select previously used categories or add new ones. Readers browse and filter comics using these categories.
                </p>

                {/* Preset Category Badges */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    'Action', 'Fantasy', 'Manga', 'Webtoon', 'Sci-Fi', 'Historical',
                    'Romance', 'Thriller', 'Supernatural', 'Comedy', 'Drama', 'Adventure',
                    'Mythology', 'Mystery', 'Martial Arts', 'Horror', 'Slice of Life'
                  ].map(cat => {
                    const isSelected = selectedGenres.includes(cat);
                    return (
                      <button
                        type="button"
                        key={cat}
                        onClick={() => handleToggleGenre(cat)}
                        className={`py-1 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400'
                        }`}
                      >
                        {isSelected ? '✓ ' : '+ '}{cat}
                      </button>
                    );
                  })}
                </div>

                {/* Add Custom Category Input */}
                <div className="flex items-center gap-2 pt-2 max-w-md">
                  <input
                    type="text"
                    placeholder="Add custom category (e.g. Steampunk, Cyberpunk)..."
                    value={customGenreInput}
                    onChange={(e) => setCustomGenreInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomGenre(e);
                      }
                    }}
                    className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomGenre}
                    className="py-1.5 px-3 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 transition-colors cursor-pointer"
                  >
                    + Add Category
                  </button>
                </div>
              </div>

              {/* SECTION 3: ATTACH MULTIPLE PHOTOS (COMIC PAGES) */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    <Images className="w-4 h-4 text-rose-500" />
                    <span>3. Attach Comic Pages (Multiple Photos Allowed) *</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                    📸 {attachedPages.length} Pages Attached
                  </span>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Select and attach multiple photo pages for your comic episode. You can upload several images at once or add more pages sequentially.
                </p>

                {/* File Upload Trigger Dropzone */}
                <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-500 dark:hover:border-rose-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-white dark:bg-slate-900 group">
                  <input
                    type="file"
                    multiple
                    accept="image/*,.png,.jpg,.jpeg,.webp,.avif"
                    onChange={handleMultiplePagesUpload}
                    className="hidden"
                  />
                  <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                    <FileUp className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Click to Select Multiple Photos or Drag &amp; Drop
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">
                    Select 1 to 50+ comic art pages (JPG, PNG, WebP)
                  </span>
                </label>

                {/* Attached Multiple Photos Gallery */}
                {attachedPages.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Uploaded Episode Sequence ({attachedPages.length} Pages):
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="py-1 px-2.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-1">
                          <Plus className="w-3 h-3" />
                          <span>Add More Pages</span>
                          <input
                            type="file"
                            multiple
                            accept="image/*,.png,.jpg,.jpeg,.webp,.avif"
                            onChange={handleMultiplePagesUpload}
                            className="hidden"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => setAttachedPages([])}
                          className="py-1 px-2.5 rounded-lg border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 text-[11px] font-semibold transition-colors"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    {/* Page Cards Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-96 overflow-y-auto p-1">
                      {attachedPages.map((page, idx) => (
                        <div
                          key={page.id}
                          className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm space-y-2 relative group"
                        >
                          <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-950">
                            <img
                              src={page.dataUrl}
                              alt={page.caption}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded bg-black/75 text-white font-mono font-bold text-[10px] backdrop-blur-xs">
                              Page {page.pageNumber}
                            </span>
                          </div>

                          <div className="text-[10px] text-slate-500 truncate" title={page.fileName}>
                            {page.fileName}
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMovePage(idx, 'up')}
                                className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-20 cursor-pointer"
                                title="Move Earlier"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === attachedPages.length - 1}
                                onClick={() => handleMovePage(idx, 'down')}
                                className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-20 cursor-pointer"
                                title="Move Later"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemovePage(page.id)}
                              className="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                              title="Delete Page"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS: PREVIEW FIRST & PUBLISH */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleOpenLivePreview()}
                  className="w-full sm:flex-1 py-3.5 px-6 rounded-xl border-2 border-rose-600 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Eye className="w-4 h-4" />
                  <span>Preview Before Publishing</span>
                </button>

                <button
                  type="button"
                  disabled={isDirectPublishing}
                  onClick={() => handleDirectPublish()}
                  className="w-full sm:flex-1 py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Globe2 className="w-4 h-4" />
                  <span>{isDirectPublishing ? 'Publishing Live...' : 'Publish Directly to Website'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* INTERACTIVE LIVE PREVIEW MODAL */}
          {showLivePreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
              <div className="w-full max-w-5xl h-[92vh] flex flex-col rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden text-slate-100">
                
                {/* Modal Header */}
                <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 bg-slate-900/80">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 font-mono uppercase">
                        <Eye className="w-3 h-3" /> Live Reader Preview
                      </span>
                      <span className="text-xs text-slate-400">How readers will view this episode</span>
                    </div>

                    <h3 className="text-base font-extrabold text-white font-heading">
                      {publishMode === 'add_episode' ? (
                        <>
                          {(() => {
                            const list = allComicsWithPending.length > 0 ? allComicsWithPending : comics;
                            const cur = list.find(c => c.id === selectedComicId) || list[0];
                            const ch = cur?.chapters.find(c => c.id === selectedChapterId) || cur?.chapters[0];
                            return `${cur?.title || 'Comic'} > ${selectedChapterId === 'new' ? (newChapterTitle || 'New Chapter') : (ch?.title || 'Chapter')} > ${episodeTitle || 'Episode'}`;
                          })()}
                        </>
                      ) : (
                        `${directTitle || 'Untitled Series'} > ${newChapterTitle || 'Chapter 1'} > ${episodeTitle || 'Episode 1'}`
                      )}
                    </h3>

                    {/* Categories Strip */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-slate-400">Categories:</span>
                      {selectedGenres.map(g => (
                        <span key={g} className="px-2 py-0.2 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          {g}
                        </span>
                      ))}
                      <span className="text-[10px] text-emerald-400 font-bold ml-2">
                        ● 100% Free · 📸 {attachedPages.length} Pages
                      </span>
                    </div>
                  </div>

                  {/* Mode & Zoom Controls */}
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <div className="flex items-center p-1 rounded-xl bg-slate-800 border border-slate-700 text-xs">
                      <button
                        type="button"
                        onClick={() => setPreviewViewMode('vertical')}
                        className={`py-1 px-2.5 rounded-lg transition-colors cursor-pointer ${
                          previewViewMode === 'vertical' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Vertical Scroll
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewViewMode('page')}
                        className={`py-1 px-2.5 rounded-lg transition-colors cursor-pointer ${
                          previewViewMode === 'page' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Page-by-Page
                      </button>
                    </div>

                    <div className="flex items-center gap-1 text-slate-400 text-xs">
                      <button
                        type="button"
                        onClick={() => setPreviewZoom(z => Math.max(75, z - 25))}
                        className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white cursor-pointer"
                        title="Zoom out"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <span className="font-mono text-[11px] px-1">{previewZoom}%</span>
                      <button
                        type="button"
                        onClick={() => setPreviewZoom(z => Math.min(150, z + 25))}
                        className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white cursor-pointer"
                        title="Zoom in"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowLivePreview(false)}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                      title="Close Preview"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Modal Body: High Resolution Reader Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex justify-center bg-slate-950/60">
                  {previewViewMode === 'vertical' ? (
                    /* VERTICAL CONTINUOUS WEBTOON SCROLL */
                    <div
                      className="space-y-4 transition-all duration-200"
                      style={{ width: `${Math.min(95, previewZoom)}%`, maxWidth: '780px' }}
                    >
                      {attachedPages.map((p, idx) => (
                        <div
                          key={p.id}
                          className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl group"
                        >
                          <img
                            src={p.dataUrl}
                            alt={p.caption || `Page ${idx + 1}`}
                            className="w-full h-auto object-contain block"
                          />
                          <div className="p-2.5 bg-slate-900/90 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
                            <span>Page {p.pageNumber} of {attachedPages.length}</span>
                            <span>{p.fileName}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* PAGE-BY-PAGE SLIDESHOW VIEW */
                    <div className="flex flex-col items-center justify-center w-full max-w-2xl h-full space-y-4">
                      {attachedPages[previewCurrentPage - 1] && (
                        <div
                          className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl max-h-[65vh] flex items-center justify-center transition-all"
                          style={{ transform: `scale(${previewZoom / 100})` }}
                        >
                          <img
                            src={attachedPages[previewCurrentPage - 1].dataUrl}
                            alt={`Page ${previewCurrentPage}`}
                            className="max-h-[65vh] w-auto object-contain rounded-xl"
                          />
                          <span className="absolute top-3 left-3 px-2.5 py-1 rounded bg-black/80 text-white font-mono text-xs font-bold backdrop-blur-xs">
                            Page {previewCurrentPage} of {attachedPages.length}
                          </span>
                        </div>
                      )}

                      {/* Pagination Chevrons */}
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          disabled={previewCurrentPage <= 1}
                          onClick={() => setPreviewCurrentPage(p => Math.max(1, p - 1))}
                          className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white text-xs font-bold transition-colors cursor-pointer"
                        >
                          &larr; Previous Page
                        </button>
                        <span className="text-xs font-mono text-slate-400">
                          {previewCurrentPage} / {attachedPages.length}
                        </span>
                        <button
                          type="button"
                          disabled={previewCurrentPage >= attachedPages.length}
                          onClick={() => setPreviewCurrentPage(p => Math.min(attachedPages.length, p + 1))}
                          className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white text-xs font-bold transition-colors cursor-pointer"
                        >
                          Next Page &rarr;
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Thumbnail Strip */}
                <div className="p-3 bg-slate-900 border-t border-slate-800 overflow-x-auto flex items-center gap-2.5 shrink-0">
                  {attachedPages.map((p, idx) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setPreviewCurrentPage(idx + 1);
                      }}
                      className={`relative w-12 h-16 rounded-lg overflow-hidden shrink-0 border-2 transition-transform cursor-pointer ${
                        previewCurrentPage === idx + 1
                          ? 'border-amber-500 scale-105 shadow-md'
                          : 'border-slate-700 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={p.dataUrl} alt={`Thumb ${idx + 1}`} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/80 text-[8px] text-center font-mono py-0.5 text-white">
                        #{idx + 1}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Modal Action Footer */}
                <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-4 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowLivePreview(false)}
                    className="py-2.5 px-5 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
                  >
                    &larr; Edit Details &amp; Pages
                  </button>

                  <button
                    type="button"
                    disabled={isDirectPublishing}
                    onClick={() => handleDirectPublish()}
                    className="py-2.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/30 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isDirectPublishing ? 'Publishing Live...' : 'Looks Great! Publish Live on Website'}</span>
                  </button>
                </div>

              </div>
            </div>
          )}

        </div>
      )}

      {/* TAB 3: COMIC SUBMISSION APPROVALS QUEUE */}
      {activeTab === 'comic-queue' && (
        <div className="space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
              Author &amp; Publisher Submissions Awaiting Approval ({pendingComics.length})
            </h3>
            <p className="text-xs text-slate-500">
              When an author submits their completed comic, approve it here. It will automatically upload and publish live on the website!
            </p>
          </div>

          {pendingComics.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">All Submissions Reviewed!</h4>
              <p className="text-xs text-slate-400">No pending comics in queue right now.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingComics.map((comic) => (
                <div
                  key={comic.id}
                  className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-amber-500/40 shadow-md space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="flex items-center gap-4">
                      <img
                        src={comic.coverImage}
                        alt={comic.title}
                        className="w-14 h-20 rounded-xl object-cover shrink-0 border border-slate-300 dark:border-slate-700"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                            {comic.title}
                          </h4>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            Pending Review
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Submitted by author: <strong className="text-slate-800 dark:text-slate-200">{comic.authorName}</strong> · {comic.genre.join(', ')}
                        </p>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Submitted on: {new Date(comic.submittedAt || comic.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleModerateComicSubmission(comic.id, 'approve')}
                        className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Approve &amp; Publish Live</span>
                      </button>

                      <button
                        onClick={() => handleModerateComicSubmission(comic.id, 'reject')}
                        className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject</span>
                      </button>

                      <button
                        onClick={() => setComicToDelete(comic)}
                        className="py-2 px-3 rounded-xl border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-bold text-xs uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                        title="Delete comic series"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>

                  {/* Synopsis and Chapters preview */}
                  <div className="text-xs space-y-2">
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                      {comic.description}
                    </p>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Content payload: {comic.chapters.length} Chapters · {comic.chapters.reduce((sum, ch) => sum + ch.episodes.length, 0)} Episodes
                      </span>
                      {comic.attachedFileName && (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1 font-mono">
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>Attached File: {comic.attachedFileName} ({comic.attachedFileSize || 'Uploaded'})</span>
                        </span>
                      )}
                      <span className="text-[11px] text-emerald-500 font-medium">Ready to deploy live</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3.5: AUTHOR DELETION REQUESTS QUEUE */}
      {activeTab === 'delete-requests' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 mb-1">
                <Trash2 className="w-3 h-3" />
                <span>Author Deletion Approval Queue</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
                Author Content Deletion Requests ({deleteRequests.filter(r => r.status === 'pending').length} Pending)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Review requests submitted by authors to delete their series, specific chapters, or episodes.
              </p>
            </div>
          </div>

          {deleteRequests.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">No Deletion Requests</h4>
              <p className="text-xs text-slate-500">There are currently no author deletion requests in the queue.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {deleteRequests.map((req) => (
                <div
                  key={req.id}
                  className={`p-5 rounded-2xl border transition-all space-y-4 ${
                    req.status === 'pending'
                      ? 'bg-rose-50/30 dark:bg-rose-950/10 border-rose-500/40 shadow-sm'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-80'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      {req.comicCover ? (
                        <img
                          src={req.comicCover}
                          alt={req.comicTitle}
                          className="w-14 h-20 rounded-xl object-cover shrink-0 border border-slate-200 dark:border-slate-800"
                        />
                      ) : (
                        <div className="w-14 h-20 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                          <Trash2 className="w-6 h-6" />
                        </div>
                      )}

                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-extrabold text-sm text-slate-900 dark:text-white font-heading">
                            {req.comicTitle}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              req.targetType === 'series'
                                ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30'
                                : req.targetType === 'chapter'
                                ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                                : 'bg-sky-500/20 text-sky-500 border border-sky-500/30'
                            }`}
                          >
                            Delete {req.targetType}
                          </span>
                          {req.status === 'pending' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Pending Admin Review
                            </span>
                          ) : req.status === 'approved' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              ✓ Approved &amp; Deleted
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                              ✕ Request Rejected
                            </span>
                          )}
                        </div>

                        {req.targetType === 'chapter' && req.chapterTitle && (
                          <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                            Target Chapter: {req.chapterTitle}
                          </div>
                        )}
                        {req.targetType === 'episode' && req.episodeTitle && (
                          <div className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                            Target Episode: {req.chapterTitle ? `${req.chapterTitle} > ` : ''}{req.episodeTitle}
                          </div>
                        )}

                        <p className="text-xs text-slate-500">
                          Submitted by <strong>{req.authorName}</strong> on {new Date(req.requestedAt).toLocaleDateString()} at {new Date(req.requestedAt).toLocaleTimeString()}
                        </p>

                        {req.reason && (
                          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 text-xs text-slate-700 dark:text-slate-300 italic">
                            "{req.reason}"
                          </div>
                        )}
                      </div>
                    </div>

                    {req.status === 'pending' && (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleModerateDeleteRequest(req.id, 'approve')}
                          className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Approve Deletion &amp; Remove</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleModerateDeleteRequest(req.id, 'reject')}
                          className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>Reject Request</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PAYWALL CONTROL & CATALOG MODERATION */}
      {activeTab === 'comics' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Paywall Control &amp; Series Catalog
              </h3>
              <p className="text-xs text-slate-500">
                All comics are free by default. You have full access to put any comic, chapter, or episode behind paywall anytime.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {allComicsWithPending.map((comic) => {
              const isExpanded = !!expandedComicPaywall[comic.id];
              const isPaywalled = comic.accessType === 'premium';

              return (
                <div
                  key={comic.id}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={comic.coverImage}
                        alt={comic.title}
                        className="w-12 h-16 rounded-lg object-cover shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-slate-900 dark:text-white">{comic.title}</h4>
                          {isPaywalled ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              <span>PAYWALL (₹{comic.fullPriceInr || 99})</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-0.5">
                              <Unlock className="w-2.5 h-2.5" />
                              <span>100% FREE</span>
                            </span>
                          )}

                          {comic.moderationStatus === 'pending' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              Pending
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">By {comic.authorName} · {comic.genre.join(', ')}</p>
                      </div>
                    </div>

                    {/* Paywall Quick Toggle Action */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {isPaywalled ? (
                        <button
                          onClick={() => handleTogglePaywall({ comicId: comic.id, isPremium: false })}
                          className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Make Entire Comic Free</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleTogglePaywall({ comicId: comic.id, isPremium: true, priceInr: 99 })}
                          className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Put Entire Comic on Paywall (₹99)</span>
                        </button>
                      )}

                      <button
                        onClick={() => setExpandedComicPaywall(prev => ({ ...prev, [comic.id]: !prev[comic.id] }))}
                        className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-400 hover:text-white"
                        title="Manage Chapters &amp; Episodes Paywall"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>

                      <button
                        onClick={() => setComicToDelete(comic)}
                        className="py-1.5 px-3 rounded-lg bg-rose-600/10 hover:bg-rose-600 hover:text-white text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                        title="Delete comic series permanently"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Comic</span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Chapter & Episode Granular Paywall Manager */}
                  {isExpanded && (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                          Granular Chapter &amp; Episode Paywall Toggles:
                        </span>
                        <span className="text-[11px] text-slate-400">Put any chapter behind paywall (₹)</span>
                      </div>

                      <div className="space-y-3">
                        {comic.chapters.map(ch => (
                          <div key={ch.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-slate-900">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900 dark:text-white">
                                Chapter {ch.chapterNumber}: {ch.title}
                              </span>

                              <div className="flex items-center gap-2">
                                {ch.isPremium ? (
                                  <button
                                    onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, isPremium: false })}
                                    className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 text-white rounded"
                                  >
                                    Chapter Paywalled (Make Free)
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, isPremium: true, priceInr: 30 })}
                                    className="px-2.5 py-1 text-[11px] font-bold bg-amber-500 text-slate-950 rounded"
                                  >
                                    Put Chapter on Paywall (₹30)
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Episode list inside chapter */}
                            <div className="pl-3 border-l border-slate-200 dark:border-slate-800 space-y-1 pt-1">
                              {ch.episodes.map(ep => (
                                <div key={ep.id} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                  <span className="text-slate-600 dark:text-slate-300">
                                    Ep {ep.episodeNumber}: {ep.title}
                                  </span>

                                  <div className="flex items-center gap-2">
                                    {ep.isPremium ? (
                                      <button
                                        onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, episodeId: ep.id, isPremium: false })}
                                        className="text-emerald-500 font-bold hover:underline"
                                      >
                                        Locked ₹{ep.priceInr} (Unlock Free)
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, episodeId: ep.id, isPremium: true, priceInr: 10 })}
                                        className="text-amber-500 font-bold hover:underline"
                                      >
                                        Free (Lock for ₹10)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: AUTHOR PROFILES & APPLICATIONS */}
      {activeTab === 'authors' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Creator Registration Applications
              </h3>
              <p className="text-xs text-slate-500">
                Authors cannot publish until receiving formal administrator verification.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {applications.map((app) => (
              <div
                key={app.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">{app.authorName}</h4>
                      <span className="text-xs text-slate-400">({app.email})</span>
                      {app.status === 'pending' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          Pending Approval
                        </span>
                      )}
                      {app.status === 'approved' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          Approved
                        </span>
                      )}
                      {app.status === 'rejected' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                          Rejected
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Submitted on: {new Date(app.submittedAt).toLocaleString()}
                    </span>
                  </div>

                  {app.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAppAction(app.id, 'approve')}
                        className="py-1.5 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve Author</span>
                      </button>

                      <button
                        onClick={() => handleAppAction(app.id, 'reject')}
                        className="py-1.5 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-slate-400 block mb-0.5">Author Biography:</span>
                    <p className="text-slate-700 dark:text-slate-300">{app.bio || 'None provided.'}</p>
                    {app.portfolioUrl && (
                      <a href={app.portfolioUrl} target="_blank" rel="noreferrer" className="text-rose-500 hover:underline block mt-1">
                        Portfolio Link ↗
                      </a>
                    )}
                  </div>

                  <div>
                    <span className="font-semibold text-slate-400 block mb-0.5">Sample Comic:</span>
                    <p className="font-bold text-slate-900 dark:text-white">{app.sampleComicTitle}</p>
                    <p className="text-slate-600 dark:text-slate-400 mt-0.5">{app.sampleSynopsis}</p>
                    <span className="text-[11px] text-slate-500 block mt-1">Pages count: {app.samplePagesCount}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: FINANCIAL & PAYMENT MANAGEMENT */}
      {activeTab === 'financial' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Razorpay Indian Transactions &amp; Audit
              </h3>
              <p className="text-xs text-slate-500">
                INR Payments recorded with RBI guidelines and server-side signature verification.
              </p>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Gross Revenue</span>
              <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                ₹{stats.totalRevenueInr?.toFixed(2)} INR
              </span>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search by invoice, customer email, or payment ID..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={txStatusFilter}
                onChange={(e) => setTxStatusFilter(e.target.value as any)}
                className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              >
                <option value="all">All Transactions</option>
                <option value="success">Success</option>
                <option value="failed">Failed / Refunded</option>
              </select>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3.5">Invoice #</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Item</th>
                  <th className="p-3.5">Amount (INR)</th>
                  <th className="p-3.5">Payment Method</th>
                  <th className="p-3.5">Author (70%)</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5 font-mono font-bold text-slate-900 dark:text-white">
                      {tx.receiptNumber}
                    </td>
                    <td className="p-3.5 text-slate-600 dark:text-slate-300 truncate max-w-[150px]">
                      {tx.userEmail}
                    </td>
                    <td className="p-3.5 font-medium text-slate-900 dark:text-white truncate max-w-[160px]">
                      {tx.comicTitle}
                    </td>
                    <td className="p-3.5 font-bold font-mono text-emerald-600 dark:text-emerald-400">
                      ₹{tx.amountInr.toFixed(2)}
                    </td>
                    <td className="p-3.5 text-slate-500 text-[11px] truncate max-w-[140px]">
                      {tx.paymentMethod}
                    </td>
                    <td className="p-3.5 font-mono text-slate-600 dark:text-slate-400">
                      ₹{tx.authorEarningsInr?.toFixed(2) || '0.00'}
                    </td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        tx.status === 'success'
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="p-3.5">
                      {tx.status === 'success' ? (
                        <button
                          onClick={() => handleRefund(tx.id)}
                          className="text-[10px] text-rose-500 hover:underline font-bold"
                        >
                          Issue Refund
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400">Refunded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: COMMENT MODERATION */}
      {activeTab === 'comments' && (
        <div className="space-y-6">
          <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
            Live Reader Comments Moderation
          </h3>

          <div className="space-y-3">
            {allComments.map((c) => (
              <div key={c.id} className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">{c.userName}</span>
                    <span className="text-[10px] text-slate-400">({new Date(c.createdAt).toLocaleDateString()})</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 mt-1">"{c.content}"</p>
                </div>
                <button
                  onClick={async () => {
                    await fetch(`/api/episodes/${c.episodeId}/comments/${c.id}`, { method: 'DELETE' });
                    fetchAdminData();
                  }}
                  className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 8: RATINGS AUDIT */}
      {activeTab === 'ratings' && (
        <div className="space-y-6">
          <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
            Rating Activity &amp; Audit Logs
          </h3>
          <div className="space-y-2">
            {allRatings.map((r) => (
              <div key={r.id} className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-amber-500">★ {r.stars} Stars</span>
                  <span className="text-slate-500 ml-2">by User: {r.userId}</span>
                  <span className="text-[10px] text-slate-400 ml-2 font-mono">({new Date(r.createdAt).toLocaleString()})</span>
                </div>
                <button
                  onClick={async () => {
                    await fetch(`/api/admin/ratings/${r.id}`, { method: 'DELETE' });
                    fetchAdminData();
                  }}
                  className="text-rose-500 text-[11px] hover:underline"
                >
                  Remove Abusive Rating
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 9: COPYRIGHT DOCUMENTS */}
      {activeTab === 'copyright' && (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Official Copyright Documents &amp; Notices
              </h3>
              <p className="text-xs text-slate-500">
                Documents published here appear directly on the public /copyright page.
              </p>
            </div>
          </div>

          {/* Form to add document */}
          <form onSubmit={handleAddCopyrightDoc} className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Add New Copyright Policy Document
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input
                type="text"
                required
                placeholder="Document Title (e.g. DMCA Takedown Guidelines 2026)"
                value={newCpyTitle}
                onChange={(e) => setNewCpyTitle(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
              <input
                type="text"
                placeholder="Executive Summary"
                value={newCpySummary}
                onChange={(e) => setNewCpySummary(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
            </div>
            <textarea
              rows={4}
              required
              placeholder="Full legal document text..."
              value={newCpyText}
              onChange={(e) => setNewCpyText(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono resize-none"
            />
            <button
              type="submit"
              className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider"
            >
              Publish to Public Copyright Page
            </button>
          </form>

          {/* Published Docs */}
          <div className="space-y-4">
            {copyrightDocs.map((doc) => (
              <div key={doc.id} className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white">{doc.title}</h4>
                    <span className="text-[10px] text-slate-400 font-mono">Ref: {doc.documentNumber}</span>
                  </div>
                  <button
                    onClick={async () => {
                      await fetch(`/api/admin/copyright/${doc.id}`, { method: 'DELETE' });
                      fetchAdminData();
                    }}
                    className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-slate-500">{doc.summary}</p>
                <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 text-[11px] text-slate-400 font-mono whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {doc.fullText}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 10: SETTINGS & TERMS EDITOR */}
      {activeTab === 'settings' && settings && (
        <form onSubmit={handleSaveSettings} className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6 max-w-3xl">
          <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
            Website Commercial Settings &amp; Pricing Controls
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-600 dark:text-slate-400">
                Author Revenue Share (%)
              </label>
              <input
                type="number"
                min="50"
                max="90"
                value={settings.authorRevenueSharePercent}
                onChange={(e) => setSettings({ ...settings, authorRevenueSharePercent: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-600 dark:text-slate-400">
                Monthly Premium Membership Price (₹ INR)
              </label>
              <input
                type="number"
                value={settings.monthlySubscriptionPrice}
                onChange={(e) => setSettings({ ...settings, monthlySubscriptionPrice: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-600 dark:text-slate-400">
              Customer Terms &amp; Conditions Clauses
            </label>
            <textarea
              rows={4}
              value={settings.termsCustomer}
              onChange={(e) => setSettings({ ...settings, termsCustomer: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-600 dark:text-slate-400">
              Author Publishing Agreement Clauses
            </label>
            <textarea
              rows={4}
              value={settings.termsAuthor}
              onChange={(e) => setSettings({ ...settings, termsAuthor: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono resize-none"
            />
          </div>

          <button
            type="submit"
            className="py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider"
          >
            Save Platform Settings
          </button>
        </form>
      )}

      {/* TAB 11: AUDIT LOGS */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
            Chronological Platform Audit Trail
          </h3>

          <div className="space-y-2">
            {activityLogs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-rose-500">{log.action}</span>
                    <span className="text-slate-400">by {log.actorEmail}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 mt-0.5">{log.details}</p>
                </div>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
