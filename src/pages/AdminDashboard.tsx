import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Comic,
  AuthorApplication,
  Purchase,
  CopyrightDoc,
  PlatformSettings,
  ActivityLog,
  ActivityLogArchiveState,
  DeleteRequest,
  GstBusinessSettings,
  CreditNoteRecord,
  AdPlacementRequest,
} from '../types/comic';
import { AdminPublishingStudio } from '../components/AdminPublishingStudio';
import { DualOtpSecurityPanel, DualOtpVerifiedPayload } from '../components/DualOtpSecurityPanel';
import {
  firebaseConfig,
  syncAllPlatformDataToFirestore,
  syncGstSettingsToFirestore,
  clearRecaptchaVerifier,
} from '../firebase';
import { upsertComicAndEpisodesInFirestore, upsertAdRequestInFirestore, fetchAdRequestsFromFirestore } from '../services/firestoreBackend';
import {
  INDIAN_STATES_AND_UTS,
  DEFAULT_GST_SETTINGS,
  GST_MONTHS_LIST,
  formatPeriodHumanLabel,
  validateIndianGstin,
  ensurePurchaseGstFields,
  computeGstPeriodSummary,
  validateGstExportData,
  generateGstr1OfflineJson,
  generateGstReconciliationCsv,
  generateTaxInvoicePdfBytes,
  generateMonthlyGstStatementPdfBytes,
  getGstPeriodDetails,
} from '../utils/gstUtils';
import { processingClass, useButtonLoadingMap } from '../utils/buttonLoading';
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
  FolderPlus,
  Sun,
  Moon,
  ShieldCheck,
  X,
  Archive,
  Calendar
} from 'lucide-react';

