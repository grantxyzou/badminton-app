'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import StagePill from './StagePill';
import { JobSpecLine, PendingChangeLine, type JobCardJob, type PendingChangeWords } from './JobCard';
import { dueFor, dueStyle, formatReadyBy } from '@/lib/stringingDue';
import { toneStageOf } from '@/lib/stringingStatusTone';
import { fmtMoney } from '@/lib/fmt';
import { racketHeadSrc } from '@/lib/racketLook';
import { blendsWithDarkPill, reelColourFill, swatchInk } from '@/lib/stringShelf';
import { jobSides, type JobSide } from '@/lib/stringingSides';

/**
 * One racket on the bench as a ROW of the jobs list (docs/plans/stringing-jobs-list.md;
 * Grant's canvas, Option A, 2026-11-16: "HMW reduce stringer error by
 * presenting racket information easily", then "go with A, build it in the
 * app"). What the stringer needs at the machine, in the order they need it:
 *
 *   racket picture · its name under it
 *   player · 📅 due · Unpaid
 *   J-number · status
 *   Custom request (when the player chose the pair or a hybrid)
 *   M  27 lb · string      ← each side its own pill, the letter in the
 *   C  28 lb · string        string's colour; a player's own pair in amber
 *   72 grommet holes       ← only when counted
 *
 * No next-step button (Grant hid it on the canvas): the status moves on the
 * job page, which the row opens. The ⋮ stays, because SwipeRow's pin and
 * archive are touch-only and the menu is how a desktop reaches them.
 */
export default function BenchJobRow({
  job,
  today,
  catalogId,
  holes = null,
  pinned = false,
  unpaid = false,
  owed = null,
  notInvoiced = false,
  waitingDays = null,
  pendingChange,
  onOpen,
  openLabel,
  open = false,
  more,
  action,
}: {
  job: JobCardJob;
  today: string;
  /** The racket's catalog id, for its picture; null draws the generic racket. */
  catalogId: string | null;
  holes?: number | null;
  pinned?: boolean;
  /** Finished, priced and unpaid (`isBillable`). */
  unpaid?: boolean;
  /** Dollars owed: "Not invoiced · $X" when `notInvoiced`, else "Still owes $X" (the archive). */
  owed?: number | null;
  notInvoiced?: boolean;
  waitingDays?: number | null;
  pendingChange?: PendingChangeWords | null;
  onOpen: () => void;
  openLabel: string;
  open?: boolean;
  more?: ReactNode;
  /** One button under the pills (the archive's "Mark paid"); the bench passes none. */
  action?: ReactNode;
}) {
  const t = useTranslations('admin.stringing');
  const tPlayer = useTranslations('home.stringing');
  const locale = useLocale();
  const sides = jobSides(job);
  const custom = sides.customTension || sides.customStrings;
  const stage = toneStageOf(job);

  const due = dueFor({ readyBy: job.readyBy, status: job.status, paidAt: job.paidAt === undefined ? 'unknown' : job.paidAt }, today);
  const dueText =
    due.key === 'pickedUp' ? null
      : due.key === 'overdue' ? t('due.overdue', { days: due.days ?? 0 })
        : due.key === 'onDate' ? (formatReadyBy(due.date, locale) ?? t('due.noDate'))
          : t(`due.${due.key}`);

  const side = (letter: string, s: JobSide) => (
    <span className={custom ? 'bench-spec bench-spec--custom' : 'bench-spec'}>
      <span
        className="bench-spec-letter"
        data-dark={s.colour && blendsWithDarkPill(s.colour) ? 'true' : undefined}
        style={s.colour ? { background: reelColourFill(s.colour), color: swatchInk(s.colour) } : undefined}
      >
        {letter}
      </span>
      <span className="bench-spec-lb">{s.tension}</span>
      <span>{t('lb')} · {s.string}</span>
    </span>
  );

  return (
    <div
      className={['bench-row', waitingDays ? 'bench-row--waiting' : null, open ? 'bench-row--open' : null].filter(Boolean).join(' ')}
      data-testid="bench-row"
      data-stage={stage}
    >
      {/* One target for the whole row, named for THIS job; the ⋮ stays its own. */}
      <button
        type="button"
        className="bench-row-open"
        onClick={onOpen}
        aria-current={open ? 'true' : undefined}
        aria-label={[openLabel, job.racketLabel, job.jobNo, tPlayer('stringerFor', { name: job.memberName })].join(' · ')}
      />
      <span className="bench-row-racket" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static racket render, sized here */}
        <img src={racketHeadSrc(catalogId)} alt="" className="bench-row-img" loading="lazy" decoding="async" />
        <span className="bench-row-racket-name">{job.racketLabel}</span>
      </span>
      <span className="bench-row-body">
        <span className="bench-row-line">
          {pinned && <span className="material-icons icon-xs" aria-hidden="true" style={{ color: 'var(--accent)' }}>star</span>}
          <span className="bench-row-who">{job.memberName}</span>
          {dueText && (
            <span className="bench-row-due" style={dueStyle(due.tone)}>
              <span className="material-icons icon-xs bench-row-due-icon" aria-hidden="true">calendar_today</span>
              {dueText}
            </span>
          )}
          {unpaid && <span className="bench-tag">{t('bench.unpaid')}</span>}
        </span>
        <span className="bench-row-line">
          <span className="bench-row-no">{job.jobNo}</span>
          <StagePill stage={stage} label={stage === 'waiting' ? t('status.waiting', { name: job.memberName }) : t(`status.${job.status}`)} />
        </span>
        {job.walkUp && <JobSpecLine spec="" walkUp />}
        {custom && <span className="bench-row-custom">{t('bench.customRequest')}</span>}
        {waitingDays && !job.cancelledAt ? (
          <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--sev-warn)' }}>{t('waiting', { days: waitingDays })}</span>
        ) : null}
        {job.cancelledAt ? (
          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('cancelledByPlayer')}</span>
        ) : owed !== null ? (
          <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--sev-warn)' }}>
            {notInvoiced ? t('archive.notInvoiced', { amount: fmtMoney(owed) }) : t('archive.stillOwed', { amount: fmtMoney(owed) })}
          </span>
        ) : null}
        {stage === 'waiting' && !job.cancelledAt && <PendingChangeLine name={job.memberName} edit={pendingChange} />}
        <span className="bench-row-specs">
          {side(t('bench.mains'), sides.mains)}
          {side(t('bench.crosses'), sides.crosses)}
          {holes !== null && <span className="bench-spec bench-spec--plain">{t('bench.grommets', { count: holes })}</span>}
        </span>
        {action && <span className="bench-row-action">{action}</span>}
      </span>
      {more && <span className="bench-row-more">{more}</span>}
    </div>
  );
}
