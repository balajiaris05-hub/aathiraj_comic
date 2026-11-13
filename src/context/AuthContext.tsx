import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types/comic';

export interface LoginExtraOptions {
  phone?: string;
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
  isLoggedIn: boolean;
  hasActivePremium: boolean;
  login: (
    credentialOrEmail: string,
    phoneOrOptions?: string | LoginExtraOptions,
    name?: string
  ) => Promise<LoginResult>;
  logout: () => void;
  switchDemoRole: (role: UserRole) => void;
  updateUser: (updated: Partial<User>) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Always start signed out (null) — never auto-login to a default account
  const [user, setUser] = useState<User | null>(null);

  const hasActivePremium = Boolean(
    user?.premiumPlan &&
    user?.premiumExpiresAt &&
    new Date(user.premiumExpiresAt).getTime() > Date.now()
  );

  const switchDemoRole = (targetRole: UserRole) => {
    setUser((prev) => {
      // If signed out, stay signed out — never auto-login to any default account
      if (!prev) {
        return null;
      }
      // Keep the exact same logged-in customer account & Premium subscription, only switching the workspace role
      return {
        ...prev,
        role: targetRole,
      };
    });
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: credentialOrEmail,
          email: credentialOrEmail.includes('@') ? credentialOrEmail : undefined,
          phone: opts.phone || (!credentialOrEmail.includes('@') ? credentialOrEmail : undefined),
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
        setUser(data.user);
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

  const logout = () => {
    setUser(null);
  };

  const updateUser = (updated: Partial<User>) => {
    if (user) {
      setUser({ ...user, ...updated });
    }
  };

  const refreshUser = async () => {
    if (!user) return;
    try {
      const [authorRes, statusRes] = await Promise.all([
        fetch(`/api/author/me?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}`),
        fetch(`/api/auth/reader-status?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}&phone=${encodeURIComponent(user.phone || '')}`),
      ]);
      const authorData = await authorRes.json();
      const statusData = await statusRes.json();

      setUser(prev => {
        if (!prev) return prev;
        let next = { ...prev };
        if (authorData?.application?.status === 'approved' && next.role !== 'author') {
          next.role = 'author';
        }
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
        return next;
      });
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    if (user?.email || user?.id) {
      refreshUser();
    }
  }, [user?.id, user?.email]);

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || 'reader',
        isLoggedIn: !!user,
        hasActivePremium,
        login,
        logout,
        switchDemoRole,
        updateUser,
        refreshUser,
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
