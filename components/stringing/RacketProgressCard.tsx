'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';
import StatusBanner from '@/components/primitives/StatusBanner';
import { fmtMoney } from '@/lib/fmt';
import { playerTensionText, type PlayerStage } from '@/lib/stringing';
import type { PlayerStringingJob } from '@/lib/types';
import StringingSteps, { stepForStage } from './StringingSteps';

/** The figure in the data face, so "$30" reads the same everywhere on the tab. */
function Money({ value, size = 'md' }: { value: number; size?: 'md' | 'lg' }) {
  return (
    <span className={size === 'lg' ? 'fs-lg' : 'fs-md'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
      {fmtMoney(value)}
    </span>
  );
}

/**
 * One racket the player has in, as its own card (Stringing canvas, 2026-10-28;
 * docs/plans/stringing-canvas-redesign.md). It used to be one row inside a
 * collapsible service card under ONE step strip for the newest racket, so a
 * player with two in saw the progress of one. Now every racket carries its own
 * strip, and its own news:
 *
 *   - a change the stringer asked about → one amber row, "Review changes",
 *     which opens "A change to confirm" (`ConfirmChangePage`);
 *   - ready → a green banner with the bill;
 *   - otherwise → the stage, with the quote beside it.
 *
 * The quote is the stringer's exact figure (Grant: "dont hide"); the bill on
 * Ready is `amountDue`, which is what the balance card adds.
 */
export default function RacketProgressCard({
  job,
  onReview,
  onCancel,
}: {
  job: PlayerStringingJob;
  onReview: () => void;
  /** Calls the request off while the racket is still in the bag. Resolves
   *  whether it worked; the card stays, saying so, when it did not. */
  onCancel?: () => Promise<boolean>;
}) {
  const t = useTranslations('home.stringing');
  const online = useOnline();
  /** Two taps to cancel: the first asks, the second does it. */
  const [cancelStep, setCancelStep] = useState<'idle' | 'asking' | 'busy' | 'failed'>('idle');
  async function cancel() {
    if (!onCancel) return;
    setCancelStep('busy');
    setCancelStep((await onCancel()) ? 'idle' : 'failed');
  }
  const stage = job.stage as PlayerStage;
  const edit = job.pendingEdit;
  const ready = stage === 'ready_for_you';
  const spec = [
    job.jobNo,
    job.stringLabel,
    job.stringColor,
    `${playerTensionText(job.tensionMains, job.tensionCrosses)} ${t('lb')}`,
  ].filter(Boolean).join(' · ');

  // The BILL only — what the balance card adds. A racket paid before pickup
  // (credit, an e-transfer) owes nothing, and its quote is no longer a bill.
  const bill = job.amountDue;

  return (
    <section className="glass-card p-5" aria-label={job.racketLabel} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)', flex: 'none' }}>sports_tennis</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="bpm-h3" style={{ display: 'block' }}>{job.racketLabel}</span>
          <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>{spec}</span>
        </span>
      </div>

      {edit ? (
        /* ONE amber row, not a banner with a button under it (Grant, on the
           design canvas, 2026-11-12): "Review changes", one line asking them
           to confirm, and a chevron — the whole row is the way in. What
           changes, and why, is on the page it opens. */
        <button type="button" className="change-ask-row" onClick={onReview}>
          <span className="material-icons icon-status text-amber-400" aria-hidden="true" style={{ flex: 'none' }}>request_quote</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="fs-md text-amber-300" style={{ display: 'block', fontWeight: 600 }}>{t('confirm.review')}</span>
            <span className="fs-sm" style={{ display: 'block', color: 'var(--text-secondary)' }}>{t('confirm.reviewBody')}</span>
          </span>
          <span className="material-icons icon-md text-amber-400" aria-hidden="true" style={{ flex: 'none' }}>chevron_right</span>
        </button>
      ) : ready ? (
        <StatusBanner
          tone="success"
          icon="check_circle"
          title={t('ready.title')}
          body={t('ready.body')}
          trailing={bill !== null ? <Money value={bill} size="lg" /> : undefined}
        />
      ) : null}

      <StringingSteps current={stepForStage(stage)} held={!!edit} />

      {/* Still in the bag: the one point where calling it off is clean — no
          racket to hand back, nothing owed. Asked first, then done. */}
      {!edit && stage === 'awaiting_dropoff' && onCancel && cancelStep !== 'idle' ? (
        <div className="bpm-inner-row motion-fade" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span className="fs-base" style={{ color: 'var(--text-primary)' }}>{t('cancelAsk')}</span>
          {cancelStep === 'failed' && <p className="field-error" role="alert">{t('cancelError')}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="button" className="cc-btn cc-btn-ghost" style={{ flex: 1 }} onClick={() => setCancelStep('idle')} disabled={cancelStep === 'busy'}>
              {t('cancelKeep')}
            </button>
            <button type="button" className="cc-btn cc-btn-danger" style={{ flex: 1 }} onClick={() => void cancel()} disabled={cancelStep === 'busy' || !online}>
              {t('cancelGo')}
            </button>
          </div>
        </div>
      ) : !edit && !ready && (
        <div className="bpm-inner-row">
          <span className="fs-base" style={{ color: 'var(--text-secondary)' }}>{t(`stage.${stage}`)}</span>
          {stage === 'awaiting_dropoff' && onCancel && (
            <button type="button" className="link-quiet link-quiet--flush" onClick={() => setCancelStep('asking')} disabled={!online}>
              {t('cancelCta')}
            </button>
          )}
          {stage !== 'awaiting_dropoff' && (
            job.quote !== null ? (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('quoted')}</span>
                <Money value={job.quote} />
              </span>
            ) : (
              <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('notPriced')}</span>
            )
          )}
        </div>
      )}
    </section>
  );
}
