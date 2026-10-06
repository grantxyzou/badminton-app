'use client';

import { useCallback, useEffect, useState } from 'react';
import { isFlagOn } from '@/lib/flags';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Entry {
  id: string;
  kind: string;
  amountCents: number;
  note: string;
  createdAt: string;
}

const money = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2).replace(/\.00$/, '')}`;

/**
 * A member's store credit, in the admin's profile sheet (docs/plans/payments.md):
 * the balance, the last few entries, and "Give credit" — a gift, a prize, a
 * refund, "Bruce prepaid". Taking credit back is a negative entry, never an
 * edit; the server refuses to take a balance below zero.
 */
export default function CreditSection({ memberId }: { memberId: string }) {
  const online = useOnline();
  const [data, setData] = useState<{ balanceCents: number; entries: Entry[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/credit?memberId=${encodeURIComponent(memberId)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setLoadError(true);
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function give(sign: 1 | -1) {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, amountCents: sign * cents, note }),
      });
      if (!res.ok) {
        const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        throw new Error(code === 'would_go_negative' ? "That's more than their credit." : "Couldn't save — try again.");
      }
      setAmount('');
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return null;

  const label = {
    fontSize: 'var(--fs-xs)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
    margin: '0',
    fontWeight: 600,
  };
  const input = {
    padding: 'var(--space-3) var(--space-4)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--glass-border)',
    background: 'var(--input-bg)',
    color: 'var(--text-primary)',
    minWidth: 0,
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={label}>Credit</p>
      {loadError ? (
        <p className="field-error" role="alert">Couldn&apos;t load their credit.</p>
      ) : !data ? null : (
        <>
          <p className="fs-md" style={{ margin: '0', color: 'var(--text-primary)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{money(data.balanceCents)}</span> available
          </p>
          {data.entries.slice(0, 4).map((e) => (
            <div key={e.id} className="fs-sm" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', color: 'var(--text-secondary)' }}>
              <span>{e.note || e.kind.replace('_', ' ')}</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{e.amountCents > 0 ? '+' : ''}{money(e.amountCents)}</span>
            </div>
          ))}
        </>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '6rem 1fr', gap: 'var(--space-2)' }}>
        <input
          aria-label="Amount in dollars"
          inputMode="decimal"
          placeholder="$"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          style={input}
        />
        <input aria-label="Note" placeholder="Note (gift, refund, prepaid…)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} style={input} />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" className="cc-btn cc-btn-primary" style={{ flex: 1 }} disabled={!online || busy || !amount} onClick={() => void give(1)}>
          Give credit
        </button>
        <button type="button" className="cc-btn cc-btn-ghost" disabled={!online || busy || !amount || !data?.balanceCents} onClick={() => void give(-1)}>
          Take back
        </button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
