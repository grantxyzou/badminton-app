'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import Collapse from '@/components/primitives/Collapse';
import GiftRecord, { type GiftPerson, type GiftUse } from './GiftRecord';
import { BottomSheet, BottomSheetBody, BottomSheetFooter, BottomSheetHeader } from '@/components/BottomSheet';
import { markExternalExcursion } from '@/lib/excursion';
import { usePageBack } from '@/lib/pageStack';
import { useOnline } from '@/lib/useOnline';
import { fmtCents } from './GiftCardsPage';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The three amounts on offer (spec §5), in cents. */
export const GIFT_AMOUNTS = [1000, 2500, 5000] as const;

/** One code with its record (`lib/giftCardView.ts`, the console's shape). */
export interface MyGiftCard {
  id: string;
  amountCents: number;
  note: string;
  hint: string;
  createdAt: string;
  redeemedAt: string | null;
  /** Additive since 2026-11-12; a server from before sends none of these. */
  createdBy?: GiftPerson | null;
  redeemedBy?: GiftPerson | null;
  usedCents?: number | null;
  remainingCents?: number | null;
  uses?: GiftUse[];
}

interface Props {
  /** The club the card is drawn on, for the "BPM Core gift card · $25" line. */
  clubName: string | null;
  onBack: () => void;
}

/**
 * "Give a gift card" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §5,
 * build step 4), for an ORGANISER of this club (2026-11-10) — the route's
 * check is the gate and Profile hides the row from everyone else. It replaces
 * `GiveGiftSheet`.
 *
 * The code is shown ONCE (the server keeps only its hash), so Copy and Share
 * sit right under it, and leaving before either asks first. The list is this
 * person's own codes, and each opens into its RECORD, the same one the
 * console's Credit codes card shows: who made it and when, who redeemed it
 * and when, what it was spent on and what is left (docs/plans/gift-card-ledger.md,
 * review of 2026-11-12; only an organiser reaches this page, so the redeemer
 * is theirs to see).
 */
