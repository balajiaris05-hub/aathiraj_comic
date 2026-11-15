import React, { useState, useEffect, useRef } from 'react';
import { Comic } from '../types/comic';
import { useAuth } from '../context/AuthContext';
import {
  PenTool,
  ArrowRight,
  Camera,
  CheckCircle2,
  X,
  Star,
  BookOpen,
  Eye,
  Globe,
} from 'lucide-react';

interface AuthorsPageProps {
  comics: Comic[];
  onSelectComic: (comic: Comic) => void;
  setCurrentTab: (tab: string) => void;
}

interface AuthorListItem {
  id: string;
  name: string;
  role: string;
  avatar: string;
  bio: string;
  sampleComicTitle?: string;
  sampleImages?: string[];
  followers: string;
  totalReads: string;
  socialLinks?: {
    website?: string;
    instagram?: string;
    artstation?: string;
  };
}

export const AuthorsPage: React.FC<AuthorsPageProps> = ({
  comics,
  onSelectComic,
  setCurrentTab,
}) => {
  const { user, updateUser, getAuthHeaders } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [selectedAuthorModal, setSelectedAuthorModal] = useState<AuthorListItem | null>(null);

  const [authorsList, setAuthorsList] = useState<AuthorListItem[]>([]);

  const fetchAuthors = async () => {
    try {
      const res = await fetch('/api/authors');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.authors)) {
          const seen = new Set<string>();
          const uniqueAuthors = data.authors.filter((a: AuthorListItem) => {
            const k = `${(a.id || '').toLowerCase()}_${(a.name || '').toLowerCase()}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          setAuthorsList(uniqueAuthors);
        }
      }
    } catch {
      // Keep current list on transient error
    }
  };

  useEffect(() => {
    fetchAuthors();
  }, []);

  const handleUploadAuthorPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      setUploadingPhoto(true);
      setPhotoMessage(null);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/author/update-photo', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId: user?.id,
            email: user?.email || 'creator@aathirai.com',
            authorName: user?.name || 'Featured Author',
            authorAvatar: dataUrl,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          if (data.user && user) {
            updateUser(data.user);
          }
          await fetchAuthors();
          setPhotoMessage('Author photo uploaded and updated on the Author List!');
          setTimeout(() => setPhotoMessage(null), 4000);
        }
      } catch {
        // Ignore error
      } finally {
        setUploadingPhoto(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const getAuthorComics = (author: AuthorListItem) =>
    comics.filter(
      (c) =>
        c.authorId === author.id ||
        c.authorName.toLowerCase().includes(author.name.split(' ')[0].toLowerCase()) ||
        (author.sampleComicTitle &&
          c.title.toLowerCase().includes(author.sampleComicTitle.toLowerCase()))
    );

  return (
    <div className="space-y-10 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white font-heading">
            Featured Authors &amp; Comic Studios
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Meet the visionary artists and writers shaping Indian and global graphic storytelling.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUploadAuthorPhoto}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 text-rose-500" />
            <span>{uploadingPhoto ? 'Uploading Photo...' : 'Upload Author Photo'}</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab('become_author')}
            className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Apply to Publish</span>
          </button>
        </div>
      </div>

      {photoMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{photoMessage}</span>
        </div>
      )}

      {/* Authors Grid */}
      {authorsList.length === 0 ? (
        <div className="p-12 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4">
          <PenTool className="w-8 h-8 text-rose-500 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white font-heading">
              No Featured Authors Yet
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Approved comic creators and studios will appear here once applications are approved or comics are published.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCurrentTab('become_author')}
            className="py-2.5 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider inline-flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Apply to Publish</span>
          </button>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {authorsList.map((author, idx) => {
          const authorComics = getAuthorComics(author);
          const totalEpisodes = authorComics.reduce(
            (sum, c) => sum + c.chapters.reduce((s, ch) => s + ch.episodes.length, 0),
            0
          );
          const avgRating =
            authorComics.length > 0
              ? (
                  authorComics.reduce((sum, c) => sum + c.averageRating, 0) / authorComics.length
                ).toFixed(1)
              : '—';

          return (
            <div
              key={`${author.id}_${author.name}_${idx}`}
              className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-6"
            >
              <div className="space-y-4">
                <div
                  onClick={() => setSelectedAuthorModal(author)}
                  className="flex items-center gap-3.5 cursor-pointer group"
                >
                  <img
                    src={author.avatar}
                    alt={author.name}
                    className="w-14 h-14 rounded-2xl object-cover border-2 border-rose-500/20 shrink-0 group-hover:scale-105 transition-transform"
                  />
                  <div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-white group-hover:text-rose-500 transition-colors font-heading">
                      {author.name}
                    </h3>
                    <span className="text-xs text-rose-600 dark:text-rose-400 font-medium block">
                      {author.role}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{author.bio}</p>

                {author.sampleImages && author.sampleImages.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Sample Artwork ({author.sampleImages.length}):
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {author.sampleImages.slice(0, 3).map((imgUrl, idx) => (
                        <img
                          key={idx}
                          src={imgUrl}
                          alt={`${author.name} sample ${idx + 1}`}
                          className="w-full h-14 object-cover rounded-lg border border-slate-200 dark:border-slate-800"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex flex-wrap items-center gap-3 text-xs font-mono text-slate-500 border-t border-slate-100 dark:border-slate-800">
                  <span>
                    <strong>{author.totalReads}</strong> Reads
                  </span>
                  <span>·</span>
                  <span>
                    <strong>{totalEpisodes}</strong> Episodes
                  </span>
                  <span>·</span>
                  <span className="text-amber-500 font-bold">★ {avgRating}</span>
                </div>
              </div>

              {/* Author's Comics Mini Showcase */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Published Titles:
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedAuthorModal(author)}
                    className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    View Public Profile →
                  </button>
                </div>

                <div className="space-y-1.5">
                  {authorComics.length > 0 ? (
                    authorComics.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => onSelectComic(c)}
                        className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-rose-50/50 dark:hover:bg-rose-950/20 border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer group"
                      >
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-rose-500 truncate max-w-[200px]">
                          {c.title}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-500 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    ))
                  ) : author.sampleComicTitle ? (
                    <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {author.sampleComicTitle}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-500">Creator Series</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* PUBLIC AUTHOR PROFILE MODAL (Zero Private PII Exposed) */}
      {selectedAuthorModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={selectedAuthorModal.avatar}
                  alt={selectedAuthorModal.name}
                  className="w-16 h-16 rounded-2xl object-cover border-2 border-rose-500/30"
                />
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-white font-heading">
                    {selectedAuthorModal.name}
                  </h2>
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                    {selectedAuthorModal.role}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAuthorModal(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {selectedAuthorModal.bio}
            </p>

            {/* Public Stats */}
            {(() => {
              const pubComics = getAuthorComics(selectedAuthorModal);
              const epCount = pubComics.reduce(
                (sum, c) => sum + c.chapters.reduce((s, ch) => s + ch.episodes.length, 0),
                0
              );
              const avg =
                pubComics.length > 0
                  ? (pubComics.reduce((s, c) => s + c.averageRating, 0) / pubComics.length).toFixed(1)
                  : '—';
              return (
                <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center">
                  <div>
                    <div className="text-lg font-black text-slate-900 dark:text-white font-mono">
                      {pubComics.length}
                    </div>
                    <div className="text-[10px] uppercase font-bold text-slate-500">Published Series</div>
                  </div>
                  <div>
                    <div className="text-lg font-black text-slate-900 dark:text-white font-mono">
                      {epCount}
                    </div>
                    <div className="text-[10px] uppercase font-bold text-slate-500">Total Episodes</div>
                  </div>
                  <div>
                    <div className="text-lg font-black text-amber-500 font-mono">★ {avg}</div>
                    <div className="text-[10px] uppercase font-bold text-slate-500">Average Rating</div>
                  </div>
                </div>
              );
            })()}

            {selectedAuthorModal.socialLinks?.website && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Globe className="w-4 h-4 text-rose-500" />
                <a
                  href={selectedAuthorModal.socialLinks.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-rose-600 dark:text-rose-400 hover:underline font-mono"
                >
                  {selectedAuthorModal.socialLinks.website}
                </a>
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Published Works by {selectedAuthorModal.name}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {getAuthorComics(selectedAuthorModal).map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      setSelectedAuthorModal(null);
                      onSelectComic(c);
                    }}
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-rose-500 cursor-pointer"
                  >
                    <img src={c.coverImage} alt={c.title} className="w-12 h-16 rounded-lg object-cover" />
                    <div className="min-w-0">
                      <h5 className="text-xs font-bold text-slate-900 dark:text-white truncate">{c.title}</h5>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Eye className="w-3 h-3" /> {c.totalViews.toLocaleString()} views · ★ {c.averageRating}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
