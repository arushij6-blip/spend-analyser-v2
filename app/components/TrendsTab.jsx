'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtAmount } from './categories.js';

export default function TrendsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null); // { category, month, rows, loading }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/trends', { cache: 'no-store' });
        const data = await res.json();
        setRows(data.rows ?? []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { months, categories, matrix, categoryTotals, monthTotals, grandTotal, maxCellByCat } = useMemo(() => {
    const m = new Map();
    const cats = new Set();
    for (const r of rows) {
      if (!m.has(r.month)) m.set(r.month, new Map());
      const inner = m.get(r.month);
      const cur = inner.get(r.category) ?? 0;
      const delta = r.type === 'DEBIT' ? r.total : -r.total;
      inner.set(r.category, cur + delta);
      cats.add(r.category);
    }
    const months = Array.from(m.keys()).sort().reverse();
    const categoryTotals = new Map();
    for (const cat of cats) {
      let sum = 0;
      for (const month of months) sum += m.get(month).get(cat) ?? 0;
      categoryTotals.set(cat, sum);
    }
    const categories = Array.from(cats).sort((a, b) => (categoryTotals.get(b) ?? 0) - (categoryTotals.get(a) ?? 0));
    const monthTotals = new Map();
    for (const month of months) {
      let sum = 0;
      for (const cat of categories) sum += m.get(month).get(cat) ?? 0;
      monthTotals.set(month, sum);
    }
    const maxCellByCat = new Map();
    for (const cat of categories) {
      let max = 0;
      for (const month of months) max = Math.max(max, m.get(month).get(cat) ?? 0);
      maxCellByCat.set(cat, max);
    }
    let grandTotal = 0;
    for (const v of monthTotals.values()) grandTotal += v;
    return { months, categories, matrix: m, categoryTotals, monthTotals, grandTotal, maxCellByCat };
  }, [rows]);

  if (loading) {
    return (
      <div className="pt-6 space-y-2.5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12 rounded-xl" />)}
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="pt-6">
        <div className="bg-white border rounded-2xl py-20 text-center" style={{ borderColor: 'var(--hairline)' }}>
          <p className="text-[13.5px] text-neutral-700 font-medium">No data yet</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">Sync from Gmail to populate trends.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-6 space-y-5">
      <p className="text-[12px] text-neutral-500">
        Net spend by category and month — credits subtracted from debits.
      </p>

      <section className="bg-white border rounded-2xl overflow-hidden elev-1" style={{ borderColor: 'var(--hairline)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.12em] text-neutral-400 font-medium border-b" style={{ borderColor: 'var(--hairline)' }}>
                <th className="px-6 py-3 sticky left-0 bg-white">Category</th>
                {months.map((mo) => (
                  <th key={mo} className="px-6 py-3 text-right whitespace-nowrap">{formatMonth(mo)}</th>
                ))}
                <th className="px-6 py-3 text-right border-l" style={{ borderColor: 'var(--hairline)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat} className="hover:bg-neutral-50/60 transition border-b last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
                  <td className="px-6 py-3.5 sticky left-0 bg-white group-hover:bg-neutral-50/60">
                    <div className="inline-flex items-center gap-2 font-medium tighter text-neutral-900">
                      <span className="h-2 w-2 rounded-full" style={{ background: catDot(cat) }} />
                      {cat}
                    </div>
                  </td>
                  {months.map((mo) => {
                    const v = matrix.get(mo)?.get(cat) ?? 0;
                    const max = maxCellByCat.get(cat) ?? 0;
                    return (
                      <td key={mo} className="px-6 py-3.5 text-right num align-middle" style={{ minWidth: 140 }}>
                        <Cell
                          value={v}
                          max={max}
                          onClick={v > 0 ? () => openDrill(cat, mo, setDrill) : undefined}
                        />
                      </td>
                    );
                  })}
                  <td className="px-6 py-3.5 text-right num font-semibold text-neutral-900 border-l tighter" style={{ borderColor: 'var(--hairline)' }}>
                    {fmtAmount(categoryTotals.get(cat) ?? 0)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: 'var(--surface-2)' }}>
                <td className="px-6 py-3.5 sticky left-0 font-semibold text-neutral-900 tighter" style={{ background: 'var(--surface-2)' }}>Total</td>
                {months.map((mo) => (
                  <td key={mo} className="px-6 py-3.5 text-right num font-semibold text-neutral-900 tighter">
                    {fmtAmount(monthTotals.get(mo) ?? 0)}
                  </td>
                ))}
                <td className="px-6 py-3.5 text-right num font-semibold text-neutral-900 border-l tighter" style={{ borderColor: 'var(--hairline)' }}>
                  {fmtAmount(grandTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {drill && <DrillModal drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

async function openDrill(category, month, setDrill) {
  setDrill({ category, month, rows: [], loading: true });
  try {
    const res = await fetch(
      `/api/transactions?category=${encodeURIComponent(category)}&month=${encodeURIComponent(month)}&limit=5`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    setDrill({ category, month, rows: data.transactions ?? [], loading: false });
  } catch (err) {
    console.error(err);
    setDrill({ category, month, rows: [], loading: false });
  }
}

function DrillModal({ drill, onClose }) {
  const { category, month, rows, loading } = drill;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl elev-1 w-full max-w-xl mx-4 overflow-hidden"
        style={{ borderColor: 'var(--hairline)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--hairline)' }}>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-neutral-400 font-medium">
              Top 5 — {formatMonth(month)}
            </div>
            <div className="text-[14px] font-semibold tighter text-neutral-900 mt-0.5 inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: catDot(category) }} />
              {category}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 text-[18px] leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-2">
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-[13px] text-neutral-500">
              No transactions.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.message_id} className="border-b last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
                    <td className="px-6 py-3 align-top">
                      <div className="font-medium text-neutral-900 truncate max-w-[320px]" title={r.merchant}>
                        {r.merchant || '—'}
                      </div>
                      <div className="text-[11.5px] text-neutral-500 mt-0.5">
                        {r.date}{r.source ? ` · ${r.source}` : ''}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right num font-semibold text-neutral-900 tighter whitespace-nowrap">
                      {fmtAmount(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ value, max, onClick }) {
  if (value <= 0) return <span className="text-neutral-300">—</span>;
  const ratio = max > 0 ? value / max : 0;
  // soft blue heat fill, magnitude-weighted
  const bgAlpha = Math.min(0.16, 0.05 + ratio * 0.11);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-block px-2 py-0.5 rounded-md font-medium tighter cursor-pointer hover:ring-1 hover:ring-blue-300 transition"
      style={{ background: `rgba(37,99,235,${bgAlpha})`, color: 'var(--ink-900)' }}
    >
      {fmtAmount(value)}
    </button>
  );
}

function catDot(c) {
  const map = {
    'Groceries':        'hsl(152 45% 50%)',
    'Shopping':         'hsl(332 45% 60%)',
    'Daily Commute':    'hsl(232 45% 60%)',
    'Travel':           'hsl(196 45% 50%)',
    'Home Maintenance': 'hsl(174 45% 45%)',
    'Staff Salaries':   'hsl(268 40% 60%)',
    'Medical':          'hsl(4 55% 58%)',
    'Going Out':        'hsl(32 60% 55%)',
    'Ordering In':      'hsl(18 65% 55%)',
    'Credit Card Bill': 'hsl(248 40% 60%)',
    'Misc':             '#a3a3a3',
  };
  return map[c] ?? '#a3a3a3';
}

function formatMonth(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[Number(m) - 1]} ’${y.slice(2)}`;
}