export default function GiveGiftPage({ clubName, onBack }: Props) {
  const t = useTranslations('profile.giveGift');
  const format = useFormatter();
  const online = useOnline();
  const [cards, setCards] = useState<MyGiftCard[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [amountCents, setAmountCents] = useState<number>(GIFT_AMOUNTS[1]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'forbidden' | 'rateLimited' | 'failed' | null>(null);
  const [minted, setMinted] = useState<{ code: string; amountCents: number } | null>(null);
  /** Copied or shared: the code has left this screen, so leaving loses nothing. */
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });
  const who = (p: GiftPerson | null | undefined) => (p ? p.name ?? t('deletedAccount') : '—');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/giftcards`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setCards(((await res.json()) as { cards: MyGiftCard[] }).cards);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unsaved = minted !== null && !kept;
  const requestBack = useCallback(() => {
    if (unsaved) setConfirmLeave(true);
    else onBack();
  }, [unsaved, onBack]);
  // Nested above Profile's own Back (depth 1), so the hardware back button
  // asks too rather than dropping a code nobody wrote down.
  usePageBack(unsaved, requestBack, 1);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/giftcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents, note }),
      });
      if (res.status === 403) return setError('forbidden');
      if (res.status === 429) return setError('rateLimited');
      if (!res.ok) return setError('failed');
      setMinted((await res.json()) as { code: string; amountCents: number });
      setKept(false);
      setCopied(false);
      setNote('');
      void load();
    } catch {
      setError('failed');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.code);
      setCopied(true);
      setKept(true);
    } catch {
      /* no clipboard: the code is still on screen to write down */
    }
  }

  async function share() {
    if (!minted) return;
    const text = t('shareText', { amount: fmtCents(minted.amountCents), code: minted.code });
    try {
      if (typeof navigator.share === 'function') {
        // iOS may evict the app while the share sheet is up (lib/excursion.ts).
        markExternalExcursion();
        await navigator.share({ text });
        setKept(true);
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setKept(true);
      }
    } catch {
      /* cancelled the share sheet: not kept */
    }
  }

  function another() {
    setMinted(null);
    setKept(false);
    setCopied(false);
  }

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight flex flex-col gap-4" data-give-gift-page>
      <TopBar title={t('title')} onBack={requestBack} backLabel={t('back')} />

      {minted ? (
        <div className="glass-card p-5 flex flex-col gap-3 motion-fade" data-gift-minted>
          <p className="fs-base" style={{ margin: '0', color: 'var(--text-muted)' }}>
            {t('mintedTitle', { club: clubName ?? t('thisClub'), amount: fmtCents(minted.amountCents) })}
          </p>
          <p className="gift-code" aria-label={t('codeLabel')}>{minted.code}</p>
          <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('onceNote')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <button type="button" className="btn-primary" onClick={() => void copy()}>
              {copied ? t('copied') : t('copy')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => void share()}>{t('share')}</button>
          </div>
          <button type="button" className="btn-ghost" onClick={another}>{t('another')}</button>
        </div>
      ) : (
        <>
          <ProfileEyebrow>{t('amountGroup')}</ProfileEyebrow>
          <div className="glass-card p-5 flex flex-col gap-4">
            <div role="radiogroup" aria-label={t('amountGroup')} className="amount-chips">
              {GIFT_AMOUNTS.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  role="radio"
                  aria-checked={amountCents === cents}
                  className="amount-chip"
                  onClick={() => setAmountCents(cents)}
                >
                  {fmtCents(cents)}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-2">
              <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('noteLabel')}</span>
              <input
                type="text"
                value={note}
                maxLength={80}
                placeholder={t('notePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button type="button" className="btn-primary" disabled={!online || busy} onClick={() => void create()}>
              {t('make', { amount: fmtCents(amountCents) })}
            </button>
            {error && <p className="field-error" role="alert" style={{ margin: '0' }}>{t(`error.${error}`)}</p>}
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('booksNote')}</p>
          </div>
        </>
      )}

      <ProfileEyebrow>{t('givenGroup')}</ProfileEyebrow>
      {loadError ? (
        <div className="glass-card p-5">
          <ErrorState message={t('listError')} />
        </div>
      ) : cards === null ? (
        <CardSkeleton height={128} />
      ) : cards.length === 0 ? (
        <div className="glass-card p-5">
          <EmptyState>{t('empty')}</EmptyState>
        </div>
      ) : (
        <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
            {cards.map((c, i) => {
              const isOpen = openId === c.id;
              const left = c.redeemedAt && typeof c.remainingCents === 'number' ? t('left', { amount: fmtCents(c.remainingCents) }) : null;
              return (
                <li key={c.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--divider)' }}>
                  <button
                    type="button"
                    className="money-row money-row--button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenId(isOpen ? null : c.id)}
                  >
                    <span className="money-row__text">
                      <span className="money-row__title">
                        {c.redeemedAt
                          ? c.redeemedBy !== undefined
                            ? t('redeemedBy', { name: who(c.redeemedBy) })
                            : t('redeemed', { date: day(c.redeemedAt) })
                          : t('notRedeemed')}
                      </span>
                      <span className="money-row__sub">
                        {[left, t('given', { date: day(c.createdAt) }), `…${c.hint}`, c.note].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="money-row__amount">{fmtCents(c.amountCents)}</span>
                    <span className="material-icons icon-sm motion-chevron" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>expand_more</span>
                  </button>
                  <Collapse open={isOpen}>
                    <GiftRecord card={c} day={day} who={who} />
                  </Collapse>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <BottomSheet open={confirmLeave} onClose={() => setConfirmLeave(false)} ariaLabel={t('leaveTitle')}>
        <BottomSheetHeader onClose={() => setConfirmLeave(false)} closeLabel={t('stay')}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('leaveTitle')}</span>
        </BottomSheetHeader>
        <BottomSheetBody>
          <p className="fs-md" style={{ margin: '0', color: 'var(--text-secondary)' }}>{t('leaveBody')}</p>
        </BottomSheetBody>
        <BottomSheetFooter>
          <div className="flex flex-col gap-3">
            <button type="button" className="btn-primary" onClick={() => setConfirmLeave(false)}>{t('stay')}</button>
            <button
              type="button"
              className="btn-ghost"
              style={{ color: 'var(--color-red)' }}
              onClick={() => {
                setConfirmLeave(false);
                onBack();
              }}
            >
              {t('leave')}
            </button>
          </div>
        </BottomSheetFooter>
      </BottomSheet>
    </div>
  );
}

