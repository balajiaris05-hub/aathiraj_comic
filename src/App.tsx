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
import { AboutUsPage } from './pages/AboutUsPage';
import { TermsPage } from './pages/TermsPage';
import { CopyrightPage } from './pages/CopyrightPage';
import { Comic } from './types/comic';

function MainAppContent() {
  const { user, role, refreshUser } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [selectedComic, setSelectedComic] = useState<Comic | null>(null);
  const [activeReaderEpisodeId, setActiveReaderEpisodeId] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [comics, setComics] = useState<Comic[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch comics catalog
  const fetchComics = async () => {
    try {
      const res = await fetch('/api/comics');
      const data = await res.json();
      if (data.comics) {
        setComics(data.comics);
        // If a comic was selected, update its reference
        if (selectedComic) {
          const updated = data.comics.find((c: Comic) => c.id === selectedComic.id);
          if (updated) setSelectedComic(updated);
        }
      }
    } catch (e) {
      console.error('Error fetching comics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComics();
  }, []);

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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      
      {/* Top Navbar */}
      <Navbar
        currentTab={selectedComic ? 'books' : currentTab}
        setCurrentTab={handleTabChange}
        openAuthModal={() => setAuthModalOpen(true)}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-8">
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
                comics={comics}
                onSelectComic={handleSelectComic}
                onOpenEpisode={handleOpenEpisode}
                setCurrentTab={handleTabChange}
              />
            )}

            {currentTab === 'books' && (
              <BooksPage
                comics={comics}
                onSelectComic={handleSelectComic}
              />
            )}

            {currentTab === 'authors' && (
              <AuthorsPage
                comics={comics}
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

            {currentTab === 'admin_dashboard' && (
              <AdminDashboard
                comics={comics}
                onRefreshComics={fetchComics}
                setCurrentTab={handleTabChange}
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
      />

      {/* Footer */}
      <Footer setCurrentTab={handleTabChange} />
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
