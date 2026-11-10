import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Sparkles,
  Check,
  IndianRupee,
  ShieldCheck,
  Zap,
  BookOpen,
  HeartHandshake
} from 'lucide-react';
import { RazorpayCheckoutModal } from '../components/RazorpayCheckoutModal';

interface PremiumPageProps {
  openAuthModal: () => void;
  setCurrentTab: (tab: string) => void;
}

export const PremiumPage: React.FC<PremiumPageProps> = ({ openAuthModal, setCurrentTab }) => {
  const { user } = useAuth();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-24">
      
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Aathirai Unlimited Reading Pass</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white font-heading">
          Unlock Unlimited Comics &amp; Webtoons
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
          Support independent Indian &amp; Asian comic creators directly. Seamless INR payments via UPI, RuPay, and Cards.
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
        
        {/* Tier 1: Pay Per Read */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pay As You Go
            </span>
            <div className="flex items-baseline gap-1 font-mono">
              <span className="text-3xl font-black text-slate-900 dark:text-white">₹10</span>
              <span className="text-xs text-slate-400">/ per episode</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Unlock only the specific episodes or chapters you want to read. No recurring subscription commitments.
            </p>

            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-2">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Lifetime access to purchased episodes</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Instant Google Pay, PhonePe &amp; UPI checkout</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>70% goes directly to the author</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Official GST invoice receipt included</span>
              </li>
            </ul>
          </div>

          <button
            onClick={() => setCurrentTab('books')}
            className="w-full py-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            Browse Premium Books
          </button>
        </div>

        {/* Tier 2: Monthly Unlimited Pass */}
        <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-amber-500/10 via-slate-900 to-slate-900 border-2 border-amber-500/60 shadow-xl space-y-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-4 right-4">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-500 text-slate-950 uppercase tracking-wider shadow-sm">
              Most Popular
            </span>
          </div>

          <div className="space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-500">
              Aathirai Pass All-Access
            </span>
            <div className="flex items-baseline gap-1 font-mono">
              <span className="text-4xl font-black text-white">₹149</span>
              <span className="text-xs text-slate-400">/ month</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Read any episode across all comics without restrictions. Early access to new chapters 7 days before public drop.
            </p>

            <ul className="space-y-2.5 text-xs text-slate-200 pt-2">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Unlimited reading across all catalog series</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>High-definition 4K zoom manga &amp; webtoon mode</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Zero advertisements and uninterrupted flow</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Exclusive subscriber badge in episode comments</span>
              </li>
            </ul>
          </div>

          <button
            onClick={() => {
              if (!user) {
                openAuthModal();
                return;
              }
              setCheckoutOpen(true);
            }}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-extrabold text-xs uppercase tracking-wider shadow-xl transition-transform hover:scale-105 cursor-pointer"
          >
            Subscribe Now for ₹149/mo
          </button>
        </div>

      </div>

      {/* RAZORPAY CHECKOUT MODAL */}
      {checkoutOpen && (
        <RazorpayCheckoutModal
          isOpen={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          comicId="global_subscription"
          comicTitle="Aathirai All-Access Pass"
          itemTitle="Monthly All-Access Subscription"
          itemType="subscription"
          amountInr={149}
          onPaymentSuccess={() => {
            alert('Welcome to Aathirai Pass! Unlimited reading unlocked.');
          }}
        />
      )}

    </div>
  );
};
