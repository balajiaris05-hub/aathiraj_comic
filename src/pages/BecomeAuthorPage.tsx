import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { AuthorApplication } from '../types/comic';
import {
  PenTool,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Upload,
  Link,
  ShieldCheck,
  Send,
  BookOpen
} from 'lucide-react';

interface BecomeAuthorPageProps {
  setCurrentTab: (tab: string) => void;
  openAuthModal: () => void;
}

export const BecomeAuthorPage: React.FC<BecomeAuthorPageProps> = ({
  setCurrentTab,
  openAuthModal,
}) => {
  const { user, role, switchDemoRole } = useAuth();
  const [authorName, setAuthorName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [bio, setBio] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [sampleComicTitle, setSampleComicTitle] = useState('');
  const [sampleSynopsis, setSampleSynopsis] = useState('');
  const [samplePagesCount, setSamplePagesCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [existingApp, setExistingApp] = useState<AuthorApplication | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing application if user applied
  useEffect(() => {
    if (user) {
      fetch(`/api/author/me?userId=${user.id}&email=${user.email}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.application) {
            setExistingApp(data.application);
          }
        })
        .catch(console.error);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/author/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          authorName,
          email,
          bio,
          portfolioUrl,
          sampleComicTitle,
          sampleSynopsis,
          samplePagesCount,
        }),
      });

      const data = await res.json();
      setLoading(false);

      if (res.ok && data.application) {
        setExistingApp(data.application);
        setSuccessMsg(data.message || 'Application submitted successfully!');
      } else {
        setError(data.error || 'Failed to submit application');
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Network error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-24">
      
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold">
          <PenTool className="w-3.5 h-3.5" />
          <span>Creator Network Program</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white font-heading">
          Become a Published Author on Aathirai_Comic
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Join our curated roster of manga artists, webtoon storytellers, and graphic novelists. We review every application for artistic quality, narrative depth, and copyright compliance.
        </p>
      </div>

      {/* 8-STEP APPLICATION PROCESS TIMELINE BANNER */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
          How Author Publishing Works (Mandatory Editorial Review):
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-rose-600 block mb-1">01. Application</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Submit portfolio, synopsis, and sample pages.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-amber-500 block mb-1">02. Admin Review</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Status set to Pending Approval for editorial vetting.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-emerald-500 block mb-1">03. Verification</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Admin approves profile and unlocks Author Studio.</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="font-bold text-blue-500 block mb-1">04. Earn 70%</span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Publish chapters and receive direct Indian INR payouts.</span>
          </div>
        </div>
      </div>

      {/* IF USER ALREADY HAS APPLICATION */}
      {existingApp ? (
        <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6 text-center">
          {existingApp.status === 'pending' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 mx-auto flex items-center justify-center">
                <Clock className="w-8 h-8 animate-pulse" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Application Status: Pending Administrator Approval
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
                Thank you, <strong className="text-slate-800 dark:text-slate-200">{existingApp.authorName}</strong>! Your submission for <span className="text-rose-500 font-semibold font-mono">"{existingApp.sampleComicTitle}"</span> is currently being evaluated by the Aathirai_Comic administrator.
              </p>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 max-w-md mx-auto text-left text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Applicant Email:</span>
                  <span className="font-medium text-slate-900 dark:text-white">{existingApp.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Submission Date:</span>
                  <span className="font-medium text-slate-900 dark:text-white">{new Date(existingApp.submittedAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Sample Length:</span>
                  <span className="font-medium text-slate-900 dark:text-white">{existingApp.samplePagesCount} pages</span>
                </div>
              </div>

              {/* Convenience shortcut to test administrator approval */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[11px] text-slate-400 mb-2">Want to test the Admin review perspective right now?</p>
                <button
                  onClick={() => {
                    switchDemoRole('admin');
                    setCurrentTab('admin_dashboard');
                  }}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                >
                  Switch to Admin Panel to Review &amp; Approve
                </button>
              </div>
            </div>
          )}

          {existingApp.status === 'approved' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Congratulations! You Are An Approved Author
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Your author privileges are active. You now have full access to the Author Studio to publish comic books, organize chapters, and track INR revenue.
              </p>
              <button
                onClick={() => setCurrentTab('author_dashboard')}
                className="py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg transition-transform hover:scale-105"
              >
                Go to Author Studio
              </button>
            </div>
          )}

          {existingApp.status === 'rejected' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 mx-auto flex items-center justify-center">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Application Decision: Needs Revision
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                {existingApp.adminNote || 'Editorial note: Please provide higher resolution sample inks and submit an updated application.'}
              </p>
              <button
                onClick={() => setExistingApp(null)}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold"
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

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-center space-y-2">
            <Upload className="w-6 h-6 text-slate-400" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Sample Episode Pages ({samplePagesCount} pages bundled)
            </span>
            <span className="text-[11px] text-slate-500">
              PNG / JPG / WebP up to 10MB per page.
            </span>
          </div>

          {/* Legal IP Agreement */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              By applying, you certify that all artwork and manuscripts submitted are 100% original. You retain complete ownership of all intellectual property under Indian &amp; international copyright law.
            </span>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span>{loading ? 'Submitting Application...' : 'Submit Application for Admin Review'}</span>
          </button>
        </form>
      )}

    </div>
  );
};
