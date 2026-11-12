'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import StagePill from './StagePill';
import StatusBadge from '@/components/primitives/StatusBadge';
import { dueFor, dueStyle, formatReadyBy } from '@/lib/stringingDue';
import { fmtMoney } from '@/lib/fmt';
import type { StringingStatus } from '@/lib/stringing';
import {
  PROGRESS_STEPS,
  STAGE_TRACK,
  progressFilled,
  stageLook,
  toneStageOf,
  type ToneStage,
} from '@/lib/stringingStatusTone';
import type { StringerPendingEdit } from '@/lib/types';

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
  /** A change waiting on the player: the pill reads "Waiting on <name>". */
  pendingEdit?: unknown;
  /** Someone not on the roster (docs/plans/stringing-walk-ups.md): a
   *  "Walk-up" pill beside "for <name>". */
  walkUp?: boolean;
}

/**
 * The spec line, "string · colour · tension · holes · for <name>", with a
 * WALK-UP's pill after the name (docs/plans/stringing-walk-ups.md). Shared by
 * this card and the stringer's queue card, so both say it the same way.
 * `contact` is the walk-up's phone or email, for the stringer who has the job.
 */
export function JobSpecLine({ spec, walkUp, contact }: { spec: string; walkUp?: boolean; contact?: string }) {
  const tAdmin = useTranslations('admin.stringing');
  if (!walkUp) return <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{spec}</span>;
  return (
    <>
      <span className="fs-sm" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <span>{spec}</span>
        <StatusBadge variant="muted">{tAdmin('walkUp.badge')}</StatusBadge>
      </span>
      {contact && (
        <span className="fs-sm" style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
          {tAdmin('walkUp.contactLabel')} · {contact}
        </span>
      )}
    </>
  );
}

/**
 * A list's heading in the label style, the count under it, and an optional
 * trailing slot (the bench's shop pill). No outer card: the list under it is
 * one card per racket on the tab's ground (Stringing canvas, 2026-11-12;
 * Grant: "Remove the outer card"). Shared by the stringer's queue and the
 * admin's bench, so the two lists are headed the same way.
 */
export function JobsHeading({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', padding: '0 var(--space-1)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
        <h3 className="section-label-muted" style={{ margin: 0, color: 'var(--text-secondary)' }}>{title}</h3>
        {subtitle && (
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{subtitle}</p>
        )}
      </div>
      {trailing && <span style={{ flex: 'none' }}>{trailing}</span>}
    </div>
  );
}

/**
 * Received · Strung · Ready · Picked up, filled to where the racket is and
 * coloured by the stage it is SHOWN as (a change waiting on the player turns
 * it purple; the fill still says where the racket actually is). Decoration:
 * the pill beside it says the status in words. One bar for the stringer's
 * card and the bench's, so they cannot drift.
 */
export function JobProgress({ status, stage, testId = 'job-progress' }: {
  status: StringingStatus;
  stage: ToneStage;
  testId?: string;
}) {
  const look = stageLook(stage);
  const filled = progressFilled(status);
  return (
    <div
      aria-hidden="true"
      data-testid={testId}
      data-filled={filled}
      data-stage={stage}
      style={{ display: 'flex', gap: 'var(--space-1)', margin: 'var(--space-05) 0' }}
    >
      {PROGRESS_STEPS.map((step, i) => (
        <span
          key={step}
          data-on={i < filled ? 'true' : 'false'}
          style={{
            flex: 1,
            height: 'var(--space-1)',
            borderRadius: 'var(--radius-pill)',
            background: i < filled ? look.tone : STAGE_TRACK,
          }}
        />
      ))}
    </div>
  );
}

/** The from/to pairs a waiting line can say: the player's diff, minus money. */
export type PendingChangeWords = Pick<
  StringerPendingEdit,
  'racketFrom' | 'racketTo' | 'stringFrom' | 'stringTo' | 'tensionFrom' | 'tensionTo'
>;

/**
 * What the player is being asked, when the diff says; otherwise only that
 * they are being asked. Racket, string and tension only — NEVER the price,
 * even on the admin's bench, which could read it: the line is the same on
 * every screen that draws a job, and a stringer sees no money.
 */
export function PendingChangeLine({ name, edit }: { name: string; edit?: PendingChangeWords | null }) {
  const t = useTranslations('home.stringing');
  const tAdmin = useTranslations('admin.stringing');
  const parts: string[] = [];
  if (edit?.racketTo && edit.racketFrom) parts.push(t('stringerChangePart', { to: edit.racketTo, from: edit.racketFrom }));
  if (edit?.stringTo && edit.stringFrom) parts.push(t('stringerChangePart', { to: edit.stringTo, from: edit.stringFrom }));
  if (edit?.tensionTo && edit.tensionFrom) {
    parts.push(t('stringerChangePart', {
      to: `${edit.tensionTo} ${tAdmin('lb')}`,
      from: `${edit.tensionFrom} ${tAdmin('lb')}`,
    }));
  }
  const text = parts.length === 0
    ? t('stringerWaitingGeneric', { name })
    : t('stringerWaitingChange', { change: parts.join(', '), name });
  return (
    <span className="fs-sm" data-testid="job-waiting-line" style={{ color: 'var(--text-secondary)' }}>
      {text}
    </span>
  );
}

