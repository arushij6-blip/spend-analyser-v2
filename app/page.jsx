'use client';

import { useEffect, useMemo, useState } from 'react';
import DashboardTab from './components/DashboardTab.jsx';
import ExpensesTab from './components/ExpensesTab.jsx';
import ReviewTab from './components/ReviewTab.jsx';
import TrendsTab from './components/TrendsTab.jsx';
import { CATEGORIES, fmtAmount } from './components/categories.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'review', label: 'Review' },
  { id: 'trends', label: 'Trends' },
];

export default function Home() {
  const [active, setActive] = useState('dashboard');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanState, setScanState] = useState({ running: false, lastResult: null, error: null });
  const [toastVisible, setToastVisible] = useState(false);

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
      setToastVisible(true);
      const t = setTimeout(() => setToastVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [scanState.lastResult, scanState.error]);

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
    setTransactions((prev) =>
      prev.map((t) => (t.message_id === messageId ? { ...t, category, manually_edited: 1 } : t))
    );
  }

  const stats = useMemo(() => {
    // Hero summary is May-only.
    const inMay = transactions.filter((t) => t.date?.startsWith('2026-05'));
    const debits = inMay.filter((t) => t.type === 'DEBIT');
    const credits = inMay.filter((t) => t.type === 'CREDIT');
    const totalDebit = debits.reduce((s, t) => s + t.amount, 0);
    const totalCredit = credits.reduce((s, t) => s + t.amount, 0);

    // Review badge stays global (all Misc across loaded range).
    const uncat = transactions.filter((t) => t.category === 'Misc' && !t.manually_edited).length;

    const byCat = new Map();
    for (const t of debits) {
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
    }
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      txnCount: inMay.length,
      totalDebit, totalCredit,
      uncategorized: uncat,
      avg: debits.length ? totalDebit / debits.length : 0,
      topCategory: top ? { name: top[0], amount: top[1] } : null,
    };
  }, [transactions]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <TopBar onSync={runScan} syncing={scanState.running} />

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
                    transactions={transactions.filter((t) => t.category === 'Misc' && !t.manually_edited)}
                    onUpdateCategory={(id, cat) => updateCategory(id, cat, { learn: true })}
                    categories={CATEGORIES}
                  />
                )}
                {active === 'trends' && <TrendsTab />}
              </div>
            )}
          </div>
        </div>
      </main>

      <Toast visible={toastVisible} state={scanState} />
    </div>
  );
}

function TopBar({ onSync, syncing }) {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-md"
      style={{ borderColor: 'var(--hairline)', background: 'rgba(247,249,252,0.82)' }}
    >
      <div className="max-w-[1180px] mx-auto px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Mark />
          <div className="text-[13.5px] font-semibold tracking-tight" style={{ color: 'var(--ink-900)' }}>Spend</div>
          <span className="ml-1 text-[11.5px]" style={{ color: 'var(--ink-400)' }}>Axis</span>
        </div>
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
    </header>
  );
}

function Mark() {
  return (
    <div className="h-6 w-6 rounded-md flex items-center justify-center" style={{ background: 'var(--accent)' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19V5l8 5 8-5v14" />
      </svg>
    </div>
  );
}

function Hero({ stats, loading }) {
  const { totalDebit, txnCount, topCategory, totalCredit, avg } = stats;

  return (
    <section className="pt-14 pb-10">
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
                {totalCredit > 0 && (
                  <>
                    <span className="mx-2" style={{ color: 'var(--ink-300)' }}>·</span>
                    <span className="num">{fmtAmount(totalCredit)}</span> received
                  </>
                )}
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
    </section>
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

function Toast({ visible, state }) {
  if (!visible) return null;
  const isErr = !!state.error;
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
              Synced · <span className="text-neutral-500 num">+{state.lastResult?.inserted} new, {state.lastResult?.updated} updated</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
