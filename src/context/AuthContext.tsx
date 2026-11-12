import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types/comic';

export interface LoginExtraOptions {
  phone?: string;
  name?: string;
  age?: number;
  upiId?: string;
  paidPlan?: '1_month' | '6_months' | 'free';
  paymentMethod?: string;
  transactionId?: string;
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
  ) => Promise<{ success: boolean; error?: string; user?: User }>;
  logout: () => void;
  switchDemoRole: (role: UserRole) => void;
  updateUser: (updated: Partial<User>) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to Balaji Reader with Gmail, Age, UPI ID & Mobile linked for Admin tracking
  const [user, setUser] = useState<User | null>({
    id: 'usr_reader',
    name: 'Balaji Reader',
    email: 'balajiaris05@gmail.com',
    age: 24,
    phone: '+91 8610950780',
    upiId: 'balajiaris05@okaxis',
    role: 'reader',
    isVerified: true,
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&h=200&q=80',
    bio: 'Avid comic book lover, manhwa enthusiast, and collector of Indian mythic manga.',
    createdAt: '2026-02-01T00:00:00Z',
    premiumPlan: null,
  });

  const hasActivePremium = Boolean(
    user?.premiumPlan &&
    user?.premiumExpiresAt &&
    new Date(user.premiumExpiresAt).getTime() > Date.now()
  );

  const switchDemoRole = (role: UserRole) => {
    if (role === 'admin') {
      setUser({
        id: 'usr_admin',
        name: 'Aathirai Editorial Admin',
        email: 'admin@aathirai.com',
        age: 30,
        phone: '+91 8610950780',
        upiId: 'balajiaris05@okaxis',
        role: 'admin',
        isVerified: true,
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Chief Content Administrator and Publisher at Aathirai_Comic.',
        createdAt: '2026-01-01T00:00:00Z',
      });
    } else if (role === 'author') {
      setUser({
        id: 'usr_rajesh',
        name: 'Rajesh Singh',
        email: 'rajesh.singh@creator.in',
        age: 28,
        phone: '+91 9840123456',
        upiId: 'rajesh.singh@okicici',
        role: 'author',
        isVerified: true,
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Graphic novelist and manga creator. Creator of Virasen and Neo Madras 2099.',
        createdAt: '2026-01-15T00:00:00Z',
      });
    } else {
      setUser({
        id: 'usr_reader',
        name: 'Balaji Reader',
        email: 'balajiaris05@gmail.com',
        age: 24,
        phone: '+91 8610950780',
        upiId: 'balajiaris05@okaxis',
        role: 'reader',
        isVerified: true,
        avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Avid comic book lover, manhwa enthusiast, and collector of Indian mythic manga.',
        createdAt: '2026-02-01T00:00:00Z',
      });
    }
  };

  const login = async (
    credentialOrEmail: string,
    phoneOrOptions?: string | LoginExtraOptions,
    nameArg?: string
  ) => {
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
          name: opts.name,
          age: opts.age,
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
      return { success: false, error: data.error || 'Login failed' };
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
