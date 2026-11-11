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
  ShoppingBag,
  Menu,
  X,
  CreditCard,
  ChevronDown
} from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  openAuthModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab, openAuthModal }) => {
  const { user, role, logout, switchDemoRole } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'books', label: 'Books' },
    { id: 'authors', label: 'Authors' },
    { id: 'premium', label: 'Premium' },
    { id: 'about', label: 'About Us' },
    { id: 'terms', label: 'Terms & Conditions' },
    { id: 'copyright', label: 'Copyright' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* LEFT ZONE: Login / Register & User Account as requested by brief */}
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentTab('purchases')}
                  title="My Purchases & Receipts"
                  className="flex items-center gap-2 py-1.5 px-3 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 transition-colors"
                >
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-5 h-5 rounded-full object-cover"
                  />
                  <span className="hidden sm:inline max-w-[110px] truncate">{user.name.split(' ')[0]}</span>
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20">
                    {user.role}
                  </span>
                </button>

                <button
                  onClick={logout}
                  title="Log out"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={openAuthModal}
                className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all"
              >
                <User className="w-3.5 h-3.5" />
                <span>Login / Register</span>
              </button>
            )}

            {/* Quick Role Switcher for Testing Reader / Author / Admin seamlessly */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                className="flex items-center gap-1 py-1 px-2 text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 rounded border border-slate-200 dark:border-slate-800 transition-colors"
                title="Switch demo persona to test role permissions"
              >
                <span>Role: <strong className="text-rose-600 dark:text-rose-400 capitalize">{role}</strong></span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {roleDropdownOpen && (
                <div className="absolute left-0 mt-1 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
                  <div className="px-3 py-1 font-semibold text-slate-400 text-[10px] uppercase tracking-wider">Switch Persona</div>
                  <button
                    onClick={() => { switchDemoRole('reader'); setRoleDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between ${role === 'reader' ? 'text-rose-600 font-bold' : 'text-slate-700 dark:text-slate-300'}`}
                  >
                    <span>Reader (Balaji)</span>
                    <span className="text-[10px] text-slate-400">Default</span>
                  </button>
                  <button
                    onClick={() => { switchDemoRole('author'); setRoleDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between ${role === 'author' ? 'text-rose-600 font-bold' : 'text-slate-700 dark:text-slate-300'}`}
                  >
                    <span>Author (Rajesh)</span>
                    <PenTool className="w-3 h-3 text-emerald-500" />
                  </button>
                  {role === 'admin' && (
                    <button
                      onClick={() => { switchDemoRole('admin'); setRoleDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between ${role === 'admin' ? 'text-rose-600 font-bold' : 'text-slate-700 dark:text-slate-300'}`}
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
          <nav className="hidden lg:flex items-center gap-5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`py-1 transition-colors hover:text-rose-600 dark:hover:text-rose-400 whitespace-nowrap cursor-pointer ${
                  currentTab === item.id
                    ? 'text-rose-600 dark:text-rose-400 border-b-2 border-rose-600 dark:border-rose-400'
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
                className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${
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
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            {/* Mobile Menu Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE NAVIGATION DRAWER */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 pt-2 pb-4 space-y-2">
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
