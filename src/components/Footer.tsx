import React from 'react';
import { BookOpen, ShieldCheck, Heart, Sparkles, CheckCircle2 } from 'lucide-react';

interface FooterProps {
  setCurrentTab: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ setCurrentTab }) => {
  return (
    <footer className="bg-slate-900 dark:bg-slate-950 border-t border-slate-800 text-slate-400 text-xs py-12 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-10 border-b border-slate-800">
          
          {/* Brand & Mission */}
          <div className="space-y-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white">
                <BookOpen className="w-4 h-4" />
              </div>
              <span className="text-base font-extrabold text-white tracking-tight uppercase">
                Aathirai<span className="text-rose-500">_Comic</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              India's premier digital comic and manga publishing network. Supporting verified original creators, episodic webtoon readers, and secure INR payments.
            </p>
            <div className="pt-1 flex items-center gap-2 text-[11px] text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verified Creator Licensing &amp; Copyright</span>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Explore Platform</h4>
            <ul className="space-y-2">
              <li>
                <button onClick={() => setCurrentTab('home')} className="hover:text-rose-400 transition-colors">
                  Home Showcase
                </button>
              </li>
              <li>
                <button onClick={() => setCurrentTab('books')} className="hover:text-rose-400 transition-colors">
                  All Comic Books &amp; Series
                </button>
              </li>
              <li>
                <button onClick={() => setCurrentTab('authors')} className="hover:text-rose-400 transition-colors">
                  Featured Authors &amp; Studios
                </button>
              </li>
              <li>
                <button onClick={() => setCurrentTab('premium')} className="hover:text-rose-400 transition-colors">
                  Premium Pass &amp; Pricing
                </button>
              </li>
              <li>
                <button onClick={() => setCurrentTab('become_author')} className="hover:text-rose-400 text-amber-400 font-medium transition-colors">
                  Become an Author (Creator Application)
                </button>
              </li>
            </ul>
          </div>

          {/* Legal & Governance */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Legal &amp; Trust</h4>
            <ul className="space-y-2">
              <li>
                <button onClick={() => setCurrentTab('about')} className="hover:text-rose-400 transition-colors">
                  About Aathirai_Comic
                </button>
              </li>
              <li>
                <button onClick={() => setCurrentTab('terms')} className="hover:text-rose-400 transition-colors">
                  Terms &amp; Conditions (Customer &amp; Author)
                </button>
              </li>
              <li>
                <button onClick={() => setCurrentTab('copyright')} className="hover:text-rose-400 transition-colors">
                  Official Copyright &amp; DMCA Takedown
                </button>
              </li>
              <li>
                <button onClick={() => setCurrentTab('purchases')} className="hover:text-rose-400 transition-colors">
                  Customer Purchase History &amp; Invoices
                </button>
              </li>
              <li className="pt-2 border-t border-slate-800">
                <button
                  onClick={() => setCurrentTab('admin_dashboard')}
                  className="hover:text-amber-400 text-amber-500 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                  <span>Admin Portal (2FA Protected)</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Indian Payment Trust Strip */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Indian Payment Gateway</h4>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Powered by Razorpay. Seamlessly accept payments in Indian Rupees (₹ INR) and international cards.
            </p>
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700/60 space-y-2">
              <div className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">Supported Payment Methods:</div>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-200">
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">UPI (GPay / PhonePe / Paytm / BHIM)</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">RuPay Debit &amp; Credit</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">Visa / Mastercard</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">Net Banking (SBI / HDFC / ICICI)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-400">
          <div>
            © 2026 Aathirai_Comic Media. All original comics and character art remain the property of their respective creators.
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400">Built with respect for Indian comic heritage and global manga art</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
