'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminBackHeader from './AdminBackHeader';
import PlayerProfileSheet from './CommandCenter/PlayerProfileSheet';
import BarRow from './metrics/BarRow';
import AddExpenseSheet, { CATEGORY_LABEL, type ExpenseCategory } from './ledger/AddExpenseSheet';
import ReconcileSheet from './ledger/ReconcileSheet';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import StatusBadge from '@/components/primitives/StatusBadge';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import { fmtSessionLabel } from '@/lib/fmt';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type RangeKey = '30d' | '12w' | 'all';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '30d', label: '30 days' },
  { key: '12w', label: '12 weeks' },
  { key: 'all', label: 'All time' },
];

interface LedgerSessionRow {
  sessionId: string;
  date: string;
  attendanceCount: number;
  totalCost: number;
  paidCount: number;
  coveredCount: number;
  unpaidAmount: number;
  unpaidCount: number;
}

interface LedgerPlayerRow {
  memberId: string | null;
  name: string;
  sessionCount: number;
  owedAmount: number;
}

/** `GET /api/admin/ledger` — cents throughout, except the drill-in rows (dollars, as before). */
interface MoneyData {
  range: { key: RangeKey; from: string; to: string };
  generatedAt: string;
  income: { sessions: number; stringing: number; total: number };
  collected: { etransferAuto: number; etransferAdmin: number; manual: number; credit: number; total: number };
  covered: number;
  outstanding: { sessions: number; stringing: number; total: number; people: number };
  credit: { liability: number; members: number };
  giftCards: { unredeemed: number; amount: number };
  outlay: { courts: number; shuttles: number; strings: number; other: number; total: number };
  net: number;
  unfinalized: { count: number; estimatedTotal: number; sessions: { sessionId: string; date: string; estimatedTotal: number; players: number }[] };
  reconcile: { lastAt: string; mismatches: number; unlisted: number; truncated: boolean } | null;
  bySession: LedgerSessionRow[];
  byPlayer: LedgerPlayerRow[];
}

interface Expense {
  id: string;
  amountCents: number;
  note: string;
  date: string;
  category: ExpenseCategory;
}

interface LedgerPageProps {
  onBack: () => void;
  /** Drill into a session's payments. Omitted in contexts (e.g. tests)
   *  that render the page in isolation — rows stay inert then. */
  onOpenSession?: (sessionId: string) => void;
}

const money = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const dollars = (n: number) => `$${n.toFixed(2)}`;
const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/** Two missed daily checks reads as "the script stopped" — the E-transfers card's rule. */
const RECONCILE_STALE_MS = 2.5 * 24 * 60 * 60 * 1000;

const rowStyle = {
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-4)',
  width: '100%',
  textAlign: 'left' as const,
  font: 'inherit',
  color: 'inherit',
};

