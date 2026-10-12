'use client';

import { useEffect, useState } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import { fmtShortDate } from '@/lib/fmt';
import type { ReceiptInput } from '@/lib/receiptTemplate';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface HistoryRow {
  sessionId: string;
  date: string;
  attendanceCount: number;
  paidPercent: number;
  costPerPerson: number | null;
  receipt: ReceiptInput | null;
  receiptError?: string;
}

interface PastSessionsPageProps {
  onBack: () => void;
  /** A row opens that session's payments — the same as a Ledger row, and one
   *  tap from its receipt (Payments' Share). It opened the receipt directly,
   *  so the three lists of past sessions did three different things. */
  onOpenSession: (sessionId: string) => void;
}

export default function PastSessionsPage({ onBack, onOpenSession }: PastSessionsPageProps) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Bumped by "Try again" to re-run the load effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/sessions/history`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { sessions: HistoryRow[] };
        if (!cancelled) setRows(data.sessions);
      } catch {
        // Distinguish load-failure from loaded-empty (CLAUDE.md: no lying empty state).
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);


  return (
    <div className="animate-slideInRight">
      <AdminBackHeader onBack={onBack} title="Past sessions" crumb="Ledger" />

      <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {loadError ? (
          <ErrorState
            message="Couldn't load past sessions."
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            }
          />
        ) : rows === null ? (
          <AdminPageSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState>No past sessions yet.</EmptyState>
        ) : (
          rows.map((row) => {
            const hasCost = (row.costPerPerson ?? 0) > 0;
            const paidLabel =
              row.attendanceCount > 0
                ? row.paidPercent >= 100
                  ? 'all paid'
                  : `${row.paidPercent}% paid`
                : '';
            const subtitle = [
              `${row.attendanceCount} player${row.attendanceCount === 1 ? '' : 's'}`,
              paidLabel,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <ListRow
                key={row.sessionId}
                onClick={() => onOpenSession(row.sessionId)}
                ariaLabel={`Payments for ${fmtShortDate(row.date)}`}
                title={
                  <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {fmtShortDate(row.date) || row.sessionId}
                  </span>
                }
                subtitle={subtitle}
                trailing={
                  <span
                    className="fs-md"
                    style={{
                      fontFamily: 'var(--font-mono), ui-monospace, monospace',
                      color: hasCost ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {hasCost ? `$${row.costPerPerson}/ea` : '—'}
                  </span>
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}
