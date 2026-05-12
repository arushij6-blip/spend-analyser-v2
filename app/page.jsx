'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import DashboardTab from './components/DashboardTab.jsx';
import ExpensesTab from './components/ExpensesTab.jsx';
import ReviewTab from './components/ReviewTab.jsx';
import TrendsTab from './components/TrendsTab.jsx';
import BudgetsTab from './components/BudgetsTab.jsx';
import { CATEGORIES, fmtAmount } from './components/categories.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'review', label: 'Review' },
  { id: 'trends', label: 'Trends' },
];

export default function Home() {
  const [active, setActive] = useState('dashboard');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanState, setScanState] = useState({ running: false, lastResult: null, error: null });
  const [uploadState, setUploadState] = useState({ running: false, lastResult: null, error: null });
  const [toastVisible, setToastVisible] = useState(false);
  const [toastSource, setToastSource] = useState('sync');
  const fileInputRef = useRef(null);

  async function loadTransactions() {
    setLoading(true);
    try {
      const res = await fetch('/api/transactions', { cache: 'no-store' });
      const data = await res.json();
      setTransactions(data.transactions ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTransactions(); }, []);

  useEffect(() => {
    if (scanState.lastResult || scanState.error) {
      setToastSource('sync');
      setToastVisible(true);
      const t = setTimeout(() => setToastVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [scanState.lastResult, scanState.error]);

  useEffect(() => {
    if (uploadState.lastResult || uploadState.error) {
      setToastSource('upload');
      setToastVisible(true);
      const t = setTimeout(() => setToastVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [uploadState.lastResult, uploadState.error]);

  async function runScan() {
    setScanState({ running: true, lastResult: null, error: null });
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: '2026-04-01' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setScanState({ running: false, lastResult: data, error: null });
      await loadTransactions();
    } catch (err) {
      setScanState({ running: false, lastResult: null, error: err.message });
    }
  }

  function openUploadPicker() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadState({ running: true, lastResult: null, error: null });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload-pdf', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUploadState({ running: false, lastResult: data, error: null });
      await loadTransactions();
    } catch (err) {
      setUploadState({ running: false, lastResult: null, error: err.message });
    }
  }

  async function updateCategory(messageId, category, opts = {}) {
    const res = await fetch('/api/transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, category, learn: opts.learn ?? false }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Update failed');
    }
    const data = await res.json().catch(() => ({}));
    const bulk = new Set([messageId, ...(data.alsoUpdatedIds ?? [])]);
    setTransactions((prev) =>
      prev.map((t) => (bulk.has(t.message_id) ? { ...t, category, manually_edited: 1 } : t))
    );
  }

  // Debit-only view: used by hero, dashboard, and review badge — anywhere
  // a summary or "header" number is shown. The Expenses tab gets the full
  // list (credits included) since the table itself shows them inline.
  const debitTransactions = useMemo(
    () => transactions.filter((t) => t.type === 'DEBIT'),
    [transactions]
  );

  const stats = useMemo(() => {
    // Hero summary is May-only. Net of refunds: DEBIT − CREDIT, matching
    // the Expenses tab's per-month signed-sum so the two never drift.
    const monthTxns = transactions.filter((t) => t.date?.startsWith('2026-05'));
    const debits = monthTxns.filter((t) => t.type === 'DEBIT');
    const totalDebit = monthTxns.reduce(
      (s, t) => s + (t.type === 'DEBIT' ? t.amount : -t.amount),
      0
    );

    // Review badge stays global (all Misc debits across loaded range).
    const uncat = debitTransactions.filter((t) => t.category === 'Misc' && !t.manually_edited).length;

    const byCat = new Map();
    for (const t of monthTxns) {
      const delta = t.type === 'DEBIT' ? t.amount : -t.amount;
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + delta);
    }
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      txnCount: debits.length,
      totalDebit,
      uncategorized: uncat,
      avg: debits.length ? totalDebit / debits.length : 0,
      topCategory: top ? { name: top[0], amount: top[1] } : null,
    };
  }, [transactions, debitTransactions]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <TopBar
        onSync={runScan}
        syncing={scanState.running}
        onUpload={openUploadPicker}
        uploading={uploadState.running}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleFileSelected}
        className="hidden"
      />

      <main className="flex-1">
        <div className="max-w-[1180px] mx-auto px-8">
          <Hero stats={stats} loading={loading} />
          <TabNav active={active} setActive={setActive} uncategorized={stats.uncategorized} />

          <div className="pb-24">
            {loading ? (
              <LoadingState />
            ) : (
              <div className="fade-in">
                {active === 'dashboard' && (
                  <DashboardTab transactions={transactions} />
                )}
                {active === 'expenses' && (
                  <ExpensesTab
                    transactions={transactions}
                    onUpdateCategory={updateCategory}
                    categories={CATEGORIES}
                  />
                )}
                {active === 'review' && (
                  <ReviewTab
                    transactions={debitTransactions.filter((t) => t.category === 'Misc' && !t.manually_edited)}
                    onUpdateCategory={(id, cat) => updateCategory(id, cat, { learn: true })}
                    categories={CATEGORIES}
                  />
                )}
                {active === 'budgets' && <BudgetsTab />}
                {active === 'trends' && <TrendsTab />}
              </div>
            )}
          </div>
        </div>
      </main>

      <Toast
        visible={toastVisible}
        state={toastSource === 'upload' ? uploadState : scanState}
        kind={toastSource}
      />
    </div>
  );
}

