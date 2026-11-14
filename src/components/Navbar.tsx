import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  BookOpen,
  User,
  PenTool,
  Sun,
  Moon,
  LogOut,
  Sparkles,
  Menu,
  X,
  ChevronDown,
  Mail,
  Phone,
  CheckCircle2,
  Lock,
  Calendar,
  UserPlus,
  Bell,
  CheckCheck,
} from 'lucide-react';

import { NotificationItem } from '../types/comic';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  openAuthModal: () => void;
  onNotificationClick?: (notification: NotificationItem) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab, onNotificationClick }) => {
  const {
    user,
    role,
    actualDbRole,
    isDevMode,
    logout,
    switchDemoRole,
    hasActivePremium,
    notifications,
    unreadNotificationsCount,
    markNotificationRead,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'books', label: 'Books' },
    { id: 'authors', label: 'Authors' },
    { id: 'premium', label: 'Premium (₹49 / ₹249)' },
    { id: 'about', label: 'About Us' },
    { id: 'terms', label: 'Terms & Conditions' },
    { id: 'copyright', label: 'Copyright' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
        {/* TOP HEADER ROW */}
        <div className="flex items-center justify-between h-12 sm:h-16 gap-1.5 sm:gap-3">
          {/* LEFT ZONE: Account Tab + Brand Logo */}
          <div className="flex items-center gap-1.5 sm:gap-4 min-w-0">
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAccountMenuOpen(!accountMenuOpen);
                  setNotifMenuOpen(false);
                }}
                title="Account: Profile, Login / Register & Role"
                className={`flex items-center gap-1 sm:gap-2 py-1 px-2 sm:py-2 sm:px-3 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-extrabold border transition-all cursor-pointer ${
                  accountMenuOpen || currentTab === 'reader_profile' || currentTab === 'reader_login'
                    ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/20'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-700'
                }`}
              >
                {user ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-4 h-4 sm:w-5 sm:h-5 rounded-full object-cover border border-white/40 shrink-0"
                  />
                ) : (
                  <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                )}
                <span>Account</span>
                <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Unified Account Dropdown */}
              {accountMenuOpen && (
                <div className="absolute left-0 top-10 sm:top-12 w-[calc(100vw-1rem)] max-w-[310px] sm:max-w-none sm:w-84 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-3.5 sm:p-4 z-50 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    {user ? (
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={user.avatar}
                          alt={user.name}
                          className="w-10 h-10 rounded-xl object-cover border border-rose-500/30 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                            {user.name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
                            <Mail className="w-3 h-3 text-rose-500 shrink-0" />
                            <span className="truncate">{user.email}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                        Customer Account Menu
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setAccountMenuOpen(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {user && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Database Account Role:</span>
                        <span className="font-mono font-bold uppercase text-rose-600 dark:text-rose-400">
                          {actualDbRole}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-sky-500" /> DOB / Age:
                        </span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {user.dob || '15/05/2002'} ({user.age ? `${user.age} yrs` : '24 yrs'})
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-amber-500" /> Mobile:
                        </span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {user.phone || '+91 8610950780'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Premium Status:</span>
                        {hasActivePremium ? (
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Active ({user.premiumPlan === '6_months' ? '6M ₹249' : '1M ₹49'})
                          </span>
                        ) : (
                          <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Free Reader
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Option 1: Login / Profile / Premium */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                      1. Account &amp; Membership
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setCurrentTab(user ? 'reader_profile' : 'reader_login');
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <UserPlus className="w-3.5 h-3.5 text-rose-400" />
                        <span>{user ? 'Reader Profile, Bookmarks & History' : 'Login / Register Account'}</span>
                      </span>
                      <span>→</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setCurrentTab('premium');
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>Premium Plans (₹49 / ₹249)</span>
                      </span>
                      <span>→</span>
                    </button>
                  </div>

                  {/* Option 2: Dev Role Switcher (strictly enabled in development mode only) */}
                  {isDevMode && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          2. Dev Mode View Switcher
                        </span>
                        <span className="text-[10px] font-bold uppercase text-rose-600 dark:text-rose-400">
                          {user ? `View: ${role}` : 'Signed Out'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setAccountMenuOpen(false);
                            if (!user) {
                              setCurrentTab('reader_login');
                              return;
                            }
                            switchDemoRole('reader');
                            setCurrentTab('reader_profile');
                          }}
                          className={`py-2 px-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                            user && role === 'reader'
                              ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <User className="w-3.5 h-3.5" />
                          <span>Reader</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setAccountMenuOpen(false);
                            if (!user) {
                              setCurrentTab('reader_login');
                              return;
                            }
                            switchDemoRole('author');
                            setCurrentTab('author_dashboard');
                          }}
                          className={`py-2 px-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                            user && role === 'author'
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <PenTool className="w-3.5 h-3.5" />
                          <span>Author</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {user && (
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        logout();
                        setCurrentTab('reader_login');
                      }}
                      className="w-full py-2 px-3 rounded-xl hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center justify-center gap-1.5 border-t border-slate-100 dark:border-slate-800 pt-2.5 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Brand Logo */}
            <button
              type="button"
              onClick={() => setCurrentTab('home')}
              className="flex items-center gap-1.5 sm:gap-2.5 group text-left cursor-pointer shrink-0"
            >
              <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-600/20 group-hover:scale-105 transition-transform shrink-0">
                <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="shrink-0">
                <span className="text-xs sm:text-lg font-extrabold tracking-tight text-slate-900 dark:text-white uppercase font-heading block whitespace-nowrap leading-tight">
                  Aathirai<span className="text-rose-600 dark:text-rose-500">_Comic</span>
                </span>
                <p className="text-[7px] sm:text-[9px] tracking-tight sm:tracking-wider text-slate-500 dark:text-slate-400 uppercase font-semibold whitespace-nowrap leading-tight">
                  Manga &amp; Webtoon Network
                </p>
              </div>
            </button>
          </div>

          {/* MAIN NAVIGATION LINKS (DESKTOP) */}
          <nav className="hidden lg:flex items-center gap-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`py-1 transition-colors hover:text-rose-600 dark:hover:text-rose-400 whitespace-nowrap cursor-pointer ${
                  currentTab === item.id
                    ? 'text-rose-600 dark:text-rose-400 border-b-2 border-rose-600 dark:border-rose-400 font-bold'
                    : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* RIGHT ACTIONS: Author Studio, Notification Center & Theme Toggle */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {(role === 'author' || actualDbRole === 'author') && (
              <button
                onClick={() => setCurrentTab('author_dashboard')}
                className={`flex items-center gap-1 py-1 px-2 sm:py-1.5 sm:px-3 rounded-lg text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer ${
                  currentTab === 'author_dashboard'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                }`}
              >
                <PenTool className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Author Studio</span>
              </button>
            )}

            {/* Notification Bell & Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifMenuOpen(!notifMenuOpen);
                  setAccountMenuOpen(false);
                }}
                title="Notifications"
                className="relative p-1.5 sm:p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-black flex items-center justify-center">
                    {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                  </span>
                )}
              </button>

              {notifMenuOpen && (
                <div className="absolute right-0 top-10 sm:top-12 w-80 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-rose-500" />
                      <span>Notifications ({unreadNotificationsCount} unread)</span>
                    </span>
                    {unreadNotificationsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => markNotificationRead()}
                        className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCheck className="w-3 h-3" />
                        <span>Mark all read</span>
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                    {notifications.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.map((n) => {
                        const isComicRelease = n.type === 'new_comic' || n.type === 'new_episode';
                        return (
                          <div
                            key={n.id}
                            onClick={() => {
                              markNotificationRead(n.id);
                              setNotifMenuOpen(false);
                              if (onNotificationClick) {
                                onNotificationClick(n);
                              }
                            }}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all hover:border-rose-500/50 ${
                              n.read
                                ? 'bg-slate-50 dark:bg-slate-950/60 border-slate-200/70 dark:border-slate-800/70 text-slate-600 dark:text-slate-400'
                                : 'bg-rose-500/5 border-rose-500/30 text-slate-900 dark:text-white shadow-sm'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 dark:text-white line-clamp-1">
                                {n.title}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                {new Date(n.createdAt).toLocaleDateString()}
                              </span>
                            </div>

                            {isComicRelease && (
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[9px] font-extrabold uppercase tracking-wider">
                                  {n.type === 'new_comic' ? 'New Comic' : 'New Episode'}
                                </span>
                                {n.isPaywalled ? (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold flex items-center gap-1">
                                    <Lock className="w-2.5 h-2.5" />
                                    <span>Paywall • Verify Access</span>
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold flex items-center gap-1">
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                    <span>Free to Read</span>
                                  </span>
                                )}
                                {n.gmailSent && (
                                  <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[9px] font-mono flex items-center gap-1">
                                    <Mail className="w-2.5 h-2.5" />
                                    <span>{n.gmailSentTo ? `Gmail: ${n.gmailSentTo}` : 'Gmail Alert Sent'}</span>
                                  </span>
                                )}
                              </div>
                            )}

                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1.5 leading-snug">
                              {n.message}
                            </p>

                            {isComicRelease && (
                              <div className="mt-1.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 flex items-center justify-between">
                                <span>
                                  {n.isPaywalled
                                    ? hasActivePremium
                                      ? 'Premium Verified — Click to Open Comic →'
                                      : 'Click to Verify Payment / View Premium Plans →'
                                    : 'Click to Read Comic Now →'}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-1.5 sm:p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            {/* Mobile Menu Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* COMPACT MOBILE WRAPPED NAVIGATION TABS */}
        <div className="lg:hidden flex flex-wrap items-center gap-1 py-1.5 border-t border-slate-200/70 dark:border-slate-800/70">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentTab(item.id)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors cursor-pointer ${
                currentTab === item.id
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-rose-500'
              }`}
            >
              {item.id === 'premium' ? 'Premium ₹49/₹249' : item.id === 'terms' ? 'Terms' : item.label}
            </button>
          ))}
          {(role === 'author' || actualDbRole === 'author') && (
            <button
              type="button"
              onClick={() => setCurrentTab('author_dashboard')}
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                currentTab === 'author_dashboard'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
              }`}
            >
              <PenTool className="w-2.5 h-2.5" />
              <span>Author Studio</span>
            </button>
          )}
        </div>
      </div>

      {/* MOBILE NAVIGATION DRAWER */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 pt-2 pb-3 space-y-1.5">
          <button
            onClick={() => {
              setCurrentTab(user ? 'reader_profile' : 'reader_login');
              setMobileMenuOpen(false);
            }}
            className="block w-full text-left py-2 px-3 rounded-md text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30"
          >
            {user ? 'Reader Profile & Bookmarks' : 'Login / Register Account'}
          </button>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`block w-full text-left py-1.5 px-3 rounded-md text-xs font-medium ${
                currentTab === item.id
                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
          {(role === 'author' || actualDbRole === 'author') && (
            <button
              onClick={() => {
                setCurrentTab('author_dashboard');
                setMobileMenuOpen(false);
              }}
              className="w-full text-left py-1.5 px-3 rounded-md text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 flex items-center gap-2"
            >
              <PenTool className="w-3.5 h-3.5" /> Author Studio
            </button>
          )}
        </div>
      )}
    </header>
  );
};
