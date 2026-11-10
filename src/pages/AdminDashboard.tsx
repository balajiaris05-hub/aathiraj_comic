import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Comic, AuthorApplication, Purchase, CopyrightDoc, PlatformSettings, ActivityLog } from '../types/comic';
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
  FileUp
} from 'lucide-react';

interface AdminDashboardProps {
  comics: Comic[];
  onRefreshComics: () => void;
  setCurrentTab: (tab: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  comics,
  onRefreshComics,
  setCurrentTab,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'publish-direct' | 'comic-queue' | 'comics' | 'authors' | 'financial' | 'comments' | 'ratings' | 'copyright' | 'settings' | 'logs'
  >('overview');

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
  const [applications, setApplications] = useState<AuthorApplication[]>([]);
  const [transactions, setTransactions] = useState<Purchase[]>([]);
  const [copyrightDocs, setCopyrightDocs] = useState<CopyrightDoc[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [allComments, setAllComments] = useState<any[]>([]);
  const [allRatings, setAllRatings] = useState<any[]>([]);

  // Direct Comic Publishing state (Admin: Title, Description, Attach File alone)
  const [directTitle, setDirectTitle] = useState('');
  const [directDesc, setDirectDesc] = useState('');
  const [directAttachedFile, setDirectAttachedFile] = useState<{
    name: string;
    size: string;
    type: string;
    dataUrl?: string;
  } | null>(null);
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

  // New Copyright Doc Form
  const [newCpyTitle, setNewCpyTitle] = useState('');
  const [newCpySummary, setNewCpySummary] = useState('');
  const [newCpyText, setNewCpyText] = useState('');

  // Author Application Action Note
  const [reviewNote, setReviewNote] = useState('');

  // Fetch all admin data (including pending comics)
  const fetchAdminData = async () => {
    try {
      const [statsRes, authRes, txRes, cpyRes, setRes, logRes, cmtRes, ratRes, allComicsRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/authors'),
        fetch('/api/admin/transactions'),
        fetch('/api/admin/copyright'),
        fetch('/api/admin/settings'),
        fetch('/api/admin/logs'),
        fetch('/api/admin/comments'),
        fetch('/api/admin/ratings'),
        fetch('/api/comics?includePending=true&role=admin'),
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
    } catch (e) {
      console.error('Error fetching admin data:', e);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  // Handle file attachment for direct admin comic publishing
  const handleAdminFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formattedSize = file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(file.size / 1024).toFixed(1)} KB`;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setDirectAttachedFile({
          name: file.name,
          size: formattedSize,
          type: file.type || 'image',
          dataUrl: reader.result as string,
        });
      };
      reader.readAsDataURL(file);
    } else {
      setDirectAttachedFile({
        name: file.name,
        size: formattedSize,
        type: file.name.split('.').pop()?.toUpperCase() || 'DOCUMENT',
      });
    }
  };

  // Admin directly publishes comic (title, description, attached file alone)
  const handleDirectPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directTitle.trim()) return;
    setIsDirectPublishing(true);
    setDirectPublishSuccess(null);

    try {
      const res = await fetch('/api/admin/comics/publish-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: directTitle.trim(),
          description: directDesc.trim(),
          attachedFileName: directAttachedFile?.name,
          attachedFileSize: directAttachedFile?.size,
          attachedFileType: directAttachedFile?.type,
          attachedFileData: directAttachedFile?.dataUrl,
        }),
      });

      const data = await res.json();
      setIsDirectPublishing(false);

      if (res.ok) {
        setDirectPublishSuccess(`"${data.comic.title}" was published directly to the live website!`);
        setDirectTitle('');
        setDirectDesc('');
        setDirectAttachedFile(null);
        onRefreshComics();
        fetchAdminData();
      }
    } catch (err) {
      setIsDirectPublishing(false);
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

  const pendingComics = allComicsWithPending.filter(c => c.moderationStatus === 'pending');
  const filteredTransactions = transactions.filter(t => {
    const matchSearch =
      t.userEmail.toLowerCase().includes(txSearch.toLowerCase()) ||
      t.comicTitle.toLowerCase().includes(txSearch.toLowerCase()) ||
      t.receiptNumber.toLowerCase().includes(txSearch.toLowerCase()) ||
      t.razorpayPaymentId.toLowerCase().includes(txSearch.toLowerCase());
    const matchStatus = txStatusFilter === 'all' || t.status === txStatusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-8 pb-24">
      
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
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Publish direct comics, approve publisher submissions, and control chapter paywalls at will.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('publish-direct')}
            className="py-2 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Publish My Comic</span>
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
            onClick={() => setActiveTab(t.id as any)}
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

      {/* TAB 2: DIRECT COMIC PUBLISHING (ADMIN SELF-PUBLISH: Title, Description, Attach File alone) */}
      {activeTab === 'publish-direct' && (
        <form
          onSubmit={handleDirectPublish}
          className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-w-2xl mx-auto space-y-6"
        >
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 mb-2">
              <Globe2 className="w-3 h-3" />
              <span>Admin Direct Publishing Mode</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
              Publish My Comic
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Provide title, description, and attach your comic file to publish directly to the live website.
            </p>
          </div>

          {directPublishSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{directPublishSuccess}</span>
            </div>
          )}

          {/* 1. Title of the comic */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Comic Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Chronicles of Coromandel"
              value={directTitle}
              onChange={(e) => setDirectTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white"
            />
          </div>

          {/* 2. Description of the comic */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Comic Description *
            </label>
            <textarea
              rows={4}
              required
              placeholder="Provide the premise, synopsis, and description of your comic..."
              value={directDesc}
              onChange={(e) => setDirectDesc(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white resize-none"
            />
          </div>

          {/* 3. Attach file */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-rose-500" />
                <span>Attach Comic File *</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                Supported: PDF, CBZ, CBR, ZIP, PNG, JPG (up to 50MB)
              </span>
            </label>

            {!directAttachedFile ? (
              <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-500 dark:hover:border-rose-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-800/40 group">
                <input
                  type="file"
                  accept=".pdf,.cbz,.cbr,.zip,.png,.jpg,.jpeg"
                  onChange={handleAdminFileChange}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                  <FileUp className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Click to Browse or Drag &amp; Drop Comic File
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  Attach your comic manuscript, PDF, or artwork package
                </span>
              </label>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0 font-bold text-xs uppercase">
                    {directAttachedFile.type.slice(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {directAttachedFile.name}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <span className="font-mono">{directAttachedFile.size}</span>
                      <span>·</span>
                      <span className="text-emerald-500 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Ready to Publish
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setDirectAttachedFile(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                  title="Remove attached file"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isDirectPublishing}
            className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Globe2 className="w-4 h-4" />
            <span>{isDirectPublishing ? 'Publishing Live...' : 'Publish Directly to Website'}</span>
          </button>
        </form>
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
                        onClick={() => handleDeleteComic(comic.id)}
                        className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg"
                        title="Delete comic"
                      >
                        <Trash2 className="w-4 h-4" />
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
