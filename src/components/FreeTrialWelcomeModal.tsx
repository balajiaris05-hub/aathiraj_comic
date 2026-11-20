import React from 'react';
import { Gift, Check, Calendar, Clock, X, BookOpen, Sparkles } from 'lucide-react';

interface FreeTrialWelcomeModalProps {
  isOpen: boolean;
  customerName?: string;
  trialDaysRemaining: number;
  expiresAt?: string;
  onStartReading: () => void;
  onViewPremium: () => void;
  onClose: () => void;
}

export const FreeTrialWelcomeModal: React.FC<FreeTrialWelcomeModalProps> = ({
  isOpen,
  customerName,
  trialDaysRemaining,
  expiresAt,
  onStartReading,
  onViewPremium,
  onClose,
}) => {
  if (!isOpen) return null;

  const formattedExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '30 days from today';

  const days = Math.max(1, trialDaysRemaining || 30);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="free-trial-welcome-title"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Top Accent Header */}
        <div className="px-6 pt-6 pb-5 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/70 dark:bg-emerald-950/30">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close free trial notification"
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-white/80 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3.5 pr-8">
            <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                New Reader Welcome Offer · ₹49 Value
              </div>
              <h2
                id="free-trial-welcome-title"
                className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white font-heading"
              >
                Free 1-Month Premium Access Granted
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                Welcome to Aathirai_Comic{customerName ? `, ${customerName}` : ''}! Your complimentary 30-day Premium Pass is active right now.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Live Remaining Days & Expiry Grid */}
          <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Free Trial Remaining</span>
              </div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {days} {days === 1 ? 'Day' : 'Days'} Left
              </div>
            </div>

            <div className="space-y-1 border-l border-slate-200 dark:border-slate-800 pl-4">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-rose-500" />
                <span>Access Valid Until</span>
              </div>
              <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white pt-0.5">
                {formattedExpiry}
              </div>
            </div>
          </div>

          {/* Clear Benefit & Payment Lock Rules */}
          <ul className="space-y-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
            <li className="flex items-start gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Read every premium comic, chapter, and episode with zero ads for 30 full days (₹49 plan value at ₹0).
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Payments are paused while your free trial is active so you will never be charged early.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Track your remaining free days anytime inside the Account menu or the Premium Plans tab.
              </span>
            </li>
          </ul>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={onStartReading}
              className="flex-1 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>Start Reading Premium Comics</span>
            </button>
            <button
              type="button"
              onClick={onViewPremium}
              className="py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
              <span>View Plan Status</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
