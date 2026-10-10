'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import Collapse from '@/components/primitives/Collapse';
import { isFlagOn } from '@/lib/flags';
import { useOnline } from '@/lib/useOnline';
import { markExternalExcursion } from '@/lib/excursion';
import { useRevealReady } from '@/components/primitives/Reveal';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Person { memberId: string; name: string | null }
interface Use { at: string; amountCents: number; note: string; kind: string; reversed: boolean }
interface Card {
  id: string;
  amountCents: number;
  note: string;
  hint: string;
  createdAt: string;
  createdBy: Person | null;
  redeemedAt: string | null;
  redeemedBy: Person | null;
  usedCents: number | null;
  remainingCents: number | null;
  uses: Use[];
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const who = (p: Person | null) => (p ? p.name ?? 'a deleted account' : '—');

/**
 * Gift cards (docs/plans/payments.md, docs/plans/gift-card-ledger.md): mint
 * a single-use code worth $X — a raffle prize, a birthday, a thank-you — and
 * hand it to anyone in the club; redeeming it in Profile turns it into their
 * credit. The code is shown ONCE (the server keeps only its hash), so the
 * card says so and offers Copy and Share right there.
 *
 * Each card opens into its RECORD: who made it, who redeemed it and when,
 * how much of it has been drawn and on what, and what is left — the
 * oldest-source-first reading of the redeemer's credit, so a card's
 * "remaining" is the share of their balance this card still accounts for.
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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
  const shown = showAll ? cards : cards.slice(0, 8);

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
          {shown.map((c) => {
            const isOpen = openId === c.id;
            return (
              <li key={c.id}>
                {/* Pressable row on a class, so the press tint is not outranked by an inline background. */}
                <button
                  type="button"
                  className="cc-mini-card"
                  aria-expanded={isOpen}
                  onClick={() => setOpenId(isOpen ? null : c.id)}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)' }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="fs-md" style={{ display: 'block', color: 'var(--text-primary)' }}>
                      {money(c.amountCents)}{c.note ? ` · ${c.note}` : ''}
                    </span>
                    <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>
                      …{c.hint} · {c.redeemedAt
                        ? `${who(c.redeemedBy)} · ${c.remainingCents === null ? 'redeemed' : c.remainingCents === 0 ? 'all used' : `${money(c.remainingCents)} left`}`
                        : `Made ${day(c.createdAt)}, not redeemed`}
                    </span>
                  </span>
                  <span className="material-icons icon-sm motion-chevron" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>expand_more</span>
                </button>
                <Collapse open={isOpen}>
                  <dl className="fs-sm" style={{ margin: 0, padding: 'var(--space-2) var(--space-3) 0', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 'var(--space-3)', rowGap: 'var(--space-1)', color: 'var(--text-secondary)' }}>
                    <dt style={{ color: 'var(--text-muted)' }}>Made</dt>
                    <dd style={{ margin: 0 }}>{day(c.createdAt)} by {who(c.createdBy)}</dd>
                    <dt style={{ color: 'var(--text-muted)' }}>Redeemed</dt>
                    <dd style={{ margin: 0 }}>{c.redeemedAt ? `${day(c.redeemedAt)} by ${who(c.redeemedBy)}` : 'Not yet'}</dd>
                    {c.redeemedAt && c.usedCents !== null && c.remainingCents !== null && (
                      <>
                        <dt style={{ color: 'var(--text-muted)' }}>Used</dt>
                        <dd style={{ margin: 0 }}>{money(c.usedCents)} of {money(c.amountCents)} · {money(c.remainingCents)} left</dd>
                      </>
                    )}
                    {c.redeemedAt && c.usedCents === null && (
                      <>
                        <dt style={{ color: 'var(--text-muted)' }}>Used</dt>
                        <dd style={{ margin: 0 }}>No record — the account that redeemed it has been deleted.</dd>
                      </>
                    )}
                  </dl>
                  {c.uses.length > 0 && (
                    <ul className="fs-sm" style={{ listStyle: 'none', margin: 0, padding: 'var(--space-2) var(--space-3) var(--space-1)', color: 'var(--text-secondary)' }}>
                      {c.uses.map((u, i) => (
                        <li key={`${u.at}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', textDecoration: u.reversed ? 'line-through' : undefined, color: u.reversed ? 'var(--text-muted)' : undefined }}>
                          <span>{day(u.at)} · {u.note || (u.kind === 'credit_grant' ? 'Taken back' : 'Spent')}</span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>−{money(u.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Collapse>
              </li>
            );
          })}
        </ul>
      )}
      {cards.length > 8 && (
        <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${cards.length}`}
        </button>
      )}
    </section>
  );
}
