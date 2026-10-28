'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/primitives/StatusBadge';
import { STATUS_TONE } from './statusTone';
import { dueFor, dueStyle, formatReadyBy } from '@/lib/stringingDue';
import { fmtMoney } from '@/lib/fmt';
import type { StringingStatus } from '@/lib/stringing';

/** What a job card needs, from either projection (the bench's or a stringer's). */
export interface JobCardJob {
  racketLabel: string;
  jobNo: string;
  status: StringingStatus;
  stringLabel: string;
  stringColor?: string;
  tensionMains: number;
  tensionCrosses: number;
  memberName: string;
  readyBy: string | null;
  /**
   * When it was paid; `null` unpaid; `undefined` NOT KNOWN — a stringer's
   * projection carries no money (`toStringerJob`), so a stringer's card never
   * says "unpaid" about a racket it cannot see the money for.
   */
  paidAt?: string | null;
  /** The player called the request off before handing the racket over. */
  cancelledAt?: string | null;
}

/**
 * One racket on the bench, the same card for the admin's bench, the archive
 * and a stringer's own queue (Stringing canvas, 2026-10-28; Grant: "Align the
 * design with the card above for stringer"). The two used to be drawn twice
 * and had drifted — a glass card per job on the bench, a soft one in the queue.
 *
 *   racket · J-number · status · ⋮
 *   string · colour · tension · holes · for <name>
 *   when it is due (muted / amber soon / red late), or what is still owed
 *   the next step, full width
 *
 * Tapping the card opens the job when `onOpen` is given; the buttons inside it
 * stay their own targets.
 */
export default function JobCard({
  job,
  today,
  holes = null,
  pinned = false,
  owed = null,
  onOpen,
  openLabel,
  more,
  action,
}: {
  job: JobCardJob;
  /** `todayIso()` — the viewer's own date, compared day to day with `readyBy`. */
  today: string;
  holes?: number | null;
  pinned?: boolean;
  /** Dollars still owed on an ARCHIVED job, shown in place of the due line. */
  owed?: number | null;
  onOpen?: () => void;
  openLabel?: string;
  /** The ⋮ button, already built by the caller (it owns the sheet). */
  more?: ReactNode;
  /** The next-step row: one or two buttons. */
  action?: ReactNode;
}) {
  const t = useTranslations('home.stringing');
  const tAdmin = useTranslations('admin.stringing');

  const spec = [
    job.stringLabel,
    job.stringColor,
    `${job.tensionMains}/${job.tensionCrosses} ${tAdmin('lb')}`,
    holes !== null ? tAdmin('holes.holesValue', { count: holes }) : null,
    t('stringerFor', { name: job.memberName }),
  ].filter(Boolean).join(' · ');

  // An unknown payment is treated as paid for the due line only, so a ready
  // racket on a stringer's queue shows its date, never "unpaid".
  const due = dueFor({ readyBy: job.readyBy, status: job.status, paidAt: job.paidAt === undefined ? 'unknown' : job.paidAt }, today);
  const dueText =
    due.key === 'pickedUp' ? null
      : due.key === 'overdue' ? tAdmin('due.overdue', { days: due.days ?? 0 })
        : due.key === 'onDate' ? (formatReadyBy(due.date) ?? tAdmin('due.noDate'))
          : tAdmin(`due.${due.key}`);

  return (
    <div className="bpm-job-card" style={{ position: 'relative' }}>
      {onOpen && (
        // Named for THIS job: a bench of identical "Open this job" buttons
        // tells a screen reader nothing about which.
        <button
          type="button"
          onClick={onOpen}
          aria-label={[openLabel, job.racketLabel, job.jobNo, t('stringerFor', { name: job.memberName })].filter(Boolean).join(' · ')}
          style={{ position: 'absolute', inset: 0, borderRadius: 'inherit' }}
        />
      )}
      <div style={{ position: 'relative', pointerEvents: onOpen ? 'none' : undefined, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flex: '1 1 auto', minWidth: 0 }}>
            {pinned && (
              <span className="material-icons icon-xs" aria-hidden="true" style={{ color: 'var(--accent)' }}>star</span>
            )}
            <span className="fs-md" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.racketLabel}
            </span>
            <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flex: 'none' }}>
              {job.jobNo}
            </span>
          </span>
          <span style={{ flex: 'none' }}>
            <StatusBadge variant="state" tone={STATUS_TONE[job.status] ?? STATUS_TONE.requested}>
              {tAdmin(`status.${job.status}`)}
            </StatusBadge>
          </span>
          {more && <span style={{ flex: 'none', pointerEvents: 'auto' }}>{more}</span>}
        </div>
        {/* Words in the body face; the spec is what the stringer opened it for. */}
        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{spec}</span>
        {job.cancelledAt ? (
          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{tAdmin('cancelledByPlayer')}</span>
        ) : owed !== null ? (
          <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--sev-warn)' }}>
            {tAdmin('archive.stillOwed', { amount: fmtMoney(owed) })}
          </span>
        ) : dueText ? (
          <span className="fs-sm" style={dueStyle(due.tone)}>{dueText}</span>
        ) : null}
        {action && (
          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)', pointerEvents: 'auto' }}>
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

/** The bench's next status after `status`, or null at the end of the flow. */
export function nextStatusOf(status: StringingStatus, flow: readonly StringingStatus[]): StringingStatus | null {
  const i = flow.indexOf(status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}
