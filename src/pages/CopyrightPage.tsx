import React, { useEffect, useState } from 'react';
import { CopyrightDoc } from '../types/comic';
import { ShieldCheck, FileCheck, AlertTriangle, Mail, Scale, Lock } from 'lucide-react';

export const CopyrightPage: React.FC = () => {
  const [docs, setDocs] = useState<CopyrightDoc[]>([]);

  useEffect(() => {
    fetch('/api/admin/copyright')
      .then(res => res.json())
      .then(data => {
        if (data.copyrightDocs) {
          setDocs(data.copyrightDocs.filter((d: CopyrightDoc) => d.status === 'published'));
        }
      })
      .catch(console.error);
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-24">
      
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Intellectual Property &amp; Legal Sovereignty</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white font-heading">
          Official Copyright &amp; IP Protection
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
          Aathirai_Comic protects original comic authors and artists under the Indian Copyright Act 1957 and International DMCA frameworks.
        </p>
      </div>

      {/* CORE IP PRINCIPLES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">Author Ownership</h3>
          <p className="text-slate-500 leading-relaxed">
            All original characters, artwork, scripts, and universes remain 100% the property of the creator who publishes them.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <Scale className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">Indian Copyright Act</h3>
          <p className="text-slate-500 leading-relaxed">
            Registered and legally bound under the Copyright Act 1957 (India). Unauthorized duplication or piracy is strictly prosecuted.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
            <FileCheck className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">DMCA Takedown Notice</h3>
          <p className="text-slate-500 leading-relaxed">
            Prompt 24-hour review for any valid notice of infringement filed by verified rights holders.
          </p>
        </div>
      </div>

      {/* PUBLISHED STATUTORY COPYRIGHT DOCUMENTS */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white font-heading">
          Published Statutory Copyright Documents
        </h2>

        <div className="space-y-6">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white font-heading">
                    {doc.title}
                  </h3>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5 font-mono">
                    <span>Document ID: {doc.documentNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span>Entity: {doc.registeredEntity}</span>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0 self-start sm:self-center">
                  Official Document · Active
                </span>
              </div>

              {doc.summary && (
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {doc.summary}
                </p>
              )}

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed max-h-96 overflow-y-auto">
                {doc.fullText}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* INFRINGEMENT COMPLAINT PROCEDURE */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-rose-500 font-bold text-xs uppercase tracking-wider">
          <AlertTriangle className="w-4 h-4" />
          <span>Filing a Copyright Complaint or DMCA Notice</span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          If you believe material hosted on Aathirai_Comic infringes your copyright, send a formal notification including:
        </p>
        <ul className="list-disc pl-5 text-xs text-slate-500 space-y-1">
          <li>Identification of the copyrighted work claimed to be infringed.</li>
          <li>The specific URL or episode identifier on Aathirai_Comic.</li>
          <li>Your contact information (name, address, telephone number, and email).</li>
          <li>A statement made under penalty of perjury that the notifier is authorized to act on behalf of the copyright owner.</li>
        </ul>
        <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
          <Mail className="w-4 h-4" />
          <span>Direct Inquiries: legal-copyright@aathirai.com</span>
        </div>
      </div>

    </div>
  );
};
