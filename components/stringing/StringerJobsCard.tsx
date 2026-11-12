'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRevealReady } from '@/components/primitives/Reveal';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { STRINGING_FLOW, type StringingStatus } from '@/lib/stringing';
import { dueFor, dueStyle, formatReadyBy, todayIso } from '@/lib/stringingDue';
import JobCard, { JobSpecLine, nextStatusOf } from './JobCard';
import {
  PROGRESS_STEPS,
  STAGE_TRACK,
  progressFilled,
  stageLook,
  toneStageOf,
  type ToneStage,
} from '@/lib/stringingStatusTone';
import type { StringerJob } from '@/lib/types';
import StagePill from './StagePill';
import { isRefused } from '@/lib/apiFetch';
import { useTabReturn } from '@/lib/tabActivity';
import { useHoleLookup } from '@/components/stringing/useHoleLookup';
import { isWaitingTooLong, waitingDays } from '@/lib/stringingWaiting';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * A job as the stringer's list reads it. A change waiting on the player comes
 * without its money (`toStringerJob` strips the price on the server); one
 * with no from/to pair (only the price moving) still reads as "waiting for
 * <name> to confirm the change".
 */
type StringerQueueJob = StringerJob;

/**
 * The bench, for the person actually holding the racket.
 *
 * Until now, stringing for the club required being an admin — `stringerId` was
 * whichever admin tapped "Take this one" — so the only way to let somebody
 * restring was to hand them payments, the roster and everyone's data. This is
 * the other half of splitting those: a member flagged `canString` sees the jobs
 * assigned to them, and nothing else.
 *
 * NO MONEY. The server projection (`toStringerJob`) has no `priceCents` and no
 * `paidAt` at all, so there is nothing here to leak — what the club charges is
 * not the business of the person putting string on the racket. The strip is on
 * the server precisely so this component cannot be the thing that gets it
 * wrong.
 *
 * They CAN advance the status, because the person doing the work is the one
 * who knows it is strung. Making them message an admin to record that is the
 * same support-burden shape the access-request flow exists to remove.
 *
 * Renders nothing when there is no work — but renders its ERROR loudly, since
 * "we could not ask" and "nothing to string" look identical and only one means
 * somebody's racket is sitting unstrung.
 */
