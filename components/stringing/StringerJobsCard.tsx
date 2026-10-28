'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { STRINGING_FLOW, type StringingStatus } from '@/lib/stringing';
import { todayIso } from '@/lib/stringingDue';
import JobCard, { nextStatusOf } from './JobCard';
import type { StringerJob } from '@/lib/types';
import { isRefused } from '@/lib/apiFetch';
import { useTabReturn } from '@/lib/tabActivity';
import { useHoleLookup } from '@/components/stringing/useHoleLookup';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

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
  const [jobs, setJobs] = useState<StringerJob[] | null>(null);
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
  const holes = useHoleLookup(!!jobs && jobs.length > 0);

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
    } catch {
      setJobs(null);
      setLoadError(true);
    }
  }, [hasIdentity]);

  useEffect(() => { void load(); }, [load]);
  // Back on the bench after a while: a new request may have come in.
  useTabReturn(() => { void load(); });

  async function advance(job: StringerJob, status: StringingStatus, undo = false) {
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

  // The Stringing tab's RevealSlot holds this place; with no jobs it closes.
  useRevealReady(!hasIdentity || refused || loadError || jobs !== null);
  if (!hasIdentity || refused) return null;
  /* `compact`, like Balance and Stringing service beside it: on Home a card
     NAMES its subject in the section-label style with a muted icon. The
     default header — an 18px heading and an accent-green glyph — is the Stats
     treatment, and here it spent Home's accent on a label. */
  if (loadError) {
    return (
      <section className="glass-card p-5 space-y-3 motion-fade" aria-label={t('stringerTitle')}>
        <CardHeader compact icon="sports_tennis" title={t('stringerTitle')} />
        <ErrorState
          message={t('stringerError')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              {t('stringerRetry')}
            </button>
          }
        />
      </section>
    );
  }
  // No work is the normal state for most people and deserves no card at all —
  // including everyone who is not a stringer, who gets an empty list. As the
  // Bench register it is a stringer's whole screen, so it says so.
  if (!jobs || jobs.length === 0) {
    if (!showEmpty || !jobs) return null;
    return (
      <section className="glass-card p-5 space-y-3 motion-fade" aria-label={t('stringerTitle')}>
        <CardHeader compact icon="sports_tennis" title={t('stringerTitle')} />
        <EmptyState icon="sports_tennis">{t('stringerEmpty')}</EmptyState>
      </section>
    );
  }

  return (
    <section className="glass-card p-5 space-y-3 motion-fade" aria-label={t('stringerTitle')}>
      <CardHeader
        compact
        icon="sports_tennis"
        title={t('stringerTitle')}
        subtitle={t('stringerSubtitle')}
      />
      {saveError && <p className="field-error" role="alert">{t('stringerSaveError')}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {jobs.map((job) => {
          const nextStatus = nextStatusOf(job.status, STRINGING_FLOW);
          const undoable = lastMove?.jobId === job.id && job.status === lastMove.to;
          return (
            /* The bench's own card (JobCard), with no money on it: the
               stringer's projection carries none, so `paidAt` is left
               unknown and the card never says "unpaid". */
            <JobCard
              key={job.id}
              job={job}
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
