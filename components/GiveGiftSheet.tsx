'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { markExternalExcursion } from '@/lib/excursion';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface MyGiftCard {
  id: string;
  amountCents: number;
  note: string;
  hint: string;
  createdAt: string;
  redeemedAt: string | null;
}

/**
 * Give out a gift card, for a member an admin has marked `canGift`
 * (docs/plans/gift-card-ledger.md). The same contract as the admin's card:
 * the code is shown ONCE — the server keeps only its hash — so Copy and
 * Share sit right under it. The list below is this person's own cards,
 * redeemed or not; WHO redeemed one is the admin's record, not the gifter's.
 */
export default function GiveGiftSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('profile.gift');
  const format = useFormatter();
  const online = useOnline();
  const [cards, setCards] = useState<MyGiftCard[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'amount' | 'rateLimited' | 'server' | null>(null);
  const [minted, setMinted] = useState<{ code: string; amountCents: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const money = (cents: number) => format.number(cents / 100, { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 });
  const day = (iso: string) => format.dateTime(new Date(iso), { month: 'short', day: 'numeric' });

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/giftcards`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setCards(((await res.json()) as { cards: MyGiftCard[] }).cards);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function create() {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('amount');
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`${BASE}/api/giftcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: cents, note }),
      });
      if (res.status === 429) return setError('rateLimited');
      if (!res.ok) return setError('server');
      setMinted((await res.json()) as { code: string; amountCents: number });
      setAmount('');
      setNote('');
      void load();
    } catch {
      setError('server');
    } finally {
      setBusy(false);
    }
  }

  const message = minted ? t('shareText', { amount: money(minted.amountCents), code: minted.code }) : '';

  async function share() {
    if (!minted) return;
    try {
      if (typeof navigator.share === 'function') {
        markExternalExcursion();
        await navigator.share({ text: message });
      } else {
        await navigator.clipboard.writeText(message);
        setCopied(true);
      }
    } catch {
      /* cancelled the share sheet */
    }
  }

  function close() {
    setMinted(null);
    setError(null);
    onClose();
  }

  const input = {
    padding: 'var(--space-3) var(--space-4)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--glass-border)',
    background: 'var(--input-bg)',
    color: 'var(--text-primary)',
    minWidth: 0,
  };

  return (
    <BottomSheet open={open} onClose={close} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={close} closeLabel={t('close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('title')}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p className="fs-sm" style={{ margin: '0', color: 'var(--text-secondary)' }}>{t('help')}</p>
          {minted && (
            <div className="cc-mini-card flex flex-col gap-2 motion-fade" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
              <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('minted', { amount: money(minted.amountCents) })}</p>
              <code className="fs-md" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '0.06em' }}>{minted.code}</code>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" className="cc-btn cc-btn-secondary" style={{ flex: 1 }} onClick={() => void share()}>
                  {copied ? t('copied') : t('share')}
                </button>
                <button
                  type="button"
                  className="cc-btn cc-btn-ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(minted.code).then(() => setCopied(true)).catch(() => {});
                  }}
                >
                  {t('copy')}
                </button>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '6rem 1fr', gap: 'var(--space-2)' }}>
            <input aria-label={t('amount')} inputMode="decimal" placeholder="$" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} style={input} />
            <input aria-label={t('note')} placeholder={t('notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} style={input} />
          </div>
          <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" disabled={!online || busy || !amount} onClick={() => void create()}>
            {t('create')}
          </button>
          {error && (
            <p className="field-error" role="alert">
              {t(error === 'amount' ? 'needAmount' : error === 'rateLimited' ? 'rateLimited' : 'error')}
            </p>
          )}
          {loadError ? (
            <ErrorState message={t('listError')} />
          ) : cards && cards.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
              {cards.map((c) => (
                <li key={c.id} className="fs-sm" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-primary)' }}>{money(c.amountCents)}{c.note ? ` · ${c.note}` : ''}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    …{c.hint} · {c.redeemedAt ? t('redeemed', { date: day(c.redeemedAt) }) : t('unredeemed', { date: day(c.createdAt) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
