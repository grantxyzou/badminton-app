'use client';

import { useEffect, useState, useCallback } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import ReceiptSheet from './ReceiptSheet';
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
}

export default function PastSessionsPage({ onBack }: PastSessionsPageProps) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Receipt sheet state — this page owns its OWN instance (it renders instead
  // of CommandCenter, so it can't reuse CommandCenter's sheet).
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptInput, setReceiptInput] = useState<ReceiptInput | null>(null);
  const [receiptError, setReceiptError] = useState('');

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  const openReceipt = useCallback((row: HistoryRow) => {
    if (!row.receipt) {
      setReceiptInput(null);
      setReceiptError(row.receiptError ?? 'No receipt available for this session.');
    } else {
      setReceiptError('');
      setReceiptInput(row.receipt);
    }
    setReceiptOpen(true);
  }, []);

  return (
    <div className="animate-slideInRight">
      <AdminBackHeader onBack={onBack} title="Past sessions" />

      <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {loadError ? (
          <ErrorState message="Couldn't load past sessions — refresh to retry." />
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
                onClick={() => openReceipt(row)}
                ariaLabel={`Receipt for ${fmtShortDate(row.date)}`}
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

      <ReceiptSheet
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        input={receiptInput}
        error={receiptError || undefined}
      />
    </div>
  );
}
