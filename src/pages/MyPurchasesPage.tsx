import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Purchase, Comic } from '../types/comic';
import {
  ShoppingBag,
  Printer,
  CheckCircle2,
  Calendar,
  IndianRupee,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Download
} from 'lucide-react';

interface MyPurchasesPageProps {
  onOpenEpisode: (episodeId: string) => void;
  comics: Comic[];
  setCurrentTab: (tab: string) => void;
  openAuthModal: () => void;
}

export const MyPurchasesPage: React.FC<MyPurchasesPageProps> = ({
  onOpenEpisode,
  comics,
  setCurrentTab,
  openAuthModal,
}) => {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetch(`/api/payments/my-purchases?userId=${user.id}&email=${user.email}`)
        .then((res) => res.json())
        .then((data) => {
          setPurchases(data.purchases || []);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user]);

  const handlePrint = (tx: Purchase) => {
    window.print();
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4 my-12 shadow-xl">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-500 mx-auto flex items-center justify-center">
          <ShoppingBag className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
          Sign In to View Purchases
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Log in with your customer account to access your unlocked premium episodes, GST tax invoices, and reading library.
        </p>
        <button
          onClick={openAuthModal}
          className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider"
        >
          Sign In / Register
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-24">
      
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-heading">
          My Purchases &amp; Reading Library
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Account: <strong className="text-slate-800 dark:text-slate-200">{user.email}</strong> · Unlocked premium comics and official invoices.
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400 text-xs">
          Loading purchase records...
        </div>
      ) : purchases.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            You haven't purchased any premium episodes or memberships yet.
          </p>
          <p className="text-xs text-slate-500">
            Browse our catalog to discover premium chapters unlocked with Indian UPI, cards, and net banking.
          </p>
          <button
            onClick={() => setCurrentTab('books')}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold"
          >
            Explore Books Catalog
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {purchases.map((purchase) => (
            <div
              key={purchase.id}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                    {purchase.receiptNumber}
                  </span>
                  <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Verified
                  </span>
                </div>

                <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {purchase.comicTitle}
                </h4>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <span>Method: {purchase.paymentMethod}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{new Date(purchase.createdAt).toLocaleDateString()}</span>
                  <span aria-hidden="true">·</span>
                  <span>TxID: {purchase.razorpayPaymentId}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 self-end sm:self-center shrink-0">
                <div className="text-right">
                  <div className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
                    ₹{purchase.amountInr.toFixed(2)} INR
                  </div>
                  <span className="text-[10px] text-slate-400">GST Paid</span>
                </div>

                {purchase.episodeId && (
                  <button
                    onClick={() => onOpenEpisode(purchase.episodeId!)}
                    className="py-2 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Read Now</span>
                  </button>
                )}

                <button
                  onClick={() => handlePrint(purchase)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Print Tax Receipt"
                >
                  <Printer className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};