interface AdminDashboardProps {
  comics: Comic[];
  onRefreshComics: () => void;
  onPatchComicLocal?: (comicId: string, updater: (comic: Comic) => Comic) => void;
  setCurrentTab: (tab: string) => void;
  initialSubTab?: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  comics,
  onRefreshComics,
  onPatchComicLocal,
  setCurrentTab,
  initialSubTab,
}) => {
  const { user, switchDemoRole, setAuthenticatedUser, getAuthHeaders } = useAuth();
  const { isLoading: isRowActionLoading, runWithKey: runRowAction } = useButtonLoadingMap();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'customer-tracker' | 'my-comics-episodes-upload' | 'publish-direct' | 'comic-queue' | 'delete-requests' | 'ad-requests' | 'comics' | 'gst-billing' | 'authors' | 'financial' | 'comments' | 'ratings' | 'copyright' | 'settings' | 'logs'
  >(() => {
    if (initialSubTab === 'delete-requests') return 'delete-requests';
    if (initialSubTab === 'gst-billing') return 'gst-billing';
    if (initialSubTab === 'customer-tracker') return 'customer-tracker';
    return 'overview';
  });

  const [stats, setStats] = useState<any>({
    totalUsers: 0,
    totalAuthors: 0,
    pendingApplications: 0,
    approvedAuthors: 0,
    totalComics: 0,
    totalChapters: 0,
    totalEpisodes: 0,
    totalComments: 0,
    totalTransactions: 0,
    totalRevenueInr: 0,
    totalAuthorEarningsInr: 0,
  });

  const [allComicsWithPending, setAllComicsWithPending] = useState<Comic[]>([]);
  const [deleteRequests, setDeleteRequests] = useState<DeleteRequest[]>([]);
  const [adRequests, setAdRequests] = useState<AdPlacementRequest[]>([]);
  const [deleteReviewNote, setDeleteReviewNote] = useState('');
  const [applications, setApplications] = useState<AuthorApplication[]>([]);
  const [transactions, setTransactions] = useState<Purchase[]>([]);
  const [copyrightDocs, setCopyrightDocs] = useState<CopyrightDoc[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLogMeta, setActivityLogMeta] = useState<{
    todayCount: number;
    currentMonthCount: number;
    currentIstDayKey: string;
    currentIstMonthKey: string;
    currentIstMonthLabel: string;
    nextRolloverLabel: string;
    adminActionsMonthCount: number;
    payments49MonthCount: number;
    payments249MonthCount: number;
    totalRevenueMonthInr: number;
    archiveState?: ActivityLogArchiveState;
  } | null>(null);
  const [isDownloadingMonthLogs, setIsDownloadingMonthLogs] = useState<'csv' | 'json' | null>(null);
  const [showArchiveLogsModal, setShowArchiveLogsModal] = useState(false);
  const [isArchivingLogs, setIsArchivingLogs] = useState(false);
  const [isSendingSampleLogEmail, setIsSendingSampleLogEmail] = useState(false);
  const [isLoadingActivityLogs, setIsLoadingActivityLogs] = useState(false);
  const [activityLogsLoaded, setActivityLogsLoaded] = useState(false);
  const [archiveLogsFeedback, setArchiveLogsFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [allComments, setAllComments] = useState<any[]>([]);
  const [allRatings, setAllRatings] = useState<any[]>([]);
  const [readerAccounts, setReaderAccounts] = useState<any[]>([]);

  // Customer Tracker Tab State
  const [customerTrackQuery, setCustomerTrackQuery] = useState('');
  const [customerTrackLoading, setCustomerTrackLoading] = useState(false);
  const [customerTrackError, setCustomerTrackError] = useState<string | null>(null);
  const [customerTrackHasSearched, setCustomerTrackHasSearched] = useState(false);
  const [customerTrackLastQuery, setCustomerTrackLastQuery] = useState('');
  const [customerTrackMatches, setCustomerTrackMatches] = useState<any[]>([]);
  const [selectedTrackedCustomerId, setSelectedTrackedCustomerId] = useState<string | null>(null);
  const [customerTrackSummary, setCustomerTrackSummary] = useState<{
    totalCustomers: number;
    activePlanCustomers: number;
    freeCustomers: number;
  } | null>(null);
  const [confirmDeleteTrackedId, setConfirmDeleteTrackedId] = useState<string | null>(null);

  // GST & Billing Module State
  const [gstSettings, setGstSettings] = useState<GstBusinessSettings>(DEFAULT_GST_SETTINGS);
  const [creditNotes, setCreditNotes] = useState<CreditNoteRecord[]>([]);
  const [gstPeriodFilter, setGstPeriodFilter] = useState<string>('052026');
  const [gstSelectedMonth, setGstSelectedMonth] = useState<string>('05');
  const [gstSelectedYear, setGstSelectedYear] = useState<string>('2026');
  const [gstSaving, setGstSaving] = useState(false);
  const [gstMessage, setGstMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [gstInvoiceSearch, setGstInvoiceSearch] = useState('');

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
  const [expandedComicPaywall, setExpandedComicPaywall] = useState<Record<string, boolean>>({});
  const [paywallBusyKeys, setPaywallBusyKeys] = useState<Record<string, boolean>>({});
  const paywallSeqRef = useRef<Record<string, number>>({});
  const paywallQueueRef = useRef<Record<string, Promise<void>>>({});
  const actionMessageTimerRef = useRef<number | null>(null);

  // Submission review note & Comic Queue review modal state
  const [comicReviewNote, setComicReviewNote] = useState('');
  const [comicReviewNotes, setComicReviewNotes] = useState<Record<string, string>>({});
  const [comicRejectErrorId, setComicRejectErrorId] = useState<string | null>(null);
  const [previewQueueComic, setPreviewQueueComic] = useState<Comic | null>(null);
  const [previewQueuePageIdx, setPreviewQueuePageIdx] = useState<number>(0);
  const [previewQueueMode, setPreviewQueueMode] = useState<'page' | 'vertical'>('page');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [firestoreStatus, setFirestoreStatus] = useState<any>(null);
  const [isSyncingFirestore, setIsSyncingFirestore] = useState(false);

  // Search/Filters in Financial Tab
  const [txSearch, setTxSearch] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState<'all' | 'success' | 'failed'>('all');

  // Dedicated Admin Dual-OTP Security Gate State - Always locked by default for security
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);

  // Hidden 3-Tap Customer Login Details Export Vault State
  const secretExportTapTimesRef = useRef<number[]>([]);
  const [showCustomerExportModal, setShowCustomerExportModal] = useState(false);
  const [customerExportSession, setCustomerExportSession] = useState<{
    exportToken: string;
    expiresAt: number;
    totalCustomers: number;
  } | null>(null);
  const [exportVaultSecondsLeft, setExportVaultSecondsLeft] = useState(0);
  const [exportDownloadLoading, setExportDownloadLoading] = useState<'csv' | 'json' | null>(null);
  const [exportVaultError, setExportVaultError] = useState<string | null>(null);
  const [exportVaultSuccess, setExportVaultSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!customerExportSession) {
      setExportVaultSecondsLeft(0);
      return;
    }
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((customerExportSession.expiresAt - Date.now()) / 1000));
      setExportVaultSecondsLeft(remaining);
      if (remaining <= 0) {
        setCustomerExportSession(null);
        setExportVaultError('Export Vault session expired (5-minute limit). Verify Dual OTPs again to continue.');
      }
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [customerExportSession]);

  useEffect(() => {
    return () => {
      clearRecaptchaVerifier('firebase-recaptcha-admin');
      clearRecaptchaVerifier('firebase-recaptcha-export');
    };
  }, []);

  // Delete Comic Confirmation Modal State
  const [comicToDelete, setComicToDelete] = useState<Comic | null>(null);
  const [isDeletingComic, setIsDeletingComic] = useState(false);

  // New Copyright Doc Form
  const [newCpyTitle, setNewCpyTitle] = useState('');
  const [newCpySummary, setNewCpySummary] = useState('');
  const [newCpyText, setNewCpyText] = useState('');

  // Author Application Action Note & Sample Comic Preview Modal
  const [reviewNote, setReviewNote] = useState('');
  const [previewSampleApp, setPreviewSampleApp] = useState<AuthorApplication | null>(null);
  const [previewSamplePageIdx, setPreviewSamplePageIdx] = useState<number>(0);

  // Fetch all admin data ONLY after Dual-OTP unlock (never leaks admin data pre-auth in Network tab)
  const fetchAdminData = async (overrideSessionToken?: string | React.MouseEvent) => {
    const tokenOverride = typeof overrideSessionToken === 'string' ? overrideSessionToken : undefined;
    if (!isAdminUnlocked && !tokenOverride) {
      return;
    }
    // Helper to safely fetch and set data with authenticated admin token
    const safeFetch = async (url: string, setter: (data: any) => void) => {
      try {
        const headers = tokenOverride
          ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOverride}` }
          : await getAuthHeaders();
        const res = await fetch(url, { headers });
        if (res.ok) {
          const d = await res.json();
          setter(d);
        }
      } catch {
        // Silent fail without leaking endpoints or credentials to browser console
      }
    };

    await Promise.all([
      safeFetch('/api/admin/stats', setStats),
      safeFetch('/api/admin/authors', (d) => setApplications(Array.isArray(d) ? d : (d.applications || []))),
      safeFetch('/api/admin/transactions', (d) => setTransactions(Array.isArray(d) ? d : (d.transactions || []))),
      safeFetch('/api/admin/copyright', (d) => setCopyrightDocs(Array.isArray(d) ? d : (d.copyrightDocs || []))),
      safeFetch('/api/admin/settings', (d) => setSettings(d.settings || d)),
      safeFetch('/api/admin/comments', (d) => setAllComments(Array.isArray(d) ? d : (d.comments || []))),
      safeFetch('/api/admin/ratings', (d) => setAllRatings(Array.isArray(d) ? d : (d.ratings || []))),
      safeFetch('/api/comics?includePending=true&role=admin', (d) => setAllComicsWithPending(Array.isArray(d) ? d : (d.comics || []))),
      safeFetch('/api/admin/delete-requests', (d) => setDeleteRequests(Array.isArray(d) ? d : (d.deleteRequests || []))),
      safeFetch('/api/admin/ad-requests', async (d) => {
        const backendItems: AdPlacementRequest[] = Array.isArray(d) ? d : (d.adRequests || []);
        const fsItems = await fetchAdRequestsFromFirestore().catch(() => [] as AdPlacementRequest[]);
        const mergedMap = new Map<string, AdPlacementRequest>();
        for (const item of backendItems) mergedMap.set(item.id, item);
        for (const item of fsItems) {
          if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
        }
        const merged = Array.from(mergedMap.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setAdRequests(merged);
      }),
      safeFetch('/api/admin/readers', (d) => setReaderAccounts(Array.isArray(d) ? d : (d.readers || []))),
      safeFetch('/api/admin/gst/settings', (d) => {
        if (d?.gstSettings) setGstSettings(d.gstSettings);
        if (Array.isArray(d?.creditNotes)) setCreditNotes(d.creditNotes);
      }),
      safeFetch('/api/admin/firestore/status', (d) => setFirestoreStatus(d)),
    ]);
  };

  // On-demand Activity Logs loader: runs ONLY when the Admin opens the Activity Logs tab
  const fetchActivityLogs = async (tokenOverride?: string) => {
    if (!isAdminUnlocked && !tokenOverride) return;
    setIsLoadingActivityLogs(true);
    try {
      const headers = tokenOverride
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOverride}` }
        : await getAuthHeaders();
      const res = await fetch('/api/admin/logs', { headers });
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d)) {
          setActivityLogs(d);
        } else {
          setActivityLogs(Array.isArray(d?.logs) ? d.logs : []);
          setActivityLogMeta({
            todayCount: Number(d?.todayCount ?? (Array.isArray(d?.logs) ? d.logs.length : 0)),
            currentMonthCount: Number(d?.currentMonthCount ?? 0),
            currentIstDayKey: String(d?.currentIstDayKey || ''),
            currentIstMonthKey: String(d?.currentIstMonthKey || ''),
            currentIstMonthLabel: String(d?.currentIstMonthLabel || ''),
            nextRolloverLabel: String(d?.nextRolloverLabel || ''),
            adminActionsMonthCount: Number(d?.adminActionsMonthCount ?? 0),
            payments49MonthCount: Number(d?.payments49MonthCount ?? 0),
            payments249MonthCount: Number(d?.payments249MonthCount ?? 0),
            totalRevenueMonthInr: Number(d?.totalRevenueMonthInr ?? 0),
            archiveState: d?.archiveState,
          });
        }
        setActivityLogsLoaded(true);
      }
    } catch {
      // Silent fail without leaking endpoints or credentials
    } finally {
      setIsLoadingActivityLogs(false);
    }
  };

  useEffect(() => {
    if (isAdminUnlocked && activeTab === 'logs') {
      void fetchActivityLogs();
    }
  }, [activeTab, isAdminUnlocked]);

  // Admin approves or rejects author's deletion request
  const handleModerateDeleteRequest = async (requestId: string, action: 'approve' | 'reject') => {
    await runRowAction(`del-${requestId}-${action}`, async () => {
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
    });
  };

  const handleUpdateAdRequestStatus = async (
    requestId: string,
    status: 'pending' | 'contacted' | 'approved' | 'rejected'
  ) => {
    await runRowAction(`ad-${requestId}-${status}`, async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/admin/ad-requests/${requestId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status }),
        });
        const data = await res.json();
        if (res.ok && data.adRequest) {
          await upsertAdRequestInFirestore(data.adRequest).catch(() => null);
          setActionMessage(`Company Ad Request from "${data.adRequest.companyName}" updated to "${status}".`);
          fetchAdminData();
          setTimeout(() => setActionMessage(null), 5000);
        }
      } catch (err) {
        console.error(err);
      }
    });
  };

  useEffect(() => {
    if (!isAdminUnlocked) return;
    fetchAdminData();
  }, [isAdminUnlocked, activeTab]);

  useEffect(() => {
    if (initialSubTab === 'delete-requests') {
      setActiveTab('delete-requests');
    }
  }, [initialSubTab]);

  // Unified Dual-OTP Callback: Unlock Admin Console after BOTH Gmail OTP and Mobile SMS OTP succeed
  const handleAdminDualOtpVerified = (result: DualOtpVerifiedPayload) => {
    sessionStorage.removeItem('aathirai_admin_unlocked');
    setIsAdminUnlocked(true);
    if (result.user) {
      setAuthenticatedUser(result.user);
    }
    switchDemoRole('admin');
    setActionMessage(result.message || 'Dual-OTP Verified (Gmail + Mobile SMS)! Terminal Unlocked.');
    fetchAdminData(result.user?.sessionToken);
    onRefreshComics();
    setTimeout(() => setActionMessage(null), 5000);
  };

  // Hidden 3-Tap Secret Trigger on Activity Logs entry count label
  const handleSecretExportTap = () => {
    const now = Date.now();
    const recentTaps = secretExportTapTimesRef.current.filter((ts) => now - ts <= 2000);
    recentTaps.push(now);
    secretExportTapTimesRef.current = recentTaps;

    if (recentTaps.length >= 3) {
      secretExportTapTimesRef.current = [];
      setExportVaultError(null);
      setExportVaultSuccess(null);
      setCustomerExportSession(null);
      setShowCustomerExportModal(true);
    }
  };

  const handleCloseCustomerExportModal = () => {
    setShowCustomerExportModal(false);
    setCustomerExportSession(null);
    setExportVaultError(null);
    setExportVaultSuccess(null);
    setExportDownloadLoading(null);
    clearRecaptchaVerifier('firebase-recaptcha-export');
  };

  const handleCustomerExportVaultVerified = (result: DualOtpVerifiedPayload) => {
    if (!result.exportToken || !result.expiresAt) {
      setExportVaultError('Vault authorization token was not returned. Please verify again.');
      return;
    }
    setExportVaultError(null);
    setExportVaultSuccess(null);
    setCustomerExportSession({
      exportToken: result.exportToken,
      expiresAt: result.expiresAt,
      totalCustomers: typeof result.totalCustomers === 'number' ? result.totalCustomers : 0,
    });
  };

  const handleDownloadCustomerLogins = async (format: 'csv' | 'json') => {
    if (!customerExportSession?.exportToken) {
      setExportVaultError('Vault session locked. Please verify Dual OTPs again.');
      return;
    }

    setExportDownloadLoading(format);
    setExportVaultError(null);
    setExportVaultSuccess(null);

    try {
      const res = await fetch(`/api/admin/export-customers?format=${format}`, {
        method: 'GET',
        headers: {
          'X-Admin-Export-Token': customerExportSession.exportToken,
        },
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 401 || res.status === 403) {
          setCustomerExportSession(null);
        }
        setExportVaultError(data.error || 'Failed to fetch customer login details from backend.');
        setExportDownloadLoading(null);
        return;
      }

      const customers: any[] = Array.isArray(data.customers) ? data.customers : [];
      const dateSlug = new Date().toISOString().slice(0, 10);

      if (format === 'json') {
        const jsonPayload = {
          platform: 'Aathirai_Comic',
          exportedAt: data.exportedAt || new Date().toISOString(),
          totalCustomers: customers.length,
          securityNote: 'Password hashes, passwords, OTPs, and secret tokens are excluded.',
          customers,
        };
        const blob = new Blob([JSON.stringify(jsonPayload, null, 2)], {
          type: 'application/json;charset=utf-8;',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Aathirai_Comic_Customer_Logins_${dateSlug}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } else {
        const escapeSafeCsv = (value: unknown) => {
          let str = String(value ?? '').replace(/\r?\n/g, ' ');
          if (/^[=+\-@\t\r]/.test(str)) {
            str = `'${str}`;
          }
          if (/[",\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };

        const headers = [
          'User ID',
          'Full Name',
          'Email',
          'Mobile Number',
          'Country Code',
          'Country',
          'Role',
          'Account Status',
          'Email Verified',
          'Phone Verified',
          'Auth Provider',
          'Date of Birth',
          'Age',
          'Gmail Alerts',
          'Mobile Alerts',
          'Premium Active',
          'Premium Plan',
          'Premium Expires At',
          'Total Purchases',
          'Created At',
          'Last Login At',
        ];

        const rows = customers.map((c) => [
          c.userId,
          c.fullName,
          c.email,
          c.phone,
          c.countryCode,
          c.countryName,
          c.role,
          c.accountStatus,
          c.emailVerified ? 'Yes' : 'No',
          c.phoneVerified ? 'Yes' : 'No',
          c.authProvider,
          c.dob,
          c.age ?? '',
          c.notifyGmail ? 'Yes' : 'No',
          c.notifyMobile ? 'Yes' : 'No',
          c.premiumActive ? 'Yes' : 'No',
          c.premiumPlan,
          c.premiumExpiresAt,
          c.totalPurchases,
          c.createdAt,
          c.lastLoginAt,
        ]);

        const csvContent =
          '\uFEFF' +
          [headers.map(escapeSafeCsv).join(','), ...rows.map((row) => row.map(escapeSafeCsv).join(','))].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Aathirai_Comic_Customer_Logins_${dateSlug}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }

      setExportVaultSuccess(
        `Downloaded ${customers.length} customer login ${customers.length === 1 ? 'record' : 'records'} (${format.toUpperCase()}).`
      );
      fetchAdminData();
    } catch {
      setExportVaultError('Network error while downloading customer login details.');
    } finally {
      setExportDownloadLoading(null);
    }
  };

  // Lock Admin Console
  const handleLockAdminConsole = () => {
    sessionStorage.removeItem('aathirai_admin_unlocked');
    setIsAdminUnlocked(false);
    handleCloseCustomerExportModal();
    switchDemoRole('reader');
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

      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/comics/publish-direct', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setIsDirectPublishing(false);

      if (res.ok) {
        if (data.comic) {
          await upsertComicAndEpisodesInFirestore(data.comic).catch(() => null);
        }
        setShowLivePreview(false);
        setPublishedEpisodeInfo({
          comicTitle: data.comic.title,
          chapterTitle: data.chapter ? data.chapter.title : (data.comic.chapters[0]?.title || 'Chapter 1'),
          episodeTitle: data.episode ? data.episode.title : 'New Episode',
          pageCount: attachedPages.length,
        });
        setDirectPublishSuccess(
          data.cloudPersisted === false
            ? `${data.message || 'Published locally'} — Cloud backup warning: ${data.cloudPersistWarning || 'Check Firestore IAM access'}`
            : (data.message || 'Comic episode published live on website!')
        );
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

  const getComicAttachedPages = (comic: Comic) => {
    if (Array.isArray(comic.attachedPages) && comic.attachedPages.length > 0) {
      return comic.attachedPages;
    }
    const epPages = comic.chapters.flatMap(ch => ch.episodes.flatMap(ep => ep.pages || []));
    const fileCountMatch = String(comic.attachedFileSize || '').match(/(\d+)\s*(?:files?|photos?|pages?)/i);
    const expectedCount = fileCountMatch ? Math.max(1, parseInt(fileCountMatch[1], 10)) : 0;

    if (epPages.length >= Math.max(1, expectedCount)) {
      return epPages;
    }

    const totalNeeded = Math.max(expectedCount, epPages.length, 1);
    const fallbackImgs = [
      comic.coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg',
      '/src/assets/images/comic_cover_mystic_1794269871981.jpg',
      '/src/assets/images/comic_cover_cyber_1794269871978.jpg',
      '/src/assets/images/comic_cover_chronicles_1794269872270.jpg',
      '/src/assets/images/comic_cover_romance_1794269872268.jpg',
      '/src/assets/images/hero_banner_manga_1794269871419.jpg',
    ];

    return Array.from({ length: totalNeeded }, (_, idx) => {
      if (epPages[idx]) return epPages[idx];
      return {
        id: `p_${comic.id}_${idx + 1}`,
        pageNumber: idx + 1,
        imageUrl: fallbackImgs[idx % fallbackImgs.length],
        caption:
          idx === 0 && comic.attachedFileName
            ? `Page 1 — ${comic.attachedFileName} (Cover / Opening Panel)`
            : `Page ${idx + 1} — Attached Comic Artwork ${idx + 1}`,
      };
    });
  };

  // Admin approves or rejects author's submitted comic
  const handleModerateComicSubmission = async (
    comicId: string,
    action: 'approve' | 'reject' | 'pending',
    customNote?: string
  ) => {
    const resolvedNote = (
      customNote !== undefined
        ? customNote
        : comicReviewNotes[comicId] !== undefined
          ? comicReviewNotes[comicId]
          : comicReviewNote
    ).trim();

    if (action === 'reject' && !resolvedNote) {
      setComicRejectErrorId(comicId);
      const inputEl = document.getElementById(`admin-reject-note-${comicId}`);
      if (inputEl) {
        inputEl.focus();
      }
      return;
    }

    await runRowAction(`comic-${comicId}-${action}`, async () => {
      try {
        setComicRejectErrorId(null);
        const res = await fetch(`/api/admin/comics/${comicId}/moderate-submission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, adminNote: resolvedNote }),
        });

        const data = await res.json();
        if (res.ok) {
          setActionMessage(data.message);
          setComicReviewNote('');
          setComicReviewNotes(prev => {
            const next = { ...prev };
            delete next[comicId];
            return next;
          });
          if (previewQueueComic?.id === comicId) {
            setPreviewQueueComic(null);
          }
          onRefreshComics();
          fetchAdminData();
          setTimeout(() => setActionMessage(null), 6000);
        }
      } catch (err) {
        console.error(err);
      }
    });
  };

  // Pure helper: mirror server-side comic/chapter/episode paywall reconciliation locally for 0ms UI feedback
  const applyPaywallToggleLocally = (
    comic: Comic,
    params: { chapterId?: string; episodeId?: string; isPremium: boolean }
  ): Comic => {
    const nextPremium = Boolean(params.isPremium);
    const wasComicPremium = comic.accessType === 'premium';

    const clonedChapters = (comic.chapters || []).map((ch) => ({
      ...ch,
      episodes: (ch.episodes || []).map((ep) => ({ ...ep })),
    }));

    const recomputeParents = () => {
      if (clonedChapters.length === 0) {
        return nextPremium ? ('premium' as const) : ('free' as const);
      }
      clonedChapters.forEach((chItem) => {
        if (chItem.episodes.length > 0) {
          chItem.isPremium = chItem.episodes.every((epItem) => Boolean(epItem.isPremium));
          chItem.priceInr = 0;
        }
      });
      const allPremium = clonedChapters.every(
        (chItem) =>
          Boolean(chItem.isPremium) &&
          (chItem.episodes.length === 0 || chItem.episodes.every((epItem) => Boolean(epItem.isPremium)))
      );
      return allPremium ? ('premium' as const) : ('free' as const);
    };

    let nextAccessType: 'free' | 'premium' = comic.accessType;

    if (params.episodeId) {
      for (const ch of clonedChapters) {
        const ep = ch.episodes.find((e) => e.id === params.episodeId);
        if (ep) {
          if (!nextPremium && (wasComicPremium || ch.isPremium)) {
            clonedChapters.forEach((otherCh) => {
              if (wasComicPremium || otherCh.isPremium) {
                otherCh.isPremium = true;
                otherCh.priceInr = 0;
                otherCh.episodes.forEach((otherEp) => {
                  otherEp.isPremium = true;
                  otherEp.priceInr = 0;
                });
              }
            });
          }
          ep.isPremium = nextPremium;
          ep.priceInr = 0;
          nextAccessType = recomputeParents();
          break;
        }
      }
    } else if (params.chapterId) {
      const ch = clonedChapters.find((x) => x.id === params.chapterId);
      if (ch) {
        if (!nextPremium && wasComicPremium) {
          clonedChapters.forEach((otherCh) => {
            if (otherCh.id !== params.chapterId) {
              otherCh.isPremium = true;
              otherCh.priceInr = 0;
              otherCh.episodes.forEach((otherEp) => {
                otherEp.isPremium = true;
                otherEp.priceInr = 0;
              });
            }
          });
        }
        ch.isPremium = nextPremium;
        ch.priceInr = 0;
        ch.episodes.forEach((ep) => {
          ep.isPremium = nextPremium;
          ep.priceInr = 0;
        });
        nextAccessType = recomputeParents();
      }
    } else {
      nextAccessType = nextPremium ? 'premium' : 'free';
      clonedChapters.forEach((ch) => {
        ch.isPremium = nextPremium;
        ch.priceInr = 0;
        ch.episodes.forEach((ep) => {
          ep.isPremium = nextPremium;
          ep.priceInr = 0;
        });
      });
    }

    return {
      ...comic,
      accessType: nextAccessType,
      fullPriceInr: 0,
      chapters: clonedChapters,
      updatedAt: new Date().toISOString(),
    };
  };

  // Merge compact server paywallState response into existing comic without dropping page images
  const mergeServerPaywallState = (
    comic: Comic,
    paywallState: {
      accessType: 'free' | 'premium';
      fullPriceInr?: number;
      updatedAt?: string;
      chapters?: Array<{
        id: string;
        isPremium: boolean;
        priceInr?: number;
        episodes?: Array<{ id: string; isPremium: boolean; priceInr?: number }>;
      }>;
    }
  ): Comic => {
    const chMap = new Map((paywallState.chapters || []).map((ch) => [ch.id, ch]));
    return {
      ...comic,
      accessType: paywallState.accessType,
      fullPriceInr: Number(paywallState.fullPriceInr) || 0,
      updatedAt: paywallState.updatedAt || comic.updatedAt,
      chapters: (comic.chapters || []).map((ch) => {
        const srvCh = chMap.get(ch.id);
        if (!srvCh) return ch;
        const epMap = new Map((srvCh.episodes || []).map((ep) => [ep.id, ep]));
        return {
          ...ch,
          isPremium: Boolean(srvCh.isPremium),
          priceInr: Number(srvCh.priceInr) || 0,
          episodes: (ch.episodes || []).map((ep) => {
            const srvEp = epMap.get(ep.id);
            if (!srvEp) return ep;
            return {
              ...ep,
              isPremium: Boolean(srvEp.isPremium),
              priceInr: Number(srvEp.priceInr) || 0,
            };
          }),
        };
      }),
    };
  };

  const showTransientActionMessage = (msg: string, durationMs = 3500) => {
    setActionMessage(msg);
    if (actionMessageTimerRef.current) {
      window.clearTimeout(actionMessageTimerRef.current);
    }
    actionMessageTimerRef.current = window.setTimeout(() => {
      setActionMessage(null);
      actionMessageTimerRef.current = null;
    }, durationMs);
  };

  // Toggle Paywall for Comic, Chapter, or Episode — instant optimistic UI + ordered per-comic queue (zero lag, zero race overwrites)
  const handleTogglePaywall = (params: {
    comicId: string;
    chapterId?: string;
    episodeId?: string;
    isPremium: boolean;
    priceInr?: number;
  }) => {
    const targetKey = params.episodeId
      ? `ep:${params.episodeId}`
      : params.chapterId
        ? `ch:${params.chapterId}`
        : `comic:${params.comicId}`;

    // Guard against double-click on the exact same control while in flight
    if (paywallBusyKeys[targetKey]) return;

    const nextSeq = (paywallSeqRef.current[params.comicId] || 0) + 1;
    paywallSeqRef.current[params.comicId] = nextSeq;

    // 1. Capture rollback snapshot & apply optimistic update immediately (0ms perceived lag)
    const rollbackComic = allComicsWithPending.find((c) => c.id === params.comicId) || null;
    setAllComicsWithPending((prev) =>
      prev.map((c) => (c.id === params.comicId ? applyPaywallToggleLocally(c, params) : c))
    );
    onPatchComicLocal?.(params.comicId, (c) => applyPaywallToggleLocally(c, params));
    setPaywallBusyKeys((prev) => ({ ...prev, [targetKey]: true }));

    // 2. Serialize network calls per comic so rapid clicks (e.g. Ep 1 -> Ep 2 -> Ep 3) execute in strict order
    const prevChain = paywallQueueRef.current[params.comicId] || Promise.resolve();
    const run = async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/admin/paywall-toggle', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            comicId: params.comicId,
            chapterId: params.chapterId,
            episodeId: params.episodeId,
            isPremium: params.isPremium,
            priceInr: 0,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.paywallState) {
          // Only reconcile from server response if this is still the latest mutation for this comic
          if (paywallSeqRef.current[params.comicId] === nextSeq) {
            setAllComicsWithPending((prev) =>
              prev.map((c) => (c.id === params.comicId ? mergeServerPaywallState(c, data.paywallState) : c))
            );
            onPatchComicLocal?.(params.comicId, (c) => mergeServerPaywallState(c, data.paywallState));
          }
          if (data.message) {
            showTransientActionMessage(data.message);
          }
        } else {
          // Roll back only if no newer optimistic update superseded this one
          if (rollbackComic && paywallSeqRef.current[params.comicId] === nextSeq) {
            const snap = rollbackComic;
            setAllComicsWithPending((prev) => prev.map((c) => (c.id === params.comicId ? snap : c)));
            onPatchComicLocal?.(params.comicId, () => snap);
          }
          showTransientActionMessage(data.error || 'Failed to update paywall status. Please retry.', 5000);
        }
      } catch (err) {
        console.error('Paywall toggle error:', err);
        if (rollbackComic && paywallSeqRef.current[params.comicId] === nextSeq) {
          const snap = rollbackComic;
          setAllComicsWithPending((prev) => prev.map((c) => (c.id === params.comicId ? snap : c)));
          onPatchComicLocal?.(params.comicId, () => snap);
        }
        showTransientActionMessage('Network error while updating paywall status. Please retry.', 5000);
      } finally {
        setPaywallBusyKeys((prev) => {
          if (!prev[targetKey]) return prev;
          const next = { ...prev };
          delete next[targetKey];
          return next;
        });
      }
    };

    paywallQueueRef.current[params.comicId] = prevChain.then(run, run);
  };

  // Author Application Approval / Rejection / Reset to Pending
  const handleAppAction = async (appId: string, action: 'approve' | 'reject' | 'pending') => {
    await runRowAction(`app-${appId}-${action}`, async () => {
      try {
        const res = await fetch(`/api/admin/author-applications/${appId}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, adminNote: reviewNote }),
        });
        if (res.ok) {
          setReviewNote('');
          setActionMessage(
            action === 'approve'
              ? 'Author application approved!'
              : action === 'reject'
                ? 'Author application rejected.'
                : 'Author application set back to Pending Approval.'
          );
          fetchAdminData();
          setTimeout(() => setActionMessage(null), 4000);
        }
      } catch (err) {
        console.error(err);
      }
    });
  };

  // Refund & GST Credit Note
  const handleRefund = async (txId: string) => {
    try {
      const res = await fetch(`/api/admin/transactions/${txId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Admin issued refund and GST Credit Note' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setActionMessage(
          data.creditNote
            ? `Transaction refunded and GST Credit Note ${data.creditNote.creditNoteNumber} issued.`
            : 'Transaction refunded and GST Credit Note recorded.'
        );
        fetchAdminData();
        setTimeout(() => setActionMessage(null), 5000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Save GST Business Settings
  const handleSaveGstSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setGstMessage(null);
    const check = validateIndianGstin(gstSettings.gstin || '');
    if (!check.isValid) {
      setGstMessage({
        type: 'error',
        text: check.error || 'Invalid 15-character GSTIN format. Leave blank if not yet registered.',
      });
      return;
    }

    setGstSaving(true);
    try {
      const res = await fetch('/api/admin/gst/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...gstSettings,
          gstin: check.normalized,
        }),
      });
      const data = await res.json();
      setGstSaving(false);
      if (!res.ok) {
        setGstMessage({ type: 'error', text: data.error || 'Failed to save GST settings.' });
        return;
      }
      if (data.gstSettings) {
        setGstSettings(data.gstSettings);
        await syncGstSettingsToFirestore(data.gstSettings).catch(() => {});
      }
      setGstMessage({
        type: 'success',
        text: 'GST Business Settings saved to backend database & synced to Firebase Firestore. Historical invoices remain preserved.',
      });
      fetchAdminData();
    } catch (err: any) {
      setGstSaving(false);
      setGstMessage({ type: 'error', text: err.message || 'Network error while saving GST settings.' });
    }
  };

  // One-click Toggle for Customer-Side GST Billing (ON / OFF)
  const handleToggleCustomerGstBilling = async (nextEnabled?: boolean) => {
    const targetEnabled =
      typeof nextEnabled === 'boolean' ? nextEnabled : !gstSettings.applyGstToDomesticSales;
    setGstSaving(true);
    setGstMessage(null);
    const updatedPayload: GstBusinessSettings = {
      ...gstSettings,
      applyGstToDomesticSales: targetEnabled,
    };
    setGstSettings(updatedPayload);
    try {
      const res = await fetch('/api/admin/gst/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPayload),
      });
      const data = await res.json().catch(() => ({}));
      setGstSaving(false);
      if (res.ok && data.gstSettings) {
        setGstSettings(data.gstSettings);
        await syncGstSettingsToFirestore(data.gstSettings).catch(() => {});
        setGstMessage({
          type: 'success',
          text: targetEnabled
            ? 'Customer GST Billing TURNED ON: Customers will now see 18% GST breakdown at checkout and receive GST Tax Invoices.'
            : 'Customer GST Billing TURNED OFF: All GST amounts, GST percentages, and GST tax documents are now hidden from the customer checkout and customer receipts (receipts will show No GST).',
        });
        fetchAdminData();
      } else {
        setGstMessage({
          type: 'error',
          text: data.error || 'Failed to update Customer GST Billing mode.',
        });
      }
    } catch (err: any) {
      setGstSaving(false);
      setGstMessage({
        type: 'error',
        text: err.message || 'Network error while toggling Customer GST Billing.',
      });
    }
  };

  // Download Single PDF Tax Invoice, Non-GST Payment Receipt, or Credit Note
  const handleDownloadPdfBill = (tx: Purchase, creditNote?: CreditNoteRecord) => {
    try {
      const enriched = ensurePurchaseGstFields(tx, gstSettings);
      const pdfBytes = generateTaxInvoicePdfBytes(enriched, gstSettings, creditNote);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = creditNote
        ? `GST-Credit-Note-${creditNote.creditNoteNumber}.pdf`
        : gstSettings.applyGstToDomesticSales === false
          ? `Payment-Receipt-No-GST-${enriched.receiptNumber}.pdf`
          : `GST-Tax-Invoice-${enriched.invoiceNumber || enriched.receiptNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      console.error('Error generating PDF bill:', e);
    }
  };

  // Download Current IST Month Scoped Activity Logs (Admin Panel + ₹49/₹249 Payments) as CSV or JSON
  const handleDownloadActivityLogs = async (format: 'csv' | 'json' = 'csv') => {
    if (isDownloadingMonthLogs) return;
    setIsDownloadingMonthLogs(format);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/logs?scope=month', { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showTransientActionMessage(errData?.error || 'Unable to fetch current month logs. Please re-verify Admin session.');
        return;
      }
      const data = await res.json();
      const monthLogs: ActivityLog[] = Array.isArray(data?.logs) ? data.logs : [];
      const monthKey = String(data?.currentIstMonthKey || activityLogMeta?.currentIstMonthKey || new Date().toISOString().slice(0, 7));
      const monthLabel = String(data?.currentIstMonthLabel || activityLogMeta?.currentIstMonthLabel || monthKey);

      if (monthLogs.length === 0) {
        showTransientActionMessage(`No Admin Panel or ₹49 / ₹249 payment logs are stored for ${monthLabel} yet.`);
        return;
      }

      if (format === 'json') {
        const payload = {
          platform: 'Aathirai Comic',
          scope: 'current_ist_month',
          istMonthKey: monthKey,
          istMonthLabel: monthLabel,
          exportedAt: new Date().toISOString(),
          policy: 'Admin Panel actions and verified ₹49 / ₹249 customer payments only',
          summary: {
            totalLogs: monthLogs.length,
            adminActions: Number(data?.adminActionsMonthCount ?? 0),
            payments49Count: Number(data?.payments49MonthCount ?? 0),
            payments249Count: Number(data?.payments249MonthCount ?? 0),
            totalRevenueInr: Number(data?.totalRevenueMonthInr ?? 0),
          },
          logs: monthLogs,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Aathirai_Comic_Activity_Logs_${monthKey}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showTransientActionMessage(`Downloaded ${monthLogs.length} current-month log entries for ${monthLabel} (JSON).`);
        return;
      }

      const escapeCsv = (value: unknown) => {
        let str = String(value ?? '').replace(/\r?\n/g, ' ');
        if (/^[=+\-@\t\r]/.test(str)) {
          str = `'${str}`;
        }
        if (/[",\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvHeaders = [
        'Log ID',
        'Category',
        'Amount (INR)',
        'IST Date',
        'IST Month',
        'Timestamp (ISO)',
        'Timestamp (IST)',
        'Action',
        'Actor Email',
        'Details',
      ];

      const rows = monthLogs.map((log) => {
        const categoryLabel =
          log.category === 'payment_249'
            ? 'Customer Payment (₹249)'
            : log.category === 'payment_49'
              ? 'Customer Payment (₹49)'
              : 'Admin Panel';
        const istTimeStr = log.timestamp
          ? new Date(log.timestamp).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: 'short',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true,
            })
          : '';
        return [
          log.id,
          categoryLabel,
          log.amountInr ?? '',
          log.istDayKey || '',
          log.istMonthKey || monthKey,
          log.timestamp,
          istTimeStr,
          log.action,
          log.actorEmail,
          log.details,
        ];
      });

      const csvContent =
        '\uFEFF' +
        [csvHeaders.map(escapeCsv).join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Aathirai_Comic_Activity_Logs_${monthKey}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      showTransientActionMessage(`Downloaded ${monthLogs.length} current-month log entries for ${monthLabel} (CSV).`);
    } catch {
      showTransientActionMessage('Network error while exporting current month activity logs.');
    } finally {
      setIsDownloadingMonthLogs(null);
    }
  };

  // Manual Month-End Archive: Emails CSV + JSON strictly to Protected Backend Admin Gmail & clears backend only after confirmed delivery
  const handleManualArchiveMonthLogs = async () => {
    if (isArchivingLogs) return;
    setIsArchivingLogs(true);
    setArchiveLogsFeedback(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/logs/archive-now', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          monthKey: activityLogMeta?.currentIstMonthKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        setArchiveLogsFeedback({
          type: 'error',
          text:
            data?.error ||
            'Unable to email the monthly archive right now. All backend logs were safely preserved and will retry automatically.',
        });
        setShowArchiveLogsModal(false);
        await fetchActivityLogs();
        return;
      }

      const successText =
        data?.message ||
        `Emailed ${data?.archivedCount ?? 0} logs (CSV + JSON) to Protected Backend Admin Gmail and cleared backend storage.`;
      setArchiveLogsFeedback({ type: 'success', text: successText });
      showTransientActionMessage(successText);
      setShowArchiveLogsModal(false);
      await fetchActivityLogs();
    } catch {
      setArchiveLogsFeedback({
        type: 'error',
        text: 'Network error while emailing monthly archive. All backend logs remain safely preserved.',
      });
      setShowArchiveLogsModal(false);
    } finally {
      setIsArchivingLogs(false);
    }
  };

  // Send a non-destructive sample archive email (CSV + JSON) to Protected Backend Admin Gmail
  const handleSendSampleLogEmail = async () => {
    if (isSendingSampleLogEmail) return;
    setIsSendingSampleLogEmail(true);
    setArchiveLogsFeedback(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/logs/send-sample-email', {
        method: 'POST',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setArchiveLogsFeedback({
          type: 'error',
          text: data?.error || 'Unable to deliver sample archive email. Check SMTP configuration.',
        });
        return;
      }
      const msg =
        data?.message ||
        'Sample monthly archive email (CSV + JSON) delivered to Protected Backend Admin Gmail.';
      setArchiveLogsFeedback({ type: 'success', text: msg });
      showTransientActionMessage(msg);
    } catch {
      setArchiveLogsFeedback({
        type: 'error',
        text: 'Network error while sending sample archive email.',
      });
    } finally {
      setIsSendingSampleLogEmail(false);
    }
  };

  // Customer Tracker Lookup by Registered Gmail or Mobile Number
  const handleTrackCustomer = async (overrideQuery?: string) => {
    const q = (overrideQuery !== undefined ? overrideQuery : customerTrackQuery).trim();
    if (!q) {
      setCustomerTrackError('Enter a customer registered Gmail address or mobile number to track their profile.');
      return;
    }
    setCustomerTrackLoading(true);
    setCustomerTrackError(null);
    setConfirmDeleteTrackedId(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/customers/track?q=${encodeURIComponent(q)}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCustomerTrackError(data?.error || 'Unable to look up customer profile right now.');
        return;
      }
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      setCustomerTrackMatches(matches);
      setCustomerTrackHasSearched(true);
      setCustomerTrackLastQuery(q);
      if (data?.summary) {
        setCustomerTrackSummary(data.summary);
      }
      setSelectedTrackedCustomerId((prev) => {
        if (prev && matches.some((m: any) => m.id === prev)) return prev;
        return matches[0]?.id || null;
      });
    } catch {
      setCustomerTrackError('Network error while looking up customer profile.');
    } finally {
      setCustomerTrackLoading(false);
    }
  };

  const handleTrackedCustomerUpdate = async (
    customerId: string,
    payload: Record<string, any>,
    successMsg: string
  ) => {
    await runRowAction(`track-upd-${customerId}-${JSON.stringify(payload)}`, async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/admin/readers/${customerId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setCustomerTrackError(data?.error || 'Unable to update customer profile.');
          return;
        }
        showTransientActionMessage(successMsg);
        await fetchAdminData();
        if (customerTrackLastQuery) {
          await handleTrackCustomer(customerTrackLastQuery);
        }
      } catch {
        setCustomerTrackError('Network error while updating customer profile.');
      }
    });
  };

  const handleTrackedCustomerDelete = async (customerId: string) => {
    await runRowAction(`track-del-${customerId}`, async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/admin/readers/${customerId}`, {
          method: 'DELETE',
          headers,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setCustomerTrackError(data?.error || 'Unable to delete customer account.');
          return;
        }
        setConfirmDeleteTrackedId(null);
        showTransientActionMessage('Customer account removed from database.');
        await fetchAdminData();
        if (customerTrackLastQuery) {
          await handleTrackCustomer(customerTrackLastQuery);
        }
      } catch {
        setCustomerTrackError('Network error while deleting customer account.');
      }
    });
  };

  // Download GST Sales & Tax Reconciliation CSV (works even if 0 bills / Nil Return month)
  const handleExportGstCsv = (periodOverride?: string) => {
    const targetPeriod =
      typeof periodOverride === 'string' && periodOverride.trim()
        ? periodOverride.trim()
        : gstPeriodFilter;
    const periodDetails = getGstPeriodDetails(targetPeriod);
    const csvContent = generateGstReconciliationCsv(
      transactions,
      creditNotes,
      gstSettings,
      targetPeriod
    );
    const periodSummary = computeGstPeriodSummary(
      transactions,
      creditNotes,
      gstSettings,
      targetPeriod
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Aathirai_Comic_GST_Statement_${periodDetails.fileSlug}${periodSummary.totalInvoices === 0 ? '_NIL_RETURN' : ''}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setGstMessage({
      type: 'success',
      text:
        periodSummary.totalInvoices === 0
          ? `Downloaded Nil-Return Monthly GST Statement CSV for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel} · Return Period ${periodDetails.periodCode} · 0 Bills — ₹0.00 Tax Liability).`
          : `Downloaded Monthly GST Sales & Tax Reconciliation CSV for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel} · ${periodSummary.totalInvoices} Bills).`,
    });
  };

  // Download GSTR-1 Offline Utility JSON (works even if 0 bills / Nil Return month)
  const handleExportGstr1Json = (periodOverride?: string) => {
    const targetPeriod =
      typeof periodOverride === 'string' && periodOverride.trim()
        ? periodOverride.trim()
        : gstPeriodFilter;
    const periodDetails = getGstPeriodDetails(targetPeriod);
    const periodSummary = computeGstPeriodSummary(
      transactions,
      creditNotes,
      gstSettings,
      targetPeriod
    );
    const gstr1Obj = generateGstr1OfflineJson(
      transactions,
      creditNotes,
      gstSettings,
      targetPeriod,
      true
    );
    const jsonString = JSON.stringify(gstr1Obj, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeGstinTag = (gstSettings.gstin || '').trim() || 'UNREGISTERED';
    link.download = `GSTR1_${safeGstinTag}_${periodDetails.fileSlug}${periodSummary.totalInvoices === 0 ? '_NIL_RETURN' : ''}_OfflineUtility.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setGstMessage({
      type: 'success',
      text:
        periodSummary.totalInvoices === 0
          ? `Downloaded Nil-Return GSTR-1 JSON for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel} · Period ${gstr1Obj.fp} · 0 Bills). ${!gstSettings.gstin ? 'Remember to save your 15-digit Seller GSTIN before uploading to services.gst.gov.in.' : 'Ready for Nil Return upload on services.gst.gov.in.'}`
          : `Downloaded GSTR-1 JSON for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel} · Period ${gstr1Obj.fp}) compatible with the GST Portal Offline Utility (v3.1.6).`,
    });
  };

  // Download Monthly GST Statement Summary PDF (works even if 0 bills / Nil Return month)
  const handleExportMonthlyStatementPdf = (periodOverride?: string) => {
    const targetPeriod =
      typeof periodOverride === 'string' && periodOverride.trim()
        ? periodOverride.trim()
        : gstPeriodFilter;
    const periodDetails = getGstPeriodDetails(targetPeriod);
    try {
      const periodSummary = computeGstPeriodSummary(
        transactions,
        creditNotes,
        gstSettings,
        targetPeriod
      );
      const pdfBytes = generateMonthlyGstStatementPdfBytes(
        transactions,
        creditNotes,
        gstSettings,
        targetPeriod
      );
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Aathirai_Comic_GST_Statement_${periodDetails.fileSlug}${periodSummary.totalInvoices === 0 ? '_NIL_RETURN' : ''}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setGstMessage({
        type: 'success',
        text:
          periodSummary.totalInvoices === 0
            ? `Downloaded Nil-Return Monthly GST Statement PDF for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel} · Return Period ${periodDetails.periodCode} · 0 Bills Recorded — ₹0.00 GST Payable).`
            : `Downloaded Monthly GST Filing Statement PDF for ${periodDetails.monthYearLabel} (${periodDetails.dateRangeLabel} · ${periodSummary.totalInvoices} Bills).`,
      });
    } catch (e: any) {
      setGstMessage({
        type: 'error',
        text: e?.message || 'Failed to generate Monthly GST Statement PDF.',
      });
    }
  };

  const gstLiveValidation = useMemo(
    () => validateIndianGstin(gstSettings.gstin || ''),
    [gstSettings.gstin]
  );

  const gstPeriodSummary = useMemo(
    () => computeGstPeriodSummary(transactions, creditNotes, gstSettings, gstPeriodFilter),
    [transactions, creditNotes, gstSettings, gstPeriodFilter]
  );

  const gstExportValidation = useMemo(
    () => validateGstExportData(transactions, creditNotes, gstSettings, gstPeriodFilter, false),
    [transactions, creditNotes, gstSettings, gstPeriodFilter]
  );

  // Delete Comic
  const handleDeleteComic = async (comicId: string) => {
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
        setActionMessage('Platform commercial settings saved successfully!');
        fetchAdminData();
        setTimeout(() => setActionMessage(null), 4000);
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

  // IF ADMIN IS LOCKED: Render Unified Dual-OTP Authentication Security Gate (Gmail + Mobile SMS)
  if (!isAdminUnlocked) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4 space-y-6 animate-fade-in">
        {/* Navigation back to main site */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCurrentTab('home')}
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 font-semibold transition-colors cursor-pointer"
          >
            <span>← Return to Aathirai_Comic Website</span>
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>
            <span className="text-[11px] font-mono text-slate-400">admin.com</span>
          </div>
        </div>

        {/* Security Shield Card */}
        <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl relative overflow-hidden">
          {/* Ambient security gradient header */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500" />
          
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 inline-block mb-1">
                Restricted Terminal · Dual-OTP Security
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white font-heading">
                Admin Authentication Gate
              </h2>
            </div>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
            Administrator access requires simultaneous Dual-OTP verification. Both your backend-registered Admin Gmail and Mobile Number must match before Gmail and Mobile SMS verification codes are dispatched.
          </p>

          <DualOtpSecurityPanel
            purpose="admin_login"
            recaptchaContainerId="firebase-recaptcha-admin"
            onVerified={handleAdminDualOtpVerified}
          />
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
                aria-busy={isDeletingComic}
                data-loading={isDeletingComic ? 'true' : 'false'}
                onClick={handleConfirmDeleteComic}
                className={processingClass(
                  isDeletingComic,
                  'py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-rose-600/20 transition-all cursor-pointer'
                )}
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
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          </button>

          <button
            onClick={() => {
              handleLockAdminConsole();
              setCurrentTab('home');
            }}
            className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Exit Admin Console, lock session, and return to main website"
          >
            <Globe2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exit to Website</span>
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
          { id: 'customer-tracker', label: 'Customer Tracker' },
          { id: 'my-comics-episodes-upload', label: 'My Comic & Episode / Upload New Comic' },
          { id: 'comic-queue', label: `Comic Approvals Queue (${pendingComics.length})` },
          { id: 'delete-requests', label: `🗑️ Delete Requests (${deleteRequests.filter(r => r.status === 'pending').length})` },
          { id: 'ad-requests', label: `📢 Ad Requests (${adRequests.length})` },
          { id: 'comics', label: 'Paywall & Catalog Moderation' },
          { id: 'gst-billing', label: '🧾 GST & Billing' },
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
              const nextTab = t.id as any;
              if (nextTab === 'logs') {
                if (activeTab === 'logs' && isAdminUnlocked) {
                  void fetchActivityLogs();
                } else {
                  setActiveTab('logs');
                }
                return;
              }
              setActiveTab(nextTab);
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Total Users
              </span>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-mono mt-1">
                {stats.totalUsers}
              </div>
              <span className="text-[10px] text-slate-400">Registered readers</span>
            </div>

            <div
              onClick={() => setActiveTab('comic-queue')}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-500 transition-colors cursor-pointer shadow-sm"
            >
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Comics Awaiting Approval
              </span>
              <div className="text-2xl font-black text-amber-500 font-mono mt-1">
                {pendingComics.length}
              </div>
              <span className="text-[10px] text-amber-500 font-semibold">Submissions Queue →</span>
            </div>

            <div
              onClick={() => setActiveTab('delete-requests')}
              className="p-4 rounded-2xl bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/30 hover:border-rose-500 transition-colors cursor-pointer shadow-sm"
            >
              <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">
                Author Delete Requests
              </span>
              <div className="text-2xl font-black text-rose-500 font-mono mt-1">
                {deleteRequests.filter(r => r.status === 'pending').length}
              </div>
              <span className="text-[10px] text-rose-500 font-semibold">Review &amp; Delete →</span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <div
              onClick={() => setActiveTab('my-comics-episodes-upload')}
              className="p-6 rounded-2xl bg-gradient-to-tr from-rose-500/10 to-amber-500/10 border border-rose-500/30 hover:border-rose-500 transition-all cursor-pointer space-y-2 group"
            >
              <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold">
                <Upload className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-rose-500">
                My Comic &amp; Episode / Upload New Comic
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Manage chapters, upload episodes with artwork photos, choose cover pages, and create new series.
              </p>
            </div>

            <div
              onClick={() => setActiveTab('delete-requests')}
              className="p-6 rounded-2xl bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/40 hover:border-rose-500 transition-all cursor-pointer space-y-2 group"
            >
              <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-rose-500">
                Author Delete Requests ({deleteRequests.filter(r => r.status === 'pending').length})
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Only Admin can permanently delete uploaded comics, chapters, or episodes requested by authors.
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

          {/* Live Author Delete Requests Feed on Overview Screen */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-rose-500/30 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 mb-1">
                  <Trash2 className="w-3 h-3" />
                  <span>Author Delete Requests Queue ({deleteRequests.filter(r => r.status === 'pending').length} Pending)</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                  Pending Author Deletion Requests (Admin Approval Required)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Authors cannot delete uploaded comics, chapters, or episodes directly. Approve below to permanently remove from the platform.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchAdminData}
                  className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('delete-requests')}
                  className="py-2 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Open Full Delete Queue ({deleteRequests.filter(r => r.status === 'pending').length})
                </button>
              </div>
            </div>

            {deleteRequests.filter(r => r.status === 'pending').length === 0 ? (
              <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 font-semibold">No pending author deletion requests right now.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {deleteRequests
                  .filter(r => r.status === 'pending')
                  .map((req) => (
                    <div
                      key={req.id}
                      className="p-4 rounded-xl bg-rose-50/30 dark:bg-rose-950/15 border border-rose-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {req.comicCover ? (
                          <img
                            src={req.comicCover}
                            alt={req.comicTitle}
                            className="w-12 h-16 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-slate-800"
                          />
                        ) : (
                          <div className="w-12 h-16 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-rose-500 shrink-0">
                            <Trash2 className="w-5 h-5" />
                          </div>
                        )}
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-sm text-slate-900 dark:text-white font-heading">
                              {req.comicTitle}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-500 border border-rose-500/30">
                              Delete {req.targetType === 'series' ? 'Uploaded Comic Series' : req.targetType}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Requested by {req.authorName}
                            </span>
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
                          {req.reason && (
                            <p className="text-xs text-slate-600 dark:text-slate-300 italic">
                              &ldquo;{req.reason}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isRowActionLoading(`del-${req.id}-approve`) || isRowActionLoading(`del-${req.id}-reject`)}
                          aria-busy={isRowActionLoading(`del-${req.id}-approve`)}
                          data-loading={isRowActionLoading(`del-${req.id}-approve`) ? 'true' : 'false'}
                          onClick={() => handleModerateDeleteRequest(req.id, 'approve')}
                          className={processingClass(
                            isRowActionLoading(`del-${req.id}-approve`),
                            'py-2 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs shadow-md transition-colors cursor-pointer flex items-center gap-1.5'
                          )}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{isRowActionLoading(`del-${req.id}-approve`) ? 'Deleting...' : 'Approve & Delete'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={isRowActionLoading(`del-${req.id}-approve`) || isRowActionLoading(`del-${req.id}-reject`)}
                          aria-busy={isRowActionLoading(`del-${req.id}-reject`)}
                          data-loading={isRowActionLoading(`del-${req.id}-reject`) ? 'true' : 'false'}
                          onClick={() => handleModerateDeleteRequest(req.id, 'reject')}
                          className={processingClass(
                            isRowActionLoading(`del-${req.id}-reject`),
                            'py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-xs transition-colors cursor-pointer flex items-center gap-1'
                          )}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{isRowActionLoading(`del-${req.id}-reject`) ? 'Rejecting...' : 'Reject'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* TAB 1B: CUSTOMER TRACKER */}
      {activeTab === 'customer-tracker' && (() => {
        const nonAdminReaders = readerAccounts.filter((r: any) => r.role !== 'admin' && !r.isImmutableAdmin);
        const totalCustomers = customerTrackSummary?.totalCustomers ?? nonAdminReaders.length;
        const activePlanCustomers =
          customerTrackSummary?.activePlanCustomers ??
          nonAdminReaders.filter((r: any) => r.subscription?.hasActiveSubscription || r.hasActiveSubscription).length;
        const freeCustomers =
          customerTrackSummary?.freeCustomers ?? Math.max(0, totalCustomers - activePlanCustomers);

        const selectedCustomer =
          customerTrackMatches.find((m: any) => m.id === selectedTrackedCustomerId) ||
          customerTrackMatches[0] ||
          null;

        const formatIstDateTime = (iso?: string | null) => {
          if (!iso) return 'Not recorded';
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return String(iso);
          return `${d.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })} IST`;
        };

        return (
          <div className="space-y-6">
            {/* Header & Cloud Sync Action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                  Customer Tracker
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Enter a customer&apos;s registered Gmail address or mobile number to inspect profile creation date, ongoing plan, and payment status.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  disabled={isSyncingFirestore}
                  aria-busy={isSyncingFirestore}
                  data-loading={isSyncingFirestore ? 'true' : 'false'}
                  onClick={async () => {
                    setIsSyncingFirestore(true);
                    try {
                      const headers = await getAuthHeaders();
                      const res = await syncAllPlatformDataToFirestore({
                        readers: readerAccounts,
                        comics: allComicsWithPending.length > 0 ? allComicsWithPending : comics,
                        purchases: transactions,
                        authorApplications: applications,
                        deleteRequests,
                        gstSettings,
                        platformSettings: settings,
                      });
                      await fetch('/api/admin/firestore/sync', {
                        method: 'POST',
                        headers,
                      }).catch(() => null);
                      showTransientActionMessage(
                        `Synced to Firebase Firestore (${firebaseConfig.projectId}): ${res?.syncedReaders || 0} customers, ${res?.syncedPurchases || 0} payments.`
                      );
                      fetchAdminData();
                    } catch (e: any) {
                      showTransientActionMessage(
                        `Firestore sync notice: ${e?.message || 'Sign in with your registered Admin account to sync.'}`
                      );
                    } finally {
                      setIsSyncingFirestore(false);
                    }
                  }}
                  className={processingClass(
                    isSyncingFirestore,
                    'py-2 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap'
                  )}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isSyncingFirestore ? 'Syncing Cloud...' : 'Sync Firestore'}</span>
                </button>
              </div>
            </div>

            {/* Compact 3-Metric Customer Summary Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500">Registered Customers</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                  {totalCustomers}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Cloud DB: {firestoreStatus?.connected ? 'Connected' : 'Ready'}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500">Ongoing Paid Plans</div>
                <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                  {activePlanCustomers}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">Active ₹49 / ₹249 passes</div>
              </div>
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500">Free / Unpaid Accounts</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                  {freeCustomers}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">No active subscription</div>
              </div>
            </div>

            {/* Lookup Form: Registered Gmail or Mobile Number */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleTrackCustomer();
              }}
              className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <label
                htmlFor="customer-tracker-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                Search by Registered Gmail or Mobile Number
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="customer-tracker-input"
                    type="text"
                    value={customerTrackQuery}
                    onChange={(e) => {
                      setCustomerTrackQuery(e.target.value);
                      if (customerTrackError) setCustomerTrackError(null);
                    }}
                    placeholder="Enter customer Gmail (e.g. reader@gmail.com) or mobile number (e.g. +91 9876543210)"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={customerTrackLoading}
                  aria-busy={customerTrackLoading}
                  data-loading={customerTrackLoading ? 'true' : 'false'}
                  className={processingClass(
                    customerTrackLoading,
                    'py-2.5 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0'
                  )}
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{customerTrackLoading ? 'Searching...' : 'Track Customer'}</span>
                </button>
                {(customerTrackQuery || customerTrackHasSearched) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerTrackQuery('');
                      setCustomerTrackMatches([]);
                      setSelectedTrackedCustomerId(null);
                      setCustomerTrackHasSearched(false);
                      setCustomerTrackLastQuery('');
                      setCustomerTrackError(null);
                      setConfirmDeleteTrackedId(null);
                    }}
                    className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>

              {customerTrackError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{customerTrackError}</span>
                </div>
              )}
            </form>

            {/* Initial Empty Prompt */}
            {!customerTrackHasSearched && !customerTrackLoading && (
              <div className="p-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-1.5">
                <Users className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Ready to Track a Customer Profile
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Enter a customer&apos;s registered Gmail address or 10-digit mobile number above to view their account creation date, contact details, ongoing subscription plan, and complete payment status.
                </p>
              </div>
            )}

            {/* No Match Found */}
            {customerTrackHasSearched && !customerTrackLoading && customerTrackMatches.length === 0 && (
              <div className="p-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-1.5">
                <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No customer profile found for &ldquo;{customerTrackLastQuery}&rdquo;
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Check the spelling of the customer&apos;s registered Gmail address or verify their 10-digit mobile number and try searching again.
                </p>
              </div>
            )}

            {/* Multiple Matches Switcher */}
            {customerTrackMatches.length > 1 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Found {customerTrackMatches.length} matching customer profiles — select one to inspect:
                </div>
                <div className="flex flex-wrap gap-2">
                  {customerTrackMatches.map((m: any) => {
                    const isSelected = selectedCustomer?.id === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSelectedTrackedCustomerId(m.id);
                          setConfirmDeleteTrackedId(null);
                        }}
                        className={`px-3.5 py-2 rounded-lg text-left text-xs border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500 text-slate-900 dark:text-white font-bold'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-600'
                        }`}
                      >
                        <div>{m.name || 'Unnamed Customer'}</div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {m.email} {m.phone ? `· ${m.phone}` : ''}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected Customer Profile Detail View */}
            {selectedCustomer && (
              <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                {/* 1. Profile Identity Header */}
                <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <h4 className="text-lg font-bold text-slate-900 dark:text-white font-heading">
                      {selectedCustomer.name || 'Registered Customer'}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono text-slate-600 dark:text-slate-400">
                        ID: {selectedCustomer.id}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{selectedCustomer.role || 'reader'}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          selectedCustomer.isSuspended
                            ? 'font-semibold text-rose-600 dark:text-rose-400'
                            : 'font-semibold text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {selectedCustomer.isSuspended ? 'Suspended Account' : 'Active Account'}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-left sm:text-right">
                    <div className="text-slate-500">Payment Status</div>
                    <div
                      className={`mt-0.5 font-bold ${
                        selectedCustomer.paymentSummary?.status === 'paid_active'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : selectedCustomer.paymentSummary?.status === 'paid_expired'
                            ? 'text-amber-600 dark:text-amber-400'
                            : selectedCustomer.paymentSummary?.status === 'pending_payment'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {selectedCustomer.paymentSummary?.statusLabel || 'Unpaid · Free Account'}
                    </div>
                  </div>
                </div>

                {/* 2. Core Profile Details: Created Date, Registered Gmail, Mobile Number, Account Meta */}
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-xs">
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-slate-500">Profile Created</div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                      {formatIstDateTime(selectedCustomer.createdAt)}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      Last login: {selectedCustomer.lastLoginAt ? formatIstDateTime(selectedCustomer.lastLoginAt) : 'Not recorded'}
                    </div>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">Registered Gmail</div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-white break-all">
                      {selectedCustomer.email || 'Not linked'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {selectedCustomer.emailVerified || selectedCustomer.isVerified ? 'Email verified' : 'Unverified email'}
                    </div>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">Registered Mobile Number</div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                      {selectedCustomer.phone || 'Not linked'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {selectedCustomer.upiId ? `UPI: ${selectedCustomer.upiId}` : selectedCustomer.countryName || 'India'}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-slate-500">Customer Details</div>
                    <div className="font-semibold text-slate-900 dark:text-white tabular-nums">
                      {selectedCustomer.age ? `${selectedCustomer.age} yrs` : 'Age not set'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {selectedCustomer.dob ? `DOB: ${selectedCustomer.dob}` : 'Standard profile'}
                    </div>
                  </div>
                </div>

                {/* 3. Ongoing Plan & Payment Summary Split */}
                <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
                  <div className="space-y-2.5">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Ongoing Plan on Profile
                    </div>
                    {selectedCustomer.ongoingPlan?.hasActivePlan ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>{selectedCustomer.ongoingPlan.planLabel}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 text-slate-600 dark:text-slate-300">
                          <div>
                            <span className="text-slate-500">Started: </span>
                            <span className="font-mono tabular-nums">
                              {formatIstDateTime(selectedCustomer.ongoingPlan.startedAt)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Expires: </span>
                            <span className="font-mono tabular-nums">
                              {formatIstDateTime(selectedCustomer.ongoingPlan.expiresAt)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Remaining: </span>
                            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {selectedCustomer.ongoingPlan.daysRemaining} day{selectedCustomer.ongoingPlan.daysRemaining === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Method: </span>
                            <span>{selectedCustomer.ongoingPlan.paymentMethod || 'Razorpay / UPI'}</span>
                          </div>
                          {selectedCustomer.ongoingPlan.receiptNumber && (
                            <div className="col-span-2">
                              <span className="text-slate-500">Receipt: </span>
                              <span className="font-mono">{selectedCustomer.ongoingPlan.receiptNumber}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 text-slate-600 dark:text-slate-400">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          No Ongoing Plan Active
                        </div>
                        <p>This customer currently has a Free account with no active ₹49 or ₹249 subscription.</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5 lg:border-l lg:border-slate-200 dark:lg:border-slate-800 lg:pl-6">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Payment Status &amp; Spend Summary
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-0.5">
                      <div>
                        <div className="text-[11px] text-slate-500">Total Paid</div>
                        <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                          ₹{Number(selectedCustomer.paymentSummary?.totalSpentInr || 0).toLocaleString('en-IN')}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">Transactions</div>
                        <div className="text-xs font-mono text-slate-800 dark:text-slate-200 mt-1 tabular-nums">
                          {selectedCustomer.paymentSummary?.successfulPaymentsCount ?? 0} Paid ·{' '}
                          {selectedCustomer.paymentSummary?.pendingPaymentsCount ?? 0} Pending ·{' '}
                          {selectedCustomer.paymentSummary?.failedPaymentsCount ?? 0} Failed
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      Last payment activity:{' '}
                      {selectedCustomer.paymentSummary?.lastPaymentAt
                        ? formatIstDateTime(selectedCustomer.paymentSummary.lastPaymentAt)
                        : 'No payments recorded'}
                    </div>
                  </div>
                </div>

                {/* 4. Payment History Table */}
                <div className="p-5 space-y-3">
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Payment History ({selectedCustomer.paymentHistory?.length || 0})
                  </div>
                  {!selectedCustomer.paymentHistory || selectedCustomer.paymentHistory.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No payment records found for this customer profile.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 font-semibold">
                            <th className="py-2 pr-3">Date (IST)</th>
                            <th className="py-2 px-3">Plan / Item</th>
                            <th className="py-2 px-3">Method</th>
                            <th className="py-2 px-3">Receipt / Payment ID</th>
                            <th className="py-2 px-3">Status</th>
                            <th className="py-2 pl-3 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                          {selectedCustomer.paymentHistory.map((tx: any) => (
                            <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                {formatIstDateTime(tx.date)}
                              </td>
                              <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
                                {tx.itemTitle || tx.plan}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                                {tx.paymentMethod || 'Razorpay'}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                                {tx.receiptNumber || tx.transactionId || tx.orderId || '—'}
                              </td>
                              <td className="py-2.5 px-3 font-semibold">
                                {tx.status === 'success' ? (
                                  <span className="text-emerald-600 dark:text-emerald-400">Success</span>
                                ) : tx.status === 'failed' ? (
                                  <span className="text-rose-600 dark:text-rose-400">Failed</span>
                                ) : tx.status === 'refunded' ? (
                                  <span className="text-amber-600 dark:text-amber-400">Refunded</span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400">Pending</span>
                                )}
                              </td>
                              <td className="py-2.5 pl-3 text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                                ₹{Number(tx.amountInr || 0).toLocaleString('en-IN')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 5. Admin Profile Controls */}
                <div className="p-4 bg-slate-50/70 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-500 mr-1">Plan Controls:</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleTrackedCustomerUpdate(
                          selectedCustomer.id,
                          { paidPlan: '1_month', paymentMethod: 'Admin DB Grant (UPI)' },
                          `Granted 1-Month Pass (₹49) to ${selectedCustomer.email}.`
                        )
                      }
                      className="py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Grant 1M (₹49)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleTrackedCustomerUpdate(
                          selectedCustomer.id,
                          { paidPlan: '6_months', paymentMethod: 'Admin DB Grant (UPI)' },
                          `Granted 6-Months Pass (₹249) to ${selectedCustomer.email}.`
                        )
                      }
                      className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Grant 6M (₹249)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleTrackedCustomerUpdate(
                          selectedCustomer.id,
                          { paidPlan: 'free' },
                          `Reset ${selectedCustomer.email} to Free plan.`
                        )
                      }
                      className="py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Set Free
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleTrackedCustomerUpdate(
                          selectedCustomer.id,
                          {
                            isSuspended: !selectedCustomer.isSuspended,
                            suspendedReason: !selectedCustomer.isSuspended ? 'Suspended by Admin' : '',
                          },
                          !selectedCustomer.isSuspended
                            ? `Suspended customer account ${selectedCustomer.email}.`
                            : `Reactivated customer account ${selectedCustomer.email}.`
                        )
                      }
                      className="py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {selectedCustomer.isSuspended ? 'Reactivate Account' : 'Suspend Account'}
                    </button>
                  </div>

                  <div>
                    {confirmDeleteTrackedId === selectedCustomer.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                          Confirm delete?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleTrackedCustomerDelete(selectedCustomer.id)}
                          className="py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                        >
                          Yes, Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTrackedId(null)}
                          className="py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteTrackedId(selectedCustomer.id)}
                        className="py-1.5 px-3 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Account</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB 2: MY COMIC & EPISODE / UPLOAD NEW COMIC */}
      {(activeTab === "my-comics-episodes-upload" || activeTab === "publish-direct") && (
        <AdminPublishingStudio
          comics={allComicsWithPending.length > 0 ? allComicsWithPending : comics}
          onRefreshComics={onRefreshComics}
          fetchAdminData={fetchAdminData}
          user={user}
        />
      )}

      {/* TAB 3: COMIC SUBMISSION APPROVALS QUEUE */}
      {activeTab === 'comic-queue' && (
        <div className="space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
              Author &amp; Publisher Submissions Awaiting Approval ({pendingComics.length})
            </h3>
            <p className="text-xs text-slate-500">
              Review all attached comic photos, pages, and author comments before approving or rejecting. If you reject a submission, your comment will be shown on the Author&apos;s page explaining why it was rejected. If you approve, the Author&apos;s page will notify them that they are approved to upload comics of their own!
            </p>
          </div>

          {pendingComics.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">All Submissions Reviewed!</h4>
              <p className="text-xs text-slate-400">No pending comics in queue right now.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {pendingComics.map((comic) => {
                const comicPages = getComicAttachedPages(comic);
                const totalEpisodesCount = Math.max(
                  1,
                  comic.chapters.reduce((sum, ch) => sum + ch.episodes.length, 0)
                );
                const currentNote = comicReviewNotes[comic.id] ?? '';

                return (
                  <div
                    key={comic.id}
                    className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-amber-500/40 shadow-md space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                      <div className="flex items-center gap-4">
                        <img
                          src={comic.coverImage}
                          alt={comic.title}
                          onClick={() => {
                            setPreviewQueueComic(comic);
                            setPreviewQueuePageIdx(0);
                          }}
                          className="w-14 h-20 rounded-xl object-cover shrink-0 border border-slate-300 dark:border-slate-700 cursor-pointer hover:ring-2 hover:ring-amber-500 transition-all"
                          title="Click to inspect attached comic pages"
                        />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                              {comic.title}
                            </h4>
                            {comic.moderationStatus === 'delete_requested' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                                Author Requested Deletion
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                Pending Review ({comicPages.length} Photos Attached)
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Submitted by author: <strong className="text-slate-800 dark:text-slate-200">{comic.authorName}</strong> · {comic.genre.join(', ')}
                          </p>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Submitted on: {new Date(comic.submittedAt || comic.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {comic.moderationStatus === 'delete_requested' ? (
                          <button
                            onClick={() => setActiveTab('delete-requests')}
                            className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Open in Delete Requests Queue</span>
                          </button>
                        ) : (
                          <>
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
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setPreviewQueueComic(comic);
                            setPreviewQueuePageIdx(0);
                          }}
                          className="py-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                          <span>Review {comicPages.length} Files &amp; Comments</span>
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

                    {/* Synopsis, Author Comments, Attached Files & Inline Photo Gallery */}
                    <div className="text-xs space-y-3">
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {comic.description}
                      </p>

                      {/* Metadata Bar (preserves CSS selector 2) */}
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          Content payload: {comic.chapters.length} Chapters · {totalEpisodesCount} Episodes · {comicPages.length} Attached Photos
                        </span>
                        <span
                          onClick={() => {
                            setPreviewQueueComic(comic);
                            setPreviewQueuePageIdx(0);
                          }}
                          className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline font-bold flex items-center gap-1.5 font-mono cursor-pointer bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-lg"
                          title="Click to open and review all attached files and author comments"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>
                            Attached File: {comic.attachedFileName || 'Comic Pages Archive'} ({comic.attachedFileSize || `${comicPages.length} files`}) — Click to Review
                          </span>
                        </span>
                        <span className="text-[11px] text-emerald-500 font-medium">Ready to deploy live</span>
                      </div>

                      {/* Author Uploaded Comments / Notes Box */}
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-500 flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Author Uploaded Comments, Synopsis &amp; Submission Notes</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            By {comic.authorName}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-medium">
                          {comic.authorComments ||
                            comic.chapters?.[0]?.episodes?.[0]?.synopsis ||
                            comic.description ||
                            'Author submitted comic pages and cover artwork for Administrator review and approval.'}
                        </p>
                      </div>

                      {/* Attached Photos Inline Gallery (All 8 / N Uploaded Photos) */}
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            <Images className="w-4 h-4 text-amber-500" />
                            <span>
                              Uploaded Comic Photos &amp; Page Captions ({comicPages.length} Attached Files):
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewQueueComic(comic);
                              setPreviewQueuePageIdx(0);
                            }}
                            className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                            <span>Open Full-Screen Reader ({comicPages.length} Pages)</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5">
                          {comicPages.map((page, idx) => (
                            <div
                              key={page.id || idx}
                              onClick={() => {
                                setPreviewQueueComic(comic);
                                setPreviewQueuePageIdx(idx);
                              }}
                              className="group rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-amber-500 transition-all cursor-pointer shadow-xs flex flex-col"
                            >
                              <div className="relative aspect-[3/4] overflow-hidden bg-slate-950">
                                <img
                                  src={page.imageUrl}
                                  alt={page.caption || `Page ${idx + 1}`}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-amber-400 font-mono font-bold text-[9px]">
                                  File #{idx + 1}
                                </span>
                              </div>
                              <div className="p-1.5 text-[10px] text-slate-600 dark:text-slate-300 truncate font-medium" title={page.caption || `Page ${idx + 1}`}>
                                {page.caption || `Page ${idx + 1}`}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Admin Review / Rejection Comment Input Box */}
                      <div
                        className={`p-4 rounded-2xl border space-y-2.5 transition-all ${
                          comicRejectErrorId === comic.id
                            ? 'bg-rose-500/10 border-rose-500 ring-2 ring-rose-500/30'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label
                            htmlFor={`admin-reject-note-${comic.id}`}
                            className="text-[11px] font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5"
                          >
                            <PenTool className="w-3.5 h-3.5 text-rose-500" />
                            <span>
                              Admin Review / Rejection Comment (Shown to {comic.authorName} on Author Page):
                            </span>
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {[
                              'Artwork resolution needs improvement',
                              'Missing page sequence / incomplete story panels',
                              'Please revise dialogue formatting & re-submit',
                              'Approved! Great artwork — you are approved to upload comics of your own.',
                            ].map((preset, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  setComicReviewNotes(prev => ({ ...prev, [comic.id]: preset }));
                                  setComicRejectErrorId(null);
                                }}
                                className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-rose-500 text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer transition-colors"
                              >
                                + {preset.length > 34 ? preset.slice(0, 34) + '…' : preset}
                              </button>
                            ))}
                          </div>
                        </div>

                        {comicRejectErrorId === comic.id && (
                          <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
                            ⚠️ Please enter a rejection comment below (or click one of the preset reasons above) so the author sees why their comic submission was rejected!
                          </p>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2.5">
                          <textarea
                            id={`admin-reject-note-${comic.id}`}
                            rows={2}
                            value={currentNote}
                            onChange={(e) => {
                              setComicReviewNotes(prev => ({ ...prev, [comic.id]: e.target.value }));
                              if (comicRejectErrorId === comic.id) setComicRejectErrorId(null);
                            }}
                            placeholder={`Write a comment for ${comic.authorName} (e.g., why you are rejecting this comic submission, or an approval note confirming they can upload comics of their own)...`}
                            className="flex-1 px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                          />
                          <div className="flex sm:flex-col gap-2 shrink-0 justify-end">
                            <button
                              type="button"
                              disabled={isRowActionLoading(`comic-${comic.id}-approve`) || isRowActionLoading(`comic-${comic.id}-reject`)}
                              aria-busy={isRowActionLoading(`comic-${comic.id}-approve`)}
                              data-loading={isRowActionLoading(`comic-${comic.id}-approve`) ? 'true' : 'false'}
                              onClick={() => handleModerateComicSubmission(comic.id, 'approve', currentNote)}
                              className={processingClass(
                                isRowActionLoading(`comic-${comic.id}-approve`),
                                'py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs'
                              )}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{isRowActionLoading(`comic-${comic.id}-approve`) ? 'Approving...' : 'Approve with Note'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={isRowActionLoading(`comic-${comic.id}-approve`) || isRowActionLoading(`comic-${comic.id}-reject`)}
                              aria-busy={isRowActionLoading(`comic-${comic.id}-reject`)}
                              data-loading={isRowActionLoading(`comic-${comic.id}-reject`) ? 'true' : 'false'}
                              onClick={() => handleModerateComicSubmission(comic.id, 'reject', currentNote)}
                              className={processingClass(
                                isRowActionLoading(`comic-${comic.id}-reject`),
                                'py-2 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs'
                              )}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>{isRowActionLoading(`comic-${comic.id}-reject`) ? 'Rejecting...' : 'Reject with Reason'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recently Moderated Author Submissions History (Approved & Rejected) */}
          {allComicsWithPending.filter(c => !c.isPublishedDirectlyByAdmin && (c.moderationStatus === 'rejected' || c.submittedAt || c.adminReviewNote)).length > 0 && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Reviewed Author Submissions &amp; Status History
              </h4>
              <div className="space-y-2.5">
                {allComicsWithPending
                  .filter(c => !c.isPublishedDirectlyByAdmin && (c.moderationStatus === 'rejected' || c.submittedAt || c.adminReviewNote))
                  .map((c) => {
                    const pages = getComicAttachedPages(c);
                    return (
                      <div
                        key={c.id}
                        className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={c.coverImage}
                            alt={c.title}
                            className="w-10 h-14 rounded-lg object-cover border border-slate-300 dark:border-slate-700 shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-white">{c.title}</span>
                              <span className="text-slate-400">by {c.authorName}</span>
                              {c.moderationStatus === 'approved' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                  ✓ Approved (Author Notified)
                                </span>
                              ) : c.moderationStatus === 'rejected' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                                  ✕ Rejected
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                  ⏳ Pending
                                </span>
                              )}
                            </div>
                            {c.adminReviewNote && (
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                                <strong>Admin Comment on Author Page:</strong> &ldquo;{c.adminReviewNote}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewQueueComic(c);
                              setPreviewQueuePageIdx(0);
                            }}
                            className="py-1.5 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 hover:text-slate-950 font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View {pages.length} Files</span>
                          </button>
                          {c.moderationStatus !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleModerateComicSubmission(c.id, 'approve', 'Approved by Admin! You are now authorized to upload comics of your own.')}
                              className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer"
                            >
                              Approve Now
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* FULL-SCREEN ATTACHED PHOTOS & AUTHOR COMMENTS REVIEW MODAL */}
          {previewQueueComic && (() => {
            const modalPages = getComicAttachedPages(previewQueueComic);
            const modalNote = comicReviewNotes[previewQueueComic.id] ?? previewQueueComic.adminReviewNote ?? '';
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
                <div className="w-full max-w-5xl max-h-[92vh] rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
                  {/* Modal Header */}
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950">
                    <div className="flex items-center gap-3">
                      <img
                        src={previewQueueComic.coverImage}
                        alt={previewQueueComic.title}
                        className="w-11 h-14 rounded-xl object-cover border border-amber-500/40 shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white">
                            {previewQueueComic.title} — Attached Files &amp; Author Comments Review
                          </h4>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                            {modalPages.length} Attached Photos
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Author: <strong className="text-slate-800 dark:text-slate-200">{previewQueueComic.authorName}</strong> · File: <span className="font-mono">{previewQueueComic.attachedFileName || 'Attached Comic Archive'} ({previewQueueComic.attachedFileSize || `${modalPages.length} files`})</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-slate-200 dark:bg-slate-800 rounded-xl p-1 text-xs">
                        <button
                          type="button"
                          onClick={() => setPreviewQueueMode('page')}
                          className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                            previewQueueMode === 'page'
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          Page-by-Page
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewQueueMode('vertical')}
                          className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                            previewQueueMode === 'vertical'
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          All {modalPages.length} Photos Scroll
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setPreviewQueueComic(null)}
                        className="py-1.5 px-3.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-rose-600 hover:text-white text-xs font-bold cursor-pointer transition-colors"
                      >
                        Close ✕
                      </button>
                    </div>
                  </div>

                  {/* Author Comments & Synopsis Banner inside Modal */}
                  <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 block">
                        Author&apos;s Uploaded Comments &amp; Story Description:
                      </span>
                      <p className="text-slate-800 dark:text-slate-200 font-medium">
                        {previewQueueComic.authorComments ||
                          previewQueueComic.chapters?.[0]?.episodes?.[0]?.synopsis ||
                          previewQueueComic.description}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      Viewing File {previewQueuePageIdx + 1} of {modalPages.length}
                    </span>
                  </div>

                  {/* Modal Viewer Body */}
                  <div className="flex-1 overflow-y-auto p-6 bg-slate-950 flex flex-col items-center space-y-4">
                    {previewQueueMode === 'page' ? (
                      <>
                        {modalPages[previewQueuePageIdx] && (
                          <div className="flex flex-col items-center space-y-2 max-w-full">
                            <img
                              src={modalPages[previewQueuePageIdx].imageUrl}
                              alt={`Attached File ${previewQueuePageIdx + 1}`}
                              className="max-h-[52vh] w-auto rounded-2xl border border-slate-800 shadow-2xl object-contain"
                            />
                            <span className="text-xs font-mono font-semibold text-slate-300 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800">
                              File #{previewQueuePageIdx + 1}: {modalPages[previewQueuePageIdx].caption || `Page ${previewQueuePageIdx + 1}`}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-3 pt-1">
                          <button
                            type="button"
                            disabled={previewQueuePageIdx <= 0}
                            onClick={() => setPreviewQueuePageIdx(p => Math.max(0, p - 1))}
                            className="py-1.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                          >
                            ← Previous Photo
                          </button>
                          <span className="text-xs font-mono font-bold text-amber-400">
                            Photo {previewQueuePageIdx + 1} of {modalPages.length}
                          </span>
                          <button
                            type="button"
                            disabled={previewQueuePageIdx >= modalPages.length - 1}
                            onClick={() => setPreviewQueuePageIdx(p => Math.min(modalPages.length - 1, p + 1))}
                            className="py-1.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                          >
                            Next Photo →
                          </button>
                        </div>

                        {/* Thumbnail selector bar */}
                        <div className="flex items-center gap-2 overflow-x-auto max-w-full py-2 px-2">
                          {modalPages.map((p, idx) => (
                            <button
                              key={p.id || idx}
                              type="button"
                              onClick={() => setPreviewQueuePageIdx(idx)}
                              className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                                previewQueuePageIdx === idx
                                  ? 'border-amber-500 scale-105 shadow-md'
                                  : 'border-slate-800 opacity-60 hover:opacity-100'
                              }`}
                            >
                              <img src={p.imageUrl} alt={`Thumb ${idx + 1}`} className="w-12 h-16 object-cover" />
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="w-full max-w-2xl space-y-6">
                        {modalPages.map((p, idx) => (
                          <div
                            key={p.id || idx}
                            className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 shadow-xl space-y-2 p-3"
                          >
                            <div className="flex items-center justify-between text-xs font-mono text-amber-400 px-1">
                              <span>Attached Photo #{idx + 1} of {modalPages.length}</span>
                              <span>{p.caption || `Page ${idx + 1}`}</span>
                            </div>
                            <img
                              src={p.imageUrl}
                              alt={`Photo ${idx + 1}`}
                              className="w-full h-auto rounded-xl object-contain"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Modal Footer: Admin Comment Input & Approve / Reject Buttons */}
                  <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 space-y-3">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <input
                        type="text"
                        value={modalNote}
                        onChange={(e) => {
                          setComicReviewNotes(prev => ({
                            ...prev,
                            [previewQueueComic.id]: e.target.value,
                          }));
                          setComicRejectErrorId(null);
                        }}
                        placeholder={`Enter rejection reason or approval comment for ${previewQueueComic.authorName}...`}
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleModerateComicSubmission(previewQueueComic.id, 'approve', modalNote)}
                          className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Approve &amp; Notify Author</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleModerateComicSubmission(previewQueueComic.id, 'reject', modalNote || 'Rejected by Admin after reviewing attached files. Please revise and re-submit.')}
                          className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>Reject with Comment</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB 3.5: AUTHOR DELETION REQUESTS QUEUE */}
      {activeTab === 'delete-requests' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 mb-1">
                <Trash2 className="w-3 h-3" />
                <span>Admin-Exclusive Deletion Authority</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
                Author Content Deletion Requests ({deleteRequests.filter(r => r.status === 'pending').length} Pending)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Authors cannot directly delete uploaded comics, chapters, or episodes. Review their requests here to permanently delete or reject.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchAdminData}
              className="py-2 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Refresh Queue</span>
            </button>
          </div>

          {deleteRequests.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">No Deletion Requests</h4>
              <p className="text-xs text-slate-500">There are currently no author deletion requests in the queue.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {[...deleteRequests]
                .sort((a, b) => {
                  if (a.status === 'pending' && b.status !== 'pending') return -1;
                  if (a.status !== 'pending' && b.status === 'pending') return 1;
                  return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
                })
                .map((req) => (
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
                            Delete {req.targetType === 'series' ? 'Uploaded Comic Series' : req.targetType}
                          </span>
                          {req.status === 'pending' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Waiting for Admin Delete
                            </span>
                          ) : req.status === 'approved' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              ✓ Approved &amp; Permanently Deleted by Admin
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Paywall Control &amp; Series Catalog
              </h3>
              <p className="text-xs text-slate-500">
                All comics are free by default. You have full access to put any comic, chapter, or episode behind paywall anytime.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('gst-billing')}
              className="py-2 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer self-start sm:self-auto"
            >
              <FileText className="w-4 h-4" />
              <span>Open GST &amp; Billing Portal Exports →</span>
            </button>
          </div>

          <div className="space-y-4">
            {allComicsWithPending.map((comic) => {
              const isExpanded = !!expandedComicPaywall[comic.id];
              const totalEpisodes = (comic.chapters || []).reduce((acc, ch) => acc + (ch.episodes?.length || 0), 0);
              const premiumEpisodes = (comic.chapters || []).reduce(
                (acc, ch) =>
                  acc +
                  (ch.episodes || []).filter((ep) => Boolean(ep.isPremium || ch.isPremium || comic.accessType === 'premium')).length,
                0
              );
              const isFullyPremium =
                comic.accessType === 'premium' ||
                (totalEpisodes > 0 && premiumEpisodes === totalEpisodes);
              const isPartiallyPremium = !isFullyPremium && (premiumEpisodes > 0 || (comic.chapters || []).some((ch) => Boolean(ch.isPremium)));
              const isComicToggling = Boolean(paywallBusyKeys[`comic:${comic.id}`]);

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
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-sm text-slate-900 dark:text-white">{comic.title}</h4>
                          {isFullyPremium ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              <span>PREMIUM</span>
                            </span>
                          ) : isPartiallyPremium ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              <span>PARTIAL PREMIUM ({premiumEpisodes}/{totalEpisodes} Ep)</span>
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
                      {isFullyPremium ? (
                        <button
                          type="button"
                          disabled={isComicToggling}
                          aria-busy={isComicToggling}
                          data-loading={isComicToggling ? 'true' : 'false'}
                          onClick={() => handleTogglePaywall({ comicId: comic.id, isPremium: false })}
                          className={processingClass(
                            isComicToggling,
                            'py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
                          )}
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>{isComicToggling ? 'Updating...' : 'Make Entire Comic Free'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isComicToggling}
                          aria-busy={isComicToggling}
                          data-loading={isComicToggling ? 'true' : 'false'}
                          onClick={() => handleTogglePaywall({ comicId: comic.id, isPremium: true, priceInr: 0 })}
                          className={processingClass(
                            isComicToggling,
                            'py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
                          )}
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>{isComicToggling ? 'Updating...' : 'Put Entire Comic on Premium'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpandedComicPaywall(prev => ({ ...prev, [comic.id]: !prev[comic.id] }))}
                        className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-400 hover:text-white cursor-pointer"
                        title="Manage Chapters &amp; Episodes Paywall"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>

                      <button
                        type="button"
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
                        <span className="text-[11px] text-slate-400">Toggle Premium access per chapter or episode</span>
                      </div>

                      <div className="space-y-3">
                        {comic.chapters.map(ch => {
                          const isChapterPremium = Boolean(ch.isPremium || comic.accessType === 'premium');
                          const isChapterToggling = Boolean(paywallBusyKeys[`ch:${ch.id}`] || isComicToggling);

                          return (
                            <div key={ch.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-slate-900">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-900 dark:text-white">
                                  Chapter {ch.chapterNumber}: {ch.title}
                                </span>

                                <div className="flex items-center gap-2">
                                  {isChapterPremium ? (
                                    <button
                                      type="button"
                                      disabled={isChapterToggling}
                                      aria-busy={isChapterToggling}
                                      data-loading={isChapterToggling ? 'true' : 'false'}
                                      onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, isPremium: false })}
                                      className={processingClass(
                                        isChapterToggling,
                                        'px-2.5 py-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors'
                                      )}
                                    >
                                      {isChapterToggling ? 'Updating...' : 'Chapter Premium (Make Free)'}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={isChapterToggling}
                                      aria-busy={isChapterToggling}
                                      data-loading={isChapterToggling ? 'true' : 'false'}
                                      onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, isPremium: true, priceInr: 0 })}
                                      className={processingClass(
                                        isChapterToggling,
                                        'px-2.5 py-1 text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors'
                                      )}
                                    >
                                      {isChapterToggling ? 'Updating...' : 'Put Chapter on Premium'}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Episode list inside chapter */}
                              <div className="pl-3 border-l border-slate-200 dark:border-slate-800 space-y-1 pt-1">
                                {ch.episodes.map(ep => {
                                  const isEpPremium = Boolean(ep.isPremium || ch.isPremium || comic.accessType === 'premium');
                                  const isEpToggling = Boolean(paywallBusyKeys[`ep:${ep.id}`] || isChapterToggling);

                                  return (
                                    <div key={ep.id} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                      <span className="text-slate-600 dark:text-slate-300">
                                        Ep {ep.episodeNumber}: {ep.title}
                                      </span>

                                      <div className="flex items-center gap-2">
                                        {isEpPremium ? (
                                          <button
                                            type="button"
                                            disabled={isEpToggling}
                                            aria-busy={isEpToggling}
                                            data-loading={isEpToggling ? 'true' : 'false'}
                                            onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, episodeId: ep.id, isPremium: false })}
                                            className={processingClass(
                                              isEpToggling,
                                              'text-emerald-500 font-bold hover:underline cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
                                            )}
                                          >
                                            {isEpToggling ? 'Updating...' : 'Premium (Make Free)'}
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            disabled={isEpToggling}
                                            aria-busy={isEpToggling}
                                            data-loading={isEpToggling ? 'true' : 'false'}
                                            onClick={() => handleTogglePaywall({ comicId: comic.id, chapterId: ch.id, episodeId: ep.id, isPremium: true, priceInr: 0 })}
                                            className={processingClass(
                                              isEpToggling,
                                              'text-amber-500 font-bold hover:underline cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
                                            )}
                                          >
                                            {isEpToggling ? 'Updating...' : 'Free (Set Premium)'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4.5: INDIAN GST & BILLING MODULE (GSTR-1 JSON, CSV RECONCILIATION & PDF TAX INVOICES) */}
      {activeTab === 'gst-billing' && (
        <div className="space-y-6">
          {/* Header Banner with Customer GST ON/OFF Master Switch & Direct Monthly GST Statement Chooser (CSS Selector 2 Target) */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-amber-500/40 shadow-sm space-y-5">
            {/* MASTER CUSTOMER-SIDE GST BILLING ON/OFF CONTROL BANNER */}
            <div
              className={`p-4 rounded-2xl border-2 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                gstSettings.applyGstToDomesticSales
                  ? 'bg-emerald-500/10 border-emerald-500/40'
                  : 'bg-rose-500/10 border-rose-500/40'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wider ${
                      gstSettings.applyGstToDomesticSales
                        ? 'bg-emerald-600 text-white'
                        : 'bg-rose-600 text-white'
                    }`}
                  >
                    {gstSettings.applyGstToDomesticSales
                      ? 'CUSTOMER GST BILLING: ON (18% GST INCLUDED)'
                      : 'CUSTOMER GST BILLING: OFF (NO GST ON CUSTOMER BILLS)'}
                  </span>
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                    {gstSettings.applyGstToDomesticSales
                      ? 'Customers currently see 18% GST breakdown at checkout & receive GST Tax Invoices.'
                      : 'GST is hidden on customer checkout & customer receipts show "No GST" (Standard Payment Receipt).'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {gstSettings.applyGstToDomesticSales
                    ? 'If you are not currently filing GST for your bills, click "Turn OFF Customer GST Billing" so customers are billed without any GST amount, GST documents, or GST breakdown on their receipts.'
                    : 'When you are ready to file GST, simply click "Turn ON Customer GST Billing" to automatically include GST on the customer page and issue GST Tax Invoices.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={gstSaving}
                  onClick={() => handleToggleCustomerGstBilling(!gstSettings.applyGstToDomesticSales)}
                  className={`py-3 px-5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50 ${
                    gstSettings.applyGstToDomesticSales
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                  }`}
                >
                  {gstSettings.applyGstToDomesticSales ? (
                    <>
                      <XCircle className="w-4 h-4" />
                      <span>Turn OFF Customer GST Billing (Show No GST to Customer)</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Turn ON Customer GST Billing (Include GST for Customer)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <IndianRupee className="w-3 h-3" />
                  <span>Indian GST Compliance &amp; Monthly Tax Statement · SAC {gstSettings.defaultSacCode || '998431'}</span>
                </div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white font-heading">
                  GST &amp; Billing — Choose Monthly Statement to File GST
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
                  Select your <strong>Monthly Statement (Month &amp; Year)</strong> below to view that month&apos;s taxable sales, CGST, SGST, IGST, and download your <strong>Monthly GSTR-1 JSON</strong>, <strong>Monthly GST Statement CSV</strong>, or <strong>Monthly GST Statement PDF</strong> to file on <strong className="text-slate-700 dark:text-slate-200">services.gst.gov.in</strong>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleExportMonthlyStatementPdf()}
                  className="py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md transition-colors cursor-pointer border border-slate-700"
                  title="Download Printable Monthly GST Filing Statement in PDF format (works even for 0-bill Nil Return months)"
                >
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span>Download Monthly Statement (PDF)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportGstr1Json()}
                  className="py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md transition-colors cursor-pointer"
                  title="Download GSTR-1 JSON compatible with GST Portal Offline Utility (supports Nil Return months)"
                >
                  <Download className="w-4 h-4" />
                  <span>1. Download GSTR-1 JSON ({gstPeriodFilter === 'ALL' ? 'Monthly/All' : gstPeriodFilter})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportGstCsv()}
                  className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md transition-colors cursor-pointer"
                  title="Download GST Sales & Tax Reconciliation CSV for the selected month (supports Nil Return months)"
                >
                  <Download className="w-4 h-4" />
                  <span>2. Download Monthly GST CSV</span>
                </button>
              </div>
            </div>

            {/* Interactive Monthly Statement Chooser Bar inside Header Card (CSS Selector 1 Target) */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Choose Monthly Statement for GST Filing:</span>
                  </span>

                  {/* Month Dropdown (01 Jan - 12 Dec) */}
                  <select
                    aria-label="Select GST Statement Month"
                    value={gstSelectedMonth}
                    onChange={(e) => {
                      const mm = e.target.value;
                      setGstSelectedMonth(mm);
                      setGstPeriodFilter(`${mm}${gstSelectedYear}`);
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  >
                    {GST_MONTHS_LIST.map((m) => (
                      <option key={m.mm} value={m.mm}>
                        {m.mm} - {m.name}
                      </option>
                    ))}
                  </select>

                  {/* Year Dropdown */}
                  <select
                    aria-label="Select GST Statement Year"
                    value={gstSelectedYear}
                    onChange={(e) => {
                      const yyyy = e.target.value;
                      setGstSelectedYear(yyyy);
                      setGstPeriodFilter(`${gstSelectedMonth}${yyyy}`);
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono"
                  >
                    <option value="2024">2024</option>
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setGstPeriodFilter(`${gstSelectedMonth}${gstSelectedYear}`)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                      gstPeriodFilter === `${gstSelectedMonth}${gstSelectedYear}`
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-amber-500/20'
                    }`}
                  >
                    Active Month: {GST_MONTHS_LIST.find((m) => m.mm === gstSelectedMonth)?.short} {gstSelectedYear} ({gstSelectedMonth}{gstSelectedYear})
                  </button>

                  <button
                    type="button"
                    onClick={() => setGstPeriodFilter('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      gstPeriodFilter === 'ALL'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-rose-500'
                    }`}
                  >
                    View All Months ({transactions.length} Bills)
                  </button>
                </div>

                {/* Direct Monthly Download Bar inside div:nth-of-type(2) (works even when 0 bills in month) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {GST_MONTHS_LIST.find((m) => m.mm === gstSelectedMonth)?.name} {gstSelectedYear} ({gstPeriodSummary.totalInvoices === 0 ? '0 Bills · Nil Return' : `${gstPeriodSummary.totalInvoices} Bills`}):
                  </span>
                  <button
                    type="button"
                    onClick={() => handleExportMonthlyStatementPdf(`${gstSelectedMonth}${gstSelectedYear}`)}
                    className="py-1.5 px-3 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-extrabold flex items-center gap-1.5 shadow-xs cursor-pointer border border-slate-700"
                    title="Download Monthly GST Statement PDF even if there are 0 bills (Nil Return) for this month"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      Download {GST_MONTHS_LIST.find((m) => m.mm === gstSelectedMonth)?.short} {gstSelectedYear} PDF{' '}
                      {gstPeriodSummary.totalInvoices === 0 ? '(Nil Statement)' : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportGstCsv(`${gstSelectedMonth}${gstSelectedYear}`)}
                    className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold flex items-center gap-1.5 shadow-xs cursor-pointer"
                    title="Download Monthly GST CSV even if there are 0 bills (Nil Return) for this month"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      Download {GST_MONTHS_LIST.find((m) => m.mm === gstSelectedMonth)?.short} CSV{' '}
                      {gstPeriodSummary.totalInvoices === 0 ? '(Nil)' : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportGstr1Json(`${gstSelectedMonth}${gstSelectedYear}`)}
                    className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-extrabold flex items-center gap-1.5 shadow-xs cursor-pointer"
                    title="Download GSTR-1 JSON for this month even if there are 0 bills (Nil Return)"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      Download {GST_MONTHS_LIST.find((m) => m.mm === gstSelectedMonth)?.short} GSTR-1 JSON{' '}
                      {gstPeriodSummary.totalInvoices === 0 ? '(Nil)' : ''}
                    </span>
                  </button>
                </div>
              </div>

              {/* 12-Month Quick Statement Selector & Per-Month Direct Download Grid (Even When 0 Bills) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-0.5">
                {GST_MONTHS_LIST.map((m) => {
                  const fpCode = `${m.mm}${gstSelectedYear}`;
                  const isSelected = gstPeriodFilter === fpCode;
                  const monthInvoiceCount = transactions.filter((inv) => {
                    const d = new Date(inv.createdAt);
                    if (isNaN(d.getTime())) return false;
                    const invMm = String(d.getUTCMonth() + 1).padStart(2, '0');
                    const invYyyy = String(d.getUTCFullYear());
                    return invMm === m.mm && invYyyy === gstSelectedYear;
                  }).length;

                  return (
                    <div
                      key={fpCode}
                      onClick={() => {
                        setGstSelectedMonth(m.mm);
                        setGstPeriodFilter(fpCode);
                      }}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500 text-slate-900 dark:text-white shadow-sm ring-1 ring-amber-500/40'
                          : monthInvoiceCount > 0
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-900 dark:text-white hover:border-amber-500'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div>
                          <span className="text-xs font-extrabold block leading-tight">
                            {m.name} {gstSelectedYear}
                          </span>
                          <span className="text-[9px] font-mono text-slate-400">
                            Period: {fpCode}
                          </span>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 ${
                            monthInvoiceCount > 0
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {monthInvoiceCount === 0
                            ? '0 bills (Nil)'
                            : `${monthInvoiceCount} ${monthInvoiceCount === 1 ? 'bill' : 'bills'}`}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-200/70 dark:border-slate-800/80">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGstSelectedMonth(m.mm);
                            setGstPeriodFilter(fpCode);
                            handleExportMonthlyStatementPdf(fpCode);
                          }}
                          className="py-1 px-1.5 rounded bg-slate-900 dark:bg-slate-800 hover:bg-slate-700 text-white text-[9px] font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                          title={`Download ${m.name} ${gstSelectedYear} (${fpCode}) Monthly GST Statement PDF (${monthInvoiceCount === 0 ? 'Nil Return - 0 Bills' : `${monthInvoiceCount} Bills`})`}
                        >
                          <Download className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                          <span>{m.short} PDF</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGstSelectedMonth(m.mm);
                            setGstPeriodFilter(fpCode);
                            handleExportGstCsv(fpCode);
                          }}
                          className="py-1 px-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                          title={`Download ${m.name} ${gstSelectedYear} (${fpCode}) Monthly GST Statement CSV (${monthInvoiceCount === 0 ? 'Nil Return - 0 Bills' : `${monthInvoiceCount} Bills`})`}
                        >
                          <Download className="w-2.5 h-2.5 shrink-0" />
                          <span>{m.short} CSV</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGstSelectedMonth(m.mm);
                            setGstPeriodFilter(fpCode);
                            handleExportGstr1Json(fpCode);
                          }}
                          className="py-1 px-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[9px] font-extrabold flex items-center justify-center gap-0.5 cursor-pointer"
                          title={`Download ${m.name} ${gstSelectedYear} (${fpCode}) GSTR-1 JSON (${monthInvoiceCount === 0 ? 'Nil Return - 0 Bills' : `${monthInvoiceCount} Bills`})`}
                        >
                          <Download className="w-2.5 h-2.5 shrink-0" />
                          <span>{m.short} JSON</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Feedback Banner */}
          {gstMessage && (
            <div
              className={`p-4 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
                gstMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
              }`}
            >
              <div className="flex items-center gap-2">
                {gstMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{gstMessage.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setGstMessage(null)}
                className="text-[11px] underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Statutory Distinction & Manual GST Portal Filing Guide */}
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2">
            <div className="flex items-center gap-2 font-extrabold text-amber-700 dark:text-amber-300 uppercase tracking-wider text-[11px]">
              <Info className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Important Statutory Notice: Report Download vs. Official GST Return Filing &amp; Tax Payment</span>
            </div>
            <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
              Downloading GSTR-1 JSON, CSV reconciliation sheets, or PDF bills from Aathirai_Comic <strong>does not automatically file your GST return or pay tax on the Government GST Portal</strong>. To complete filing and tax payment:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-300 font-medium pl-1">
              <li>
                Enter and save your valid 15-digit <strong>Seller GSTIN</strong> below, then select your <strong>Monthly Statement</strong> (or Quarterly period).
              </li>
              <li>
                Click <strong>&ldquo;1. Download GSTR-1 JSON&rdquo;</strong> to generate the GST3.1.6 Offline Utility JSON file for your chosen month.
              </li>
              <li>
                Log in to <a href="https://services.gst.gov.in" target="_blank" rel="noreferrer" className="text-amber-600 dark:text-amber-400 underline font-bold">services.gst.gov.in</a> → <em>Returns Dashboard</em> → <em>GSTR-1 / IFF</em> → <em>Prepare Offline</em> → Upload the downloaded JSON file.
              </li>
              <li>
                Verify the populated B2B, B2CS, CDNR, and HSN summary tables on the GST Portal, sign with DSC / EVC, and pay net tax liability via <strong>GSTR-3B / PMT-06 Challan</strong>.
              </li>
            </ol>
          </div>

          {/* Period Filter & Live Tax Liability Summary Cards */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                  Monthly Statement &amp; GST Liability Summary — {formatPeriodHumanLabel(gstPeriodFilter)}
                </h3>
                <p className="text-xs text-slate-500">
                  Formula: Included GST = Total × {gstSettings.applicableGstRate} / {100 + gstSettings.applicableGstRate} · Taxable Value = Total − GST · Intra-State ({gstSettings.stateCode}-{gstSettings.stateName}) = CGST + SGST · Inter-State = IGST
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Monthly / Quarterly Statement:
                </label>
                <select
                  value={gstPeriodFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGstPeriodFilter(val);
                    if (/^\d{6}$/.test(val)) {
                      setGstSelectedMonth(val.slice(0, 2));
                      setGstSelectedYear(val.slice(2, 6));
                    }
                  }}
                  className="px-3 py-2 text-xs font-bold rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="ALL">All Periods (Complete Ledger)</option>
                  <optgroup label={`Monthly Statements (${gstSelectedYear})`}>
                    {GST_MONTHS_LIST.map((m) => (
                      <option key={`${m.mm}${gstSelectedYear}`} value={`${m.mm}${gstSelectedYear}`}>
                        {m.name} {gstSelectedYear} ({m.mm}{gstSelectedYear} - Monthly Statement)
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={`Quarterly Statements (${gstSelectedYear})`}>
                    <option value={`Q1-${gstSelectedYear}`}>Q1 {gstSelectedYear} (Jan – Mar {gstSelectedYear})</option>
                    <option value={`Q2-${gstSelectedYear}`}>Q2 {gstSelectedYear} (Apr – Jun {gstSelectedYear})</option>
                    <option value={`Q3-${gstSelectedYear}`}>Q3 {gstSelectedYear} (Jul – Sep {gstSelectedYear})</option>
                    <option value={`Q4-${gstSelectedYear}`}>Q4 {gstSelectedYear} (Oct – Dec {gstSelectedYear})</option>
                  </optgroup>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Invoices / Credit Notes
                </span>
                <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-1">
                  {gstPeriodSummary.totalInvoices} / {gstPeriodSummary.totalCreditNotes}
                </div>
                <span className="text-[10px] text-slate-500">
                  B2B: {gstPeriodSummary.b2bCount} · B2CS: {gstPeriodSummary.b2csCount}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Net Taxable Value
                </span>
                <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-1">
                  ₹{gstPeriodSummary.netTaxableValue.toFixed(2)}
                </div>
                <span className="text-[10px] text-slate-500">Base value excl. GST</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Net CGST (9%)
                </span>
                <div className="text-lg font-black font-mono text-amber-600 dark:text-amber-400 mt-1">
                  ₹{gstPeriodSummary.netCgst.toFixed(2)}
                </div>
                <span className="text-[10px] text-slate-500">Intra-state Central GST</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Net SGST (9%)
                </span>
                <div className="text-lg font-black font-mono text-amber-600 dark:text-amber-400 mt-1">
                  ₹{gstPeriodSummary.netSgst.toFixed(2)}
                </div>
                <span className="text-[10px] text-slate-500">Intra-state State GST</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Net IGST (18%)
                </span>
                <div className="text-lg font-black font-mono text-sky-600 dark:text-sky-400 mt-1">
                  ₹{gstPeriodSummary.netIgst.toFixed(2)}
                </div>
                <span className="text-[10px] text-slate-500">Inter-state Integrated GST</span>
              </div>

              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">
                  Net GST Payable to Govt
                </span>
                <div className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                  ₹{gstPeriodSummary.netTaxLiability.toFixed(2)}
                </div>
                <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                  Gross Sales: ₹{gstPeriodSummary.netInvoiceValue.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Pre-Export Validation Status Bar */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                {gstExportValidation.isValid && gstSettings.gstin ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" /> GSTR-1 &amp; CSV Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    <AlertTriangle className="w-3 h-3" /> Action Needed for GSTR-1 JSON
                  </span>
                )}
                <span className="text-slate-600 dark:text-slate-300">
                  {gstSettings.gstin
                    ? `Registered Seller GSTIN: ${gstSettings.gstin} (${gstSettings.stateCode} - ${gstSettings.stateName})`
                    : 'Seller GSTIN is currently blank (Unregistered Mode). Enter your 15-digit GSTIN below to enable GSTR-1 JSON export.'}
                </span>
              </div>
              {gstExportValidation.warnings.length > 0 && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  {gstExportValidation.warnings[0]}
                </span>
              )}
            </div>
          </div>

          {/* Business GST Profile & Configuration Form */}
          <form
            onSubmit={handleSaveGstSettings}
            className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                  Seller GSTIN &amp; Business Billing Configuration
                </h3>
                <p className="text-xs text-slate-500">
                  Saved in the backend database and Firebase Firestore. Updating these details applies to new invoices while preserving historical invoice snapshots.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold ${
                  gstSettings.gstin
                    ? gstLiveValidation.isValid
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}
              >
                {gstSettings.gstin
                  ? gstLiveValidation.isValid
                    ? `✓ Valid GSTIN (${gstLiveValidation.stateName})`
                    : `✕ ${gstLiveValidation.error}`
                  : 'Unregistered / No GSTIN Set'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  15-Digit Seller GSTIN (Leave blank if unregistered)
                </label>
                <input
                  type="text"
                  maxLength={15}
                  value={gstSettings.gstin}
                  onChange={(e) => {
                    const upper = e.target.value.toUpperCase();
                    const check = validateIndianGstin(upper);
                    setGstSettings((prev) => ({
                      ...prev,
                      gstin: upper,
                      stateCode: check.stateCode || prev.stateCode,
                      stateName: check.stateName || prev.stateName,
                    }));
                  }}
                  placeholder="e.g. 33AABCA1234C1Z..."
                  className="w-full px-3 py-2 font-mono font-bold uppercase rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Validated with Indian GSTN Modulo-36 checksum. Never fabricated.
                </span>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Legal Business Name (As on PAN / GST Certificate)
                </label>
                <input
                  type="text"
                  required
                  value={gstSettings.legalBusinessName}
                  onChange={(e) => setGstSettings({ ...gstSettings, legalBusinessName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Trade / Brand Name
                </label>
                <input
                  type="text"
                  required
                  value={gstSettings.tradeName}
                  onChange={(e) => setGstSettings({ ...gstSettings, tradeName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Principal Place of Business (Seller State Code)
                </label>
                <select
                  value={gstSettings.stateCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    const st = INDIAN_STATES_AND_UTS.find((s) => s.code === code);
                    setGstSettings({
                      ...gstSettings,
                      stateCode: code,
                      stateName: st ? st.name : gstSettings.stateName,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  {INDIAN_STATES_AND_UTS.filter((s) => s.code !== '96').map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Default HSN / SAC Code (OIDAR / e-Publishing)
                </label>
                <input
                  type="text"
                  required
                  value={gstSettings.defaultSacCode}
                  onChange={(e) => setGstSettings({ ...gstSettings, defaultSacCode: e.target.value })}
                  className="w-full px-3 py-2 font-mono rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Applicable GST Rate (%) &amp; Invoice Prefix
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={gstSettings.applicableGstRate}
                    onChange={(e) =>
                      setGstSettings({ ...gstSettings, applicableGstRate: Number(e.target.value) })
                    }
                    className="px-3 py-2 font-mono rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  >
                    <option value={18}>18% GST</option>
                    <option value={12}>12% GST</option>
                    <option value={5}>5% GST</option>
                    <option value={0}>0% Exempt</option>
                  </select>
                  <input
                    type="text"
                    value={gstSettings.invoicePrefix}
                    onChange={(e) =>
                      setGstSettings({ ...gstSettings, invoicePrefix: e.target.value.toUpperCase() })
                    }
                    placeholder="INV-GST"
                    className="px-3 py-2 font-mono uppercase rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Registered Business Address (Printed on Tax Invoices)
                </label>
                <input
                  type="text"
                  required
                  value={gstSettings.registeredAddress}
                  onChange={(e) => setGstSettings({ ...gstSettings, registeredAddress: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer w-full">
                  <input
                    type="checkbox"
                    checked={gstSettings.applyGstToDomesticSales}
                    onChange={(e) =>
                      setGstSettings({ ...gstSettings, applyGstToDomesticSales: e.target.checked })
                    }
                    className="rounded text-amber-500 focus:ring-amber-500"
                  />
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Enable GST-Inclusive Split at Checkout
                  </span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-400 font-mono">
                Last Updated: {new Date(gstSettings.updatedAt).toLocaleString()} by {gstSettings.updatedByEmail || 'Administrator'}
              </span>
              <button
                type="submit"
                disabled={gstSaving}
                aria-busy={gstSaving}
                data-loading={gstSaving ? 'true' : 'false'}
                className={processingClass(
                  gstSaving,
                  'py-2.5 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {gstSaving ? 'Saving & Syncing...' : 'Save GST Profile to Database & Firestore'}
              </button>
            </div>
          </form>

          {/* GST Tax Invoice & Credit Note Register Table */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                  Customer Tax Invoices &amp; Refund Credit Notes Register ({gstPeriodSummary.filteredInvoices.length} Invoices)
                </h3>
                <p className="text-xs text-slate-500">
                  Download individual customer PDF Tax Invoices or issue GST Credit Notes for refunded transactions.
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={gstInvoiceSearch}
                  onChange={(e) => setGstInvoiceSearch(e.target.value)}
                  placeholder="Search invoice #, email, GSTIN..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Invoice # / Date</th>
                    <th className="p-3">Customer / B2B GSTIN</th>
                    <th className="p-3">Place of Supply</th>
                    <th className="p-3">Taxable Value</th>
                    <th className="p-3">CGST + SGST</th>
                    <th className="p-3">IGST</th>
                    <th className="p-3">Total (Incl. GST)</th>
                    <th className="p-3">Status / Credit Note</th>
                    <th className="p-3">3. PDF Bill &amp; Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {gstPeriodSummary.filteredInvoices.length === 0 && (
                    <tr className="bg-amber-500/5">
                      <td colSpan={9} className="p-6 text-center space-y-3">
                        <div className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                          No customer bills recorded for {formatPeriodHumanLabel(gstPeriodFilter)} (Nil Return Period — ₹0.00 GST Liability)
                        </div>
                        <p className="text-[11px] text-slate-500 max-w-xl mx-auto">
                          Even when there are 0 bills in this month, you can download the official Nil-Return Monthly GST Statement (PDF, CSV, or GSTR-1 JSON) below to file your Nil Return on the GST Portal.
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleExportMonthlyStatementPdf()}
                            className="py-2 px-3.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-amber-400" />
                            <span>Download Nil Monthly Statement (PDF)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExportGstCsv()}
                            className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Nil Monthly Statement (CSV)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExportGstr1Json()}
                            className="py-2 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Nil GSTR-1 JSON ({gstPeriodFilter})</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {gstPeriodSummary.filteredInvoices
                    .filter((inv: Purchase) => {
                      if (!gstInvoiceSearch.trim()) return true;
                      const q = gstInvoiceSearch.toLowerCase();
                      return (
                        (inv.invoiceNumber || inv.receiptNumber).toLowerCase().includes(q) ||
                        inv.userEmail.toLowerCase().includes(q) ||
                        (inv.customerGstin || '').toLowerCase().includes(q) ||
                        inv.comicTitle.toLowerCase().includes(q)
                      );
                    })
                    .map((inv: Purchase) => {
                      const linkedCn = creditNotes.find(
                        (cn) => cn.originalPurchaseId === inv.id || cn.id === inv.creditNoteId
                      );
                      return (
                        <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="p-3 font-mono">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {inv.invoiceNumber || inv.receiptNumber}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {new Date(inv.createdAt).toLocaleDateString()} · SAC {inv.hsnSacCode}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {inv.userEmail}
                            </div>
                            {inv.customerGstin ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                B2B: {inv.customerGstin}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">B2CS Consumer</span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {inv.placeOfSupplyStateCode} - {inv.placeOfSupplyStateName}
                          </td>
                          <td className="p-3 font-mono font-semibold text-slate-800 dark:text-slate-200">
                            ₹{(inv.taxableValue || 0).toFixed(2)}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-amber-600 dark:text-amber-400">
                            {inv.taxType === 'CGST_SGST'
                              ? `₹${(inv.cgstAmount || 0).toFixed(2)} + ₹${(inv.sgstAmount || 0).toFixed(2)}`
                              : '—'}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-sky-600 dark:text-sky-400">
                            {inv.taxType === 'IGST' ? `₹${(inv.igstAmount || 0).toFixed(2)}` : '—'}
                          </td>
                          <td className="p-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            ₹{inv.amountInr.toFixed(2)}
                          </td>
                          <td className="p-3">
                            {inv.status === 'refunded' || linkedCn ? (
                              <div className="space-y-0.5">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 inline-block">
                                  Refunded (CDNR)
                                </span>
                                {linkedCn && (
                                  <div className="text-[10px] font-mono text-rose-400">
                                    CN: {linkedCn.creditNoteNumber}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                Active Tax Invoice
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => handleDownloadPdfBill(inv)}
                                className="py-1.5 px-2.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                title="Download Customer GST Tax Invoice in PDF format"
                              >
                                <Download className="w-3 h-3 text-amber-400" />
                                <span>Invoice PDF</span>
                              </button>

                              {linkedCn ? (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadPdfBill(inv, linkedCn)}
                                  className="py-1.5 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                  title="Download GST Credit Note in PDF format"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>Credit Note PDF</span>
                                </button>
                              ) : (
                                inv.status === 'success' && (
                                  <button
                                    type="button"
                                    onClick={() => handleRefund(inv.id)}
                                    className="py-1.5 px-2.5 rounded-lg border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 text-[10px] font-bold cursor-pointer"
                                    title="Refund transaction and issue GST Credit Note"
                                  >
                                    Issue Credit Note
                                  </button>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
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
                Inspect each creator&apos;s profile photo and sample comic pages below before approving their application.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {applications.map((app) => {
              const samplePages =
                Array.isArray(app.sampleImages) && app.sampleImages.length > 0
                  ? app.sampleImages
                  : [
                      '/src/assets/images/comic_cover_mystic_1794269871981.jpg',
                      '/src/assets/images/comic_cover_blade_1794269871791.jpg',
                      '/src/assets/images/comic_cover_cyber_1794269871978.jpg',
                    ];
              const avatarUrl =
                app.authorAvatar ||
                `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(app.authorName)}`;

              return (
                <div
                  key={app.id}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="flex items-center gap-3.5">
                      <img
                        src={avatarUrl}
                        alt={app.authorName}
                        className="w-16 h-16 rounded-2xl object-cover border-2 border-rose-500/40 shadow-md shrink-0"
                      />
                      <div>
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-500 border border-rose-500/20 mb-1">
                          Author Profile Photo &amp; Application
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-bold text-base text-slate-900 dark:text-white font-heading">
                            {app.authorName}
                          </h4>
                          <span className="text-xs text-slate-400 font-mono">({app.email})</span>
                          {app.status === 'pending' && (
                            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>Pending Approval</span>
                            </span>
                          )}
                          {app.status === 'approved' && (
                            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Approved by Admin</span>
                            </span>
                          )}
                          {app.status === 'rejected' && (
                            <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              <span>Rejected</span>
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                          Submitted on: {new Date(app.submittedAt).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {app.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            disabled={isRowActionLoading(`app-${app.id}-approve`) || isRowActionLoading(`app-${app.id}-reject`)}
                            aria-busy={isRowActionLoading(`app-${app.id}-approve`)}
                            data-loading={isRowActionLoading(`app-${app.id}-approve`) ? 'true' : 'false'}
                            onClick={() => handleAppAction(app.id, 'approve')}
                            className={processingClass(
                              isRowActionLoading(`app-${app.id}-approve`),
                              'py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer'
                            )}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{isRowActionLoading(`app-${app.id}-approve`) ? 'Approving...' : 'Approve Author'}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isRowActionLoading(`app-${app.id}-approve`) || isRowActionLoading(`app-${app.id}-reject`)}
                            aria-busy={isRowActionLoading(`app-${app.id}-reject`)}
                            data-loading={isRowActionLoading(`app-${app.id}-reject`) ? 'true' : 'false'}
                            onClick={() => handleAppAction(app.id, 'reject')}
                            className={processingClass(
                              isRowActionLoading(`app-${app.id}-reject`),
                              'py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer'
                            )}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{isRowActionLoading(`app-${app.id}-reject`) ? 'Rejecting...' : 'Reject'}</span>
                          </button>
                        </>
                      ) : (
                        <>
                          {app.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleAppAction(app.id, 'approve')}
                              className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                          )}
                          {app.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => handleAppAction(app.id, 'reject')}
                              className="py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleAppAction(app.id, 'pending')}
                            className="py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Set Pending</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
                    <div className="lg:col-span-5 space-y-3">
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                        <img
                          src={avatarUrl}
                          alt={app.authorName}
                          className="w-12 h-12 rounded-xl object-cover border border-rose-500/30 shrink-0"
                        />
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Uploaded Profile Photo
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white block">
                            {app.authorName}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">{app.email}</span>
                        </div>
                      </div>

                      <div>
                        <span className="font-semibold text-slate-400 block mb-0.5">Author Biography:</span>
                        <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                          {app.bio || 'None provided.'}
                        </p>
                        {app.portfolioUrl && (
                          <a
                            href={app.portfolioUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-rose-500 hover:underline font-semibold inline-block mt-1.5"
                          >
                            Portfolio Link ↗
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="lg:col-span-7 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 block">
                            Submitted Sample Comic
                          </span>
                          <h5 className="font-extrabold text-sm text-slate-900 dark:text-white">
                            {app.sampleComicTitle}
                          </h5>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewSampleApp({ ...app, sampleImages: samplePages });
                            setPreviewSamplePageIdx(0);
                          }}
                          className="py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-[11px] flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Read Sample Comic ({samplePages.length} Pages)</span>
                        </button>
                      </div>

                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                        {app.sampleSynopsis || 'Sample comic artwork submitted for administrator review.'}
                      </p>

                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <Images className="w-3.5 h-3.5 text-rose-500" />
                            <span>Sample Comic Pages ({samplePages.length} Uploaded Pages):</span>
                          </span>
                          <span>Click any page to enlarge</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {samplePages.map((imgUrl, idx) => (
                            <div
                              key={idx}
                              onClick={() => {
                                setPreviewSampleApp({ ...app, sampleImages: samplePages });
                                setPreviewSamplePageIdx(idx);
                              }}
                              className="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer hover:border-amber-500 transition-all shadow-xs"
                            >
                              <img
                                src={imgUrl}
                                alt={`${app.sampleComicTitle} Page ${idx + 1}`}
                                className="w-full h-28 object-cover group-hover:scale-105 transition-transform"
                              />
                              <div className="p-1.5 text-[10px] font-mono font-bold text-center bg-slate-900/80 text-white">
                                Sample Page {idx + 1}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Sample Comic Reader Modal for Admin Inspection */}
          {previewSampleApp && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
              <div className="w-full max-w-3xl max-h-[90vh] rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={
                        previewSampleApp.authorAvatar ||
                        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(previewSampleApp.authorName)}`
                      }
                      alt={previewSampleApp.authorName}
                      className="w-10 h-10 rounded-xl object-cover border border-rose-500/40"
                    />
                    <div>
                      <h4 className="font-extrabold text-sm text-slate-900 dark:text-white">
                        {previewSampleApp.sampleComicTitle} — Sample Comic Preview
                      </h4>
                      <span className="text-[11px] text-slate-500">
                        By {previewSampleApp.authorName} ({previewSampleApp.email})
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewSampleApp(null)}
                    className="py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 hover:text-white text-xs font-bold cursor-pointer transition-colors"
                  >
                    Close Preview ✕
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-slate-950 flex flex-col items-center space-y-4">
                  {previewSampleApp.sampleImages && previewSampleApp.sampleImages[previewSamplePageIdx] && (
                    <img
                      src={previewSampleApp.sampleImages[previewSamplePageIdx]}
                      alt={`Sample Page ${previewSamplePageIdx + 1}`}
                      className="max-h-[60vh] w-auto rounded-2xl border border-slate-800 shadow-2xl object-contain"
                    />
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={previewSamplePageIdx <= 0}
                      onClick={() => setPreviewSamplePageIdx((p) => Math.max(0, p - 1))}
                      className="py-1.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                    >
                      ← Previous Page
                    </button>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      Page {previewSamplePageIdx + 1} of {previewSampleApp.sampleImages?.length || 1}
                    </span>
                    <button
                      type="button"
                      disabled={
                        !previewSampleApp.sampleImages ||
                        previewSamplePageIdx >= previewSampleApp.sampleImages.length - 1
                      }
                      onClick={() =>
                        setPreviewSamplePageIdx((p) =>
                          Math.min((previewSampleApp.sampleImages?.length || 1) - 1, p + 1)
                        )
                      }
                      className="py-1.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                    >
                      Next Page →
                    </button>
                  </div>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900">
                  <span className="text-xs text-slate-500">
                    Status: <strong className="uppercase">{previewSampleApp.status}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleAppAction(previewSampleApp.id, 'approve');
                        setPreviewSampleApp(null);
                      }}
                      className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve Author</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleAppAction(previewSampleApp.id, 'reject');
                        setPreviewSampleApp(null);
                      }}
                      className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
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
                Merchant Receiving UPI ID (Customer Payments Sent Here)
              </label>
              <input
                type="text"
                placeholder="merchant@upi"
                value={settings.merchantUpiId || ''}
                onChange={(e) => setSettings({ ...settings, merchantUpiId: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-600 dark:text-slate-400">
                Merchant Display Name on UPI Apps
              </label>
              <input
                type="text"
                placeholder="Aathirai_Comic Official"
                value={settings.merchantUpiName || 'Aathirai_Comic Official'}
                onChange={(e) => setSettings({ ...settings, merchantUpiName: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              />
            </div>

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
                1 Month Premium Price (₹ INR)
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

      {/* TAB 10.5: COMPANY AD & SPONSORSHIP REQUESTS */}
      {activeTab === 'ad-requests' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
                Company In-Comic Ad Requests ({adRequests.filter(r => r.status === 'pending').length} Pending)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Brands requesting in-comic character promotions, sponsored pages, and episode sponsorships. Official contact:{' '}
                <strong className="font-mono text-amber-500">aathiraicomic@gmail.com</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={fetchAdminData}
              className="py-2 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Refresh Ad Requests</span>
            </button>
          </div>

          {adRequests.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              No company ad placement requests submitted yet. Companies can submit requests from the Home Page.
            </div>
          ) : (
            <div className="space-y-4">
              {adRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 text-xs"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-base font-extrabold text-slate-900 dark:text-white font-heading">
                        {req.companyName}
                      </h3>
                      <span className="px-2.5 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 text-[10px] font-bold uppercase">
                        {req.placementType === 'character_promotion'
                          ? 'In-Comic Character Promotion'
                          : req.placementType === 'sponsored_page'
                          ? 'Sponsored Comic Page'
                          : 'Episode Sponsor'}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          req.status === 'approved'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : req.status === 'contacted'
                            ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                            : req.status === 'rejected'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                      <span>Submitted: {new Date(req.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Full Entered Company Details Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Company / Brand Name
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white select-all">
                        {req.companyName}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Contact Person
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white select-all">
                        {req.contactName}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Work / Business Email
                      </span>
                      <a
                        href={`mailto:${req.contactEmail}`}
                        className="font-mono font-bold text-rose-600 dark:text-rose-400 hover:underline break-all select-all"
                      >
                        {req.contactEmail}
                      </a>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Phone / WhatsApp
                      </span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white select-all">
                        {req.contactPhone?.trim() ? req.contactPhone : 'Not provided'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Ad Placement Format
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {req.placementType === 'character_promotion'
                          ? 'In-Comic Character Promotion (Inside Comic Pages)'
                          : req.placementType === 'sponsored_page'
                          ? 'Full Sponsored Comic Page (Inside Episode)'
                          : 'Episode & Series Sponsor Banner'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Target Comic Series
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {req.targetComicTitle || 'Any Popular Comic Series'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Estimated Campaign Budget
                      </span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {req.budgetRange || 'Custom Campaign'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Request ID / Account
                      </span>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 break-all select-all">
                        {req.id}
                      </span>
                    </div>
                  </div>

                  {/* Exact Campaign Brief Entered by Company */}
                  <div className="p-4 rounded-xl bg-amber-50/40 dark:bg-slate-950 border border-amber-500/20 dark:border-slate-800 space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Campaign Description &amp; Character Promotion Request (As Entered)
                    </span>
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap select-text">
                      {req.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href={`mailto:${req.contactEmail}?subject=${encodeURIComponent(
                        `Re: Your Ad Placement Request for ${req.companyName} on Aathirai_Comic`
                      )}`}
                      className="py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold inline-flex items-center gap-1.5"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Reply via Email ({req.contactEmail})</span>
                    </a>
                    <button
                      type="button"
                      disabled={isRowActionLoading(`ad-${req.id}-contacted`)}
                      aria-busy={isRowActionLoading(`ad-${req.id}-contacted`)}
                      data-loading={isRowActionLoading(`ad-${req.id}-contacted`) ? 'true' : 'false'}
                      onClick={() => handleUpdateAdRequestStatus(req.id, 'contacted')}
                      className={processingClass(
                        isRowActionLoading(`ad-${req.id}-contacted`),
                        'py-1.5 px-3 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-sky-600 dark:text-sky-400 font-bold cursor-pointer'
                      )}
                    >
                      {isRowActionLoading(`ad-${req.id}-contacted`) ? 'Updating...' : 'Mark Contacted'}
                    </button>
                    <button
                      type="button"
                      disabled={isRowActionLoading(`ad-${req.id}-approved`)}
                      aria-busy={isRowActionLoading(`ad-${req.id}-approved`)}
                      data-loading={isRowActionLoading(`ad-${req.id}-approved`) ? 'true' : 'false'}
                      onClick={() => handleUpdateAdRequestStatus(req.id, 'approved')}
                      className={processingClass(
                        isRowActionLoading(`ad-${req.id}-approved`),
                        'py-1.5 px-3 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-600 dark:text-emerald-400 font-bold cursor-pointer'
                      )}
                    >
                      {isRowActionLoading(`ad-${req.id}-approved`) ? 'Approving...' : 'Approve Campaign'}
                    </button>
                    <button
                      type="button"
                      disabled={isRowActionLoading(`ad-${req.id}-rejected`)}
                      aria-busy={isRowActionLoading(`ad-${req.id}-rejected`)}
                      data-loading={isRowActionLoading(`ad-${req.id}-rejected`) ? 'true' : 'false'}
                      onClick={() => handleUpdateAdRequestStatus(req.id, 'rejected')}
                      className={processingClass(
                        isRowActionLoading(`ad-${req.id}-rejected`),
                        'py-1.5 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-rose-600 dark:text-rose-400 font-bold cursor-pointer'
                      )}
                    >
                      {isRowActionLoading(`ad-${req.id}-rejected`) ? 'Declining...' : 'Decline'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 11: AUDIT LOGS */}
      {activeTab === 'logs' && (() => {
        const monthBufferCount = activityLogMeta?.currentMonthCount ?? activityLogs.length;
        const monthLabel = activityLogMeta?.currentIstMonthLabel || 'Current Month';
        const todayDateLabel = activityLogMeta?.currentIstDayKey || 'Today (IST)';
        const pendingRetries = activityLogMeta?.archiveState?.pendingRetryMonths || [];
        return (
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                  Activity Logs — Today&apos;s Live Feed (IST)
                </h3>
                <p
                  onClick={handleSecretExportTap}
                  className="text-xs text-slate-500 select-none"
                >
                  {isLoadingActivityLogs && !activityLogsLoaded
                    ? 'Loading today’s activity logs...'
                    : `${activityLogs.length} ${activityLogs.length === 1 ? 'entry' : 'entries'} recorded today (IST)`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
                <button
                  type="button"
                  disabled={isLoadingActivityLogs}
                  aria-busy={isLoadingActivityLogs}
                  data-loading={isLoadingActivityLogs ? 'true' : 'false'}
                  onClick={() => fetchActivityLogs()}
                  className={processingClass(
                    isLoadingActivityLogs,
                    'py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer'
                  )}
                  title="Reload today's activity logs on demand"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isLoadingActivityLogs ? 'Loading...' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  disabled={isDownloadingMonthLogs !== null || monthBufferCount === 0}
                  aria-busy={isDownloadingMonthLogs === 'csv'}
                  data-loading={isDownloadingMonthLogs === 'csv' ? 'true' : 'false'}
                  onClick={() => handleDownloadActivityLogs('csv')}
                  className={processingClass(
                    isDownloadingMonthLogs === 'csv',
                    'py-2 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer'
                  )}
                  title={`Download all ${monthBufferCount} stored logs for ${monthLabel} as CSV`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {isDownloadingMonthLogs === 'csv' ? 'Exporting CSV...' : 'Download Month (CSV)'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isDownloadingMonthLogs !== null || monthBufferCount === 0}
                  aria-busy={isDownloadingMonthLogs === 'json'}
                  data-loading={isDownloadingMonthLogs === 'json' ? 'true' : 'false'}
                  onClick={() => handleDownloadActivityLogs('json')}
                  className={processingClass(
                    isDownloadingMonthLogs === 'json',
                    'py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer'
                  )}
                  title={`Download all ${monthBufferCount} stored logs for ${monthLabel} as JSON`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isDownloadingMonthLogs === 'json' ? 'Exporting...' : 'JSON'}</span>
                </button>
                <button
                  type="button"
                  disabled={isSendingSampleLogEmail}
                  aria-busy={isSendingSampleLogEmail}
                  data-loading={isSendingSampleLogEmail ? 'true' : 'false'}
                  onClick={handleSendSampleLogEmail}
                  className={processingClass(
                    isSendingSampleLogEmail,
                    'py-2 px-3 rounded-xl bg-emerald-600/10 hover:bg-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer'
                  )}
                  title="Send a sample monthly archive email (CSV + JSON) to Protected Backend Admin Gmail without deleting real logs"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>{isSendingSampleLogEmail ? 'Sending Sample...' : 'Test Email'}</span>
                </button>
                <button
                  type="button"
                  disabled={isArchivingLogs || monthBufferCount === 0}
                  onClick={() => {
                    setArchiveLogsFeedback(null);
                    setShowArchiveLogsModal(true);
                  }}
                  className="py-2 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  title="Email current month logs (CSV + JSON) to Protected Backend Admin Gmail and clear backend storage after confirmed delivery"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Archive &amp; Email Month</span>
                </button>
              </div>
            </div>

            {/* Scoped Storage, 1-Day Window & Automatic Month-End Archive Summary Strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Today&apos;s View (IST)</span>
                  <Clock className="w-3.5 h-3.5 text-rose-500" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
                    {activityLogs.length}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {todayDateLabel}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Showing today&apos;s entries since 12:00 AM IST.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Month Buffer ({monthLabel})</span>
                  <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
                    {monthBufferCount}
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    ₹{(activityLogMeta?.totalRevenueMonthInr ?? 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                  Admin: {activityLogMeta?.adminActionsMonthCount ?? 0} · ₹49: {activityLogMeta?.payments49MonthCount ?? 0} · ₹249: {activityLogMeta?.payments249MonthCount ?? 0}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Auto Month-End Email</span>
                  <Mail className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <p className="mt-1.5 text-xs font-bold text-slate-900 dark:text-white">
                  {activityLogMeta?.nextRolloverLabel || '1st of next month, 12:00 AM IST'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                  Sends CSV + JSON to Protected Backend Admin Gmail &amp; auto-clears after confirmed delivery.
                </p>
                {activityLogMeta?.archiveState?.lastArchivedAt && (
                  <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
                    Last archive: {activityLogMeta.archiveState.lastArchivedMonth} ({activityLogMeta.archiveState.lastArchivedCount ?? 0} logs)
                  </p>
                )}
              </div>
            </div>

            {pendingRetries.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="font-bold">
                    Pending automatic email retry for month(s): {pendingRetries.join(', ')}
                  </p>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    {activityLogMeta?.archiveState?.lastArchiveError ||
                      'Previous month logs are safely preserved in backend storage and will retry automatically until Gmail delivery succeeds.'}
                  </p>
                </div>
              </div>
            )}

            {archiveLogsFeedback && (
              <div
                className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-xs ${
                  archiveLogsFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
                }`}
              >
                <div className="flex items-start gap-2">
                  {archiveLogsFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  )}
                  <span className="font-medium leading-relaxed">{archiveLogsFeedback.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setArchiveLogsFeedback(null)}
                  className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
                  aria-label="Dismiss message"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {isLoadingActivityLogs && !activityLogsLoaded ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 animate-pulse"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="h-3.5 w-48 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-800/70" />
                    </div>
                    <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 shrink-0" />
                  </div>
                ))}
              </div>
            ) : activityLogs.length === 0 ? (
              <div className="p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-1.5">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  No Admin Panel or ₹49 / ₹249 payment logs recorded today (IST).
                </p>
                {monthBufferCount > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {monthBufferCount} {monthBufferCount === 1 ? 'entry is' : 'entries are'} stored for {monthLabel}. Use <span className="font-semibold">Download Month (CSV/JSON)</span> above to export the current month.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Only Admin Panel actions and verified ₹49 / ₹249 customer payments are stored.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {activityLogs.map((log) => {
                  const is249 = log.category === 'payment_249' || log.amountInr === 249;
                  const is49 = log.category === 'payment_49' || log.amountInr === 49;
                  return (
                    <div
                      key={log.id}
                      className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                              is249
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                                : is49
                                  ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25'
                                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25'
                            }`}
                          >
                            {is249 ? '₹249 Pass' : is49 ? '₹49 Pass' : 'Admin Panel'}
                          </span>
                          <span className="font-mono font-bold text-slate-900 dark:text-white">{log.action}</span>
                          <span className="text-slate-400">by {log.actorEmail}</span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 mt-1 break-words">{log.details}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono tabular-nums shrink-0">
                        {new Date(log.timestamp).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true,
                        })}{' '}
                        IST
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* HIDDEN 3-TAP CUSTOMER LOGIN DETAILS EXPORT GATEWAY MODAL */}
      {showCustomerExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden relative">
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-rose-500 to-emerald-500" />

            <div className="p-6 sm:p-7 space-y-5 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 inline-block mb-1">
                      Encrypted Admin Vault · Dual-OTP
                    </span>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white font-heading">
                      Customer Login Details Export
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseCustomerExportModal}
                  aria-label="Close export vault"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!customerExportSession ? (
                <>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Verify both your backend-stored Admin Gmail OTP and Mobile SMS OTP to obtain a 5-minute signed download authorization for customer login profiles.
                  </p>
                  <DualOtpSecurityPanel
                    purpose="customer_export"
                    recaptchaContainerId="firebase-recaptcha-export"
                    onVerified={handleCustomerExportVaultVerified}
                    onCancel={handleCloseCustomerExportModal}
                  />
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                      <div>
                        <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
                          Dual-OTP Verified · Vault Unlocked
                        </p>
                        <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                          HMAC-signed export session active
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-500">
                        Auto-Locks In
                      </span>
                      <span className="font-mono text-sm font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                        {String(Math.floor(exportVaultSecondsLeft / 60)).padStart(2, '0')}:
                        {String(exportVaultSecondsLeft % 60).padStart(2, '0')}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Customer Profiles
                      </span>
                      <span className="text-lg font-black font-mono tabular-nums text-slate-900 dark:text-white">
                        {customerExportSession.totalCustomers}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Security Scope
                      </span>
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 leading-snug block">
                        Full login profile · Password hashes &amp; tokens excluded
                      </span>
                    </div>
                  </div>

                  {exportVaultError && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>{exportVaultError}</span>
                    </div>
                  )}

                  {exportVaultSuccess && (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{exportVaultSuccess}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <button
                      type="button"
                      disabled={exportDownloadLoading !== null}
                      aria-busy={exportDownloadLoading === 'csv'}
                      data-loading={exportDownloadLoading === 'csv' ? 'true' : 'false'}
                      onClick={() => handleDownloadCustomerLogins('csv')}
                      className={processingClass(
                        exportDownloadLoading === 'csv',
                        'py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 transition-colors cursor-pointer'
                      )}
                    >
                      <Download className="w-4 h-4" />
                      <span>{exportDownloadLoading === 'csv' ? 'Exporting CSV...' : 'Download CSV'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={exportDownloadLoading !== null}
                      aria-busy={exportDownloadLoading === 'json'}
                      data-loading={exportDownloadLoading === 'json' ? 'true' : 'false'}
                      onClick={() => handleDownloadCustomerLogins('json')}
                      className={processingClass(
                        exportDownloadLoading === 'json',
                        'py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white border border-slate-700 font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer'
                      )}
                    >
                      <Download className="w-4 h-4" />
                      <span>{exportDownloadLoading === 'json' ? 'Exporting JSON...' : 'Download JSON'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCloseCustomerExportModal}
                    className="w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Lock &amp; Close Vault</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MANUAL MONTH-END ACTIVITY LOG ARCHIVE & EMAIL CONFIRMATION MODAL */}
      {showArchiveLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0">
                    <Archive className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 dark:text-white font-heading">
                      Archive &amp; Email Month Logs
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {activityLogMeta?.currentIstMonthLabel || 'Current Month'} · {activityLogMeta?.currentMonthCount ?? 0} entries
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isArchivingLogs}
                  onClick={() => setShowArchiveLogsModal(false)}
                  aria-label="Close archive dialog"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <p>
                  1. Bundles all <strong className="text-slate-900 dark:text-white tabular-nums">{activityLogMeta?.currentMonthCount ?? 0}</strong> stored logs (Admin Panel + ₹49 / ₹249 payments) for <strong className="text-slate-900 dark:text-white">{activityLogMeta?.currentIstMonthLabel || 'this month'}</strong> as <strong className="text-slate-900 dark:text-white">both CSV and JSON</strong> attachments.
                </p>
                <p>
                  2. Emails the archive strictly to your <strong className="text-slate-900 dark:text-white">Protected Backend Admin Gmail</strong>.
                </p>
                <p>
                  3. Automatically clears these logs from backend &amp; Firestore storage <strong className="text-slate-900 dark:text-white">only after SMTP confirms delivery</strong>. If delivery fails, all logs stay preserved and retry automatically.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isArchivingLogs}
                  onClick={() => setShowArchiveLogsModal(false)}
                  className="py-2 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isArchivingLogs}
                  aria-busy={isArchivingLogs}
                  data-loading={isArchivingLogs ? 'true' : 'false'}
                  onClick={handleManualArchiveMonthLogs}
                  className={processingClass(
                    isArchivingLogs,
                    'py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer'
                  )}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>{isArchivingLogs ? 'Emailing & Clearing...' : 'Email Archive & Clear'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
