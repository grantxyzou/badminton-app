'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { usePageBack } from '@/lib/pageStack';
import { scrollPageTo } from '@/lib/pageScroll';
import { announceBalanceChanged } from '@/lib/balanceRefresh';
import type { PlayerStage } from '@/lib/stringing';
import type { PlayerStringingJob } from '@/lib/types';
import { changeRows } from './pendingChange';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "A change to confirm" — the stringer changed something, is that alright?
 *
 * A PAGE in place of the Stringing tab's content, not a sheet (Grant, on the
 * design canvas, 2026-11-12: "Can we have some detail explaining why the
 * change?", then "i think it should be its own page", and of the buttons,
 * "this goes into the card"). It replaced `ConfirmChangeSheet`; the answer is
 * the same call, and so are the rules it kept:
 *
 *   - It renders a DIFF, not a form. The player is answering yes or no to
 *     something already written down; inputs would suggest a negotiation the
 *     app cannot carry. Each change is its own amber row, old struck through.
 *   - The stringer's "why" (`PlayerPendingEdit.reason`) leads, when they gave
 *     one, and nothing stands in its place when they did not.
 *   - Declining is a real answer ("Keep mine"): the job stands as it was.
 *     Going Back leaves the question open, which is correct — "I haven't
 *     decided" and "no" are different.
 *   - A 409 is "Nothing left to answer": the stringer withdrew the change or
 *     it was answered elsewhere. The card behind is re-read, and the page
 *     drops its card for the page-level centred state with only Close.
 *   - A failed send STAYS on the page saying so: leaving would look like it
 *     worked, and this is the one screen where that means somebody believing
 *     they agreed to a price they did not.
 *
 * `job` is a SNAPSHOT taken when the page opened: once answered, the reload
 * drops its `pendingEdit`, and a page looked up by id would vanish before the
 * player read why.
 */
export default function ConfirmChangePage({
  job,
  onBack,
  onAnswered,
}: {
  job: PlayerStringingJob;
  onBack: () => void;
  /** Re-read the rackets: the answer (or a 409) changed what the card shows. */
  onAnswered: () => void;
}) {
  const t = useTranslations('home.stringing');
  const tNav = useTranslations('nav');
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'send' | 'gone' | null>(null);

  // A page opens at its top, wherever the card list was scrolled to.
  useEffect(() => { scrollPageTo(0); }, []);
  // The Android back button walks back to the card (lib/pageStack.ts).
  usePageBack(true, onBack);

  const edit = job.pendingEdit;
  const rows = edit ? changeRows(edit, { lb: t('lb'), unpriced: t('confirm.unpriced') }) : [];
  const reason = edit?.reason?.trim() ?? '';

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
      if (res.status === 409) {
        setError('gone');
        onAnswered();
        return;
      }
      if (!res.ok) throw new Error(`answer ${res.status}`);
      // Accepting a price change moves what they owe, and the balance card is
      // a separate component with its own fetch.
      announceBalanceChanged();
      onAnswered();
      onBack();
    } catch {
      setError('send');
    } finally {
      setBusy(false);
    }
  }

  const stage = job.stage as PlayerStage;
  const header = (
    <TopBar title={t('confirm.title')} crumb={tNav('stringing')} onBack={onBack} backLabel={t('confirm.back')} />
  );

  /* Gone is not a failure: the stringer withdrew the change or it was answered
     elsewhere, so there is nothing left to answer. NO card at all — no racket,
     no change, no buttons the server would refuse — only the page-level
     centred state under the same header (Grant's final frame, 2026-11-12). */
  if (error === 'gone') {
    return (
      <div className="animate-slideInRight">
        {header}
        <div className="motion-fade" style={{ padding: 'var(--space-9) var(--space-7)' }}>
          <EmptyState
            icon="fact_check"
            title={t('confirm.goneTitle')}
            action={
              <button type="button" className="cc-btn cc-btn-secondary" onClick={onBack}>
                {t('confirm.close')}
              </button>
            }
          >
            {t('confirm.gone')}
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-slideInRight">
      {header}

      <section
        className="glass-card p-5"
        aria-label={t('confirm.title')}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)', flex: 'none' }}>sports_tennis</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="fs-lg" style={{ display: 'block', fontWeight: 600 }}>{job.racketLabel}</span>
            <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>
              {[job.jobNo, t(`stage.${stage}`)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>

        {reason && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <span className="section-label-muted">{t('confirm.why')}</span>
            <p className="change-note fs-md">{reason}</p>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <span className="section-label-muted">{t('confirm.changes')}</span>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none' }}>
              {rows.map((r) => (
                <li key={r.key} className="change-row">
                  <span className="fs-base" style={{ color: 'var(--text-secondary)' }}>{t(`confirm.${r.key}`)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                    {/* What it WAS is half of what is being asked, so it
                        stays, struck through, rather than being dropped. */}
                    <span className="fs-base" style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{r.from}</span>
                    <span className="material-icons icon-sm text-amber-400" aria-hidden="true">arrow_forward</span>
                    <span className="fs-md text-amber-300" style={{ fontWeight: 700 }}>{r.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('confirm.note')}</p>

        {error === 'send' && (
          <p className="field-error" role="alert">{t('confirm.error')}</p>
        )}

        {/* Inside the card (Grant: "this goes into the card"). Accept is
            the filled primary; Keep mine is the outlined twin beside it. */}
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <button
            type="button"
            className="cc-btn cc-btn-secondary cc-btn-lg"
            style={{ flex: 1 }}
            disabled={busy || !online}
            onClick={() => void answer('decline')}
          >
            {t('confirm.decline')}
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1 }}
            disabled={busy || !online}
            onClick={() => void answer('accept')}
          >
            {busy ? t('confirm.working') : t('confirm.accept')}
          </button>
        </div>
      </section>
    </div>
  );
}
