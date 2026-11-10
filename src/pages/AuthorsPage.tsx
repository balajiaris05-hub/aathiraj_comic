import React from 'react';
import { Comic } from '../types/comic';
import { PenTool, BookOpen, Star, Sparkles, ArrowRight } from 'lucide-react';

interface AuthorsPageProps {
  comics: Comic[];
  onSelectComic: (comic: Comic) => void;
  setCurrentTab: (tab: string) => void;
}

export const AuthorsPage: React.FC<AuthorsPageProps> = ({
  comics,
  onSelectComic,
  setCurrentTab,
}) => {
  const authors = [
    {
      id: 'usr_rajesh',
      name: 'Rajesh Singh',
      role: 'Graphic Novelist & Manga Illustrator',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&h=200&q=80',
      bio: 'Leading creator behind Virasen and Neo Madras 2099. Pioneering Indian mythic science fiction and cyberpunk webtoons.',
      comics: comics.filter(c => c.authorName.includes('Rajesh')),
      followers: '28.4K',
      totalReads: '87.3K',
    },
    {
      id: 'usr_ananya',
      name: 'Ananya Sundaram',
      role: 'Mythological Fantasy Writer & Inker',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
      bio: 'Creator of Curse of Mahishur. Drawing inspiration from Sangam architecture and Dravidian temple guardian lore.',
      comics: comics.filter(c => c.title.includes('Mahishur')),
      followers: '14.2K',
      totalReads: '28.4K',
    },
    {
      id: 'usr_luna',
      name: 'Luna & Sky',
      role: 'Slice-of-Life Webtoon Duo',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&h=200&q=80',
      bio: 'Artistic partnership creating gentle, heartwarming watercolor webtoons set in the misty Nilgiri hills.',
      comics: comics.filter(c => c.title.includes('Monsoon')),
      followers: '32.1K',
      totalReads: '52.1K',
    },
  ];

  return (
    <div className="space-y-12 pb-24">
      
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

        <button
          onClick={() => setCurrentTab('become_author')}
          className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
        >
          <PenTool className="w-3.5 h-3.5" />
          <span>Apply to Publish</span>
        </button>
      </div>

      {/* Authors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {authors.map((author) => (
          <div
            key={author.id}
            className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-6"
          >
            <div className="space-y-4">
              <div className="flex items-center gap-3.5">
                <img
                  src={author.avatar}
                  alt={author.name}
                  className="w-14 h-14 rounded-2xl object-cover border-2 border-rose-500/20"
                />
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white font-heading">
                    {author.name}
                  </h3>
                  <span className="text-xs text-rose-600 dark:text-rose-400 font-medium block">
                    {author.role}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {author.bio}
              </p>

              <div className="pt-2 flex items-center gap-4 text-xs font-mono text-slate-500 border-t border-slate-100 dark:border-slate-800">
                <span><strong>{author.followers}</strong> Readers</span>
                <span>·</span>
                <span><strong>{author.totalReads}</strong> Total Reads</span>
              </div>
            </div>

            {/* Author's Comics Mini Showcase */}
            <div className="space-y-2 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Published Titles:
              </span>
              <div className="space-y-1.5">
                {author.comics.map(c => (
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
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