function TopBar({ onSync, syncing, onUpload, uploading }) {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-md"
      style={{ borderColor: 'var(--hairline)', background: 'rgba(247,249,252,0.82)' }}
    >
      <div className="max-w-[1180px] mx-auto px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Mark />
          <div className="leading-tight">
            <div className="text-[13.5px] font-semibold tracking-tight" style={{ color: 'var(--ink-900)' }}>
              Ankush <span style={{ color: 'var(--accent)' }}>&amp;</span> Arushi
            </div>
            <div className="text-[10.5px] font-medium tracking-wide" style={{ color: 'var(--ink-400)' }}>
              Financial Dashboard
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onUpload}
            disabled={uploading}
            className="focus-ring inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition shadow-sm disabled:cursor-not-allowed border"
            style={{
              background: 'white',
              color: uploading ? 'var(--ink-400)' : 'var(--ink-900)',
              borderColor: 'var(--hairline)',
            }}
            onMouseEnter={(e) => { if (!uploading) e.currentTarget.style.background = 'var(--ink-50, #f3f4f6)'; }}
            onMouseLeave={(e) => { if (!uploading) e.currentTarget.style.background = 'white'; }}
          >
            {uploading ? (
              <>
                <Spinner />
                <span>Uploading</span>
              </>
            ) : (
              <>
                <UploadIcon />
                <span>Upload</span>
              </>
            )}
          </button>
          <button
            onClick={onSync}
            disabled={syncing}
            className="focus-ring inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-[12.5px] font-medium text-white transition shadow-sm disabled:cursor-not-allowed"
            style={{
              background: syncing ? 'var(--ink-300)' : 'var(--accent)',
              borderColor: syncing ? 'var(--ink-300)' : 'var(--accent)',
            }}
            onMouseEnter={(e) => { if (!syncing) e.currentTarget.style.background = 'var(--accent-700)'; }}
            onMouseLeave={(e) => { if (!syncing) e.currentTarget.style.background = 'var(--accent)'; }}
          >
            {syncing ? (
              <>
                <Spinner />
                <span>Syncing</span>
              </>
            ) : (
              <>
                <SyncIcon />
                <span>Sync</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <div
      className="h-7 w-7 rounded-lg flex items-center justify-center elev-1"
      style={{ background: 'linear-gradient(135deg, var(--accent), #7c4dff)' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </div>
  );
}

function Hero({ stats, loading }) {
  const { totalDebit, txnCount, topCategory, avg } = stats;

  return (
    <section className="pt-14 pb-10 relative">
      <HeroIllustration />

      <div className="md:pr-[200px]">
        <div className="text-[11px] uppercase tracking-[0.14em] font-medium" style={{ color: 'var(--ink-500)' }}>
          Spending overview · May 2026
        </div>

        <div className="mt-3 flex items-end gap-6 flex-wrap">
          <div>
            <div className="num display text-[64px] leading-none font-medium" style={{ color: 'var(--ink-900)' }}>
              {loading ? <span className="skeleton inline-block h-14 w-64 rounded-md align-middle" /> : fmtAmount(totalDebit)}
            </div>
            <div className="mt-3 text-[13px]" style={{ color: 'var(--ink-500)' }}>
              {loading ? '—' : (
                <span>
                  across <span className="font-medium num" style={{ color: 'var(--ink-900)' }}>{txnCount}</span> transactions
                </span>
              )}
            </div>
          </div>

          {!loading && (
            <div className="ml-auto flex items-stretch gap-8 pb-1">
              <MiniStat label="Avg ticket" value={fmtAmount(avg)} />
              {topCategory && (
                <>
                  <Sep />
                  <MiniStat label="Top category" value={topCategory.name} sub={fmtAmount(topCategory.amount)} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function HeroIllustration() {
  return (
    <div
      className="hidden md:block pointer-events-none absolute right-0 top-4 opacity-90"
      aria-hidden="true"
    >
      <svg width="180" height="140" viewBox="0 0 180 140" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="potGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fde2d8" />
            <stop offset="100%" stopColor="#f4a78a" />
          </linearGradient>
          <linearGradient id="leafGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8ed1a3" />
            <stop offset="100%" stopColor="#3e8c5c" />
          </linearGradient>
          <linearGradient id="coinGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe9a8" />
            <stop offset="100%" stopColor="#f0b94b" />
          </linearGradient>
        </defs>

        {/* falling coins (lightly suspended) */}
        <g opacity="0.85">
          <circle cx="42" cy="22" r="7" fill="url(#coinGrad)" stroke="#c98b2c" strokeWidth="1" />
          <text x="42" y="26" textAnchor="middle" fontSize="9" fontWeight="700" fill="#7a5418">₹</text>
          <circle cx="22" cy="50" r="5.5" fill="url(#coinGrad)" stroke="#c98b2c" strokeWidth="1" />
          <text x="22" y="53.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#7a5418">₹</text>
          <circle cx="58" cy="58" r="6" fill="url(#coinGrad)" stroke="#c98b2c" strokeWidth="1" />
          <text x="58" y="62" textAnchor="middle" fontSize="8" fontWeight="700" fill="#7a5418">₹</text>
        </g>

        {/* plant stem */}
        <path d="M115 105 C 115 85, 118 65, 122 50" stroke="#4a7c5c" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        {/* left leaf */}
        <path d="M115 78 C 95 72, 88 58, 95 48 C 108 50, 118 62, 115 78 Z" fill="url(#leafGrad)" />
        {/* right leaf */}
        <path d="M120 65 C 142 60, 150 46, 144 34 C 130 34, 118 48, 120 65 Z" fill="url(#leafGrad)" />
        {/* top leaf (heart-shaped) */}
        <path d="M122 50 C 120 38, 112 32, 118 24 C 124 22, 130 30, 122 50 Z" fill="url(#leafGrad)" />

        {/* pot */}
        <path d="M95 105 L 105 130 L 140 130 L 150 105 Z" fill="url(#potGrad)" stroke="#c97a5a" strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="93" y="100" width="59" height="8" rx="2" fill="#f4a78a" stroke="#c97a5a" strokeWidth="1.5" />

        {/* heart spark */}
        <path d="M158 78 C 162 74, 168 76, 168 81 C 168 85, 162 89, 158 92 C 154 89, 148 85, 148 81 C 148 76, 154 74, 158 78 Z" fill="#f06292" opacity="0.85" />
      </svg>
    </div>
  );
}

function Sep() {
  return <div className="w-px self-stretch" style={{ background: 'var(--hairline)' }} />;
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="min-w-[88px]">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-neutral-400 font-medium">{label}</div>
      <div className="mt-1 text-[15px] font-medium tighter text-neutral-900 num">{value}</div>
      {sub && <div className="text-[11.5px] text-neutral-500 num mt-0.5">{sub}</div>}
    </div>
  );
}

function TabNav({ active, setActive, uncategorized }) {
  return (
    <nav className="border-b sticky top-14 z-20 backdrop-blur-md -mx-8 px-8" style={{ borderColor: 'var(--hairline)', background: 'rgba(247,249,252,0.82)' }}>
      <div className="flex gap-1">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className="relative px-3 h-11 text-[13px] font-medium transition"
              style={{ color: isActive ? 'var(--accent)' : 'var(--ink-500)' }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--ink-900)'; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--ink-500)'; }}
            >
              <span className="inline-flex items-center gap-2">
                {tab.label}
                {tab.id === 'review' && uncategorized > 0 && (
                  <span
                    className="inline-flex items-center justify-center h-[17px] min-w-[17px] px-1 rounded-full text-[10px] font-semibold num"
                    style={{
                      background: isActive ? 'var(--accent)' : 'var(--accent-50)',
                      color: isActive ? 'white' : 'var(--accent-700)',
                    }}
                  >
                    {uncategorized}
                  </span>
                )}
              </span>
              {isActive && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: 'var(--accent)' }} />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function LoadingState() {
  return (
    <div className="pt-6 space-y-2.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skeleton h-14 rounded-xl" />
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function Toast({ visible, state, kind = 'sync' }) {
  if (!visible) return null;
  const isErr = !!state.error;
  const verb = kind === 'upload' ? 'Imported' : 'Synced';
  return (
    <div className="fixed bottom-6 right-6 z-50 fade-in">
      <div
        className="elev-2 rounded-xl border bg-white pl-3.5 pr-4 py-3 flex items-center gap-2.5 min-w-[260px]"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: isErr ? '#dc2626' : 'var(--positive)' }}
        />
        <span className="text-[12.5px] text-neutral-800">
          {isErr ? state.error : (
            <>
              {verb} · <span className="text-neutral-500 num">+{state.lastResult?.inserted} new, {state.lastResult?.updated} updated</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
