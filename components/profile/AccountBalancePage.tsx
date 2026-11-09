'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { BottomSheet, BottomSheetBody, BottomSheetHeader } from '@/components/BottomSheet';
import { announceBalanceChanged } from '@/lib/balanceRefresh';
import { isFlagOn } from '@/lib/flags';
import { showTopToast } from '@/lib/topToast';
import { useOnline } from '@/lib/useOnline';
import { fmtCents } from './GiftCardsPage';
import PaymentsChart from './PaymentsChart';
import { creditWouldPay, type OwedSessionLine, type OwedStringingLine, type UseBalance } from './useBalance';
import type { UseCredit } from './useCredit';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  /** Shared with the Profile row that opens this page, so the two agree. */
  balance: UseBalance;
  /** The store credit, or `null` with store credit off. */
  credit: UseCredit | null;
  onBack: () => void;
}

type Line =
  | { kind: 'session'; key: string; at: string; cents: number; s: OwedSessionLine }
  | { kind: 'stringing'; key: string; at: string; cents: number; j: OwedStringingLine };

/**
 * "Account balance" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §4):
 * the detailed view of Home's balance card, from the same read, so the two
 * cannot disagree (Grant, 2026-11-09: "this is the detailed view").
 *
 * One card on top: what you owe and how many lines, your credit beside it,
 * a row per line, then the two ways to pay. Under it, WHAT YOU'VE PAID: the
 * last six months as a chart, sessions and stringing and your guests' shares.
 *
 * The stringer's name never appears (docs/roles.md): a line is your racket.
 */
