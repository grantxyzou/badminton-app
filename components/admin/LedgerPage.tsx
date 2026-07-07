'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminBackHeader from './AdminBackHeader';
import PlayerProfileSheet from './CommandCenter/PlayerProfileSheet';
import { fmtSessionLabel } from '@/lib/fmt';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type RangeKey = '30d' | '12w' | 'all';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '30d', label: '30 days' },
  { key: '12w', label: '12 weeks' },
  { key: 'all', label: 'All time' },
];

interface LedgerSummary {
  spent: number;
  paidAmount: number;
  coveredAmount: number;
  collected: number;
  gap: number;
  sessionCount: number;
  coveredCount: number;
}

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

interface LedgerData {
  range: { from: string; to: string };
  summary: LedgerSummary;
  bySession: LedgerSessionRow[];
  byPlayer: LedgerPlayerRow[];
}

interface LedgerPageProps {
  onBack: () => void;
  /** Drill into a session's payments. Omitted in contexts (e.g. tests)
   *  that render the page in isolation — rows stay inert then. */
  onOpenSession?: (sessionId: string) => void;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function LedgerPage({ onBack, onOpenSession }: LedgerPageProps) {
  const [range, setRange] = useState<RangeKey>('12w');
  const [tab, setTab] = useState<'session' | 'player'>('session');
  // Player drill-in opens a self-contained sheet owned here (LedgerPage is a
  // routed page, not a child of CommandCenter where the shared sheet lives).
  const [profile, setProfile] = useState<{ memberId: string | null; name: string } | null>(null);
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinct from "loaded but empty": a failed fetch must not render the same
  // UI as a real zero-state (the forbidden lying-empty pattern).
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/ledger?range=${range}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as LedgerData);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  // Another admin may have covered someone while this tab was backgrounded.
  // Refetch on focus so the gap doesn't go stale (spec §Concurrency).
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  if (loadError) {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={onBack} title="Ledger" />
        <div
          role="alert"
          style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)' }}
        >
          <p style={{ fontWeight: 600, color: 'var(--text)' }}>Couldn&apos;t load the ledger</p>
          <p style={{ fontSize: 'var(--fs-base)', marginTop: 6 }}>
            Backend may be cold-starting. Reconnect, then retry.
          </p>
          <button
            type="button"
            className="cc-btn cc-btn-ghost"
            style={{ marginTop: 14 }}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading || !data) return null;

  const { summary, bySession, byPlayer } = data;
  const showPlayerTab = byPlayer.length > 0;
  // Derived, not stored: if byPlayer empties (range change OR a focus-refetch
  // after another admin covers the last debtor) while the user is on the
  // player tab, fall back to session without clobbering their stored choice —
  // so widening the range again restores the player tab they had open.
  const activeTab = tab === 'player' && !showPlayerTab ? 'session' : tab;

  return (
    <div className="animate-slideInRight space-y-3">
      <AdminBackHeader onBack={onBack} title="Ledger" />

      <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: '0 4px' }}>
        Who owes what. Cover anyone you don&apos;t want to chase.
      </p>

      {/* Range — narrow → wide, 12 weeks default */}
      <div className="segment-control flex" role="tablist" aria-label="Date range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={range === r.key}
            onClick={() => setRange(r.key)}
            className={`flex-1 fs-sm rounded-full ${
              range === r.key ? 'segment-tab-active' : 'segment-tab-inactive'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {summary.sessionCount === 0 ? (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-md)',
          }}
        >
          Nothing settled in this window. Try widening the range.
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div className="cc-tile cc-tile-static">
              <span className="num">{money(summary.collected)}</span>
              <span className="lbl">Collected</span>
            </div>
            <div className="cc-tile cc-tile-static">
              <span className="num">{money(summary.spent)}</span>
              <span className="lbl">Spent</span>
            </div>
            <div className={`cc-tile cc-tile-static${summary.gap > 0 ? ' warn' : ''}`}>
              <span className="num">{money(summary.gap)}</span>
              <span className="lbl">Gap</span>
            </div>
          </div>

          {/* Honest-headline sub-line — always shown, even at $0 covered. */}
          <p
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--ink-faint)',
              margin: '0 4px',
              fontFamily: 'var(--font-mono, "JetBrains Mono")',
            }}
          >
            {money(summary.coveredAmount)} covered by you · {summary.sessionCount} session
            {summary.sessionCount === 1 ? '' : 's'} settled · {byPlayer.length} still owing
          </p>

          {!showPlayerTab && (
            <p
              style={{
                fontSize: 'var(--fs-base)',
                color: 'var(--accent)',
                fontWeight: 600,
                margin: '4px 4px 0',
              }}
            >
              Everyone&apos;s caught up. Nice.
            </p>
          )}

          {/* View toggle — By player tab only when someone still owes */}
          <div className="segment-control flex" role="tablist" aria-label="Ledger view">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'session'}
              onClick={() => setTab('session')}
              className={`flex-1 fs-sm rounded-full ${
                activeTab === 'session' ? 'segment-tab-active' : 'segment-tab-inactive'
              }`}
            >
              By session
            </button>
            {showPlayerTab && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'player'}
                onClick={() => setTab('player')}
                className={`flex-1 fs-sm rounded-full ${
                  activeTab === 'player' ? 'segment-tab-active' : 'segment-tab-inactive'
                }`}
              >
                By player
              </button>
            )}
          </div>

          {/* Rows are drill-ins (v1.5/D): a session opens its Payments
              page, a player opens their profile sheet. They're real
              <button>s now — the cc-tile-static "don't fake tappability"
              caveat no longer applies because they ARE tappable. The
              trailing chevron is the same affordance the CommandCenter
              settings list uses to signal a row navigates. */}
          {activeTab === 'session' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {bySession.map((s) => {
                const settled = s.unpaidCount === 0;
                return (
                  <button
                    type="button"
                    key={s.sessionId}
                    className="glass-card"
                    onClick={() => onOpenSession?.(s.sessionId)}
                    aria-label={`Payments for ${fmtSessionLabel(s.date)}`}
                    style={{
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      width: '100%',
                      textAlign: 'left',
                      font: 'inherit',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          fontFamily: 'var(--font-display, "Space Grotesk")',
                          fontSize: 'var(--fs-md)',
                          fontWeight: 600,
                          margin: 0,
                        }}
                      >
                        {fmtSessionLabel(s.date)}
                      </p>
                      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                        {money(s.totalCost)} · {s.attendanceCount} player
                        {s.attendanceCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {settled ? (
                        <span className="cc-pill cc-pill-success">✓ all settled</span>
                      ) : (
                        <span className="cc-pill cc-pill-amber">
                          {s.unpaidCount} owing · {money(s.unpaidAmount)}
                        </span>
                      )}
                      <span
                        className="material-icons"
                        aria-hidden="true"
                        style={{ fontSize: 18, color: 'var(--ink-faint)' }}
                      >
                        chevron_right
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {byPlayer.map((p) => {
                // Only memberId-linked rows drill into a profile. Legacy
                // pre-migration records (no memberId) have no history to
                // show — render them inert rather than fake a tap that
                // opens an empty sheet (design-system "don't signal
                // tappability you can't honor" principle).
                const linked = p.memberId !== null;
                const rowStyle = {
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left' as const,
                  font: 'inherit',
                  color: 'inherit',
                  cursor: linked ? 'pointer' : 'default',
                };
                const inner = (
                  <>
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          fontFamily: 'var(--font-display, "Space Grotesk")',
                          fontSize: 'var(--fs-md)',
                          fontWeight: 600,
                          margin: 0,
                        }}
                      >
                        {p.name}
                      </p>
                      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                        {p.sessionCount} unpaid session{p.sessionCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    {/* Hero number, not a cc-pill: the owed amount IS this
                        row's primary figure (cf. BirdsPage stock numbers).
                        The session row uses cc-pill-amber because there the
                        amount is secondary status, not the headline. */}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-display, "Space Grotesk")',
                          fontSize: 18,
                          fontWeight: 700,
                          letterSpacing: '-0.02em',
                          color: 'var(--amber)',
                        }}
                      >
                        {money(p.owedAmount)}
                      </span>
                      {linked && (
                        <span
                          className="material-icons"
                          aria-hidden="true"
                          style={{ fontSize: 18, color: 'var(--ink-faint)' }}
                        >
                          chevron_right
                        </span>
                      )}
                    </span>
                  </>
                );
                const key = p.memberId ?? `name:${p.name.toLowerCase()}`;
                return linked ? (
                  <button
                    type="button"
                    key={key}
                    className="glass-card"
                    onClick={() => setProfile({ memberId: p.memberId, name: p.name })}
                    aria-label={`${p.name}'s history`}
                    style={rowStyle}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={key} className="glass-card" style={rowStyle}>
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <PlayerProfileSheet
        open={profile !== null}
        onClose={() => setProfile(null)}
        memberId={profile?.memberId ?? null}
        initialName={profile?.name}
      />
    </div>
  );
}
