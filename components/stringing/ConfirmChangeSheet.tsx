'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import type { PlayerStringingJob } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "Grant changed something — is that alright?"
 *
 * The only thing a player may write to their own job, and the reason the
 * price wall has an exception: the figures here are EXACT, because you cannot
 * ask somebody to agree to "$28–32". Every other surface still shows the band.
 *
 * It renders a DIFF, not a form. The player is not editing anything — they are
 * answering yes or no to something already written down, and showing them
 * inputs would suggest a negotiation the app cannot actually carry.
 *
 * Declining is a real answer with its own button, not a dismissal. Closing the
 * sheet leaves the question open, which is correct: "I haven't decided" and
 * "no" are different, and a racket sitting unanswered is a conversation to have
 * in person rather than a state the app should guess at.
 */
export default function ConfirmChangeSheet({
  job,
  open,
  onClose,
  onAnswered,
}: {
  job: PlayerStringingJob;
  open: boolean;
  onClose: () => void;
  onAnswered: () => void;
}) {
  const t = useTranslations('home.stringing');
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'send' | 'gone' | null>(null);

  const edit = job.pendingEdit;

  async function answer(decision: 'accept' | 'decline') {
    if (busy || !online) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      // 409 is its own message. The likely cause is a stale sheet — Grant
      // withdrew the change, or it was answered on another device — and
      // "try again" would be a lie, so it says to refresh instead.
      if (res.status === 409) {
        setError('gone');
        return;
      }
      if (!res.ok) throw new Error(`answer ${res.status}`);
      onAnswered();
      onClose();
    } catch {
      // The sheet STAYS OPEN saying so. Closing on failure would look like it
      // worked, and this is the one screen where that would mean somebody
      // believing they had agreed to a price they had not.
      setError('send');
    } finally {
      setBusy(false);
    }
  }

  const rows: { label: string; from: string; to: string }[] = [];
  if (edit?.racketTo !== undefined) {
    rows.push({ label: t('confirm.racket'), from: edit.racketFrom ?? '', to: edit.racketTo });
  }
  if (edit?.stringTo !== undefined) {
    rows.push({ label: t('confirm.string'), from: edit.stringFrom ?? '', to: edit.stringTo });
  }
  if (edit?.tensionTo !== undefined) {
    rows.push({ label: t('confirm.tension'), from: edit.tensionFrom ?? '', to: edit.tensionTo });
  }
  if (edit && edit.priceTo !== undefined) {
    const money = (v: number | null | undefined) =>
      v === null || v === undefined ? t('confirm.unpriced') : `$${v.toFixed(2)}`;
    rows.push({ label: t('confirm.price'), from: money(edit.priceFrom), to: money(edit.priceTo) });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={t('confirm.title')}
      maxHeight="70vh"
      width="narrow"
    >
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('confirm.title')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('confirm.close')}
          style={{ minWidth: 44, minHeight: 44 }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p className="fs-md" style={{ color: 'var(--text-secondary)', margin: 0 }}>
            {t('confirm.intro', { racket: job.racketLabel })}
          </p>

          {error && (
            <p className="field-error" role="alert">
              {t(error === 'gone' ? 'confirm.gone' : 'confirm.error')}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {rows.map((r) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--inner-card-bg)',
                  border: '1px solid var(--inner-card-border)',
                }}
              >
                <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                  {/* The old value struck through rather than dropped: what it
                      WAS is half of what is being asked. */}
                  <span
                    className="fs-sm"
                    style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}
                  >
                    {r.from}
                  </span>
                  <span className="material-icons icon-xs" style={{ color: 'var(--text-muted)' }}>
                    arrow_forward
                  </span>
                  <span className="fs-md" style={{ fontWeight: 600 }}>{r.to}</span>
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !online}
              onClick={() => void answer('accept')}
              style={{ width: '100%' }}
            >
              {busy ? t('confirm.working') : t('confirm.accept')}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              disabled={busy || !online}
              onClick={() => void answer('decline')}
              style={{ width: '100%' }}
            >
              {t('confirm.decline')}
            </button>
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
