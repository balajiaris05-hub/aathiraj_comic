import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { AuthorApplication } from '../types/comic';
import {
  PenTool,
  CheckCircle2,
  Clock,
  AlertCircle,
  Upload,
  ShieldCheck,
  Send,
  Camera,
  Image as ImageIcon,
  X,
  Users,
  BookOpen,
} from 'lucide-react';

interface BecomeAuthorPageProps {
  setCurrentTab: (tab: string) => void;
  openAuthModal: () => void;
}

export const BecomeAuthorPage: React.FC<BecomeAuthorPageProps> = ({
  setCurrentTab,
}) => {
  const { user, updateUser, switchDemoRole } = useAuth();
  const [authorName, setAuthorName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [authorAvatar, setAuthorAvatar] = useState<string>(user?.avatar || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [sampleComicTitle, setSampleComicTitle] = useState('');
  const [sampleSynopsis, setSampleSynopsis] = useState('');
  const [sampleImages, setSampleImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [existingApp, setExistingApp] = useState<AuthorApplication | null>(null);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authorPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const samplePhotosInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user) {
      if (!authorName) setAuthorName(user.name || '');
      if (!email) setEmail(user.email || '');
      if (!authorAvatar && user.avatar) setAuthorAvatar(user.avatar);
      fetch(`/api/author/me?userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.application) {
            setExistingApp(data.application);
            setAuthorName(data.application.authorName || user.name || '');
            setEmail(data.application.email || user.email || '');
            if (data.application.authorAvatar) {
              setAuthorAvatar(data.application.authorAvatar);
            }
            setBio(data.application.bio || '');
            setPortfolioUrl(data.application.portfolioUrl || '');
            setSampleComicTitle(data.application.sampleComicTitle || '');
            setSampleSynopsis(data.application.sampleSynopsis || '');
            if (Array.isArray(data.application.sampleImages) && data.application.sampleImages.length > 0) {
              setSampleImages(
                data.application.sampleImages.map((url: string, idx: number) => ({
                  name: `Sample Page ${idx + 1}`,
                  dataUrl: url,
                }))
              );
            }
          }
        })
        .catch(console.error);
    }
  }, [user?.id, user?.email]);

  const handleAuthorPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAuthorAvatar(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSamplePhotosSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const selectedFiles: File[] = Array.from(files);
    Promise.all(
      selectedFiles.map(
        (file) =>
          new Promise<{ name: string; dataUrl: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                name: file.name,
                dataUrl: typeof reader.result === 'string' ? reader.result : '',
              });
            };
            reader.readAsDataURL(file);
          })
      )
    ).then((loadedImages) => {
      const valid = loadedImages.filter((item) => item.dataUrl);
      setSampleImages((prev) => [...prev, ...valid]);
    });

    e.target.value = '';
  };

  const handleRemoveSamplePhoto = (index: number) => {
    setSampleImages((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorName.trim() || !email.trim() || !sampleComicTitle.trim()) {
      setError('Please enter your Author Name, Contact Email, and Sample Comic Title.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/author/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          authorName: authorName.trim(),
          email: email.trim(),
          authorAvatar: authorAvatar || undefined,
          bio: bio.trim(),
          portfolioUrl: portfolioUrl.trim(),
          sampleComicTitle: sampleComicTitle.trim(),
          sampleSynopsis: sampleSynopsis.trim(),
          samplePagesCount: sampleImages.length > 0 ? sampleImages.length : 1,
          sampleImages: sampleImages.map((img) => img.dataUrl),
        }),
      });

      const data = await res.json();
      setLoading(false);

      if (res.ok && data.application) {
        if (data.user) {
          updateUser(data.user);
        }
        setExistingApp(data.application);
        setIsEditingExisting(false);
        setSuccessMsg(
          data.message ||
            'Author photo & sample photos uploaded! Your profile is now live on the Author List and your account works as both Author and Reader.'
        );
      } else {
        setError(data.error || 'Failed to submit application');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  const samplePagesCount = sampleImages.length;

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-24">
      
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold">
          <PenTool className="w-3.5 h-3.5" />
          <span>Creator &amp; Reader Unified Account Program</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white font-heading">
          Become a Published Author on Aathirai_Comic
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Upload your Author Photo for the Author List and select multiple Sample Photos of your artwork. Completing this form activates your profile on the Author List while keeping your unified Reader &amp; Author account active.
        </p>
      </div>

      {/* 4-STEP APPLICATION PROCESS TIMELINE BANNER */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
          How Author &amp; Reader Unified Publishing Works:
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-rose-600 block mb-1">01. Author Photo</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Upload your creator photo to appear on the Author List.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-amber-500 block mb-1">02. Sample Photos</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Select multiple sample comic pages from your device.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-emerald-500 block mb-1">03. Dual Role Access</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Use the same account seamlessly as both Author and Reader.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-blue-500 block mb-1">04. Earn 70%</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Publish chapters and receive direct Indian INR payouts.</span>
          </div>
        </div>
      </div>

      {/* IF USER ALREADY HAS APPLICATION AND IS NOT EDITING */}
      {existingApp && !isEditingExisting ? (
        <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6 text-center">
          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {existingApp.status === 'pending' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                {existingApp.authorAvatar ? (
                  <img
                    src={existingApp.authorAvatar}
                    alt={existingApp.authorName}
                    className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-500 shadow-md"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 mx-auto flex items-center justify-center">
                    <Clock className="w-8 h-8 animate-pulse" />
                  </div>
                )}
                <span className="px-3 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[11px] font-extrabold uppercase tracking-wider">
                  Pending Administrator Approval
                </span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {existingApp.authorName} — Application Pending Approval
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
                Thank you, <strong className="text-slate-800 dark:text-slate-200">{existingApp.authorName}</strong>! Your profile photo and sample comic <span className="text-rose-500 font-semibold font-mono">&ldquo;{existingApp.sampleComicTitle}&rdquo;</span> have been sent to the Admin Console for approval.
              </p>

              {existingApp.sampleImages && existingApp.sampleImages.length > 0 && (
                <div className="max-w-lg mx-auto pt-2 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Submitted Sample Comic Pages ({existingApp.sampleImages.length}):
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {existingApp.sampleImages.map((imgUrl, idx) => (
                      <img
                        key={idx}
                        src={imgUrl}
                        alt={`Sample ${idx + 1}`}
                        className="w-full h-20 object-cover rounded-xl border border-slate-200 dark:border-slate-700"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setCurrentTab('authors')}
                  className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-md flex items-center gap-2 cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>View Author List</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    switchDemoRole('reader');
                    setCurrentTab('books');
                  }}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Browse as Reader</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingExisting(true)}
                  className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs uppercase tracking-wider cursor-pointer"
                >
                  Update Photo / Sample Photos
                </button>
              </div>
            </div>
          )}

          {existingApp.status === 'approved' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                {existingApp.authorAvatar ? (
                  <img
                    src={existingApp.authorAvatar}
                    alt={existingApp.authorName}
                    className="w-20 h-20 rounded-2xl object-cover border-2 border-emerald-500 shadow-md"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                )}
                <span className="px-3 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-extrabold uppercase tracking-wider">
                  Active as Both Author &amp; Reader
                </span>
              </div>

              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {existingApp.authorName} — Admin Approved to Upload Comics of Your Own!
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                {existingApp.adminNote || 'The Administrator has approved your creator account! You are approved to upload and publish comics of your own in the Author Studio, while also keeping full Reader access.'}
              </p>

              {existingApp.sampleImages && existingApp.sampleImages.length > 0 && (
                <div className="max-w-lg mx-auto pt-2 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Uploaded Sample Photos ({existingApp.sampleImages.length}):
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {existingApp.sampleImages.map((imgUrl, idx) => (
                      <img
                        key={idx}
                        src={imgUrl}
                        alt={`Sample ${idx + 1}`}
                        className="w-full h-20 object-cover rounded-xl border border-slate-200 dark:border-slate-700"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setCurrentTab('authors')}
                  className="py-3 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>View Author List</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    switchDemoRole('author');
                    setCurrentTab('author_dashboard');
                  }}
                  className="py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  <PenTool className="w-4 h-4" />
                  <span>Go to Author Studio &amp; Upload Your Comic</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    switchDemoRole('reader');
                    setCurrentTab('books');
                  }}
                  className="py-3 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Browse as Reader</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingExisting(true)}
                  className="py-3 px-5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs uppercase tracking-wider cursor-pointer"
                >
                  Update Photo / Sample Photos
                </button>
              </div>
            </div>
          )}

          {existingApp.status === 'rejected' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 mx-auto flex items-center justify-center">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Rejected by Admin — Reason Provided Below
              </h3>
              <div className="max-w-md mx-auto p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400 font-semibold">
                Why Admin Rejected: {existingApp.adminNote || 'Editorial note: Please provide higher resolution sample inks and submit an updated application.'}
              </div>
              <button
                type="button"
                onClick={() => setExistingApp(null)}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold cursor-pointer"
              >
                Submit New Application
              </button>
            </div>
          )}
        </div>
      ) : (
        /* APPLICATION SUBMISSION FORM */
        <form
          onSubmit={handleSubmit}
          className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6"
        >
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          {/* div 1: Author Name, Contact Email & Author Photo Upload Button for Author List */}
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Author / Studio Name *
                </label>
                <input
                  type="text"
                  required
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="e.g. Ananya Sundaram"
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Creator Contact Email *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="creator@studio.in"
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            {/* Author Photo Upload Button for Author List */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {authorAvatar ? (
                  <img
                    src={authorAvatar}
                    alt="Author Avatar Preview"
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-rose-500 shadow-sm shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500 flex items-center justify-center shrink-0">
                    <Camera className="w-7 h-7" />
                  </div>
                )}
                <div className="space-y-1 text-center sm:text-left">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white block">
                    Author Photo for Author List
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Click the button to upload your Author Photo so it appears on the Featured Authors list.
                  </p>
                </div>
              </div>

              <input
                ref={authorPhotoInputRef}
                type="file"
                accept="image/*"
                onChange={handleAuthorPhotoSelect}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => authorPhotoInputRef.current?.click()}
                className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-md flex items-center gap-2 shrink-0 cursor-pointer transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span>{authorAvatar ? 'Change Author Photo' : 'Upload Author Photo'}</span>
              </button>
            </div>
          </div>

          {/* div 2: Author Biography */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Author Biography &amp; Background
            </label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell our editorial team about your artistic background, storytelling style, and graphic novel experience..."
              className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
            />
          </div>

          {/* div 3: Portfolio & Sample Comic Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Online Portfolio / ArtStation / Instagram
              </label>
              <input
                type="url"
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                placeholder="https://artstation.com/your-name"
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Sample Comic Title *
              </label>
              <input
                type="text"
                required
                value={sampleComicTitle}
                onChange={(e) => setSampleComicTitle(e.target.value)}
                placeholder="e.g. Chronicles of Coromandel"
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
          </div>

          {/* div 4: Sample Comic Synopsis */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Sample Comic Synopsis &amp; Narrative Arc
            </label>
            <textarea
              rows={3}
              value={sampleSynopsis}
              onChange={(e) => setSampleSynopsis(e.target.value)}
              placeholder="Provide a premise of your story, character motivations, and planned chapters..."
              className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
            />
          </div>

          {/* div 5: Interactive Multiple Sample Photos Upload Div Button */}
          <div
            onClick={() => samplePhotosInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                samplePhotosInputRef.current?.click();
              }
            }}
            className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-500 dark:hover:border-rose-500 transition-colors flex flex-col items-center justify-center text-center space-y-3 cursor-pointer"
          >
            <input
              ref={samplePhotosInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleSamplePhotosSelect}
              className="hidden"
            />
            <div className="w-11 h-11 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
              <Upload className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                Sample Episode Pages ({samplePagesCount > 0 ? `${samplePagesCount} sample photo(s) selected` : 'Click to Select Multiple Sample Photos'})
              </span>
              <span className="text-[11px] text-slate-500 block">
                PNG / JPG / WebP up to 10MB per page · Multiple images can be selected at once.
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                samplePhotosInputRef.current?.click();
              }}
              className="py-2 px-4 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-rose-600 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Select Multiple Sample Photos</span>
            </button>

            {sampleImages.length > 0 && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-left"
              >
                {sampleImages.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative group rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-full h-24 object-cover"
                    />
                    <div className="p-1.5 text-[10px] font-mono truncate text-slate-600 dark:text-slate-300">
                      {idx + 1}. {img.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSamplePhoto(idx)}
                      className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-slate-900/80 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                      title="Remove sample photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* div 6: Legal IP Agreement */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              By submitting, your Author Photo and Sample Photos will be saved to your creator profile on the Author List, and your account will be enabled as both an <strong>Author and Reader</strong>.
            </span>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span>
              {loading
                ? 'Saving Author Photo & Sample Photos...'
                : 'Save Author Photo & Activate as Author & Reader'}
            </span>
          </button>
        </form>
      )}

    </div>
  );
};
