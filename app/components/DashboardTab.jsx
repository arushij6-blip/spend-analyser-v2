'use client';

import { useMemo, useState } from 'react';
import { fmtAmount, fmtDate } from './categories.js';

export default function DashboardTab({ transactions }) {
  const monthsAvailable = useMemo(() => {
    const set = new Set();
    for (const t of transactions) if (t.date) set.add(t.date.slice(0, 7));
    const arr = Array.from(set).sort();
    return arr;
  }, [transactions]);

  const latest = monthsAvailable[monthsAvailable.length - 1] ?? '2026-05';
  const [month, setMonth] = useState(latest);

  const idx = monthsAvailable.indexOf(month);
  const prevMonth = idx > 0 ? monthsAvailable[idx - 1] : null;
  const nextMonth = idx >= 0 && idx < monthsAvailable.length - 1 ? monthsAvailable[idx + 1] : null;

  const monthTxns = useMemo(
    () => transactions.filter((t) => t.date?.startsWith(month)),
    [transactions, month]
  );

  const debits = monthTxns.filter((t) => t.type === 'DEBIT');
  const credits = monthTxns.filter((t) => t.type === 'CREDIT');
  const totalDebit = debits.reduce((s, t) => s + t.amount, 0);
  const totalCredit = credits.reduce((s, t) => s + t.amount, 0);
  const avgTicket = debits.length ? totalDebit / debits.length : 0;

  const byCategory = useMemo(() => {
    const m = new Map();
    for (const t of debits) {
      m.set(t.category, (m.get(t.category) ?? 0) + t.amount);
    }
    return Array.from(m.entries())
      .map(([name, amount]) => ({ name, amount, share: totalDebit > 0 ? amount / totalDebit : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [debits, totalDebit]);

  const topTxns = useMemo(
    () => [...debits].sort((a, b) => b.amount - a.amount).slice(0, 5),
    [debits]
  );

  const compareLabel = prevMonth ? formatMonthShort(prevMonth) : null;
  const prevDebit = useMemo(() => {
    if (!prevMonth) return null;
    return transactions
      .filter((t) => t.date?.startsWith(prevMonth) && t.type === 'DEBIT')
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions, prevMonth]);

  const delta = prevDebit != null && prevDebit > 0 ? (totalDebit - prevDebit) / prevDebit : null;

  if (monthsAvailable.length === 0) {
    return (
      <div className="pt-10">
        <div className="bg-white border rounded-2xl py-20 text-center" style={{ borderColor: 'var(--hairline)' }}>
          <p className="text-[13.5px] text-neutral-700 font-medium">No data yet</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">Sync from Gmail to populate the dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-6 space-y-5">
      {/* Month switcher */}
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1 bg-white border rounded-full px-1 py-1 elev-1" style={{ borderColor: 'var(--hairline)' }}>
          <NavBtn disabled={!prevMonth} onClick={() => prevMonth && setMonth(prevMonth)} dir="left" />
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="focus-ring appearance-none bg-transparent px-3 h-7 text-[13px] font-semibold tighter cursor-pointer"
            style={{ color: 'var(--ink-900)' }}
          >
            {monthsAvailable.map((m) => (
              <option key={m} value={m}>{formatMonthLong(m)}</option>
            ))}
          </select>
          <NavBtn disabled={!nextMonth} onClick={() => nextMonth && setMonth(nextMonth)} dir="right" />
        </div>
        <div className="text-[12px] text-neutral-500 num">
          <span className="font-medium text-neutral-700">{monthTxns.length}</span> transactions
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Total spend"
          value={fmtAmount(totalDebit)}
          accent
          footer={
            delta != null ? (
              <DeltaPill value={delta} compareLabel={compareLabel} />
            ) : (
              <span className="text-[11.5px] text-neutral-400">No prior month</span>
            )
          }
        />
        <Kpi label="Avg ticket" value={fmtAmount(avgTicket)} footer={`across ${debits.length} debits`} />
        <Kpi
          label="Money in"
          value={fmtAmount(totalCredit)}
          valueColor="var(--positive)"
          footer={`${credits.length} credits`}
        />
        <Kpi
          label="Top category"
          value={byCategory[0]?.name ?? '—'}
          footer={byCategory[0] ? fmtAmount(byCategory[0].amount) : '—'}
        />
      </div>

      {/* Category breakdown + Top txns */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <section className="lg:col-span-3 bg-white border rounded-2xl elev-1" style={{ borderColor: 'var(--hairline)' }}>
          <header className="px-6 py-4 border-b flex items-baseline justify-between" style={{ borderColor: 'var(--hairline)' }}>
            <h3 className="text-[13.5px] font-semibold tighter text-neutral-900">Where it went</h3>
            <span className="text-[11.5px] text-neutral-400">{byCategory.length} categories</span>
          </header>
          {byCategory.length === 0 ? (
            <div className="px-6 py-10 text-center text-[12.5px] text-neutral-500">No debits this month.</div>
          ) : (
            <ul className="px-2 py-2">
              {byCategory.map((c) => (
                <li key={c.name} className="px-4 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 text-[12.5px] font-medium tighter text-neutral-900">
                      <span className="h-2 w-2 rounded-full" style={{ background: catDot(c.name) }} />
                      {c.name}
                    </div>
                    <div className="flex items-baseline gap-2 num">
                      <span className="text-[12.5px] font-semibold tighter text-neutral-900">{fmtAmount(c.amount)}</span>
                      <span className="text-[11px] text-neutral-400 w-9 text-right">{(c.share * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, c.share * 100)}%`,
                        background: catDot(c.name),
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lg:col-span-2 bg-white border rounded-2xl elev-1" style={{ borderColor: 'var(--hairline)' }}>
          <header className="px-6 py-4 border-b flex items-baseline justify-between" style={{ borderColor: 'var(--hairline)' }}>
            <h3 className="text-[13.5px] font-semibold tighter text-neutral-900">Top transactions</h3>
            <span className="text-[11.5px] text-neutral-400">{topTxns.length}</span>
          </header>
          {topTxns.length === 0 ? (
            <div className="px-6 py-10 text-center text-[12.5px] text-neutral-500">Nothing to show.</div>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--hairline)' }}>
              {topTxns.map((t, i) => (
                <li key={t.message_id} className="px-6 py-3 flex items-center gap-3">
                  <span className="num text-[11px] text-neutral-400 w-4">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-neutral-900 truncate tighter" title={t.merchant ?? ''}>
                      {(t.merchant ?? '').replace(/\s+/g, ' ').trim() || '—'}
                    </div>
                    <div className="text-[11px] text-neutral-400 num mt-0.5 flex items-center gap-1.5">
                      <span>{fmtDate(t.date)}</span>
                      <span className="h-1 w-1 rounded-full" style={{ background: catDot(t.category) }} />
                      <span>{t.category}</span>
                    </div>
                  </div>
                  <span className="num text-[13px] font-semibold tighter text-neutral-900 whitespace-nowrap">
                    {fmtAmount(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, footer, valueColor, accent }) {
  return (
    <div
      className="bg-white border rounded-2xl px-5 py-4 elev-1"
      style={{ borderColor: 'var(--hairline)' }}
    >
      <div
        className="text-[10.5px] uppercase tracking-[0.12em] font-semibold"
        style={{ color: accent ? 'var(--accent)' : 'var(--ink-400)' }}
      >
        {label}
      </div>
      <div
        className="mt-1.5 text-[22px] font-medium tighter num truncate"
        style={{ color: valueColor ?? 'var(--ink-900)' }}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
      <div className="mt-1 text-[11.5px] text-neutral-500">{footer}</div>
    </div>
  );
}

function DeltaPill({ value, compareLabel }) {
  const up = value > 0;
  const flat = Math.abs(value) < 0.005;
  const color = flat ? 'var(--ink-500)' : up ? '#b45309' : 'var(--positive)';
  const bg = flat ? 'var(--surface-2)' : up ? '#fff4e5' : '#ecfdf5';
  const sign = flat ? '·' : up ? '↑' : '↓';
  const pct = (Math.abs(value) * 100).toFixed(0);
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium num"
      style={{ background: bg, color }}
    >
      {sign} {pct}% <span className="text-neutral-400 font-normal">vs {compareLabel}</span>
    </span>
  );
}

function NavBtn({ onClick, disabled, dir }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition disabled:opacity-30 disabled:cursor-not-allowed"
      aria-label={dir === 'left' ? 'Previous month' : 'Next month'}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );
}

function catDot(c) {
  const map = {
    'Groceries':        'hsl(142 60% 50%)',
    'Shopping':         'hsl(326 60% 60%)',
    'Daily Commute':    'hsl(222 60% 58%)',
    'Travel':           'hsl(196 60% 50%)',
    'Home Maintenance': 'hsl(170 50% 45%)',
    'Staff Salaries':   'hsl(268 50% 60%)',
    'Medical':          'hsl(8 60% 58%)',
    'Going Out':        'hsl(38 65% 55%)',
    'Ordering In':      'hsl(22 65% 55%)',
    'Credit Card Bill': 'hsl(248 50% 60%)',
    'Misc':             '#a3a3a3',
  };
  return map[c] ?? '#a3a3a3';
}

function formatMonthLong(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(m) - 1]} ${y}`;
}

function formatMonthShort(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m) - 1]} ’${y.slice(2)}`;
}