export default function StringerJobsCard({ hasIdentity, showEmpty = false }: {
  hasIdentity: boolean;
  /** The Stringing tab's Bench register (docs/plans/stringing-tabs.md): the
   *  tab is only offered to a stringer, so an empty queue says so rather than
   *  leaving the register blank. */
  showEmpty?: boolean;
}) {
  const t = useTranslations('home.stringing');
  const online = useOnline();
  const [jobs, setJobs] = useState<StringerQueueJob[] | null>(null);
  /* Requests nobody has taken, oldest first (docs/plans/stringing-request-
     nudge.md). A stringer is nudged about these after 48 hours, so they are
     listed here with "Take it" rather than only on the admin's bench. */
  const [unclaimed, setUnclaimed] = useState<StringerJob[]>([]);
  const [takenElsewhere, setTakenElsewhere] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Refused, not failed: a device with no session for this name (most
  // name-only regulars) is answered 401/403. That says nothing about whether
  // they string rackets — and someone who does has signed in — so it renders
  // nothing, the same as an empty bench. It used to fall into the load-error
  // branch and put a red "couldn't load your jobs" card in front of players
  // who have never strung anything.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  /* The last tap, so it can be taken back. The person doing the work is the
     one who knows it is strung — and the one whose thumb slips. A mis-tap on
     "Mark ready" used to be final for the stringer (only an admin could move
     a job backwards), and it sends the player a push. Undo PATCHes the
     previous status; the route allows any move. The push already sent is not
     retracted (audit 2026-10-11, finding 08). */
  const [lastMove, setLastMove] = useState<{ jobId: string; from: StringingStatus; to: StringingStatus } | null>(null);
  const today = todayIso();
  // Read only once there is a job to show (docs/plans/grommet-holes.md, Phase 4).
  const holes = useHoleLookup(!!jobs && (jobs.length > 0 || unclaimed.length > 0));

  const load = useCallback(async () => {
    if (!hasIdentity) return;
    setLoadError(false);
    setRefused(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs?view=stringer`, { cache: 'no-store' });
      if (isRefused(res)) {
        setJobs(null);
        setRefused(true);
        return;
      }
      if (!res.ok) throw new Error(`stringer jobs ${res.status}`);
      const data = await res.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setUnclaimed(Array.isArray(data.unclaimed) ? data.unclaimed : []);
    } catch {
      setJobs(null);
      setLoadError(true);
    }
  }, [hasIdentity]);

  useEffect(() => { void load(); }, [load]);
  // Back on the bench after a while: a new request may have come in.
  useTabReturn(() => { void load(); });

  async function advance(job: StringerQueueJob, status: StringingStatus, undo = false) {
    if (busy || !online) return;
    setBusy(job.id);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // `memberId` is the partition key — the player the racket belongs to,
        // not the stringer. It is on the projection for exactly this call.
        body: JSON.stringify({ memberId: job.memberId, status }),
      });
      if (!res.ok) throw new Error(`advance ${res.status}`);
      // Remember the move only once it LANDED (a failed one has nothing to
      // undo); an undo clears the offer rather than offering to undo the
      // undo. `to` is kept so the offer can be withdrawn if the reload shows
      // somebody else moved the job in between (final review).
      setLastMove(undo ? null : { jobId: job.id, from: job.status, to: status });
      await load();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(null);
    }
  }

  /** Take an unclaimed request for themselves. A 409 means someone else got
   *  there first: say so, and reload so it leaves the list. */
  async function take(job: StringerJob) {
    if (busy || !online) return;
    setBusy(job.id);
    setSaveError(false);
    setTakenElsewhere(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: job.memberId, claim: true }),
      });
      if (res.status === 409) setTakenElsewhere(true);
      else if (!res.ok) throw new Error(`take ${res.status}`);
      await load();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(null);
    }
  }

  // The Stringing tab's RevealSlot holds this place; with no jobs it closes.
  useRevealReady(!hasIdentity || refused || loadError || jobs !== null);
  if (!hasIdentity || refused) return null;
  /* NO OUTER CARD (Stringing canvas, 2026-11-12; Grant: "Remove the outer
     card"). The list is a plain section heading over one card per racket, so
     each job is its own fill-only card on the tab's ground instead of a card
     nested in a card. The error and the empty answer sit under the same
     heading in a card of their own, so the section reads the same in every
     state. */
  if (loadError) {
    return (
      <section className="flex flex-col gap-3 motion-fade" aria-label={t('stringerTitle')}>
        <QueueHeading title={t('stringerTitle')} />
        <div className="glass-card">
          <ErrorState
            message={t('stringerError')}
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
                {t('stringerRetry')}
              </button>
            }
          />
        </div>
      </section>
    );
  }
  // No work is the normal state for most people and deserves no card at all —
  // including everyone who is not a stringer, who gets an empty list. As the
  // Bench register it is a stringer's whole screen, so it says so.
  if (!jobs || (jobs.length === 0 && unclaimed.length === 0)) {
    if (!showEmpty || !jobs) return null;
    return (
      <section className="flex flex-col gap-3 motion-fade" aria-label={t('stringerTitle')}>
        <QueueHeading title={t('stringerTitle')} />
        <div className="glass-card">
          <EmptyState icon="sports_tennis">{t('stringerEmpty')}</EmptyState>
        </div>
      </section>
    );
  }

  // "5 assigned to you · 1 late" — late by the same rule the card's due line
  // uses, so the count and the red lines below it always agree.
  const late = jobs.filter((job) => dueFor({ readyBy: job.readyBy, status: job.status, paidAt: 'unknown' }, today).key === 'overdue').length;
  const summary = [
    t('stringerAssigned', { count: jobs.length }),
    late > 0 ? t('stringerLate', { count: late }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className="flex flex-col gap-3 motion-fade" aria-label={t('stringerTitle')}>
      {/* With requests nobody has taken listed too, "N assigned to you" would
          sit over jobs assigned to nobody; each list carries its own label. */}
      <QueueHeading title={t('stringerTitle')} subtitle={unclaimed.length > 0 ? undefined : summary} />
      {saveError && <p className="field-error" role="alert">{t('stringerSaveError')}</p>}
      {takenElsewhere && <p className="field-warn" role="alert">{t('unclaimedTaken')}</p>}
      {unclaimed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <span className="section-label-muted">{t('unclaimedTitle')}</span>
          {unclaimed.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              today={today}
              holes={holes.forLabel(job.racketLabel).holes}
              waitingDays={isWaitingTooLong(job) ? waitingDays(job) : null}
              action={
                <button
                  type="button"
                  className="cc-btn cc-btn-secondary"
                  style={{ flex: 1 }}
                  disabled={busy !== null || !online}
                  onClick={() => void take(job)}
                >
                  {t('unclaimedTake')}
                </button>
              }
            />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {unclaimed.length > 0 && jobs.length > 0 && (
          <span className="section-label-muted">{t('assignedTitle')}</span>
        )}
        {jobs.map((job) => {
          const stage = toneStageOf(job);
          // Waiting on the player: nothing to do until they answer, so no
          // next step and no undo — a "Mark strung" here would string the
          // racket the player has not agreed to.
          const waiting = stage === 'waiting';
          const nextStatus = waiting ? null : nextStatusOf(job.status, STRINGING_FLOW);
          const undoable = !waiting && lastMove?.jobId === job.id && job.status === lastMove.to;
          return (
            <StringerJobCard
              key={job.id}
              job={job}
              stage={stage}
              today={today}
              holes={holes.forLabel(job.racketLabel).holes}
              action={nextStatus || undoable ? (
                <>
                  {nextStatus && (
                    <button
                      type="button"
                      className="cc-btn cc-btn-secondary"
                      style={{ flex: 1 }}
                      disabled={busy !== null || !online}
                      onClick={() => void advance(job, nextStatus)}
                    >
                      {/* The status WORD from the locale, not the key: "Mark
                          picked up" happened to read fine in English and
                          rendered "标记为ready" in Chinese (audit 2026-10-11, finding 08). */}
                      {t('stringerAdvance', { status: t(`next.${nextStatus}`) })}
                    </button>
                  )}
                  {/* Only while the job still sits where THIS card put it: if
                      the admin moved it on in between, undo would revert their move. */}
                  {undoable && (
                    <button
                      type="button"
                      className="cc-btn cc-btn-ghost"
                      disabled={busy !== null || !online}
                      onClick={() => void advance(job, lastMove!.from, true)}
                    >
                      {t('stringerUndo')}
                    </button>
                  )}
                </>
              ) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

/** The section's name in the label style, with the count under it. */
function QueueHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: '0 var(--space-1)' }}>
      <h3 className="section-label-muted" style={{ margin: 0, color: 'var(--text-secondary)' }}>{title}</h3>
      {subtitle && (
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{subtitle}</p>
      )}
    </div>
  );
}

/**
 * One racket in a stringer's queue.
 *
 *   racket · J-number                       [icon  status]
 *   ▬▬ ▬▬ ▬▬ ▬▬   Received · Strung · Ready · Picked up
 *   string · colour · tension · holes · for <name>
 *   when it is due (muted / amber soon / red late)
 *   what the player is being asked, while they are — or the next step
 *
 * Drawn here rather than through `JobCard` because the queue is where Grant
 * could not tell the statuses apart: each status now has its own hue and
 * glyph (`lib/stringingStatusTone.ts`) and a bar that says how far along the
 * racket is, where the bench's pill had four tones for five statuses. The
 * spec and due lines are `JobCard`'s, word for word.
 */
function StringerJobCard({ job, stage, today, holes, action }: {
  job: StringerQueueJob;
  stage: ToneStage;
  today: string;
  holes: number | null;
  action?: ReactNode;
}) {
  const t = useTranslations('home.stringing');
  const tAdmin = useTranslations('admin.stringing');
  const locale = useLocale();
  const look = stageLook(stage);
  const filled = progressFilled(job.status);

  const spec = [
    job.stringLabel,
    job.stringColor,
    `${job.tensionMains}/${job.tensionCrosses} ${tAdmin('lb')}`,
    holes !== null ? tAdmin('holes.holesValue', { count: holes }) : null,
    t('stringerFor', { name: job.memberName }),
  ].filter(Boolean).join(' · ');

  // A stringer's projection carries no money, so payment is "unknown" and a
  // ready racket shows its date, never "unpaid" (as on `JobCard`).
  const due = dueFor({ readyBy: job.readyBy, status: job.status, paidAt: 'unknown' }, today);
  const dueText =
    due.key === 'pickedUp' ? null
      : due.key === 'overdue' ? tAdmin('due.overdue', { days: due.days ?? 0 })
        : due.key === 'onDate' ? (formatReadyBy(due.date, locale) ?? tAdmin('due.noDate'))
          : tAdmin(`due.${due.key}`);

  const label = stage === 'waiting'
    ? t('stringerStage.waiting', { name: job.memberName })
    : t(`stringerStage.${stage}`);

  return (
    <div className="glass-card" data-testid="stringer-job" data-stage={stage}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', minWidth: 0 }}>
            <span className="fs-md" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.racketLabel}
            </span>
            <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flex: 'none' }}>
              {job.jobNo}
            </span>
          </span>
          <StagePill stage={stage} label={label} testId="stringer-job-status" />
        </div>
        {/* Received · Strung · Ready · Picked up, filled to where the racket
            is. Decoration: the pill above already says the status in words. */}
        <div
          aria-hidden="true"
          data-testid="stringer-job-progress"
          data-filled={filled}
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
        {/* A walk-up's contact rides on this, the stringer's OWN queue, only:
            they are the one who tells them it is ready. */}
        <JobSpecLine spec={spec} walkUp={job.walkUp} contact={job.walkUpContact} />
        {dueText && <span className="fs-sm" style={dueStyle(due.tone)}>{dueText}</span>}
        {stage === 'waiting' && (
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
            <WaitingLine job={job} />
          </span>
        )}
        {action && (
          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

/** What the player is being asked, when the projection says; otherwise only
 *  that they are being asked. Never the price — a stringer sees no money. */
function WaitingLine({ job }: { job: StringerQueueJob }) {
  const t = useTranslations('home.stringing');
  const tAdmin = useTranslations('admin.stringing');
  const edit = job.pendingEdit;
  const parts: string[] = [];
  if (edit?.racketTo && edit.racketFrom) parts.push(t('stringerChangePart', { to: edit.racketTo, from: edit.racketFrom }));
  if (edit?.stringTo && edit.stringFrom) parts.push(t('stringerChangePart', { to: edit.stringTo, from: edit.stringFrom }));
  if (edit?.tensionTo && edit.tensionFrom) {
    parts.push(t('stringerChangePart', {
      to: `${edit.tensionTo} ${tAdmin('lb')}`,
      from: `${edit.tensionFrom} ${tAdmin('lb')}`,
    }));
  }
  if (parts.length === 0) return <>{t('stringerWaitingGeneric', { name: job.memberName })}</>;
  return <>{t('stringerWaitingChange', { change: parts.join(', '), name: job.memberName })}</>;
}
