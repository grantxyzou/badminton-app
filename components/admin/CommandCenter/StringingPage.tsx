'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePageBack } from '@/lib/pageStack';
import { popView, pushView, topView } from '@/lib/viewTrail';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { dueFor, todayIso } from '@/lib/stringingDue';
import { isWaitingTooLong, waitingDays } from '@/lib/stringingWaiting';
import { fmtMoney } from '@/lib/fmt';
import { STRINGING_FLOW, isWalkUpJob, type StringingStatus } from '@/lib/stringing';
import JobCard, { JobsHeading, nextStatusOf } from '@/components/stringing/JobCard';
import { toPlayerPendingEdit } from '@/lib/stringingPendingEdit';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';
import type { StringingJob } from '@/lib/types';
import SwipeRow from '@/components/primitives/SwipeRow';
import ActionRow from '@/components/primitives/ActionRow';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { isBillable } from '@/lib/stringingBilling';
import StringingJobDetail from './StringingJobDetail';
import StringingIntake from './StringingIntake';
import StringShelfCard from './StringShelfCard';
import OtherPricesCard from './OtherPricesCard';
import HoleCountsCard from './HoleCountsCard';
import { useHoleLookup } from '@/components/stringing/useHoleLookup';
import { StateLink } from '@/components/primitives/StateCard';
import RegisterSwitch from '@/components/primitives/RegisterSwitch';
import ListRow from '@/components/primitives/ListRow';
import { StringingAside, useStringingAside } from '@/components/stringing/StringingAside';
import { PaneDetail } from '@/components/primitives/PaneDetail';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The bench — screen 2a of the Stringing design, plus the two screens it
 * opens.
 *
 * Kept as one page with an internal view rather than three `AdminView`
 * entries, because the three share one job list: coming back from a detail
 * must not refetch and must not lose the Mine/All choice. That is the same
 * reason `SetupPage` owns its sub-views.
 *
 * ADMIN-ONLY BY CONSTRUCTION. Every price on this screen is exact, which is
 * precisely what the player API strips. Nothing here is reachable without the
 * admin cookie, and the routes re-check the role on every request rather than
 * trusting that.
 */

/* Status pills live in components/stringing/StagePill.tsx (colours: lib/stringingStatusTone.ts) and the due
   column's colours in lib/stringingDue.ts (`dueStyle`), shared with a
   stringer's own queue. The two are separate on purpose: a job can be
   `received` (neutral) and overdue (red) at once, which is exactly the pair a
   stringer scans for. */

interface Props {
  onBack: () => void;
  /** The header's crumb: "Admin" from the Command Center, "Stringing" from the tab. */
  crumb?: string;
  /** Rendered as the Stringing tab's Bench register (docs/plans/stringing-tabs.md):
   *  the bench itself has no Back header there, because the tab's own header
   *  and register switch already say where you are. */
  embedded?: boolean;
  /** Called with `true` while a sub-screen (a job, intake, the archive,
   *  set-up) stands in for the whole tab, so the tab hides its chrome around
   *  it, and with `false` when the bench is back. */
  onTakeover?: (on: boolean) => void;
}

