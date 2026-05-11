'use client';

import { useState } from 'react';
import { fmtAmount, fmtDate } from './categories.js';

export default function ReviewTab({ transactions, onUpdateCategory, categories }) {
  const [savingId, setSavingId] = useState(null);

  if (transactions.length === 0) {
    return (
      <div className="pt-10">
        <div className="bg-white border rounded-2xl py-20 text-center" style={{ borderColor: 'var(--hairline)' }}>
          <div className="mx-auto h-10 w-10 rounded-full flex items-center justify-center mb-4" style={{ background: '#ecfdf5' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#057a55" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-[15px] font-semibold tighter text-neutral-900">All categorized</h2>
          <p className="text-[12.5px] text-neutral-500 mt-1.5 max-w-sm mx-auto">
            New uncategorized transactions will appear here after the next sync.
          </p>
        </div>
      </div>
    );
  }

  async function assign(messageId, category) {
    setSavingId(messageId);
    try { await onUpdateCategory(messageId, category); }
    catch (err) { alert('Failed: ' + err.message); }
    finally { setSavingId(null); }
  }

  return (
    <div className="pt-6 space-y-4">
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border" style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}>
        <div className="mt-0.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-medium text-neutral-900 tighter">
            <span className="num">{transactions.length}</span> {transactions.length === 1 ? 'transaction needs' : 'transactions need'} a category
          </p>
          <p className="text-[12px] text-neutral-500 mt-0.5">
            Categorizing here teaches Spend — the same merchant will be auto-tagged on the next sync.
          </p>
        </div>
      </div>

      <section className="bg-white border rounded-2xl overflow-hidden elev-1" style={{ borderColor: 'var(--hairline)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12.5px] uppercase tracking-[0.1em] font-semibold border-b" style={{ borderColor: 'var(--hairline)', color: 'var(--accent)', background: 'var(--accent-50)' }}>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Merchant</th>
                <th className="px-6 py-3 text-right">Amount</th>
                <th className="px-6 py-3">Raw info</th>
                <th className="px-6 py-3">Assign</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.message_id} className="hover:bg-neutral-50/60 transition border-b last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
                  <td className="px-6 py-3.5 whitespace-nowrap text-neutral-700 num">
                    <div>{fmtDate(t.date)}</div>
                    {t.time && <div className="text-[11px] text-neutral-400 mt-0.5">{t.time.slice(0, 5)}</div>}
                  </td>
                  <td className="px-6 py-3.5 font-medium text-neutral-900 tighter">
                    {(t.merchant ?? '').replace(/\s+/g, ' ').trim() || <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-6 py-3.5 text-right num font-semibold whitespace-nowrap tighter">
                    <span
                      className={t.type === 'CREDIT' ? '' : 'text-neutral-900'}
                      style={t.type === 'CREDIT' ? { color: 'var(--positive)' } : {}}
                    >
                      {t.type === 'CREDIT' ? '+' : ''}{fmtAmount(t.amount)}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-[11.5px] text-neutral-500 max-w-[260px] truncate mono" title={t.raw_transaction_info ?? ''}>
                    {t.raw_transaction_info ?? '—'}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="relative">
                      <select
                        disabled={savingId === t.message_id}
                        defaultValue=""
                        onChange={(e) => e.target.value && assign(t.message_id, e.target.value)}
                        className="focus-ring appearance-none h-8 pl-3 pr-8 border rounded-lg text-[12px] bg-white min-w-[170px] hover:bg-neutral-50 disabled:bg-neutral-100 disabled:text-neutral-400 transition font-medium text-neutral-700 cursor-pointer"
                        style={{ borderColor: 'var(--hairline)' }}
                      >
                        <option value="" disabled>
                          {savingId === t.message_id ? 'Saving…' : 'Pick a category'}
                        </option>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
