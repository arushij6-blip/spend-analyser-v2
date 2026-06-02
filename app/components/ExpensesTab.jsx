'use client';

import { useMemo, useState } from 'react';
import { fmtAmount, fmtDate } from './categories.js';

export default function ExpensesTab({ transactions, onUpdateCategory, onHide, categories }) {
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');

  const sources = useMemo(() => {
    const s = new Set();
    for (const t of transactions) if (t.source) s.add(t.source);
    return Array.from(s).sort();
  }, [transactions]);

  const visible = useMemo(() => {
    let rows = transactions;
    if (typeFilter !== 'ALL') rows = rows.filter((t) => t.type === typeFilter);
    if (categoryFilter !== 'ALL') rows = rows.filter((t) => t.category === categoryFilter);
    if (sourceFilter !== 'ALL') rows = rows.filter((t) => t.source === sourceFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (t) =>
          (t.merchant ?? '').toLowerCase().includes(q) ||
          (t.category ?? '').toLowerCase().includes(q) ||
          (t.email_subject ?? '').toLowerCase().includes(q)
      );
    }
    const sorted = [...rows].sort((a, b) => {
      let av = a[sort.key];
      let bv = b[sort.key];
      if (sort.key === 'date') {
        av = (a.date ?? '') + ' ' + (a.time ?? '');
        bv = (b.date ?? '') + ' ' + (b.time ?? '');
      }
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      return sort.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return sorted;
  }, [transactions, sort, search, typeFilter, categoryFilter, sourceFilter]);

  const monthGroups = useMemo(() => {
    const groups = new Map();
    for (const t of visible) {
      const month = t.date?.slice(0, 7) ?? 'Unknown';
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(t);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  function toggleSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }

  function sortIndicator(key) {
    if (sort.key !== key) return null;
    return <span className="ml-1 text-neutral-400">{sort.dir === 'asc' ? '↑' : '↓'}</span>;
  }

  async function handleCategoryChange(messageId, newCategory) {
    try { await onUpdateCategory(messageId, newCategory); }
    catch (err) { alert('Failed to update: ' + err.message); }
    setEditing(null);
  }

  function getMonthLabel(yyyymm) {
    const [y, m] = yyyymm.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[Number(m) - 1]} ${y}`;
  }

  const hasFilters = typeFilter !== 'ALL' || categoryFilter !== 'ALL' || sourceFilter !== 'ALL' || search.trim().length > 0;
  function clearFilters() {
    setSearch(''); setTypeFilter('ALL'); setCategoryFilter('ALL'); setSourceFilter('ALL');
  }

  return (
    <div className="pt-6 space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px] max-w-[420px]">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search merchants, categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="focus-ring w-full pl-9 pr-3 h-9 border rounded-lg text-[13px] bg-white placeholder:text-neutral-400 transition"
            style={{ borderColor: 'var(--hairline)' }}
          />
        </div>
        <FilterSelect value={typeFilter} onChange={setTypeFilter} options={[
          { v: 'ALL', l: 'All types' },
          { v: 'DEBIT', l: 'Debits' },
          { v: 'CREDIT', l: 'Credits' },
        ]} />
        <FilterSelect value={categoryFilter} onChange={setCategoryFilter} options={[
          { v: 'ALL', l: 'All categories' },
          ...categories.map((c) => ({ v: c, l: c })),
        ]} />
        {sources.length > 1 && (
          <FilterSelect value={sourceFilter} onChange={setSourceFilter} options={[
            { v: 'ALL', l: 'All accounts' },
            ...sources.map((s) => ({ v: s, l: s })),
          ]} />
        )}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="h-9 px-3 text-[12.5px] text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition"
          >
            Clear
          </button>
        )}
        <div className="ml-auto text-[12px] text-neutral-500 num">
          {visible.length} <span className="text-neutral-400">of {transactions.length}</span>
        </div>
      </div>

      {/* Empty */}
      {visible.length === 0 ? (
        <div className="bg-white border rounded-2xl py-20 text-center" style={{ borderColor: 'var(--hairline)' }}>
          <div className="mx-auto h-10 w-10 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--surface-2)' }}>
            <SearchIcon big />
          </div>
          <p className="text-[13.5px] text-neutral-800 font-medium">No transactions found</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">Adjust filters or sync from Gmail.</p>
        </div>
      ) : (
        monthGroups.map(([month, monthTxns]) => {
          const monthDebit = monthTxns
            .reduce((s, t) => s + (t.type === 'DEBIT' ? t.amount : -t.amount), 0);

          return (
            <section key={month} className="bg-white border rounded-2xl overflow-hidden elev-1" style={{ borderColor: 'var(--hairline)' }}>
              <header className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--hairline)' }}>
                <div className="flex items-baseline gap-3">
                  <h3 className="text-[15px] font-semibold tighter text-neutral-900">{getMonthLabel(month)}</h3>
                  <span className="text-[12px] text-neutral-400 num">{monthTxns.length} transactions</span>
                </div>
                <div className="flex items-center gap-5 text-[12.5px]">
                  <div className="text-right">
                    <div className="text-[10.5px] uppercase tracking-[0.12em] text-neutral-400 font-medium">Spend</div>
                    <div className="num font-semibold text-neutral-900 tighter">{fmtAmount(monthDebit)}</div>
                  </div>
                </div>
              </header>

              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[12.5px] uppercase tracking-[0.1em] font-semibold border-b" style={{ borderColor: 'var(--hairline)', color: 'var(--accent)', background: 'var(--accent-50)' }}>
                      <th className="px-6 py-3 cursor-pointer hover:opacity-80 transition" onClick={() => toggleSort('date')}>
                        Date {sortIndicator('date')}
                      </th>
                      <th className="px-6 py-3">Merchant</th>
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3">Account</th>
                      <th className="px-6 py-3 cursor-pointer hover:opacity-80 transition text-right" onClick={() => toggleSort('amount')}>
                        Amount {sortIndicator('amount')}
                      </th>
                      <th className="px-3 py-3" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {monthTxns.map((t) => (
                      <tr
                        key={t.message_id}
                        className="group hover:bg-neutral-50/60 transition border-b last:border-b-0"
                        style={{ borderColor: 'var(--hairline)' }}
                      >
                        <td className="px-6 py-3.5 whitespace-nowrap text-neutral-700 num align-top">
                          <div className="text-[13px]">{fmtDate(t.date)}</div>
                          {t.time && <div className="text-[11px] text-neutral-400 mt-0.5">{t.time.slice(0, 5)}</div>}
                        </td>
                        <td className="px-6 py-3.5 max-w-[320px] align-top">
                          <div className="flex items-center gap-2.5">
                            <MerchantAvatar name={t.merchant} />
                            <div className="min-w-0">
                              <div className="font-medium text-neutral-900 truncate tighter" title={t.merchant ?? ''}>
                                {prettifyMerchant(t.merchant) || <span className="text-neutral-400">—</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3.5 align-top">
                          {editing === t.message_id ? (
                            <select
                              autoFocus
                              defaultValue={t.category}
                              onChange={(e) => handleCategoryChange(t.message_id, e.target.value)}
                              onBlur={() => setEditing(null)}
                              className="focus-ring h-7 px-2 border rounded-md text-[12px] bg-white"
                              style={{ borderColor: 'var(--hairline-strong)' }}
                            >
                              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : (
                            <button
                              onClick={() => setEditing(t.message_id)}
                              className="group/cat inline-flex items-center gap-1.5 rounded-md hover:bg-neutral-100 px-1 -mx-1 py-0.5 transition"
                              title="Click to change"
                            >
                              <CategoryPill name={t.category} />
                              {t.manually_edited === 1 && (
                                <span title="Manually set" className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--ink-300)' }} />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-3.5 align-top whitespace-nowrap">
                          <div className="text-[12px] text-neutral-700 font-medium">{t.source || '—'}</div>
                          {t.account && <div className="mono text-[10.5px] text-neutral-400 mt-0.5">{t.account}</div>}
                        </td>
                        <td className="px-6 py-3.5 text-right whitespace-nowrap num align-top">
                          <span
                            className={`font-semibold tighter ${t.type === 'CREDIT' ? '' : 'text-neutral-900'}`}
                            style={t.type === 'CREDIT' ? { color: 'var(--positive)' } : {}}
                          >
                            {t.type === 'CREDIT' ? '+' : ''}{fmtAmount(t.amount)}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 align-top text-right">
                          {onHide && (
                            <button
                              onClick={() => {
                                if (confirm(`Hide this transaction from expenses?\n\n${prettifyMerchant(t.merchant) ?? ''} · ${fmtAmount(t.amount)}`)) {
                                  onHide(t.message_id);
                                }
                              }}
                              title="Hide from expenses"
                              aria-label="Hide transaction"
                              className="opacity-0 group-hover:opacity-100 transition h-7 w-7 rounded-md flex items-center justify-center text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="6" y1="6" x2="18" y2="18" />
                                <line x1="6" y1="18" x2="18" y2="6" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function FilterSelect({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring appearance-none h-9 pl-3 pr-8 border rounded-lg text-[12.5px] bg-white hover:bg-neutral-50 transition cursor-pointer font-medium text-neutral-700"
        style={{ borderColor: 'var(--hairline)' }}
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <ChevronDown />
    </div>
  );
}

function ChevronDown() {
  return (
    <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SearchIcon({ big }) {
  if (big) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
    );
  }
  return (
    <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function MerchantAvatar({ name }) {
  const clean = (name ?? '?').replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
  const letter = (clean.charAt(0) || '?').toUpperCase();
  const hue = hashHue(clean || '?');
  return (
    <div
      className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center text-[12px] font-semibold"
      style={{ background: `hsl(${hue} 35% 96%)`, color: `hsl(${hue} 30% 32%)` }}
    >
      {letter}
    </div>
  );
}

function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function prettifyMerchant(name) {
  if (!name) return name;
  // strip stray newlines / collapse whitespace
  return name.replace(/\s+/g, ' ').trim();
}

function CategoryPill({ name }) {
  const style = categoryStyle(name);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11.5px] font-medium tighter border"
      style={{ background: style.bg, color: style.fg, borderColor: style.border }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} />
      {name}
    </span>
  );
}

// Pastel palette: soft, candy-like fills with confident hue.
function categoryStyle(c) {
  const palette = {
    'Groceries':        { hue: 142 }, // mint
    'Shopping':         { hue: 326 }, // pink
    'Daily Commute':    { hue: 222 }, // periwinkle
    'Travel':           { hue: 196 }, // sky
    'Home Maintenance': { hue: 170 }, // teal
    'Staff Salaries':   { hue: 268 }, // lavender
    'Medical':          { hue: 8   }, // coral
    'Going Out':        { hue: 38  }, // peach
    'Ordering In':      { hue: 22  }, // apricot
    'Credit Card Bill': { hue: 248 }, // indigo
    'Misc':             { gray: true },
  };
  const p = palette[c] ?? { gray: true };
  if (p.gray) {
    return { bg: '#f4f4f3', fg: '#525252', border: '#e7e7e5', dot: '#a3a3a3' };
  }
  return {
    bg: `hsl(${p.hue} 78% 93%)`,
    fg: `hsl(${p.hue} 48% 30%)`,
    border: `hsl(${p.hue} 60% 85%)`,
    dot: `hsl(${p.hue} 62% 55%)`,
  };
}
