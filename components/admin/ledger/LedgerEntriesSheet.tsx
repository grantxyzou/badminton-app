'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type RangeKey = '30d' | '12w' | 'all';

interface Entry {
  id: string;
  date: string;
  account: 'member_owed' | 'member_credit' | 'club_outlay';
  kind: string;
  reverses: string | null;
  amountCents: number;
  who: string;
  what: string;
  via: string | null;
  reason: string | null;
  reversed: boolean;
}

type Filter = 'all' | 'charges' | 'payments' | 'outlay' | 'reversals' | 'credit';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'charges', label: 'Charges' },
  { id: 'payments', label: 'Payments' },
  { id: 'outlay', label: 'Club costs' },
  { id: 'reversals', label: 'Reversals' },
  { id: 'credit', label: 'Credit' },
];

const RANGE_LABEL: Record<RangeKey, string> = { '30d': 'the last 30 days', '12w': 'the last 12 weeks', all: 'all time' };
const VIA: Record<string, string> = { card: 'card', etransfer: 'e-transfer', credit: 'credit', manual: 'marked paid' };

const KIND: Record<string, string> = {
  charge: 'Charge',
  payment: 'Payment',
  cover: 'Covered by the club',
  court_cost: 'Court cost',
  shuttle_purchase: 'Shuttles bought',
  shuttle_adj: 'Shuttle price change',
  expense: 'Expense',
  credit_grant: 'Credit given',
  gift_redeem: 'Credit code redeemed',
  credit_spend: 'Credit spent',
  credit_refund: 'Credit returned',
  void: 'Reversal',
};

function matches(e: Entry, f: Filter): boolean {
  const kind = e.kind === 'void' ? e.reverses ?? 'void' : e.kind;
  switch (f) {
    case 'all':
      return true;
    case 'reversals':
      return e.kind === 'void';
    case 'charges':
      return e.kind !== 'void' && e.account === 'member_owed' && kind === 'charge';
    case 'payments':
      return e.kind !== 'void' && e.account === 'member_owed' && (kind === 'payment' || kind === 'cover');
    case 'outlay':
      return e.kind !== 'void' && e.account === 'club_outlay';
    case 'credit':
      return e.kind !== 'void' && e.account === 'member_credit';
  }
}

/** "Payment · card", "Reversal of a charge (job deleted)". */
function label(e: Entry): string {
  if (e.kind === 'void') {
    const of = e.reverses ? (KIND[e.reverses] ?? e.reverses).toLowerCase() : 'an entry';
    return `Reversal of ${/^[aeiou]/.test(of) ? 'an' : 'a'} ${of}${e.reason ? ` (${e.reason.replace(/_/g, ' ')})` : ''}`;
  }
  const base = KIND[e.kind] ?? e.kind;
  return e.via && VIA[e.via] ? `${base} · ${VIA[e.via]}` : base;
}

const money = (cents: number) => `${cents < 0 ? '−' : '+'}$${(Math.abs(cents) / 100).toFixed(2)}`;

function dayHeading(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Vancouver' });
}

/**
 * Every entry in the club's ledger, newest first, like a bank statement
 * (`docs/plans/ledger-entries.md`). Read-only: the ledger is append-only, so
 * a mistake shows as an entry and its reversal, never as an edit. Same range
 * as the Ledger page it opens from.
 */
export default function LedgerEntriesSheet({ open, onClose, range }: { open: boolean; onClose: () => void; range: RangeKey }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/ledger/entries?range=${range}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { entries: Entry[]; truncated: boolean };
      setEntries(body.entries);
      setTruncated(body.truncated);
    } catch {
      setLoadError(true);
    }
  }, [range]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const shown = useMemo(() => (entries ?? []).filter((e) => matches(e, filter)), [entries, filter]);
  const days = useMemo(() => {
    const out: { day: string; items: Entry[] }[] = [];
    for (const e of shown) {
      const day = dayHeading(e.date);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [shown]);

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Ledger entries">
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Ledger entries</span>
        <button type="button" onClick={onClose} aria-label="Close" className="cc-btn cc-btn-ghost">
          <span className="material-icons" style={{ fontSize: 'var(--icon-md)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Every entry behind this page for {RANGE_LABEL[range]}, newest first, like a bank statement. A bill is a charge
            (+), money in is a payment (−). Nothing is ever edited: a mistake shows as the entry and its reversal, both
            struck through.
          </p>

          <div className="filter-chips" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                className={filter === f.id ? 'filter-chip filter-chip--applied' : 'filter-chip'}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loadError ? (
            <ErrorState message="Couldn't load the entries." action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>Try again</button>} />
          ) : entries === null ? (
            <div className="flex flex-col" style={{ gap: 'var(--space-2)' }} aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="shimmer-line" style={{ height: 'var(--space-8)', borderRadius: 'var(--radius-lg)' }} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState>{entries.length === 0 ? `No entries in ${RANGE_LABEL[range]}.` : 'None of this kind in this range.'}</EmptyState>
          ) : (
            <div className="flex flex-col" style={{ gap: 'var(--space-5)' }} data-testid="ledger-entries">
              {days.map(({ day, items }) => (
                <section key={day} className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
                  <h3 className="section-label-muted" style={{ margin: 0 }}>{day}</h3>
                  {items.map((e) => {
                    const struck = e.reversed || e.kind === 'void';
                    return (
                      <div key={e.id} className="cc-mini-card flex items-start justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
                        <div className="flex flex-col" style={{ minWidth: 0, gap: 'var(--space-05)' }}>
                          <span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                            {e.who} · {e.what}
                          </span>
                          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                            {label(e)}
                            {e.reversed && <span style={{ color: 'var(--sev-warn)' }}> · reversed</span>}
                          </span>
                        </div>
                        <span
                          className="fs-md"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                            color: struck ? 'var(--text-muted)' : 'var(--text-primary)',
                            textDecoration: struck ? 'line-through' : undefined,
                          }}
                        >
                          {money(e.amountCents)}
                        </span>
                      </div>
                    );
                  })}
                </section>
              ))}
              {truncated && (
                <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Showing the newest 500. Pick a shorter range for the rest.
                </p>
              )}
            </div>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