export default function StringingPage({ onBack, crumb, embedded = false, onTakeover }: Props) {
  const t = useTranslations('admin.stringing');
  // The next-step words, shared with a stringer's queue, live with the player copy.
  const tPlayer = useTranslations('home.stringing');
  const online = useOnline();
  const [jobs, setJobs] = useState<StringingJob[] | null>(null);
  // Tri-state, not `jobs ?? []`. A failed load must never render as an empty
  // bench — that is the lying-empty-state rule, and on this screen it would
  // mean a stringer believing they have no rackets to string.
  const [loadError, setLoadError] = useState(false);
  const [mine, setMine] = useState(false);
  /* The bench's own pages, a TRAIL (docs/plans/back-navigation.md): Archive →
     a job → Back returns to the Archive, and a job → Add holes → Back to the
     job. Each Back used to land on the bench. */
  type BenchView = 'bench' | 'detail' | 'new' | 'archive' | 'setup';
  const [views, setViews] = useState<BenchView[]>([]);
  const view: BenchView = topView(views, 'bench');
  const setView = useCallback((next: BenchView) => setViews((v) => pushView(v, next, 'bench')), []);
  const back = useCallback(() => setViews(popView), []);
  // Each job's grommet holes, matched from its racket label (docs/plans/grommet-holes.md, Phase 4).
  const holes = useHoleLookup();
  // A racket to open the Set-up screen's hole-count card on, from a job's "Add a hole count".
  const [holesPreset, setHolesPreset] = useState<string | null>(null);
  // Inside the admin trail (or the Stringing tab), so one level deeper.
  usePageBack(views.length > 0, () => {
    if (view === 'setup') { setHolesPreset(null); holes.reload(); }
    back();
  }, 1);
  /* Mine/All is only worth a control when somebody else strings too. Read off
     an ALL load — the jobs already on screen, so it arrives in the same frame
     as the list instead of one request later, pushing it down — and kept once
     true, so switching to Mine (fewer stringers on screen) never hides it. */
  const [multiStringer, setMultiStringer] = useState(false);
  /* The archive is its OWN list with its own loader, rather than a flag folded
     into `load`. Folding it in would put `view` in load's dependency array, and
     coming back from a detail screen would then refetch — the exact thing this
     page is structured to avoid. */
  const [archivedJobs, setArchivedJobs] = useState<StringingJob[] | null>(null);
  const [archiveError, setArchiveError] = useState(false);
  /* One target at a time, so only one sheet can ever be open — same shape as
     PaymentsCard's per-row menu. */
  const [actionTarget, setActionTarget] = useState<StringingJob | null>(null);
  /** The job a card's own next-step button is moving, and whether it failed. */
  const [moving, setMoving] = useState<string | null>(null);
  const [moveError, setMoveError] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  /* Two-step, in-sheet. Reset every time the sheet opens, so a confirm armed
     against one job can never be fired at the next one. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* On a foldable the bench has a right page (docs/plans/foldable-layout.md):
     a tapped job opens there, beside the list, instead of in place of it,
     and before any tap the job at the top of the list is open. `null` on
     one screen, where opening a job is the page it always was. */
  const aside = useStringingAside();
  // null = UNKNOWN (throttled or failed), not closed. Rendering a CLOSED sign
  // on a shop that is open is the confident-wrong answer, so unknown says so.
  const [shopOpen, setShopOpen] = useState<boolean | null>(null);
  const [shopBusy, setShopBusy] = useState(false);
  // A flip that failed says so. Leaving the sign as it was is right; leaving it
  // without a word read as the tap not registering.
  const [shopToggleError, setShopToggleError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs${mine ? '?mine=true' : ''}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`stringing jobs ${res.status}`);
      const data = await res.json();
      // Only the BENCH answer is the bench. An admin whose admin_session
      // lapsed still has a member_session, and the route then answers their
      // own jobs as `view: 'player'`; shown here, that read as an empty bench.
      if (data?.view !== 'bench') throw new Error(`stringing jobs: ${String(data?.view)} view`);
      const list: StringingJob[] = Array.isArray(data.jobs) ? data.jobs : [];
      setJobs(list);
      if (!mine && new Set(list.map((j) => j.stringerId).filter(Boolean)).size > 1) setMultiStringer(true);
    } catch {
      setJobs(null);
      setLoadError(true);
    }
  }, [mine]);

  useEffect(() => {
    void load();
  }, [load]);

  // `shopOpen` null is "not known yet"; `shopReadFailed` separates a read that
  // FAILED from one still in flight. They used to share null, so the sign said
  // "we couldn't check" while the request was merely loading, and a real
  // failure told the admin to refresh with nothing to tap.
  const [shopReadFailed, setShopReadFailed] = useState(false);
  const [shopAttempt, setShopAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/shop`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`shop ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (typeof d?.open === 'boolean') setShopOpen(d.open);
        else setShopReadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setShopReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shopAttempt]);

  async function toggleShop() {
    if (shopBusy || !online || shopOpen === null) return;
    setShopBusy(true);
    setShopToggleError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/shop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open: !shopOpen }),
      });
      if (!res.ok) throw new Error(`shop toggle ${res.status}`);
      setShopOpen((await res.json()).open === true);
    } catch {
      // Leave the sign as it was rather than claim a change that failed, and
      // say so.
      setShopToggleError(true);
    } finally {
      setShopBusy(false);
    }
  }

  const loadArchive = useCallback(async () => {
    setArchiveError(false);
    try {
      // Honours Mine/All like the bench does. An admin filtered to "Mine"
      // reading a global archive count underneath it is the two halves of one
      // screen answering different questions.
      const res = await fetch(
        `${BASE}/api/stringing/jobs?archived=true${mine ? '&mine=true' : ''}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`stringing archive ${res.status}`);
      const data = await res.json();
      // Same rule as the bench: the player branch ignores `archived=true`.
      if (data?.view !== 'bench') throw new Error(`stringing archive: ${String(data?.view)} view`);
      setArchivedJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      // Same tri-state as the bench: null + error, never `[]`. An empty
      // archive and an unreachable one must not look identical.
      setArchivedJobs(null);
      setArchiveError(true);
    }
  }, [mine]);

  // Fetched up front so the "Archived (N)" entry can carry an honest number.
  // One extra request on a low-traffic admin screen buys a row that says how
  // much is behind it instead of making the stringer open it to find out.
  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  /** Archive / pin. Both are plain PATCH fields — neither moves the job along
   *  the bench, so neither notifies the player. */
  async function patchJob(job: StringingJob, body: Record<string, unknown>) {
    if (actionBusy || !online) return;
    setActionBusy(true);
    setActionError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: job.memberId, ...body }),
      });
      if (!res.ok) throw new Error(`patch ${res.status}`);
      setActionTarget(null);
      /* BOTH lists, always. Archiving happens mostly FROM the bench, and
         skipping the archive reload there left the "Archived (N)" count stale
         and the job missing from the archive the admin taps into a second
         later — which is precisely the honest count this row was added for. */
      await Promise.all([load(), loadArchive()]);
    } catch {
      // The sheet STAYS OPEN saying so. Closing on failure would look like it
      // worked, which is the lying-empty-state rule wearing a different hat.
      setActionError(true);
    } finally {
      setActionBusy(false);
    }
  }

  // Either list: a job opened FROM the archive is not in `jobs`, and looking
  // only there would land on a blank detail screen.
  /** Destroy the record. Only reachable from the archive, and only after the
   *  second tap — see the confirm row in the sheet. */
  async function deleteJob(job: StringingJob) {
    if (actionBusy || !online) return;
    setActionBusy(true);
    setDeleteError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: job.memberId, confirm: true }),
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
      setActionTarget(null);
      setConfirmingDelete(false);
      await Promise.all([load(), loadArchive()]);
    } catch {
      setDeleteError(true);
    } finally {
      setActionBusy(false);
    }
  }

  const selected =
    jobs?.find((j) => j.id === selectedId) ??
    archivedJobs?.find((j) => j.id === selectedId) ??
    null;
  // A detail view whose job is gone renders the bench, so it is not a takeover.
  // A job opens as its own page on one screen, and an archived one anywhere;
  // on a foldable an open job opens on the right page and the bench stays.
  const detailAsPage = view === 'detail' && selected !== null && !aside;
  // On a foldable nothing takes the tab over: every page the bench opens —
  // a job, a new job, the archive, set-up — opens on the right page.
  const takingOver = !aside && view !== 'bench' && !(view === 'detail' && !detailAsPage);
  /* The right page's job: the one tapped, while it is still on the list; the
     job at the top of the list before any tap (the list's own order, so the
     first thing the bench asks of you is what is open). */
  const asideJob =
    aside && jobs && jobs.length > 0 ? (jobs.find((j) => j.id === selectedId) ?? jobs[0]) : null;
  // Whether the right page is showing that job (and not a page the bench opened).
  const rightShowsJob = view === 'bench' || (view === 'detail' && typeof selected?.archivedAt !== 'string');
  useEffect(() => {
    onTakeover?.(takingOver);
  }, [takingOver, onTakeover]);
  // Released on unmount: switching register away must never leave the tab's
  // chrome hidden.
  useEffect(() => () => onTakeover?.(false), [onTakeover]);
  // Resolved once per render rather than per row, so every row on the screen
  // agrees about what day it is even if the render straddles midnight.
  const today = todayIso();

  /**
   * One bench row, used by BOTH the bench and the archive.
   *
   * The card is a `div` rather than a `button` now: it has to contain the
   * menu button, and a button inside a button is invalid HTML. Full-row tap is
   * kept by an absolutely-positioned overlay button, with the content layer
   * `pointer-events: none` above it and the menu button opting back in. That is
   * the same shape `PaymentsCard` arrived at.
   */
  /** The next step from the card itself — the one tap a bench is for. A
   *  status move notifies the player (the route does), like the job screen's. */
  async function advance(job: StringingJob, status: StringingStatus) {
    if (moving || !online) return;
    setMoving(job.id);
    setMoveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: job.memberId, status }),
      });
      if (!res.ok) throw new Error(`advance ${res.status}`);
      await Promise.all([load(), loadArchive()]);
    } catch {
      setMoveError(true);
    } finally {
      setMoving(null);
    }
  }

  async function markPaid(job: StringingJob) {
    if (moving || !online) return;
    setMoving(job.id);
    setMoveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: job.memberId, paid: true }),
      });
      if (!res.ok) throw new Error(`paid ${res.status}`);
      await loadArchive();
    } catch {
      setMoveError(true);
    } finally {
      setMoving(null);
    }
  }

  /** Opens a job: as its page on one screen. On a foldable an open job opens
   *  on the right page and anything else open there (a new job, set-up, the
   *  archive) closes; an archived job opens over the archive, which is where
   *  its Back returns. */
  function openJob(job: StringingJob, inArchive: boolean) {
    setSelectedId(job.id);
    if (!aside || inArchive) { setView('detail'); return; }
    if (view === 'setup') { setHolesPreset(null); holes.reload(); }
    setViews([]);
  }

  function renderJob(job: StringingJob, inArchive: boolean) {
    const pinned = typeof job.prioritizedAt === 'string';
    // Exactly `isBillable`: finished, priced and unpaid. Shown only in the
    // archive, where the whole risk is money quietly going out of sight.
    const owed = isBillable(job) ? (job.priceCents ?? 0) / 100 : null;
    /* Waiting on the player (a proposed change they have not answered): no
       next step, as on the stringer's card — "Mark strung" here would string
       the racket the player has not agreed to. */
    const waiting = !!job.pendingEdit;
    const next = inArchive || waiting ? null : nextStatusOf(job.status, STRINGING_FLOW);

    return (
      <SwipeRow
        key={job.id}
        enabled={online}
        leadingAction={
          inArchive
            ? undefined
            : {
                icon: pinned ? 'star_border' : 'star',
                label: t(pinned ? 'swipe.unpin' : 'swipe.pin'),
                tone: 'accent',
                onAction: () => void patchJob(job, { prioritized: !pinned }),
              }
        }
        trailingAction={{
          icon: inArchive ? 'unarchive' : 'archive',
          label: t(inArchive ? 'swipe.unarchive' : 'swipe.archive'),
          tone: 'neutral',
          onAction: () => void patchJob(job, { archived: !inArchive }),
        }}
      >
        <JobCard
          job={job}
          today={today}
          holes={holes.forLabel(job.racketLabel).holes}
          pinned={pinned}
          owed={inArchive ? owed : null}
          waitingDays={!inArchive && isWaitingTooLong(job) ? waitingDays(job) : null}
          /* The player's own diff (racket, string, tension); the card's line
             never reads its price. */
          pendingChange={waiting ? toPlayerPendingEdit(job) : null}
          /* Its own card on the bench, in the stringer's card style (the
             canvas, 2026-11-12); still the inner tint inside the archive's
             list card. */
          surface={inArchive ? 'inner' : 'card'}
          onOpen={() => openJob(job, inArchive)}
          open={!inArchive && rightShowsJob && asideJob?.id === job.id}
          openLabel={t('actions.open')}
          more={
            <button
              type="button"
              onClick={() => {
                setActionTarget(job);
                setActionError(false);
                setConfirmingDelete(false);
                setDeleteError(false);
              }}
              aria-label={t('actions.more', { name: job.memberName })}
              /* A 44px hit area, pulled in by negative margins so the glyph
                 does not move (audit 2026-10-11, A3). */
              style={{
                color: 'var(--ink-faint)',
                minWidth: 44,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: 'calc(-1 * var(--space-3)) calc(-1 * var(--space-4)) calc(-1 * var(--space-3)) 0',
              }}
            >
              <span className="material-icons icon-md">more_vert</span>
            </button>
          }
          action={
            next ? (
              <button
                type="button"
                className="cc-btn cc-btn-secondary"
                style={{ flex: 1 }}
                disabled={moving !== null || !online}
                onClick={() => void advance(job, next)}
              >
                {tPlayer('stringerAdvance', { status: tPlayer(`next.${next}`) })}
              </button>
            ) : inArchive && owed !== null ? (
              <button
                type="button"
                className="cc-btn cc-btn-secondary"
                style={{ flex: 1 }}
                disabled={moving !== null || !online}
                onClick={() => void markPaid(job)}
              >
                {t('markPaid')}
              </button>
            ) : undefined
          }
        />
      </SwipeRow>
    );
  }

  /* The intake's Recent chips: the members on the newest jobs, open or
     archived, each once. */
  const recentMembers = [...(jobs ?? []), ...(archivedJobs ?? [])]
    // A walk-up is nobody to pick again: their id is one job's, not a person's
    // (docs/plans/stringing-walk-ups.md).
    .filter((j) => !isWalkUpJob(j))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .reduce<{ id: string; name: string }[]>((acc, j) => (acc.some((m) => m.id === j.memberId) ? acc : [...acc, { id: j.memberId, name: j.memberName }]), []);

  if (detailAsPage && selected) {
    return (
      <div className="animate-slideInRight">
        <StringingJobDetail
          job={selected}
          crumb={crumb}
          onBack={back}
          onChanged={() => void load()}
          holesFor={holes.forLabel}
          onAddHoles={(catalogId) => { setHolesPreset(catalogId); setView('setup'); }}
        />
      </div>
    );
  }

  const targetPinned = typeof actionTarget?.prioritizedAt === 'string';
  const targetArchived = typeof actionTarget?.archivedAt === 'string';
  // What deleting this would take off the player's balance, if anything.
  const targetOwed =
    actionTarget && isBillable(actionTarget) ? (actionTarget.priceCents ?? 0) / 100 : null;

  /* One sheet, rendered by whichever screen is up. The gesture is the fast
     path; this is the findable one. A swipe nobody discovers is how kudos
     became unfindable — a player asked how to give one and the owner's own
     answer was wrong. */
  const closeActions = () => {
    setActionTarget(null);
    setActionError(false);
    setConfirmingDelete(false);
    setDeleteError(false);
  };
  const actionSheet = (
    <BottomSheet open={actionTarget !== null} onClose={closeActions} ariaLabel={t('actions.title')}>
      {/* Titled with the racket, the bench's unit (the canvas, 2026-10-28):
          a member with two rackets in made "Lin" ambiguous. */}
      <BottomSheetHeader onClose={closeActions} closeLabel={t('actions.close')}>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{actionTarget?.racketLabel ?? ''}</span>
          {actionTarget && (
            <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{actionTarget.jobNo}</span>
              {' · '}{tPlayer('stringerFor', { name: actionTarget.memberName })}
            </span>
          )}
        </span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {actionError && <p className="field-error" role="alert">{t('actions.error')}</p>}
          {actionTarget && !targetArchived && (
            <ActionRow
              icon={targetPinned ? 'star_border' : 'star'}
              label={t(targetPinned ? 'actions.unpin' : 'actions.pin')}
              hint={targetPinned ? undefined : t('actions.pinHint')}
              disabled={actionBusy || !online}
              onClick={() => void patchJob(actionTarget, { prioritized: !targetPinned })}
            />
          )}
          {actionTarget && (
            <ActionRow
              icon={targetArchived ? 'unarchive' : 'archive'}
              label={t(targetArchived ? 'actions.unarchive' : 'actions.archive')}
              hint={targetArchived ? undefined : t('actions.archiveHint')}
              disabled={actionBusy || !online}
              onClick={() => void patchJob(actionTarget, { archived: !targetArchived })}
            />
          )}
          {actionTarget && (
            <ActionRow
              icon="open_in_new"
              label={t('actions.open')}
              onClick={() => {
                openJob(actionTarget, typeof actionTarget.archivedAt === 'string');
                setActionTarget(null);
              }}
            />
          )}

          {/* Deleting is offered ONLY on an archived job, which is what makes
              archive the undo step. Two-step and in-sheet — not a stacked
              sheet and not window.confirm(). */}
          {actionTarget && targetArchived && !confirmingDelete && (
            <ActionRow
              icon="delete_forever"
              label={t('actions.delete')}
              hint={t('actions.deleteHint')}
              disabled={actionBusy || !online}
              destructive
              onClick={() => {
                setConfirmingDelete(true);
                setDeleteError(false);
              }}
            />
          )}
          {actionTarget && targetArchived && confirmingDelete && (
            <div className="motion-fade" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {deleteError && <p className="field-error" role="alert">{t('actions.deleteError')}</p>}
              {/* Name what goes. "This cannot be undone" tells someone it is
                  serious without telling them what they lose — and the thing
                  they can actually lose here is somebody else's money, because
                  archiving never touched the debt and this does. */}
              <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                {targetOwed !== null
                  ? t('actions.deleteConfirmOwed', {
                      name: actionTarget.memberName,
                      racket: actionTarget.racketLabel,
                      amount: fmtMoney(targetOwed),
                    })
                  : t('actions.deleteConfirm', {
                      name: actionTarget.memberName,
                      racket: actionTarget.racketLabel,
                    })}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button
                  type="button"
                  className="cc-btn cc-btn-ghost"
                  disabled={actionBusy}
                  onClick={() => setConfirmingDelete(false)}
                  style={{ flex: 1 }}
                >
                  {t('actions.deleteKeep')}
                </button>
                <button
                  type="button"
                  className="cc-btn cc-btn-danger"
                  disabled={actionBusy || !online}
                  onClick={() => void deleteJob(actionTarget)}
                  style={{ flex: 1 }}
                >
                  {actionBusy ? t('actions.deleting') : t('actions.deleteGo')}
                </button>
              </div>
            </div>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );

  // The bench's own pages: in place of the bench on one screen, on the right
  // page beside it on a foldable (where the page-open motion stands in for
  // the slide, and the bench's own ⋮ sheet is the one already mounted).
  const pageClass = aside ? undefined : 'animate-slideInRight';
  const archiveScreen = view !== 'archive' ? null : (
      <div className={pageClass}>
        <AdminBackHeader onBack={back} title={t('archive.title')} crumb={crumb} />
        <div className="flex flex-col gap-4 pb-6">
          {archiveError && (
            <ErrorState
              message={t('archive.loadError')}
              action={
                <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void loadArchive()}>
                  {t('retry')}
                </button>
              }
            />
          )}
          {!archiveError && archivedJobs === null && <AdminPageSkeleton />}
          {!archiveError && archivedJobs !== null && archivedJobs.length === 0 && (
            <EmptyState icon="inventory_2">{t('archive.empty')}</EmptyState>
          )}
          {moveError && <p className="field-error" role="alert">{t('actions.error')}</p>}
          {archivedJobs !== null && archivedJobs.length > 0 && (
            <section className="glass-card p-5 flex flex-col gap-3" aria-label={t('archive.pickedUp')}>
              <CardHeader
                compact
                icon="inventory_2"
                title={t('archive.pickedUp')}
                subtitle={t('archive.summary', { count: archivedJobs.length, owing: archivedJobs.filter((j) => isBillable(j)).length })}
              />
              {archivedJobs.map((job) => renderJob(job, true))}
            </section>
          )}
        </div>
        {!aside && actionSheet}
      </div>
  );
  if (archiveScreen && !aside) return archiveScreen;

  const setupScreen = view !== 'setup' ? null : (
      <div className={pageClass}>
        <AdminBackHeader
          onBack={() => { setHolesPreset(null); holes.reload(); back(); }}
          title={t('setupRow')}
          crumb={crumb}
        />
        {/* Its own screen (docs/plans/bench-redesign.md): folded under the
            list, it still opened three tall cards beneath the jobs. Siblings,
            never a card around cards (DESIGN.md #12). */}
        <div className="flex flex-col gap-4 pb-6">
          <StringShelfCard />
          <OtherPricesCard />
          <HoleCountsCard preset={holesPreset} />
        </div>
      </div>
  );
  if (setupScreen && !aside) return setupScreen;

  const newScreen = view !== 'new' ? null : (
      <div className={pageClass}>
        <StringingIntake
          crumb={crumb}
          recent={recentMembers}
          onBack={back}
          onCreated={() => {
            setView('bench');
            void load();
          }}
        />
      </div>
  );
  if (newScreen && !aside) return newScreen;

  const shopState = shopReadFailed ? 'unknown' : shopOpen === null ? 'checking' : shopOpen ? 'open' : 'closed';
  /* A closed shop over a bench KNOWN to be empty says both in one card, so the
     list's heading and its "Nothing on the bench." are not shown as well. Only
     the ALL list can say the bench is empty: "Mine" being empty says nothing
     about the other stringers' jobs. */
  const closedAndEmpty =
    shopState === 'closed' && !loadError && !mine && jobs !== null && jobs.length === 0;
  // "5 open · 1 late" — late by the same rule each card's due line uses, so
  // the count and the red lines under it always agree.
  const jobsSummary = (() => {
    if (!jobs || jobs.length === 0) return undefined;
    const late = jobs.filter((j) => dueFor(j, today).key === 'overdue').length;
    return late > 0 ? t('jobsSummaryLate', { open: jobs.length, late }) : t('jobsSummary', { open: jobs.length });
  })();
  const chevron = <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>;
  const toggleError = shopToggleError && <p className="field-error" role="alert">{t('shop.toggleError')}</p>;

  /* The shop's own row, last under the list (the canvas, 2026-11-12; Grant on
     the old sign: "Move to below"). Open: "Close shop", in the same quiet row
     as Archived and set-up. Being read: a skeleton the row's size, never a
     guessed button. Unreadable: says so, with the way to read it again — no
     toggle, because there is nothing to flip FROM. Closed: nothing here, the
     closed card at the top carries "Open shop". */
  const shopRow = (() => {
    if (shopState === 'open') {
      return (
        <ListRow
          onClick={() => void toggleShop()}
          disabled={shopBusy || !online || shopOpen === null}
          ariaLabel={t('shop.closeCta')}
          leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>bedtime</span>}
          title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{t('shop.closeCta')}</span>}
          subtitle={t('shop.closeHint')}
          trailing={chevron}
        />
      );
    }
    if (shopState === 'checking') {
      return (
        <div
          data-state="checking"
          role="status"
          aria-label={t('shop.checking')}
          className="cc-mini-card"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}
        >
          <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>storefront</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-hidden="true">
            <div className="shimmer-line rounded-lg" style={{ height: 12, width: '45%' }} />
            <div className="shimmer-line rounded-lg" style={{ height: 12, width: '75%', animationDelay: '120ms' }} />
          </div>
        </div>
      );
    }
    if (shopState === 'unknown') {
      return (
        <div
          data-state="unknown"
          className="cc-mini-card"
          style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}
        >
          <ListRow
            leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--sev-crit-text)' }}>error</span>}
            title={<span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('shop.unknown')}</span>}
            subtitle={
              <>
                {t('shop.unknownHint')}{' '}
                <StateLink
                  onClick={() => {
                    setShopReadFailed(false);
                    setShopAttempt((n) => n + 1);
                  }}
                >
                  {t('retry')}
                </StateLink>
              </>
            }
          />
        </div>
      );
    }
    return null;
  })();

  return (
    // Returning to the bench from a job, the archive or intake: it fades back
    // rather than cutting in (the wrapper's slide only runs on first entry).
    <div className="motion-fade">
      {!embedded && <AdminBackHeader onBack={onBack} title={t('benchTitle')} crumb={crumb} />}
      {/* No horizontal padding here. The app shell's <main> already carries
          `px-4`, and a second inset made every card on the three stringing
          screens 362px wide against the app's 394 — visibly narrower than the
          Command Center they are opened from, and than Birds next to them. */}
      <div className="flex flex-col gap-4 pb-6">
        {/* CLOSED is a card, first (Grant, 2026-11-12, on the design canvas:
            "Follow design system"): the player's closed-shop card — same
            header, the muted badge, the standing bedtime state — with "Open
            shop" as the state's one action under it. Separate from
            NEXT_PUBLIC_FLAG_STRINGING on purpose: that says whether this code
            exists, this says whether the club is taking rackets this week.
            Closing does NOT stop the bench. An OPEN shop has no row up here
            any more (the canvas, 2026-11-12; Grant: "Delete"): it is the
            small pill beside the list's heading, and "Close shop" is the last
            row on the page. */}
        {shopState === 'closed' && (
          <section
            data-state="closed"
            className="glass-card p-5 space-y-3"
            aria-label={tPlayer('title')}
          >
            {/* The player card's own header words: the same service, by the
                same name, on both sides of the counter. */}
            <CardHeader
              compact
              icon="grid_4x4"
              title={tPlayer('title')}
              badge={<StatusBadge variant="muted">{tPlayer('soon')}</StatusBadge>}
            />
            <EmptyState
              icon="bedtime"
              title={closedAndEmpty ? t('shop.closedTitleEmpty') : t('shop.closedTitle')}
              action={
                <button
                  type="button"
                  onClick={toggleShop}
                  disabled={shopBusy || !online || shopOpen === null}
                  className="cc-btn cc-btn-secondary"
                >
                  {t('shop.openCta')}
                </button>
              }
            >
              {/* Until the list says it is empty, jobs may be on it, and
                  closing never touches them — keep saying so. */}
              {closedAndEmpty ? t('shop.closedBody') : t('shop.closedBodyJobs')}
            </EmptyState>
          </section>
        )}
        {shopState === 'closed' && toggleError}

        {/* Mine / All, only with two or more stringers (see `multiStringer`).
            The same switch as the tab's registers, which marks the current
            one for a screen reader (aria-current). */}
        {multiStringer && (
          <RegisterSwitch
            views={['mine', 'all'] as const}
            value={mine ? 'mine' : 'all'}
            onChange={(v) => setMine(v === 'mine')}
            label={(v) => t(v)}
            ariaLabel={t('whoseJobs')}
          />
        )}

        {/* NO OUTER CARD (the canvas, 2026-11-12; Grant: "the card needs to be
            updated"), the stringer's list's shape (StringerJobsCard): a plain
            heading with the count — and here the shop's state beside it — over
            one card per racket on the tab's ground. The error and the empty
            answer sit under the same heading in a card of their own, so the
            section reads the same in every state. */}
        {!closedAndEmpty && (
          <section className="flex flex-col gap-3" aria-label={t('jobsTitle')}>
            <JobsHeading
              title={t('jobsTitle')}
              subtitle={loadError ? undefined : jobsSummary}
              trailing={
                shopState === 'open' ? (
                  <span data-state="open">
                    <StatusBadge variant="muted">
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-block',
                          width: 'var(--space-2)',
                          height: 'var(--space-2)',
                          marginRight: 'var(--space-2)',
                          borderRadius: 'var(--radius-pill)',
                          background: 'var(--pill-paid-text)',
                          verticalAlign: 'middle',
                        }}
                      />
                      <span aria-hidden="true">{t('shop.open')}</span>
                      <span className="sr-only">{t('shop.openSr')}</span>
                    </StatusBadge>
                  </span>
                ) : undefined
              }
            />
            {moveError && <p className="field-error" role="alert">{t('actions.error')}</p>}
            {loadError && (
              <div className="glass-card">
                <ErrorState
                  message={t('loadError')}
                  action={
                    <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
                      {t('retry')}
                    </button>
                  }
                />
              </div>
            )}
            {!loadError && jobs === null && <AdminPageSkeleton />}
            {!loadError && jobs !== null && jobs.length === 0 && (
              <div className="glass-card">
                <EmptyState icon="sports_tennis">{mine ? t('emptyMine') : t('empty')}</EmptyState>
              </div>
            )}
            {jobs !== null && jobs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {jobs.map((job) => renderJob(job, false))}
              </div>
            )}
          </section>
        )}

        {/* The page's one main action, in the app's primary pattern: the
            filled `.btn-primary`, a leading glyph, the label centred — the
            same as the player's "Submit a request" (design-system rule "A
            tab's one main action is `.btn-primary`"). */}
        <button
          type="button"
          onClick={() => setView('new')}
          disabled={!online}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <span className="material-icons icon-sm" aria-hidden="true">add</span>
          {t('addJob')}
        </button>

        {/* The ways off the bench, and the shop's own switch, as quiet rows
            with a chevron — not a full-width outlined button and a section
            eyebrow. The archive row is ALWAYS rendered, even at zero and even
            when its count is unknown: the one thing an archive must never
            become is unreachable. */}
        <div className="flex flex-col gap-2" style={{ paddingTop: 'var(--space-2)' }}>
          <ListRow
            onClick={() => setView('archive')}
            ariaLabel={archivedJobs === null ? t('archive.openUnknown') : t('archive.open', { count: archivedJobs.length })}
            leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>inventory_2</span>}
            title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{t('archive.title')}</span>}
            trailing={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--text-muted)' }}>
                {archivedJobs !== null && <span className="fs-md" style={{ fontFamily: 'var(--font-mono)' }}>{archivedJobs.length}</span>}
                <span className="material-icons icon-sm" aria-hidden="true">chevron_right</span>
              </span>
            }
          />
          <ListRow
            onClick={() => setView('setup')}
            ariaLabel={t('setupRow')}
            leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>tune</span>}
            title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{t('setupRow')}</span>}
            trailing={chevron}
          />
          {shopRow}
          {shopState !== 'closed' && toggleError}
        </div>
      </div>
      {/* The right page on a foldable: the open job, or its place while the
          list loads, so the bench does not move when it arrives. */}
      {aside && (archiveScreen || setupScreen || newScreen) ? (
        <StringingAside id={view}>{archiveScreen ?? setupScreen ?? newScreen}</StringingAside>
      ) : aside && view === 'detail' && selected && typeof selected.archivedAt === 'string' ? (
        <StringingAside id={`archived-${selected.id}`}>
          {/* Opened from the archive, so its Back returns there. */}
          <PaneDetail nested>
            <StringingJobDetail
              key={selected.id}
              job={selected}
              crumb={t('archive.title')}
              onBack={back}
              onChanged={() => void load()}
              holesFor={holes.forLabel}
              onAddHoles={(catalogId) => { setHolesPreset(catalogId); setView('setup'); }}
            />
          </PaneDetail>
        </StringingAside>
      ) : asideJob ? (
        <StringingAside id={asideJob.id}>
          <StringingJobDetail
            key={asideJob.id}
            job={asideJob}
            onChanged={() => void load()}
            holesFor={holes.forLabel}
            onAddHoles={(catalogId) => { setHolesPreset(catalogId); setView('setup'); }}
          />
        </StringingAside>
      ) : (
        aside && !loadError && jobs === null && (
          <StringingAside id="loading">
            <AdminPageSkeleton />
          </StringingAside>
        )
      )}
      {actionSheet}
    </div>
  );
}
