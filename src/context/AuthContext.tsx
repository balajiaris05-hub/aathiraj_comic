import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types/comic';

interface AuthContextType {
  user: User | null;
  role: UserRole;
  isLoggedIn: boolean;
  login: (email: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  switchDemoRole: (role: UserRole) => void;
  updateUser: (updated: Partial<User>) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to Balaji Reader as requested in prompt metadata
  const [user, setUser] = useState<User | null>({
    id: 'usr_reader',
    name: 'Balaji Reader',
    email: 'balajiaris05@gmail.com',
    role: 'reader',
    isVerified: true,
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&h=200&q=80',
    bio: 'Avid comic book lover, manhwa enthusiast, and collector of Indian mythic manga.',
    createdAt: '2026-02-01T00:00:00Z',
  });

  const switchDemoRole = (role: UserRole) => {
    if (role === 'admin') {
      setUser({
        id: 'usr_admin',
        name: 'Aathirai Editorial Admin',
        email: 'admin@aathirai.com',
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
        role: 'reader',
        isVerified: true,
        avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&h=200&q=80',
        bio: 'Avid comic book lover, manhwa enthusiast, and collector of Indian mythic manga.',
        createdAt: '2026-02-01T00:00:00Z',
      });
    }
  };

  const login = async (email: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setUser(data.user);
        return { success: true };
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
      const res = await fetch(`/api/author/me?userId=${user.id}&email=${user.email}`);
      const data = await res.json();
      if (data.application?.status === 'approved' && user.role !== 'author') {
        setUser({ ...user, role: 'author' });
      }
    } catch (e) {
      // ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || 'reader',
        isLoggedIn: !!user,
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
