import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  BookOpen,
  User,
  Shield,
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
  UserPlus
} from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  openAuthModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab, openAuthModal }) => {
  const { user, role, logout, switchDemoRole, hasActivePremium } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [leftProfileOpen, setLeftProfileOpen] = useState(false);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'books', label: 'Books' },
    { id: 'authors', label: 'Authors' },
    { id: 'premium', label: 'Premium (₹49 / ₹249)' },
    { id: 'reader_login', label: 'Login / Register' },
    { id: 'about', label: 'About Us' },
    { id: 'terms', label: 'Terms & Conditions' },
    { id: 'copyright', label: 'Copyright' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* LEFT ZONE: Reader Profile & Login/Register on the Left */}
          <div className="flex items-center gap-2 shrink-0 relative">
            {user ? (
              <div className="flex items-center gap-2 relative">
                {/* Left Reader Profile Button */}
                <button
                  onClick={() => setLeftProfileOpen(!leftProfileOpen)}
                  title="Open Reader Profile & Gmail Paywall Status"
                  className={`flex items-center gap-2 py-1.5 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    currentTab === 'reader_profile' || leftProfileOpen
                      ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/20'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-5 h-5 rounded-full object-cover border border-white/40"
                  />
                  <span className="max-w-[95px] truncate font-bold">
                    {user.name.split(' ')[0]}
                  </span>
                  {hasActivePremium ? (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500 text-white font-extrabold">
                      {user.premiumPlan === '6_months' ? '6M ₹249' : '1M ₹49'}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/30">
                      Profile
                    </span>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                </button>

                {/* Direct Login / Register Button next to Profile */}
                <button
                  type="button"
                  onClick={() => setCurrentTab('reader_login')}
                  title="Open Login / Register Page (Record Paid Detail of Premium, Age & Gmail)"
                  className={`hidden sm:flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                    currentTab === 'reader_login'
                      ? 'bg-amber-500 text-slate-950 border-amber-500'
                      : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Login / Register</span>
                </button>

                {/* Left-Anchored Reader Profile Quick Drawer / Dropdown */}
                {leftProfileOpen && (
                  <div className="absolute left-0 top-12 w-80 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 space-y-3.5 animate-fade-in">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
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
                      <button
                        type="button"
                        onClick={() => setLeftProfileOpen(false)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Connected Gmail, Age & Paid Detail Summary */}
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-sky-500" /> Customer Age:
                        </span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {user.age ? `${user.age} Years` : '24 Years'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-amber-500" /> Mobile:
                        </span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {user.phone || 'Add in Profile'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Paid Premium Detail:</span>
                        {hasActivePremium ? (
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Paid ({user.premiumPlan === '6_months' ? '6M ₹249' : '1M ₹49'})
                          </span>
                        ) : (
                          <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Free (₹0 Unpaid)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setLeftProfileOpen(false);
                          setCurrentTab('reader_profile');
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" />
                          <span>Open My Reader Profile</span>
                        </span>
                        <span>→</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setLeftProfileOpen(false);
                          setCurrentTab('reader_login');
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          <UserPlus className="w-3.5 h-3.5 text-rose-400" />
                          <span>Login / Register (Record Paid Detail)</span>
                        </span>
                        <span>→</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setLeftProfileOpen(false);
                          setCurrentTab('premium');
                        }}
                        className="w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                          <span>Premium: 1M ₹49 · 6M ₹249</span>
                        </span>
                        <span>→</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setLeftProfileOpen(false);
                          logout();
                          setCurrentTab('reader_login');
                        }}
                        className="w-full py-2 px-3 rounded-xl hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out / Register New User</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentTab('reader_login')}
                  className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Login / Register</span>
                </button>
              </div>
            )}

            {/* Quick Role Switcher */}
            <div className="relative">
              <button
                onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                className="flex items-center gap-1 py-1.5 px-2.5 text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer"
                title="Switch persona or open Reader Profile"
              >
                <span>Role: <strong className="text-rose-600 dark:text-rose-400 capitalize">{role}</strong></span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {roleDropdownOpen && (
                <div className="absolute left-0 mt-1 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl py-1.5 text-xs z-50">
                  <div className="px-3 py-1 font-semibold text-slate-400 text-[10px] uppercase tracking-wider">
                    Reader &amp; Role Switcher
                  </div>
                  <button
                    onClick={() => {
                      switchDemoRole('reader');
                      setRoleDropdownOpen(false);
                      setCurrentTab('reader_profile');
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer ${
                      role === 'reader' ? 'text-rose-600 font-bold' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span>Reader Profile ({user?.name?.split(' ')[0] || 'Balaji'})</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 font-bold">Profile</span>
                  </button>
                  <button
                    onClick={() => {
                      setRoleDropdownOpen(false);
                      setCurrentTab('reader_login');
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    <span>Login / Register (Gmail, Age &amp; Paid)</span>
                    <Mail className="w-3 h-3 text-rose-500" />
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                  <button
                    onClick={() => {
                      switchDemoRole('author');
                      setRoleDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer ${
                      role === 'author' ? 'text-rose-600 font-bold' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span>Author (Rajesh)</span>
                    <PenTool className="w-3 h-3 text-emerald-500" />
                  </button>
                  {role === 'admin' && (
                    <button
                      onClick={() => {
                        switchDemoRole('admin');
                        setRoleDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer ${
                        role === 'admin' ? 'text-rose-600 font-bold' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span>Administrator</span>
                      <Shield className="w-3 h-3 text-amber-500" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* BRAND TITLE / LOGO */}
          <button
            onClick={() => setCurrentTab('home')}
            className="flex items-center gap-2 group text-left cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-600/20 group-hover:scale-105 transition-transform">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <span className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white uppercase font-heading">
                Aathirai<span className="text-rose-600 dark:text-rose-500">_Comic</span>
              </span>
              <p className="text-[9px] tracking-wider text-slate-500 dark:text-slate-400 uppercase -mt-1 font-semibold">
                Manga &amp; Webtoon Network
              </p>
            </div>
          </button>

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

          {/* RIGHT ACTIONS: Dashboards & Theme Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {role === 'author' && (
              <button
                onClick={() => setCurrentTab('author_dashboard')}
                className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  currentTab === 'author_dashboard'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Author Studio</span>
              </button>
            )}

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            {/* Mobile Menu Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE NAVIGATION DRAWER */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 pt-2 pb-4 space-y-2">
          <button
            onClick={() => {
              setCurrentTab('reader_login');
              setMobileMenuOpen(false);
            }}
            className="block w-full text-left py-2 px-3 rounded-md text-sm font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30"
          >
            Login / Register (Record Paid Detail, Age &amp; Gmail)
          </button>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`block w-full text-left py-2 px-3 rounded-md text-sm font-medium ${
                currentTab === item.id
                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
          {role === 'author' && (
            <button
              onClick={() => { setCurrentTab('author_dashboard'); setMobileMenuOpen(false); }}
              className="w-full text-left py-2 px-3 rounded-md text-sm font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 flex items-center gap-2"
            >
              <PenTool className="w-4 h-4" /> Author Studio
            </button>
          )}
        </div>
      )}
    </header>
  );
};
