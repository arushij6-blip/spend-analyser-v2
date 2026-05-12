'use client';

/**
 * Budgets — monthly per-category caps with a calm, mobile-first layout.
 *
 * - List rows stack vertically on small screens and breathe on wider ones.
 * - Inline edit drawer per row (tap "Set" / "Edit" → small sheet at bottom on
 *   mobile, side panel on desktop). No modal stacking.
 * - Progress bar colors track the same threshold semantics the Telegram
 *   alerts use: calm < 80%, warm 80–99%, over 100%+.
 * - Defaults: last month's net spend is pre-filled in the editor for any
 *   un-budgeted category, so the user can accept-and-go.
 * - Empty state guides the user to set their first budget.
 */

import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, fmtAmount } from './categories.js';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[Number(m) - 1]} ${y}`;
}

export default function BudgetsTab() {
  const [month] = useState(currentMonth());
  const [data, setData] = useState({ rows: [], suggestions: {} });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { category, current }
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/budgets?month=${month}`, { cache: 'no-store' });
      const json = await res.json();
      setData({ rows: json.rows ?? [], suggestions: json.suggestions ?? {} });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [month]);

  // Merge categories without budgets-or-spend into the list so the user can
  // still set a budget for a quiet category from the same screen.
  const allRows = useMemo(() => {
    const known = new Map(data.rows.map((r) => [r.category, r]));
    for (const c of CATEGORIES) {
      if (!known.has(c)) {
        known.set(c, { category: c, budget: null, spent: 0, remaining: null, pct: null });
      }
    }
    return Array.from(known.values());
  }, [data.rows]);

  const budgeted = allRows.filter((r) => r.budget != null);
  const unbudgeted = allRows.filter((r) => r.budget == null);

  async function saveBudget(category, amount) {
    setSaving(true);
    try {
      await fetch('/api/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, month, amount }),
      });
      await load();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="pt-6 space-y-2.5">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
      </div>
    );
  }

  const noBudgetsYet = budgeted.length === 0;

  return (
    <div className="pt-6 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] font-medium" style={{ color: 'var(--ink-500)' }}>
            Budgets · {formatMonthLabel(month)}
          </div>
          <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-500)' }}>
            Set a monthly cap per category. Gentle Telegram nudge at 80%, again at 100%.
          </p>
        </div>
      </header>

      {noBudgetsYet ? (
        <EmptyState
          suggestions={data.suggestions}
          onPick={(category) =>
            setEditing({ category, current: data.suggestions[category] ?? '' })
          }
        />
      ) : (
        <section className="space-y-2.5">
          {budgeted.map((r) => (
            <BudgetRow
              key={r.category}
              row={r}
              onEdit={() => setEditing({ category: r.category, current: r.budget })}
            />
          ))}
        </section>
      )}

      <section className="space-y-2.5">
        <div className="text-[10.5px] uppercase tracking-[0.12em] font-medium" style={{ color: 'var(--ink-400)' }}>
          Not budgeted yet
        </div>
        {unbudgeted.length === 0 ? (
          <div className="text-[12.5px]" style={{ color: 'var(--ink-400)' }}>
            Every category has a budget. Calm energy. 🌿
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {unbudgeted.map((r) => (
              <UnbudgetedRow
                key={r.category}
                row={r}
                suggestion={data.suggestions[r.category]}
                onSet={() =>
                  setEditing({
                    category: r.category,
                    current: data.suggestions[r.category] ?? '',
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      {editing && (
        <EditSheet
          category={editing.category}
          current={editing.current}
          suggestion={data.suggestions[editing.category]}
          saving={saving}
          onSave={(amt) => saveBudget(editing.category, amt)}
          onDelete={() => saveBudget(editing.category, null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BudgetRow({ row, onEdit }) {
  const { category, budget, spent, remaining, pct } = row;
  const overflow = pct != null && pct >= 100;
  const warm = pct != null && pct >= 80 && pct < 100;

  const fillPct = Math.min(100, pct ?? 0);
  const barColor = overflow
    ? 'var(--accent-warm-over, #d9534b)'
    : warm
    ? 'var(--accent-warm, #d99155)'
    : 'var(--accent)';

  return (
    <div
      className="bg-white border rounded-2xl px-4 sm:px-5 py-4 elev-1"
      style={{ borderColor: 'var(--hairline)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: catDot(category) }} />
            <span className="text-[14px] font-medium tighter" style={{ color: 'var(--ink-900)' }}>
              {category}
            </span>
          </div>
          <div className="mt-1 text-[12px] num" style={{ color: 'var(--ink-500)' }}>
            {fmtAmount(spent)} <span style={{ color: 'var(--ink-400)' }}>of</span> {fmtAmount(budget)}
          </div>
        </div>
        <button
          onClick={onEdit}
          className="focus-ring text-[12px] font-medium px-2.5 h-7 rounded-full border transition"
          style={{ borderColor: 'var(--hairline)', color: 'var(--ink-700)', background: 'white' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
        >
          Edit
        </button>
      </div>

      <div className="mt-3.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${fillPct}%`, background: barColor }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11.5px] num">
        <span style={{ color: overflow ? '#b14a43' : 'var(--ink-500)' }}>
          {overflow
            ? `${fmtAmount(Math.abs(remaining))} over`
            : `${fmtAmount(Math.max(0, remaining))} left`}
        </span>
        <span style={{ color: 'var(--ink-400)' }}>
          {pct == null ? '—' : `${Math.round(pct)}%`}
        </span>
      </div>
    </div>
  );
}

function UnbudgetedRow({ row, suggestion, onSet }) {
  return (
    <div
      className="bg-white border rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3"
      style={{ borderColor: 'var(--hairline)' }}
    >
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: catDot(row.category) }} />
          <span className="text-[13.5px] font-medium tighter truncate" style={{ color: 'var(--ink-900)' }}>
            {row.category}
          </span>
        </div>
        <div className="mt-0.5 text-[11.5px] num" style={{ color: 'var(--ink-500)' }}>
          {row.spent > 0 ? `${fmtAmount(row.spent)} spent` : 'No spend yet'}
          {suggestion ? ` · last mo. ${fmtAmount(suggestion)}` : ''}
        </div>
      </div>
      <button
        onClick={onSet}
        className="focus-ring text-[12px] font-medium px-3 h-7 rounded-full text-white transition"
        style={{ background: 'var(--accent)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-700)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
      >
        Set
      </button>
    </div>
  );
}

function EmptyState({ suggestions, onPick }) {
  const suggested = Object.entries(suggestions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <div
      className="bg-white border rounded-2xl px-6 py-10 text-center elev-1"
      style={{ borderColor: 'var(--hairline)' }}
    >
      <div className="text-[28px]" aria-hidden>🌱</div>
      <h3 className="mt-2 text-[15px] font-semibold tighter" style={{ color: 'var(--ink-900)' }}>
        No budgets yet
      </h3>
      <p className="mt-1 text-[12.5px] max-w-md mx-auto" style={{ color: 'var(--ink-500)' }}>
        Pick a category to start. We’ll send a soft Telegram nudge at 80% and again if you cross 100%. No anxiety. Promise.
      </p>
      {suggested.length > 0 && (
        <div className="mt-5">
          <div className="text-[10.5px] uppercase tracking-[0.12em] font-medium" style={{ color: 'var(--ink-400)' }}>
            Based on last month
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {suggested.map(([cat, amt]) => (
              <button
                key={cat}
                onClick={() => onPick(cat)}
                className="focus-ring inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[12.5px] font-medium transition"
                style={{ borderColor: 'var(--hairline)', color: 'var(--ink-700)', background: 'white' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: catDot(cat) }} />
                {cat}
                <span className="num" style={{ color: 'var(--ink-400)' }}>{fmtAmount(amt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EditSheet({ category, current, suggestion, saving, onSave, onDelete, onClose }) {
  const [value, setValue] = useState(current != null && current !== '' ? String(Math.round(current)) : '');

  function submit(e) {
    e?.preventDefault?.();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    onSave(n);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl elev-2 p-5 sm:p-6 fade-in"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div className="text-[10.5px] uppercase tracking-[0.12em] font-medium" style={{ color: 'var(--ink-400)' }}>
          Monthly budget
        </div>
        <div className="mt-1 inline-flex items-center gap-2 text-[16px] font-semibold tighter" style={{ color: 'var(--ink-900)' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: catDot(category) }} />
          {category}
        </div>

        <label className="mt-5 block">
          <span className="text-[11.5px]" style={{ color: 'var(--ink-500)' }}>Amount (INR)</span>
          <div className="mt-1.5 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: 'var(--ink-400)' }}>₹</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={suggestion ? String(Math.round(suggestion)) : '0'}
              className="focus-ring w-full h-11 pl-7 pr-3 rounded-xl border text-[15px] num bg-white"
              style={{ borderColor: 'var(--hairline-strong)', color: 'var(--ink-900)' }}
            />
          </div>
          {suggestion ? (
            <button
              type="button"
              onClick={() => setValue(String(Math.round(suggestion)))}
              className="mt-2 text-[11.5px] underline-offset-2 hover:underline"
              style={{ color: 'var(--ink-500)' }}
            >
              Use last month: {fmtAmount(suggestion)}
            </button>
          ) : null}
        </label>

        <div className="mt-6 flex items-center justify-between gap-2">
          {current ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={saving}
              className="text-[12.5px] font-medium"
              style={{ color: '#b14a43' }}
            >
              Remove
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-9 px-3.5 rounded-full text-[12.5px] font-medium border"
              style={{ borderColor: 'var(--hairline)', color: 'var(--ink-700)', background: 'white' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !Number(value)}
              className="h-9 px-4 rounded-full text-[12.5px] font-medium text-white transition disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
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
