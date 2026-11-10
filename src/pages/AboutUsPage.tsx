import React from 'react';
import { BookOpen, Sparkles, Heart, Globe2, ShieldCheck, PenTool } from 'lucide-react';

interface AboutUsPageProps {
  setCurrentTab: (tab: string) => void;
}

export const AboutUsPage: React.FC<AboutUsPageProps> = ({ setCurrentTab }) => {
  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-24">
      
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-600 to-amber-500 mx-auto flex items-center justify-center text-white shadow-lg shadow-rose-600/20">
          <BookOpen className="w-6 h-6" />
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white font-heading">
          Empowering Indian &amp; Global Comic Creators
        </h1>

        <p className="text-xs sm:text-base text-slate-500 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Aathirai_Comic was founded to bridge the rich narrative heritage of Indian storytelling with modern digital webtoon and manga artistry.
        </p>
      </div>

      {/* Story Narrative */}
      <div className="p-6 sm:p-10 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
          Our Vision: Respecting Authors, Delighting Readers
        </h2>

        <p>
          For decades, Indian comic creators struggled with fragmented print distribution, piracy, and unfair commercial contracts. At <strong className="text-slate-900 dark:text-white">Aathirai_Comic</strong>, we built a modern digital platform where artists and scriptwriters maintain 100% intellectual property sovereignty while earning a sustainable <strong className="text-emerald-500 font-bold">70% revenue share</strong> through seamless Indian payments like UPI, RuPay, and Net Banking.
        </p>

        <p>
          Whether it is the celestial mythological combats of <em>Virasen</em>, the rain-drenched cyberpunk streets of <em>Neo Madras 2099</em>, or romantic wanderings in Ooty, we are committed to building the most enjoyable comic reading experience on the web.
        </p>
      </div>

      {/* 3 Core Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
            <Globe2 className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">Authentic Cultural Lore</h3>
          <p className="text-slate-500 leading-relaxed">
            Stories inspired by Dravidian temple legends, Vedic astronomy, and Indian futurism told with top-tier graphic novel craft.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">Vetted Editorial Vetting</h3>
          <p className="text-slate-500 leading-relaxed">
            Authors are reviewed and approved by human editors to maintain superior illustration quality and original storytelling.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <PenTool className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">Indian Payment Freedom</h3>
          <p className="text-slate-500 leading-relaxed">
            UPI-first checkout with Razorpay, instant unlocks for ₹10 per episode, and transparent creator payouts.
          </p>
        </div>
      </div>

      {/* Call to action */}
      <div className="p-8 rounded-3xl bg-slate-100 dark:bg-slate-900 text-center space-y-4">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-heading">
          Ready to publish your original comic or webtoon?
        </h3>
        <button
          onClick={() => setCurrentTab('become_author')}
          className="py-3 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-transform hover:scale-105"
        >
          Submit Creator Application
        </button>
      </div>

    </div>
  );
};
