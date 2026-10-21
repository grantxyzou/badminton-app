'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { dueFor, dueStyle, todayIso, formatReadyBy } from '@/lib/stringingDue';
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
import StatusBadge from '@/components/primitives/StatusBadge';
import RegisterSwitch from '@/components/primitives/RegisterSwitch';
import { STATUS_TONE } from '@/components/stringing/statusTone';
import ListRow from '@/components/primitives/ListRow';

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

/* Status pill tones live in components/stringing/statusTone.ts and the due
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
  const online = useOnline();
  const [jobs, setJobs] = useState<StringingJob[] | null>(null);
  // Tri-state, not `jobs ?? []`. A failed load must never render as an empty
  // bench — that is the lying-empty-state rule, and on this screen it would
  // mean a stringer believing they have no rackets to string.
  const [loadError, setLoadError] = useState(false);
  const [mine, setMine] = useState(false);
  const [view, setView] = useState<'bench' | 'detail' | 'new' | 'archive' | 'setup'>('bench');
  // Each job's grommet holes, matched from its racket label (docs/plans/grommet-holes.md, Phase 4).
  const holes = useHoleLookup();
  // A racket to open the Set-up screen's hole-count card on, from a job's "Add a hole count".
  const [holesPreset, setHolesPreset] = useState<string | null>(null);
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
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  /* Two-step, in-sheet. Reset every time the sheet opens, so a confirm armed
     against one job can never be fired at the next one. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const takingOver = view !== 'bench' && !(view === 'detail' && !selected);
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
  function renderJob(job: StringingJob, inArchive: boolean) {
    const tone = STATUS_TONE[job.status] ?? STATUS_TONE.requested;
    const due = dueFor(job, today);
    const pinned = typeof job.prioritizedAt === 'string';
    // Exactly `isBillable`: finished, priced and unpaid. Shown only in the
    // archive, where the whole risk is money quietly going out of sight.
    const owed = isBillable(job) ? (job.priceCents ?? 0) / 100 : null;

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
        <div className="glass-card p-4" style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => {
              setSelectedId(job.id);
              setView('detail');
            }}
            aria-label={t('actions.open')}
            style={{ position: 'absolute', inset: 0 }}
          />
          <div
            style={{
              position: 'relative',
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
              {/* Grows to fill the row, so the status sits beside the menu at the
                  far edge. With three children under space-between it floated
                  in the middle of the row, aligned to nothing (Grant's
                  screenshot, 2026-10-12). */}
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flex: '1 1 auto', minWidth: 0 }}>
                {pinned && (
                  <span className="material-icons icon-xs" style={{ color: 'var(--accent)' }}>
                    star
                  </span>
                )}
                <span
                  className="fs-lg"
                  style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {job.memberName}
                </span>
                <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {job.jobNo}
                </span>
              </span>
              <span style={{ flex: '0 0 auto' }}>
                <StatusBadge variant="state" tone={tone}>{t(`status.${job.status}`)}</StatusBadge>
              </span>
              <button
                type="button"
                onClick={() => {
                  setActionTarget(job);
                  setActionError(false);
                  setConfirmingDelete(false);
                  setDeleteError(false);
                }}
                aria-label={t('actions.more', { name: job.memberName })}
                /* 18×24 measured in the browser (audit 2026-10-11, A3), under
                   the 24px floor of WCAG 2.5.8. A 44px hit area, pulled in by
                   negative margins so the glyph does not move. */
                style={{
                  pointerEvents: 'auto',
                  flex: '0 0 auto',
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
            </div>
            <div className="fs-md" style={{ color: 'var(--text-secondary)' }}>
              {job.racketLabel}
              {holes.forLabel(job.racketLabel).holes !== null && (
                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                  {' · '}{t('holes.holesValue', { count: holes.forLabel(job.racketLabel).holes as number })}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
              {/* Words in the body face, the tension in mono: mono is for data,
                  and a string's name is not. --text-muted, the secondary ink
                  the rest of the row's helper text uses. */}
              <span className="fs-sm" style={{ color: 'var(--text-muted)', minWidth: 0 }}>
                {job.stringLabel}{job.stringColor ? ` · ${job.stringColor}` : ''} ·{' '}
                <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  {job.tensionMains}/{job.tensionCrosses} {t('lb')}
                </span>
              </span>
              {/* URGENCY, not price. A bench is scanned for what is late, and
                  the exact figure lives one tap away on the detail screen —
                  where it is also the only place it belongs.

                  The archive is the one exception, and only for money still
                  outstanding: archiving does not forgive a debt, so the row
                  that hides the job has to say what it is hiding. */}
              {inArchive && owed !== null ? (
                <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--sev-warn)' }}>
                  {t('archive.stillOwed', { amount: owed.toFixed(2) })}
                </span>
              ) : (
                <span className="fs-sm" style={{ ...dueStyle(due.tone), flex: '0 0 auto' }}>
                  {/* Suppressed for a picked-up job: the status chip on the row
                      above already says "Picked up", and printing it twice in
                      one row is noise on a screen whose whole job is scanning. */}
                  {due.key === 'pickedUp'
                    ? ''
                    : due.key === 'overdue'
                      ? t('due.overdue', { days: due.days ?? 0 })
                      : due.key === 'onDate'
                        ? (formatReadyBy(due.date) ?? t('due.noDate'))
                        : t(`due.${due.key}`)}
                </span>
              )}
            </div>
          </div>
        </div>
      </SwipeRow>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <div className="animate-slideInRight">
        <StringingJobDetail
          job={selected}
          crumb={crumb}
          onBack={() => setView('bench')}
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
      <BottomSheetHeader onClose={closeActions} closeLabel={t('actions.close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
          {actionTarget?.memberName ?? ''}
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
                setSelectedId(actionTarget.id);
                setActionTarget(null);
                setView('detail');
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
                      amount: targetOwed.toFixed(2),
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

  if (view === 'archive') {
    return (
      <div className="animate-slideInRight">
        <AdminBackHeader onBack={() => setView('bench')} title={t('archive.title')} crumb={crumb} />
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
          {archivedJobs?.map((job) => renderJob(job, true))}
        </div>
        {actionSheet}
      </div>
    );
  }

  if (view === 'setup') {
    return (
      <div className="animate-slideInRight">
        <AdminBackHeader
          onBack={() => { setHolesPreset(null); holes.reload(); setView('bench'); }}
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
  }

  if (view === 'new') {
    return (
      <div className="animate-slideInRight">
        <StringingIntake
          crumb={crumb}
          onBack={() => setView('bench')}
          onCreated={() => {
            setView('bench');
            void load();
          }}
        />
      </div>
    );
  }

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
        {/* The shop sign: a status LINE, not a card (docs/plans/bench-redesign.md).
            As a green glass card it was the heaviest thing on a page named for
            the jobs under it. Still first — closing is the most consequential
            thing on this screen — but quiet. Separate from
            NEXT_PUBLIC_FLAG_STRINGING on purpose: that says whether this code
            exists, this says whether Grant is taking rackets this week.
            Closing does NOT stop the bench. The icon carries the state as well
            as the colour, never colour alone. */}
        {(() => {
          const state = shopReadFailed ? 'unknown' : shopOpen === null ? 'checking' : shopOpen ? 'open' : 'closed';
          const icon = { unknown: 'error', checking: 'storefront', open: 'check_circle', closed: 'lock' }[state];
          // Accent on this page is "Add job"'s. The icon carries the state.
          const ink = {
            unknown: 'var(--sev-crit-text)',
            checking: 'var(--text-muted)',
            open: 'var(--text-secondary)',
            closed: 'var(--text-muted)',
          }[state];
          if (state === 'checking') {
            // A skeleton the row's size while the sign is read: no guessed
            // "Open shop" button, and no "Checking…" line standing in for it.
            return (
              <div
                data-state="checking"
                role="status"
                aria-label={t('shop.checking')}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-1) 0', minHeight: 44 }}
              >
                <span className="material-icons icon-md" aria-hidden="true" style={{ color: ink }}>{icon}</span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-hidden="true">
                  <div className="shimmer-line rounded-lg" style={{ height: 12, width: '45%' }} />
                  <div className="shimmer-line rounded-lg" style={{ height: 12, width: '75%', animationDelay: '120ms' }} />
                </div>
              </div>
            );
          }
          return (
            <div
              data-state={state}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-1) 0' }}
            >
              <span className="material-icons icon-md" aria-hidden="true" style={{ color: ink }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {state === 'unknown' ? t('shop.unknown') : state === 'open' ? t('shop.open') : t('shop.closed')}
                </div>
                <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
                  {state === 'unknown' ? (
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
                  ) : state === 'open'
                    ? t('shop.openHint')
                    : t('shop.closedHint')}
                </p>
              </div>
              {/* No toggle on a sign that could not be read: there is nothing to
                  flip FROM, and a greyed Open beside "Try again" is two controls
                  where one is the answer. */}
              {state !== 'unknown' && (
                <button
                  type="button"
                  onClick={toggleShop}
                  disabled={shopBusy || !online || shopOpen === null}
                  className="cc-btn cc-btn-secondary"
                  style={{ flex: '0 0 auto' }}
                >
                  {shopOpen ? t('shop.closeCta') : t('shop.openCta')}
                </button>
              )}
            </div>
          );
        })()}

        {shopToggleError && <p className="field-error" role="alert">{t('shop.toggleError')}</p>}

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

        {loadError && (
          <ErrorState
            message={t('loadError')}
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
                {t('retry')}
              </button>
            }
          />
        )}
        {!loadError && jobs === null && <AdminPageSkeleton />}
        {!loadError && jobs !== null && jobs.length === 0 && (
          <EmptyState icon="sports_tennis">{mine ? t('emptyMine') : t('empty')}</EmptyState>
        )}

        {jobs?.map((job) => renderJob(job, false))}

        {/* The page's one accent action. */}
        <button
          type="button"
          onClick={() => setView('new')}
          disabled={!online}
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%' }}
        >
          <span className="material-icons icon-sm" aria-hidden="true">add</span>
          {t('addJob')}
        </button>

        {/* The two ways off the bench, as quiet rows with a chevron — not a
            full-width outlined button and a section eyebrow. The archive row
            is ALWAYS rendered, even at zero and even when its count is
            unknown: the one thing an archive must never become is unreachable. */}
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
            trailing={<span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
          />
        </div>
      </div>
      {actionSheet}
    </div>
  );
}