/**
 * One racket on the bench, the same card for the admin's bench, the archive
 * and a stringer's own queue (Stringing canvas, 2026-10-28; Grant: "Align the
 * design with the card above for stringer"). The two used to be drawn twice
 * and had drifted — a glass card per job on the bench, a soft one in the queue.
 *
 *   racket · J-number · status · ⋮
 *   ▬▬ ▬▬ ▬▬ ▬▬   Received · Strung · Ready · Picked up
 *   string · colour · tension · holes · for <name>
 *   when it is due (muted / amber soon / red late), or what is still owed
 *   what the player is being asked, while a change waits on them
 *   the next step, full width
 *
 * Tapping the card opens the job when `onOpen` is given; the buttons inside it
 * stay their own targets. `surface="card"` makes it a card of its own on the
 * tab's ground (the admin bench, 2026-11-12, in the stringer's card style);
 * the default is the inner card it is inside a list card (the archive).
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
  waitingDays = null,
  pendingChange,
  surface = 'inner',
  open = false,
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
  /**
   * Whole days a request has sat at `requested` past the 48-hour mark
   * (`isWaitingTooLong` / `waitingDays` in lib/stringingWaiting.ts), or null.
   * The caller decides, because it holds the clock; the card only draws it:
   * an amber tint and a "Waiting N days" line (docs/plans/stringing-request-nudge.md).
   */
  waitingDays?: number | null;
  /**
   * The from/to of a change waiting on the player (`toPlayerPendingEdit` on
   * the bench, the stringer projection's own `pendingEdit` on a stringer's
   * list). Read only while `job.pendingEdit` is set; absent, the card says
   * only that the player has to confirm.
   */
  pendingChange?: PendingChangeWords | null;
  /** `card`: a glass card of its own, on the tab's ground. `inner`: the tint
   *  of a card inside a list card. */
  surface?: 'inner' | 'card';
  /** The job showing on a foldable's right page: a solid tint marks it (fill
   *  only, never a ring), and the button says it is the current one. */
  open?: boolean;
}) {
  const t = useTranslations('home.stringing');
  const locale = useLocale();
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
        : due.key === 'onDate' ? (formatReadyBy(due.date, locale) ?? tAdmin('due.noDate'))
          : tAdmin(`due.${due.key}`);

  const stage = toneStageOf(job);
  const className = [
    surface === 'card' ? 'glass-card' : null,
    'bpm-job-card',
    waitingDays ? 'bpm-job-card--waiting' : null,
    open ? 'bpm-job-card--open' : null,
  ].filter(Boolean).join(' ');

  return (
    <div className={className} data-testid="job-card" data-stage={stage} style={{ position: 'relative' }}>
      {onOpen && (
        // Named for THIS job: a bench of identical "Open this job" buttons
        // tells a screen reader nothing about which.
        <button
          type="button"
          onClick={onOpen}
          aria-current={open ? 'true' : undefined}
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
            {/* The same pill as the stringer's list (lib/stringingStatusTone.ts). */}
            <StagePill stage={stage} label={stage === 'waiting' ? tAdmin('status.waiting', { name: job.memberName }) : tAdmin(`status.${job.status}`)} />
          </span>
          {more && <span style={{ flex: 'none', pointerEvents: 'auto' }}>{more}</span>}
        </div>
        <JobProgress status={job.status} stage={stage} />
        {/* Words in the body face; the spec is what the stringer opened it for. */}
        <JobSpecLine spec={spec} walkUp={job.walkUp} />
        {waitingDays && !job.cancelledAt ? (
          <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--sev-warn)' }}>
            {tAdmin('waiting', { days: waitingDays })}
          </span>
        ) : null}
        {job.cancelledAt ? (
          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{tAdmin('cancelledByPlayer')}</span>
        ) : owed !== null ? (
          <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--sev-warn)' }}>
            {tAdmin('archive.stillOwed', { amount: fmtMoney(owed) })}
          </span>
        ) : dueText ? (
          <span className="fs-sm" style={dueStyle(due.tone)}>{dueText}</span>
        ) : null}
        {stage === 'waiting' && !job.cancelledAt && (
          <PendingChangeLine name={job.memberName} edit={pendingChange} />
        )}
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

/**
 * The next step a card offers. While a change waits on the player only
 * RECEIVING the racket stays on offer: "Mark strung" would string a racket
 * the player has not agreed to, but a racket dropped off before they answer
 * is on the bench all the same, and hiding "Mark received" left the job
 * reading "waiting for drop-off" with the racket in hand (review, 2026-11-12).
 * One rule for the bench and the stringer's card.
 */
export function nextStepOf(
  status: StringingStatus,
  flow: readonly StringingStatus[],
  waitingOnPlayer: boolean,
): StringingStatus | null {
  const next = nextStatusOf(status, flow);
  return waitingOnPlayer && next !== 'received' ? null : next;
}
