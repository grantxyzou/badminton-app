'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import ListRow from '@/components/primitives/ListRow';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import { isFlagOn } from '@/lib/flags';
import { useOnline } from '@/lib/useOnline';
import { markExternalExcursion } from '@/lib/excursion';
import { useRevealReady } from '@/components/primitives/Reveal';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Card {
  id: string;
  amountCents: number;
  note: string;
  hint: string;
  createdAt: string;
  redeemedAt: string | null;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Gift cards (docs/plans/payments.md): mint a single-use code worth $X — a
 * raffle prize, a birthday, a thank-you — and hand it to anyone in the club;
 * redeeming it in Profile turns it into their credit. The code is shown ONCE
 * (the server keeps only its hash), so the card says so and offers Copy and
 * Share right there. The list shows the last four, never the code.
 */
export default function GiftCardsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const enabled = isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT');
  const online = useOnline();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [minted, setMinted] = useState<{ code: string; amountCents: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/giftcards`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setCards(((await res.json()) as { cards: Card[] }).cards);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load, refreshKey]);

  // The console reveals its cards in order (the loading cascade): hold this
  // slot until the list or its error is in, and release it at once when off.
  useRevealReady(!enabled || cards !== null || loadError);

  if (!enabled) return null;
  const title = 'Gift cards';

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="payments"
        title={title}
        message={<>Couldn&apos;t load gift cards. <StateLink onClick={() => void load()}>Try again</StateLink></>}
      />
    );
  }
  if (!cards) return null;

  async function create() {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const res = await fetch(`${BASE}/api/admin/giftcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: cents, note }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMinted((await res.json()) as { code: string; amountCents: number });
      setAmount('');
      setNote('');
      void load();
    } catch {
      setError("Couldn't create a gift card — try again.");
    } finally {
      setBusy(false);
    }
  }

  const message = minted
    ? `Here's a ${money(minted.amountCents)} BPM gift card: ${minted.code}\nRedeem it in the app: Profile → Redeem a gift card.`
    : '';

  async function share() {
    if (!minted) return;
    try {
      if (typeof navigator.share === 'function') {
        // iOS can evict the installed app while the share sheet is up; this is
        // what brings the admin back to this tab rather than Home.
        markExternalExcursion();
        await navigator.share({ text: message });
      } else {
        await navigator.clipboard.writeText(message);
        setCopied(true);
      }
    } catch {
      /* the person cancelled the share sheet — nothing to do */
    }
  }

  const input = {
    padding: 'var(--space-3) var(--space-4)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--glass-border)',
    background: 'var(--input-bg)',
    color: 'var(--text-primary)',
    minWidth: 0,
  };
  const open = cards.filter((c) => !c.redeemedAt).length;

  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
      <CardHeader
        icon="payments"
        title={title}
        subtitle={cards.length === 0 ? 'A code anyone can redeem for credit.' : `${open} not redeemed yet · ${cards.length} made`}
      />
      {minted && (
        <div className="cc-mini-card flex flex-col gap-2 motion-fade" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {money(minted.amountCents)} gift card — copy it now, it won&apos;t be shown again:
          </p>
          <code className="fs-md" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '0.06em' }}>{minted.code}</code>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="cc-btn cc-btn-secondary" style={{ flex: 1 }} onClick={() => void share()}>
              {copied ? 'Copied' : 'Share'}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              onClick={() => {
                void navigator.clipboard.writeText(minted.code).then(() => setCopied(true)).catch(() => {});
              }}
            >
              Copy code
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '6rem 1fr', gap: 'var(--space-2)' }}>
        <input aria-label="Amount in dollars" inputMode="decimal" placeholder="$" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} style={input} />
        <input aria-label="Note" placeholder="Note (raffle, birthday…)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} style={input} />
      </div>
      <button type="button" className="cc-btn cc-btn-primary" disabled={!online || busy || !amount} onClick={() => void create()}>
        Create gift card
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
      {cards.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
          {cards.slice(0, 8).map((c) => (
            <li key={c.id}>
              <ListRow
                title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{money(c.amountCents)}{c.note ? ` · ${c.note}` : ''}</span>}
                subtitle={
                  <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                    …{c.hint} · {c.redeemedAt ? `Redeemed ${day(c.redeemedAt)}` : `Made ${day(c.createdAt)}, not redeemed`}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
