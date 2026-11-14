import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { AuthModal } from './components/AuthModal';
import { ComicReader } from './components/ComicReader';
import { HomePage } from './pages/HomePage';
import { BooksPage } from './pages/BooksPage';
import { ComicDetailsPage } from './pages/ComicDetailsPage';
import { AuthorsPage } from './pages/AuthorsPage';
import { BecomeAuthorPage } from './pages/BecomeAuthorPage';
import { AuthorDashboard } from './pages/AuthorDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { PremiumPage } from './pages/PremiumPage';
import { MyPurchasesPage } from './pages/MyPurchasesPage';
import { ReaderProfilePage } from './pages/ReaderProfilePage';
import { AboutUsPage } from './pages/AboutUsPage';
import { TermsPage } from './pages/TermsPage';
import { CopyrightPage } from './pages/CopyrightPage';
import { Comic, NotificationItem } from './types/comic';

function MainAppContent() {
  const { user, hasActivePremium, refreshNotifications } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>(() => {
    const path = window.location.pathname.toLowerCase();
    if (path === '/admin' || path === '/admin.com') {
      return 'admin_dashboard';
    }
    return 'home';
  });
  const [selectedComic, setSelectedComic] = useState<Comic | null>(null);
  const [activeReaderEpisodeId, setActiveReaderEpisodeId] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [comics, setComics] = useState<Comic[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch comics catalog (include pending & delete_requested so Author & Admin dashboards stay synced)
  const fetchComics = async () => {
    try {
      const res = await fetch('/api/comics?includePending=true');
      const data = await res.json();
      if (data.comics) {
        setComics(data.comics);
        // If a comic was selected, update its reference
        if (selectedComic) {
          const updated = data.comics.find((c: Comic) => c.id === selectedComic.id);
          if (updated) setSelectedComic(updated);
        }
      }
      await refreshNotifications();
    } catch (e) {
      console.error('Error fetching comics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComics();
  }, []);

  const publicComics = comics.filter(
    (c) => c.moderationStatus === 'approved' || c.moderationStatus === 'delete_requested'
  );

  const handleTabChange = (tab: string) => {
    setSelectedComic(null);
    setCurrentTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectComic = (comic: Comic) => {
    setSelectedComic(comic);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenEpisode = (episodeId: string) => {
    setActiveReaderEpisodeId(episodeId);
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    const targetComicId = notification.comicId || notification.targetId;
    const targetComic = targetComicId ? comics.find((c) => c.id === targetComicId) : undefined;

    if (!targetComic) {
      if (notification.type === 'author_approved' || notification.type === 'comic_approved' || notification.type === 'comic_rejected') {
        handleTabChange('author_dashboard');
      }
      return;
    }

    const isComicPaywalled =
      Boolean(notification.isPaywalled) ||
      targetComic.accessType === 'premium' ||
      Boolean(
        targetComic.chapters?.some(
          (ch) =>
            ch.isPremium ||
            ch.episodes?.some((ep) =>
              notification.episodeId ? ep.id === notification.episodeId && ep.isPremium : ep.isPremium
            )
        )
      );

    if (!isComicPaywalled) {
      handleSelectComic(targetComic);
      return;
    }

    // Comic/episode is under paywall: verify whether customer has paid (active subscription or individual comic/episode purchase)
    if (hasActivePremium) {
      handleSelectComic(targetComic);
      return;
    }

    if (user) {
      try {
        const res = await fetch(
          `/api/payments/my-purchases?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email || '')}&phone=${encodeURIComponent(user.phone || '')}`
        );
        if (res.ok) {
          const data = await res.json();
          const purchases = Array.isArray(data.purchases) ? data.purchases : [];
          const hasPaidForTarget = purchases.some(
            (p: any) =>
              p.status === 'success' &&
              (p.itemType === 'subscription' ||
                (p.itemType === 'comic' && p.targetId === targetComic.id) ||
                (notification.episodeId && p.itemType === 'episode' && p.targetId === notification.episodeId))
          );
          if (hasPaidForTarget) {
            handleSelectComic(targetComic);
            return;
          }
        }
      } catch {
        // fall through to premium plans page
      }
    }

    // Customer has not paid for this paywalled comic/episode -> direct to Premium Plans page
    handleTabChange('premium');
  };

  const isAdminView = currentTab === 'admin_dashboard' || currentTab === 'admin_dashboard_delete_requests';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      
      {/* Top Navbar - Hidden when viewing dedicated separate Admin Console */}
      {!isAdminView && (
        <Navbar
          currentTab={selectedComic ? 'books' : currentTab}
          setCurrentTab={handleTabChange}
          openAuthModal={() => setAuthModalOpen(true)}
          onNotificationClick={handleNotificationClick}
        />
      )}

      {/* Main Content Viewport */}
      <main className={`flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 ${isAdminView ? 'pt-4 max-w-7xl' : 'pt-8 max-w-7xl'}`}>
        {selectedComic ? (
          <ComicDetailsPage
            comic={selectedComic}
            onBack={() => setSelectedComic(null)}
            onOpenEpisode={handleOpenEpisode}
            openAuthModal={() => setAuthModalOpen(true)}
          />
        ) : (
          <>
            {currentTab === 'home' && (
              <HomePage
                comics={publicComics}
                onSelectComic={handleSelectComic}
                onOpenEpisode={handleOpenEpisode}
                setCurrentTab={handleTabChange}
              />
            )}

            {currentTab === 'books' && (
              <BooksPage
                comics={publicComics}
                onSelectComic={handleSelectComic}
              />
            )}

            {currentTab === 'authors' && (
              <AuthorsPage
                comics={publicComics}
                onSelectComic={handleSelectComic}
                setCurrentTab={handleTabChange}
              />
            )}

            {currentTab === 'become_author' && (
              <BecomeAuthorPage
                setCurrentTab={handleTabChange}
                openAuthModal={() => setAuthModalOpen(true)}
              />
            )}

            {currentTab === 'author_dashboard' && (
              <AuthorDashboard
                comics={comics}
                onRefreshComics={fetchComics}
                onOpenEpisode={handleOpenEpisode}
                setCurrentTab={handleTabChange}
              />
            )}

            {(currentTab === 'admin_dashboard' || currentTab === 'admin_dashboard_delete_requests') && (
              <AdminDashboard
                comics={comics}
                onRefreshComics={fetchComics}
                setCurrentTab={handleTabChange}
                initialSubTab={currentTab === 'admin_dashboard_delete_requests' ? 'delete-requests' : undefined}
              />
            )}

            {(currentTab === 'reader_profile' || currentTab === 'reader_login') && (
              <ReaderProfilePage
                comics={publicComics}
                onSelectComic={handleSelectComic}
                onOpenEpisode={handleOpenEpisode}
                setCurrentTab={handleTabChange}
                initialMode={currentTab === 'reader_login' ? 'login' : 'profile'}
              />
            )}

            {currentTab === 'premium' && (
              <PremiumPage
                openAuthModal={() => setAuthModalOpen(true)}
                setCurrentTab={handleTabChange}
              />
            )}

            {currentTab === 'purchases' && (
              <MyPurchasesPage
                comics={comics}
                onOpenEpisode={handleOpenEpisode}
                setCurrentTab={handleTabChange}
                openAuthModal={() => setAuthModalOpen(true)}
              />
            )}

            {currentTab === 'about' && (
              <AboutUsPage setCurrentTab={handleTabChange} />
            )}

            {currentTab === 'terms' && (
              <TermsPage />
            )}

            {currentTab === 'copyright' && (
              <CopyrightPage />
            )}
          </>
        )}
      </main>

      {/* Global Interactive Comic Reader Overlay */}
      {activeReaderEpisodeId && (
        <ComicReader
          episodeId={activeReaderEpisodeId}
          onClose={() => setActiveReaderEpisodeId(null)}
          onSelectEpisode={(epId) => setActiveReaderEpisodeId(epId)}
          openAuthModal={() => setAuthModalOpen(true)}
        />
      )}

      {/* Global Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onOpenFullReaderPage={() => handleTabChange(user ? 'reader_profile' : 'reader_login')}
      />

      {/* Footer - Hidden when viewing dedicated separate Admin Console */}
      {!isAdminView && <Footer setCurrentTab={handleTabChange} />}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainAppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
