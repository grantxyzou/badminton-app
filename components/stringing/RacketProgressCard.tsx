'use client';

import { useTranslations } from 'next-intl';
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
 *   - a change the stringer asked about → an amber banner with the diff and
 *     the one button that answers it;
 *   - ready → a green banner with the bill;
 *   - otherwise → the stage, with the quote beside it.
 *
 * The quote is the stringer's exact figure (Grant: "dont hide"); the bill on
 * Ready is `amountDue`, which is what the balance card adds.
 */
export default function RacketProgressCard({ job, onReview }: { job: PlayerStringingJob; onReview: () => void }) {
  const t = useTranslations('home.stringing');
  const stage = job.stage as PlayerStage;
  const edit = job.pendingEdit;
  const ready = stage === 'ready_for_you';
  const spec = [
    job.jobNo,
    job.stringLabel,
    job.stringColor,
    `${playerTensionText(job.tensionMains, job.tensionCrosses)} ${t('lb')}`,
  ].filter(Boolean).join(' · ');

  /* The diff on the banner is the PRICE when the price is what changes —
     the question a player answers first. Any other change names itself in
     the sheet behind "Review the change". */
  const priceDiff = edit && edit.priceTo !== undefined && typeof edit.priceTo === 'number' ? (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>
      {typeof edit.priceFrom === 'number' && (
        <span className="fs-base" style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{fmtMoney(edit.priceFrom)}</span>
      )}
      <Money value={edit.priceTo} size="lg" />
    </span>
  ) : null;

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
        <StatusBanner
          tone="warn"
          icon="request_quote"
          title={t('confirm.banner')}
          body={t('confirm.bannerBody')}
          trailing={priceDiff}
          action={
            <button type="button" className="cc-btn cc-btn-warn" onClick={onReview} style={{ width: '100%' }}>
              {t('confirm.review')}
            </button>
          }
        />
      ) : ready ? (
        <StatusBanner
          tone="success"
          icon="check_circle"
          title={t('ready.title')}
          body={t('ready.body')}
          trailing={bill !== null ? <Money value={bill} size="lg" /> : undefined}
        />
      ) : null}

      <StringingSteps current={stepForStage(stage)} />

      {!edit && !ready && (
        <div className="bpm-inner-row">
          <span className="fs-base" style={{ color: 'var(--text-secondary)' }}>{t(`stage.${stage}`)}</span>
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
