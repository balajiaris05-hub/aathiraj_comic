import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, UserRole, NotificationItem, ReadingProgressItem } from '../types/comic';
import { getCurrentFirebaseIdToken, signOut as firebaseSignOut, auth } from '../firebase';

export interface LoginExtraOptions {
  phone?: string;
  countryCode?: string;
  countryName?: string;
  password?: string;
  name?: string;
  age?: number;
  dob?: string;
  notifyGmail?: boolean;
  notifyMobile?: boolean;
  upiId?: string;
  paidPlan?: '1_month' | '6_months' | 'free';
  paymentMethod?: string;
  transactionId?: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  user?: User;
  isLocked?: boolean;
  lockedUntil?: string | null;
  remainingAttempts?: number;
}

interface AuthContextType {
  user: User | null;
  role: UserRole;
  actualDbRole: UserRole;
  isDevMode: boolean;
  isLoggedIn: boolean;
  hasActivePremium: boolean;
  notifications: NotificationItem[];
  unreadNotificationsCount: number;
  getAuthHeaders: () => Promise<Record<string, string>>;
  login: (
    credentialOrEmail: string,
    phoneOrOptions?: string | LoginExtraOptions,
    name?: string
  ) => Promise<LoginResult>;
  logout: () => Promise<void>;
  switchDemoRole: (role: UserRole) => void;
  updateUser: (updated: Partial<User>) => void;
  refreshUser: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (notificationId?: string) => Promise<void>;
  toggleBookmark: (comicId: string) => Promise<boolean>;
  toggleFavorite: (comicId: string) => Promise<boolean>;
  saveReadingProgress: (item: Omit<ReadingProgressItem, 'updatedAt'>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'aathirai_auth_session_v2';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.user && parsed.expiresAt > Date.now()) {
          return parsed.user;
        }
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    return null;
  });

  // Development-only UI role preview switcher (strictly disabled in production, never alters actual backend DB permissions)
  const isDevMode = Boolean(import.meta.env.DEV);
  const [devPreviewRole, setDevPreviewRole] = useState<UserRole | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const persistSession = (nextUser: User | null) => {
    try {
      if (!nextUser) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } else {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({
            user: nextUser,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h automatic session expiration
          })
        );
      }
    } catch {
      // ignore storage errors
    }
  };

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const fbToken = await getCurrentFirebaseIdToken();
    if (fbToken) {
      headers['Authorization'] = `Bearer ${fbToken}`;
    } else if (user?.sessionToken) {
      headers['Authorization'] = `Bearer ${user.sessionToken}`;
    }
    return headers;
  }, [user?.sessionToken]);

  const hasActivePremium = Boolean(
    user?.premiumPlan &&
      user?.premiumExpiresAt &&
      new Date(user.premiumExpiresAt).getTime() > Date.now()
  );

  // Switch interface role ONLY in development mode; never mutates user.role or backend permissions
  const switchDemoRole = (targetRole: UserRole) => {
    if (!isDevMode) return;
    if (!user) return;
    setDevPreviewRole(targetRole);
  };

  const login = async (
    credentialOrEmail: string,
    phoneOrOptions?: string | LoginExtraOptions,
    nameArg?: string
  ): Promise<LoginResult> => {
    const opts: LoginExtraOptions =
      typeof phoneOrOptions === 'string'
        ? { phone: phoneOrOptions, name: nameArg }
        : phoneOrOptions || { name: nameArg };

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          credential: credentialOrEmail,
          email: credentialOrEmail.includes('@') ? credentialOrEmail : undefined,
          phone: opts.phone || (!credentialOrEmail.includes('@') ? credentialOrEmail : undefined),
          countryCode: opts.countryCode,
          countryName: opts.countryName,
          password: opts.password,
          name: opts.name,
          age: opts.age,
          dob: opts.dob,
          notifyGmail: opts.notifyGmail,
          notifyMobile: opts.notifyMobile,
          upiId: opts.upiId,
          paidPlan: opts.paidPlan,
          paymentMethod: opts.paymentMethod,
          transactionId: opts.transactionId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setDevPreviewRole(null);
        setUser(data.user);
        persistSession(data.user);
        return { success: true, user: data.user };
      }
      return {
        success: false,
        error: data.error || 'Login failed',
        isLocked: data.isLocked,
        lockedUntil: data.lockedUntil,
        remainingAttempts: data.remainingAttempts,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  const logout = async () => {
    try {
      if (auth.currentUser) {
        await firebaseSignOut(auth);
      }
    } catch {
      // ignore
    }
    setDevPreviewRole(null);
    setUser(null);
    setNotifications([]);
    persistSession(null);
  };

  const updateUser = (updated: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const merged = { ...prev, ...updated };
      persistSession(merged);
      return merged;
    });
  };

  const fetchNotifications = useCallback(async (u?: User | null) => {
    try {
      const query = u
        ? `?userId=${encodeURIComponent(u.id)}&email=${encodeURIComponent(u.email)}`
        : '';
      const res = await fetch(`/api/notifications${query}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    await fetchNotifications(user);
  }, [fetchNotifications, user]);

  const refreshUser = async () => {
    if (!user) return;
    try {
      const [authorRes, statusRes] = await Promise.all([
        fetch(`/api/author/me?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}`),
        fetch(
          `/api/auth/reader-status?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}&phone=${encodeURIComponent(user.phone || '')}`
        ),
      ]);
      const authorData = await authorRes.json();
      const statusData = await statusRes.json();

      setUser((prev) => {
        if (!prev) return prev;
        const next: User = { ...prev };
        if (statusData?.user?.role) {
          next.role = statusData.user.role;
        } else if (authorData?.application?.status === 'approved' && next.role === 'reader') {
          next.role = 'author';
        }
        if (statusData?.user?.bookmarks) next.bookmarks = statusData.user.bookmarks;
        if (statusData?.user?.favorites) next.favorites = statusData.user.favorites;
        if (statusData?.user?.readingHistory) next.readingHistory = statusData.user.readingHistory;
        if (statusData?.subscription) {
          next.premiumPlan = statusData.subscription.activePlan;
          next.premiumStartedAt = statusData.subscription.startedAt;
          next.premiumExpiresAt = statusData.subscription.expiresAt;
          next.premiumPaymentDetail = statusData.subscription.premiumPaymentDetail;
          if (statusData.subscription.age !== undefined) {
            next.age = statusData.subscription.age;
          }
          if (statusData.subscription.upiId) {
            next.upiId = statusData.subscription.upiId;
          }
          if (statusData.subscription.verifiedPhone && !next.phone) {
            next.phone = statusData.subscription.verifiedPhone;
          }
        }
        persistSession(next);
        return next;
      });
      await fetchNotifications(user);
    } catch {
      // ignore
    }
  };

  const markNotificationRead = async (notificationId?: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId: user?.id,
          email: user?.email,
          notificationId,
          markAll: !notificationId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
        } else {
          setNotifications((prev) =>
            prev.map((n) => (!notificationId || n.id === notificationId ? { ...n, read: true } : n))
          );
        }
      }
    } catch {
      // ignore
    }
  };

  const toggleBookmark = async (comicId: string): Promise<boolean> => {
    if (!user) return false;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/reader/bookmarks/toggle', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user.id, email: user.email, comicId }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.bookmarks)) {
        updateUser({ bookmarks: data.bookmarks });
        return Boolean(data.bookmarked);
      }
    } catch {
      // ignore
    }
    return false;
  };

  const toggleFavorite = async (comicId: string): Promise<boolean> => {
    if (!user) return false;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/reader/favorites/toggle', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user.id, email: user.email, comicId }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.favorites)) {
        updateUser({ favorites: data.favorites });
        return Boolean(data.favorited);
      }
    } catch {
      // ignore
    }
    return false;
  };

  const saveReadingProgress = async (item: Omit<ReadingProgressItem, 'updatedAt'>) => {
    if (!user) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/reader/progress', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user.id, email: user.email, ...item }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.readingHistory)) {
        updateUser({ readingHistory: data.readingHistory });
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (user?.email || user?.id) {
      refreshUser();
    } else {
      fetchNotifications(null);
    }
  }, [user?.id, user?.email, fetchNotifications]);

  const actualDbRole: UserRole = user?.role || 'reader';
  const effectiveUiRole: UserRole = isDevMode && devPreviewRole ? devPreviewRole : actualDbRole;
  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        role: effectiveUiRole,
        actualDbRole,
        isDevMode,
        isLoggedIn: !!user,
        hasActivePremium,
        notifications,
        unreadNotificationsCount,
        getAuthHeaders,
        login,
        logout,
        switchDemoRole,
        updateUser,
        refreshUser,
        refreshNotifications,
        markNotificationRead,
        toggleBookmark,
        toggleFavorite,
        saveReadingProgress,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
