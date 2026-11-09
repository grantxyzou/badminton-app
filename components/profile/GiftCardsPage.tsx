'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { announceBalanceChanged } from '@/lib/balanceRefresh';
import { fmtMoney } from '@/lib/fmt';
import { showTopToast } from '@/lib/topToast';
import { useOnline } from '@/lib/useOnline';
import type { CreditEntry, UseCredit } from './useCredit';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** A gift card code is eight letters and digits; dashes and spaces are the reader's. */
export const codeChars = (code: string) => code.replace(/[^A-Za-z0-9]/g, '');

/** Cents as a person reads money, signed when asked: `+$25`, `−$12.50`. */
export function fmtCents(cents: number, signed = false): string {
  const abs = fmtMoney(Math.abs(cents) / 100);
  if (!signed) return cents < 0 ? `−${abs}` : abs;
  return cents < 0 ? `−${abs}` : `+${abs}`;
}

type Line = { key: 'gift' | 'grant' | 'session' | 'stringing' | 'refund' | 'other'; detail?: string; date?: string };

/**
 * What a credit entry IS, from its kind — never the server's English note.
 * Only the part a person typed (a gift card's note, an admin's reason) is
 * passed through, and a spend's session date is read off its note's ISO day.
 */
export function creditLine(e: Pick<CreditEntry, 'kind' | 'note'>): Line {
  const note = e.note ?? '';
  switch (e.kind) {
    case 'gift_redeem': {
      const typed = note.startsWith('Gift card · ') ? note.slice('Gift card · '.length) : '';
      return typed ? { key: 'gift', detail: typed } : { key: 'gift' };
    }
    case 'credit_grant':
      return note ? { key: 'grant', detail: note } : { key: 'grant' };
    case 'credit_spend': {
      const day = /^Session (\d{4}-\d{2}-\d{2})/.exec(note)?.[1];
      return day ? { key: 'session', date: day } : { key: 'stringing' };
    }
    case 'credit_refund':
      return { key: 'refund' };
    default:
      return { key: 'other' };
  }
}

interface Props {
  /** Shared with the Profile row that opens this page, so the two agree. */
  state: UseCredit;
  onBack: () => void;
}

/**
 * "Gift cards & credit" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §3,
 * build step 4): your credit, the field to redeem a card into it, and what
 * has added to it and come out of it. It replaces `RedeemGiftSheet`: a page,
 * not a sheet (Grant, 2026-11-08).
 *
 * Wrong, used and unknown codes get ONE message on purpose: the server answers
 * them identically so a guesser learns nothing, and the page must not
 * re-introduce the difference.
 */
export default function GiftCardsPage({ state, onBack }: Props) {
  const t = useTranslations('profile.giftCards');
  const format = useFormatter();
  const online = useOnline();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'notFound' | 'rateLimited' | 'failed' | null>(null);

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });
  // A session's day is a calendar date, not an instant: read it at noon UTC
  // so no zone moves it to the day before.
  const sessionDay = (ymd: string) =>
    format.dateTime(new Date(`${ymd}T12:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' });

  async function redeem() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/credit/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.status === 429) return setError('rateLimited');
      if (res.status === 404) return setError('notFound');
      if (!res.ok) return setError('failed');
      const { amountCents } = (await res.json()) as { amountCents: number };
      setCode('');
      showTopToast({ tone: 'success', icon: 'check_circle', title: t('added', { amount: fmtCents(amountCents) }) });
      // Home's balance card and this page's figure both re-read (useCredit
      // listens for the same event), so the new credit shows everywhere.
      announceBalanceChanged();
    } catch {
      setError('failed');
    } finally {
      setBusy(false);
    }
  }

  const loaded = state.balanceCents !== null && state.entries !== null;

  function label(e: CreditEntry): string {
    const line = creditLine(e);
    const base = line.key === 'session' && line.date ? t('history.session', { date: sessionDay(line.date) }) : t(`history.${line.key}`);
    return line.detail ? `${base} · ${line.detail}` : base;
  }

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight flex flex-col gap-4" data-gift-cards-page>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      {state.loadError ? (
        <div className="glass-card p-5">
          <ErrorState message={t('loadError')} />
        </div>
      ) : loaded ? (
        <div className="glass-card p-5 flex flex-col gap-2">
          <p className="fs-base" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('yourCredit')}</p>
          {/* Keyed so a new figure fades in after a redeem rather than ticking over. */}
          <p key={state.balanceCents} className="bpm-count motion-fade" style={{ margin: '0', color: 'var(--accent)' }}>
            {fmtCents(state.balanceCents ?? 0)}
          </p>
          <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('creditNote')}</p>
        </div>
      ) : (
        <CardSkeleton height={128} />
      )}

      <ProfileEyebrow>{t('redeemGroup')}</ProfileEyebrow>
      <form
        className="glass-card p-5 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (online && codeChars(code).length > 0) void redeem();
        }}
      >
        <input
          type="text"
          aria-label={t('codeLabel')}
          placeholder={t('placeholder')}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="gift-code-input"
        />
        <button type="submit" className="btn-primary" disabled={!online || busy || codeChars(code).length === 0}>
          {t('redeem')}
        </button>
        {error && <p className="field-error" role="alert" style={{ margin: '0' }}>{t(`error.${error}`)}</p>}
      </form>

      <ProfileEyebrow>{t('historyGroup')}</ProfileEyebrow>
      {state.loadError ? (
        <div className="glass-card p-5">
          <ErrorState message={t('loadError')} />
        </div>
      ) : state.entries === null ? (
        <CardSkeleton height={160} />
      ) : state.entries.length === 0 ? (
        <div className="glass-card p-5">
          <EmptyState>{t('empty')}</EmptyState>
        </div>
      ) : (
        <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
            {state.entries.map((e, i) => (
              <li key={e.id} className="money-row" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--divider)' }}>
                <span className="money-row__text">
                  <span className="money-row__title">{label(e)}</span>
                  <span className="money-row__sub">{day(e.createdAt)}</span>
                </span>
                <span
                  className="money-row__amount"
                  style={{ color: e.amountCents >= 0 ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  {fmtCents(e.amountCents, true)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