export default function AccountBalancePage({ balance, credit, onBack }: Props) {
  const t = useTranslations('profile.balance');
  const format = useFormatter();
  const online = useOnline();
  const [spend, setSpend] = useState<'idle' | 'busy' | 'error'>('idle');
  const [payOpen, setPayOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  // "N days ago" counts from when the page opened, read once (render stays pure).
  const [now] = useState(() => Date.now());
  const canSayPaid = isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO');

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });
  const shortDay = (iso: string) =>
    format.dateTime(new Date(iso), { month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });

  const data = balance.data;
  const creditCents = credit && !credit.loadError ? credit.balanceCents : null;
  const lines: Line[] = data
    ? [
        ...data.sessions.map((s) => ({ kind: 'session' as const, key: s.playerId ?? s.sessionId, at: s.date, cents: Math.round(s.owedAmount * 100), s })),
        ...(data.stringing ?? []).map((j) => ({ kind: 'stringing' as const, key: j.jobId, at: j.at, cents: Math.round(j.amount * 100), j })),
      ].sort((a, b) => (a.at < b.at ? 1 : -1))
    : [];
  const totalCents = data ? Math.round(data.totalOwed * 100) : 0;
  const withCredit = data && creditCents ? creditWouldPay(data, creditCents) : 0;

  async function payWithCredit() {
    setSpend('busy');
    try {
      const res = await fetch(`${BASE}/api/credit/spend`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      setSpend('idle');
      showTopToast({ tone: 'success', icon: 'check_circle', title: t('paidWithCredit', { amount: fmtCents(withCredit) }) });
      // Every balance re-reads: this page's, Profile's row, Home's card.
      announceBalanceChanged();
    } catch {
      setSpend('error');
    }
  }

  async function sayPaid() {
    setSent('busy');
    try {
      const res = await fetch(`${BASE}/api/payments/self-report`, { method: 'POST' });
      setSent(res.ok ? 'done' : 'error');
    } catch {
      setSent('error');
    }
  }

  function subtitle(line: Line): string {
    if (line.kind === 'stringing') return t('line.ready', { date: shortDay(line.at) });
    const s = line.s;
    if (!s.settled) return t('line.estimate');
    const settledAt = s.settledAt ?? null;
    if (!settledAt) return t('line.settledNoDate');
    const days = Math.max(0, Math.floor((now - new Date(settledAt).getTime()) / DAY_MS));
    return t('line.settled', { date: shortDay(settledAt), days });
  }

  function title(line: Line): string {
    if (line.kind === 'stringing') return t('line.restring', { racket: line.j.racketLabel });
    return line.s.guestName
      ? t('line.guest', { day: day(line.at), name: line.s.guestName })
      : t('line.session', { day: day(line.at) });
  }

  const payTo = data?.payTo ?? null;

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight flex flex-col gap-4" data-account-balance-page>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      {balance.forbidden ? (
        <div className="glass-card p-5">
          <EmptyState>{t('signInAgain')}</EmptyState>
        </div>
      ) : balance.loadError ? (
        <div className="glass-card p-5">
          <ErrorState
            message={t('loadError')}
            action={<button type="button" className="cc-btn cc-btn-ghost" onClick={balance.reload}>{t('retry')}</button>}
          />
        </div>
      ) : !data ? (
        <CardSkeleton height={260} />
      ) : (
        <div className="glass-card p-5 flex flex-col gap-4">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
            <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span className="fs-base" style={{ color: 'var(--text-muted)' }}>
                {totalCents > 0 ? t('youOwe', { count: lines.length }) : t('paidUp')}
              </span>
              <span key={totalCents} className="bpm-count motion-fade" style={{ color: totalCents > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                {fmtCents(totalCents)}
              </span>
            </div>
            {(creditCents ?? 0) > 0 && (
              <div className="balance-credit">
                <span className="balance-credit__label">{t('credit')}</span>
                <span className="balance-credit__value">{fmtCents(creditCents ?? 0)}</span>
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <ul className="flex flex-col gap-3" style={{ listStyle: 'none', margin: '0', padding: '0' }}>
              {lines.map((line) => (
                <li key={line.key} className="balance-line">
                  <span className="balance-line__icon" aria-hidden="true">
                    <span className="material-icons">{line.kind === 'session' ? 'event' : 'sports_tennis'}</span>
                  </span>
                  <span className="money-row__text">
                    <span className="money-row__title">{title(line)}</span>
                    <span className="money-row__sub">{subtitle(line)}</span>
                  </span>
                  <span className="money-row__amount">{fmtCents(line.cents)}</span>
                </li>
              ))}
            </ul>
          )}

          {totalCents > 0 && (
            <div className="flex flex-col gap-3">
              {withCredit > 0 && (
                <button type="button" className="btn-primary" disabled={!online || spend === 'busy'} onClick={() => void payWithCredit()}>
                  {t('payWithCredit', { amount: fmtCents(withCredit) })}
                </button>
              )}
              {/* Only when the club has said where to send it (lib/payTo.ts);
                  Home's card leaves the line out the same way. */}
              {payTo && (
                <button type="button" className="btn-ghost" onClick={() => setPayOpen(true)}>
                  {t('payByEtransfer', { amount: fmtCents(totalCents) })}
                </button>
              )}
              {spend === 'error' && <p className="field-error" role="alert" style={{ margin: '0' }}>{t('creditError')}</p>}
            </div>
          )}
        </div>
      )}

      <ProfileEyebrow>{t('paidGroup')}</ProfileEyebrow>
      <PaymentsChart />

      <BottomSheet open={payOpen} onClose={() => setPayOpen(false)} ariaLabel={t('etransfer.title')}>
        <BottomSheetHeader onClose={() => setPayOpen(false)} closeLabel={t('etransfer.close')}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('etransfer.title')}</span>
        </BottomSheetHeader>
        <BottomSheetBody>
          {payTo && (
            <div className="flex flex-col gap-4">
              <p className="fs-md" style={{ margin: '0', color: 'var(--text-secondary)' }}>
                {t('etransfer.body', { amount: fmtCents(totalCents) })}
              </p>
              <div className="balance-payto">
                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{payTo.name}</span>
                <span className="balance-payto__email">{payTo.email}</span>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(payTo.email).then(() => setCopied(true)).catch(() => {});
                }}
              >
                {copied ? t('etransfer.copied') : t('etransfer.copy')}
              </button>
              {canSayPaid &&
                (sent === 'done' ? (
                  <p className="fs-sm motion-fade" role="status" style={{ margin: '0', color: 'var(--text-secondary)' }}>{t('etransfer.sentDone')}</p>
                ) : (
                  <button type="button" className="btn-ghost" disabled={!online || sent === 'busy'} onClick={() => void sayPaid()}>
                    {t('etransfer.sent')}
                  </button>
                ))}
              {sent === 'error' && <p className="field-error" role="alert" style={{ margin: '0' }}>{t('etransfer.sentError')}</p>}
            </div>
          )}
        </BottomSheetBody>
      </BottomSheet>
    </div>
  );
}