function Section({ title, subtitle, action, children, ariaLabel }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={ariaLabel ?? title}>
      <CardHeader title={title} subtitle={subtitle} action={action} compact />
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

/**
 * THE ONE MONEY VIEW (docs/plans/payments.md, Phase 2 stage 3). Top to
 * bottom: is the ledger trustworthy today → what came in and went out →
 * how it came in → what is still owed → what the club owes back → what it
 * spent → what is not finalized yet (last, so an estimate can never read
 * as a total) → the settled sessions to drill into.
 *
 * Cents from the ledger and dollars from the rows never meet in one number.
 * A failed load is the error state and NO tiles: six true figures and one
 * silent zero is the lying empty state with a straight face.
 */
export default function LedgerPage({ onBack, onOpenSession }: LedgerPageProps) {
  const online = useOnline();
  const [range, setRange] = useState<RangeKey>('12w');
  const [data, setData] = useState<MoneyData | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [expensesError, setExpensesError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [profile, setProfile] = useState<{ memberId: string | null; name: string } | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseKey, setExpenseKey] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');

  const loadExpenses = useCallback(async () => {
    setExpensesError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/expenses`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setExpenses(((await res.json()) as { expenses: Expense[] }).expenses);
    } catch {
      setExpensesError(true);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/ledger?range=${range}`, { cache: 'no-store' });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as MoneyData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  // Another admin may have covered someone while this tab was backgrounded.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const refresh = () => {
    void load();
    void loadExpenses();
  };

  async function removeExpense(id: string) {
    setRemoveError('');
    try {
      const res = await fetch(`${BASE}/api/admin/expenses`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setRemoving(null);
      refresh();
    } catch {
      setRemoveError("Couldn't remove it — try again.");
    }
  }

  if (loadError) {
    return (
      <div className="motion-fade space-y-3">
        <AdminBackHeader onBack={onBack} title="Ledger" />
        <div style={{ padding: 'var(--space-9) var(--space-7)' }}>
          <ErrorState
            message="Couldn't load the ledger."
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
                Try again
              </button>
            }
          />
        </div>
      </div>
    );
  }

  // First load only: a range tap or a focus refetch keeps the last view (dimmed via aria-busy).
  if (!data) {
    return (
      <div className="space-y-3">
        <AdminBackHeader onBack={onBack} title="Ledger" />
        <AdminPageSkeleton />
      </div>
    );
  }

  const { reconcile, collected, outlay, outstanding, credit, giftCards, unfinalized, bySession, byPlayer } = data;
  const mismatched = (reconcile?.mismatches ?? 0) > 0;
  const stale = !reconcile || Date.now() - Date.parse(reconcile.lastAt) > RECONCILE_STALE_MS;
  const reconcileLine = !reconcile
    ? 'Ledger not checked yet'
    : mismatched
      ? `${reconcile.mismatches}${reconcile.truncated ? '+' : ''} ${reconcile.mismatches === 1 ? 'line doesn’t' : 'lines don’t'} match · checked ${ago(reconcile.lastAt)}`
      : `Ledger checked ${ago(reconcile.lastAt)} · clean`;

  return (
    <div className="space-y-3 motion-busy" aria-busy={loading || undefined}>
      <AdminBackHeader onBack={onBack} title="Ledger" />

      {/* Is the ledger trustworthy today? One line; amber when it isn't, or nobody has asked lately. */}
      <div className="flex items-center" style={{ gap: 'var(--space-3)', margin: '0 var(--space-1)' }}>
        <p
          className="fs-sm"
          role={mismatched ? 'status' : undefined}
          style={{ margin: 0, flex: 1, fontFamily: 'var(--font-mono)', color: mismatched || stale ? 'var(--sev-warn)' : 'var(--text-muted)' }}
        >
          {reconcileLine}
        </p>
        <button type="button" className={`cc-btn ${mismatched ? 'cc-btn-secondary' : 'cc-btn-ghost'}`} onClick={() => setReconcileOpen(true)}>
          {mismatched ? 'See what' : 'Check'}
        </button>
      </div>

      <div className="segment-control flex" role="tablist" aria-label="Date range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={range === r.key}
            onClick={() => setRange(r.key)}
            className={`flex-1 flex items-center justify-center fs-sm rounded-full ${range === r.key ? 'segment-tab-active' : 'segment-tab-inactive'}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── In and out ── */}
      <Section title="In and out" subtitle={`${money(data.covered)} covered by you · ${bySession.length} session${bySession.length === 1 ? '' : 's'} settled`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <div className="cc-tile cc-tile-static">
            <span className="num">{money(collected.total)}</span>
            <span className="lbl">Collected</span>
          </div>
          <div className="cc-tile cc-tile-static">
            <span className="num">{money(outlay.total)}</span>
            <span className="lbl">Outlay</span>
          </div>
          <div className={`cc-tile cc-tile-static${data.net < 0 ? ' warn' : ''}`}>
            <span className="num">{money(data.net)}</span>
            <span className="lbl">Net</span>
          </div>
        </div>
      </Section>

      {/* ── Collected by ── */}
      <Section title="Collected by">
        {collected.total === 0 ? (
          <Muted>Nothing collected in this window.</Muted>
        ) : (
          <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
            <BarRow label="E-transfer, matched on its own" value={share(collected.etransferAuto, collected.total)} detail={money(collected.etransferAuto)} />
            <BarRow label="E-transfer, matched by you" value={share(collected.etransferAdmin, collected.total)} detail={money(collected.etransferAdmin)} />
            <BarRow label="Marked paid" value={share(collected.manual, collected.total)} detail={money(collected.manual)} />
            <BarRow label="Store credit" value={share(collected.credit, collected.total)} detail={money(collected.credit)} />
          </div>
        )}
      </Section>

      {/* ── Still owed — right now ── */}
      <Section
        title="Still owed"
        subtitle="Right now, everyone — finalized bills only, not just this range"
        action={mismatched ? <StatusBadge variant="phase" tone="amber">ledger ≠ app</StatusBadge> : undefined}
      >
        {outstanding.total === 0 ? (
          <p className="fs-md" style={{ margin: 0, color: 'var(--accent)', fontWeight: 600 }}>
            Everyone&apos;s caught up. Nice.
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
              <div className="cc-tile cc-tile-static">
                <span className="num">{money(outstanding.sessions)}</span>
                <span className="lbl">Sessions</span>
              </div>
              <div className="cc-tile cc-tile-static">
                <span className="num">{money(outstanding.stringing)}</span>
                <span className="lbl">Stringing</span>
              </div>
              <div className="cc-tile cc-tile-static">
                <span className="num">{outstanding.people}</span>
                <span className="lbl">{outstanding.people === 1 ? 'Person' : 'People'}</span>
              </div>
            </div>
            {byPlayer.length > 0 && (
              <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
                {byPlayer.map((p) => {
                  const linked = p.memberId !== null;
                  const inner = (
                    <>
                      <div style={{ minWidth: 0 }}>
                        <p className="fs-md" style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontWeight: 600, margin: 0 }}>{p.name}</p>
                        <p className="fs-xs" style={{ color: 'var(--text-secondary)', margin: 'var(--space-05) 0 0' }}>
                          {p.sessionCount} unpaid session{p.sessionCount === 1 ? '' : 's'} in this range
                        </p>
                      </div>
                      <span className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                        <span className="fs-lg" style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--amber)' }}>
                          {dollars(p.owedAmount)}
                        </span>
                        {linked && <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--ink-faint)' }}>chevron_right</span>}
                      </span>
                    </>
                  );
                  const key = p.memberId ?? `name:${p.name.toLowerCase()}`;
                  return linked ? (
                    <button type="button" key={key} className="cc-mini-card" onClick={() => setProfile({ memberId: p.memberId, name: p.name })} aria-label={`${p.name}'s history`} style={{ ...rowStyle, cursor: 'pointer' }}>
                      {inner}
                    </button>
                  ) : (
                    <div key={key} className="cc-mini-card" style={rowStyle}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── Credit & gift cards ── */}
      <Section title="Credit & gift cards" subtitle="Money the group owes back">
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
            <span className="fs-base" style={{ color: 'var(--text-primary)' }}>
              Store credit held by {credit.members} {credit.members === 1 ? 'member' : 'members'}
            </span>
            <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{money(credit.liability)}</span>
          </div>
          <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
            <span className="fs-base" style={{ color: 'var(--text-primary)' }}>
              {giftCards.unredeemed} gift {giftCards.unredeemed === 1 ? 'card' : 'cards'} not yet redeemed
            </span>
            <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{money(giftCards.amount)}</span>
          </div>
        </div>
      </Section>

      {/* ── Club outlay ── */}
      <Section
        title="Group outlay"
        subtitle="Courts, shuttles, and anything you add"
        action={
          <button type="button" className="cc-btn cc-btn-ghost" style={{ whiteSpace: 'nowrap' }} disabled={!online} onClick={() => { setExpenseKey((k) => k + 1); setExpenseOpen(true); }}>
            Add expense
          </button>
        }
      >
        {outlay.total === 0 ? (
          <Muted>Nothing spent in this window.</Muted>
        ) : (
          <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
            <BarRow label="Courts" value={share(outlay.courts, outlay.total)} detail={money(outlay.courts)} />
            <BarRow label="Shuttles" value={share(outlay.shuttles, outlay.total)} detail={money(outlay.shuttles)} />
            <BarRow label="Strings" value={share(outlay.strings, outlay.total)} detail={money(outlay.strings)} />
            <BarRow label="Other" value={share(outlay.other, outlay.total)} detail={money(outlay.other)} />
          </div>
        )}
        {expensesError ? (
          <ErrorState message="Couldn't load your expenses." action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => void loadExpenses()}>Try again</button>} />
        ) : expenses && expenses.length > 0 ? (
          <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }} aria-label="Your expenses">
            {expenses.map((e) => (
              <li key={e.id} className="cc-mini-card" style={{ padding: 'var(--space-3)' }}>
                <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
                  <span className="fs-base" style={{ color: 'var(--text-primary)', minWidth: 0 }}>{e.note}</span>
                  <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{money(e.amountCents)}</span>
                </div>
                <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
                  <span className="fs-xs" style={{ color: 'var(--text-muted)' }}>
                    {e.date} · {CATEGORY_LABEL[e.category] ?? 'Other'}
                  </span>
                  {removing === e.id ? (
                    <span className="motion-fade flex items-center" style={{ gap: 'var(--space-2)' }}>
                      <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setRemoving(null)}>Keep</button>
                      <button type="button" className="cc-btn cc-btn-danger" onClick={() => void removeExpense(e.id)} aria-label={`Confirm remove ${e.note}`}>Remove</button>
                    </span>
                  ) : (
                    <button type="button" className="cc-btn cc-btn-ghost" disabled={!online} onClick={() => { setRemoveError(''); setRemoving(e.id); }} aria-label={`Remove ${e.note}`}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {removeError && <p className="field-error" role="alert">{removeError}</p>}
      </Section>

      {/* ── Not yet finalized — LAST, so an estimate never reads as a total ── */}
      <Section title="Not yet finalized" subtitle="Estimates from the live split — not income until you settle" ariaLabel="Not yet finalized">
        {unfinalized.count === 0 ? (
          <Muted>Everything in this window is finalized.</Muted>
        ) : (
          <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
            {unfinalized.sessions.map((s) => (
              <button
                type="button"
                key={s.sessionId}
                className="cc-mini-card"
                onClick={() => onOpenSession?.(s.sessionId)}
                aria-label={`Payments for ${fmtSessionLabel(s.date)} (not finalized)`}
                style={{ ...rowStyle, cursor: 'pointer' }}
              >
                <div style={{ minWidth: 0 }}>
                  <p className="fs-md" style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontWeight: 600, margin: 0 }}>{fmtSessionLabel(s.date)}</p>
                  <p className="fs-xs" style={{ color: 'var(--text-secondary)', margin: 'var(--space-05) 0 0' }}>
                    {s.players} player{s.players === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                  <span className="cc-pill cc-pill-amber">est. {dollars(s.estimatedTotal)}</span>
                  <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--ink-faint)' }}>chevron_right</span>
                </span>
              </button>
            ))}
            <Muted>
              {unfinalized.count} session{unfinalized.count === 1 ? '' : 's'} · about {dollars(unfinalized.estimatedTotal)} once settled
            </Muted>
          </div>
        )}
      </Section>

      {/* ── Settled sessions ── */}
      <Section title="Settled sessions" subtitle="Tap one for its payments">
        {bySession.length === 0 ? (
          <Muted>Nothing settled in this window. Try widening the range.</Muted>
        ) : (
          <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
            {bySession.map((s) => (
              <button
                type="button"
                key={s.sessionId}
                className="cc-mini-card"
                onClick={() => onOpenSession?.(s.sessionId)}
                aria-label={`Payments for ${fmtSessionLabel(s.date)}`}
                style={{ ...rowStyle, cursor: 'pointer' }}
              >
                <div style={{ minWidth: 0 }}>
                  <p className="fs-md" style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontWeight: 600, margin: 0 }}>{fmtSessionLabel(s.date)}</p>
                  <p className="fs-xs" style={{ color: 'var(--text-secondary)', margin: 'var(--space-05) 0 0' }}>
                    {dollars(s.totalCost)} · {s.attendanceCount} player{s.attendanceCount === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                  {s.unpaidCount === 0 ? (
                    <span className="cc-pill cc-pill-success">✓ all settled</span>
                  ) : (
                    <span className="cc-pill cc-pill-amber">
                      {s.unpaidCount} owing · {dollars(s.unpaidAmount)}
                    </span>
                  )}
                  <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--ink-faint)' }}>chevron_right</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <PlayerProfileSheet open={profile !== null} onClose={() => setProfile(null)} memberId={profile?.memberId ?? null} initialName={profile?.name} />
      <ReconcileSheet open={reconcileOpen} onClose={() => setReconcileOpen(false)} onChanged={() => void load()} />
      <AddExpenseSheet key={expenseKey} open={expenseOpen} onClose={() => setExpenseOpen(false)} onSaved={refresh} />
    </div>
  );
}
