'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { dueFor, todayIso, formatReadyBy, type DueTone } from '@/lib/stringingDue';
import type { StringingStatus } from '@/lib/stringing';
import type { StringingJob } from '@/lib/types';
import SwipeRow from '@/components/primitives/SwipeRow';
import ActionRow from '@/components/primitives/ActionRow';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { isBillable } from '@/lib/stringingBilling';
import StringingJobDetail from './StringingJobDetail';
import StringingIntake from './StringingIntake';
import OfferedStringsCard from './OfferedStringsCard';
import PricingCard from './PricingCard';

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

/** Chip tone per status. Mirrors the design's TONE table. */
/** Urgency colour for the due column. Separate from the status chip: a job can
 *  be `received` (neutral) and overdue (red) at the same time, which is exactly
 *  the pair a stringer scans for. */
const DUE_FG: Record<DueTone, string> = {
  overdue: 'var(--sev-crit-text, var(--color-red))',
  soon: 'var(--pill-waitlist-text)',
  ok: 'var(--text-secondary)',
  done: 'var(--text-muted)',
};

const TONE: Record<StringingStatus, { bg: string; fg: string }> = {
  requested: { bg: 'var(--pill-unpaid-bg)', fg: 'var(--pill-unpaid-text)' },
  received: { bg: 'var(--pill-waitlist-bg)', fg: 'var(--pill-waitlist-text)' },
  strung: { bg: 'var(--pill-waitlist-bg)', fg: 'var(--pill-waitlist-text)' },
  ready: { bg: 'var(--pill-paid-bg)', fg: 'var(--pill-paid-text)' },
  picked_up: { bg: 'var(--pill-unpaid-bg)', fg: 'var(--pill-unpaid-text)' },
};

interface Props {
  onBack: () => void;
}

export default function StringingPage({ onBack }: Props) {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  const [jobs, setJobs] = useState<StringingJob[] | null>(null);
  // Tri-state, not `jobs ?? []`. A failed load must never render as an empty
  // bench — that is the lying-empty-state rule, and on this screen it would
  // mean a stringer believing they have no rackets to string.
  const [loadError, setLoadError] = useState(false);
  const [mine, setMine] = useState(false);
  const [view, setView] = useState<'bench' | 'detail' | 'new' | 'archive'>('bench');
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

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs${mine ? '?mine=true' : ''}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`stringing jobs ${res.status}`);
      const data = await res.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      setJobs(null);
      setLoadError(true);
    }
  }, [mine]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/shop`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setShopOpen(typeof d.open === 'boolean' ? d.open : null);
      })
      .catch(() => {
        /* stays null — unknown, not closed */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleShop() {
    if (shopBusy || !online || shopOpen === null) return;
    setShopBusy(true);
    try {
      const res = await fetch(`${BASE}/api/stringing/shop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open: !shopOpen }),
      });
      if (res.ok) setShopOpen((await res.json()).open === true);
    } catch {
      /* leave the sign as it was rather than claiming a change that failed */
    } finally {
      setShopBusy(false);
    }
  }

  const loadArchive = useCallback(async () => {
    setArchiveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs?archived=true`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`stringing archive ${res.status}`);
      const data = await res.json();
      setArchivedJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      // Same tri-state as the bench: null + error, never `[]`. An empty
      // archive and an unreachable one must not look identical.
      setArchivedJobs(null);
      setArchiveError(true);
    }
  }, []);

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
      await Promise.all([load(), view === 'archive' ? loadArchive() : Promise.resolve()]);
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
    const tone = TONE[job.status] ?? TONE.requested;
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
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', minWidth: 0 }}>
                {pinned && (
                  <span className="material-icons icon-xs" style={{ color: 'var(--accent)' }}>
                    star
                  </span>
                )}
                <span className="fs-lg" style={{ fontWeight: 600 }}>{job.memberName}</span>
                <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {job.jobNo}
                </span>
              </span>
              <span
                className="fs-2xs"
                style={{
                  flex: '0 0 auto',
                  fontWeight: 600,
                  padding: 'var(--space-2) var(--space-4)',
                  borderRadius: 'var(--radius-pill)',
                  background: tone.bg,
                  color: tone.fg,
                }}
              >
                {t(`status.${job.status}`)}
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
                style={{ pointerEvents: 'auto', flex: '0 0 auto', color: 'var(--ink-faint)' }}
              >
                <span className="material-icons icon-md">more_vert</span>
              </button>
            </div>
            <div className="fs-md" style={{ color: 'var(--text-secondary)' }}>{job.racketLabel}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-faint)' }}>
                {job.stringLabel} · {job.tensionMains}/{job.tensionCrosses}{t('lb')}
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
                <span className="fs-sm" style={{ fontWeight: 600, color: DUE_FG[due.tone] }}>
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
          onBack={() => setView('bench')}
          onChanged={() => void load()}
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
  const actionSheet = (
    <BottomSheet
      open={actionTarget !== null}
      onClose={() => {
        setActionTarget(null);
        setActionError(false);
        setConfirmingDelete(false);
        setDeleteError(false);
      }}
      ariaLabel={t('actions.title')}
      maxHeight="50vh"
      width="narrow"
    >
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
          {actionTarget?.memberName ?? ''}
        </span>
        <button
          type="button"
          onClick={() => {
            setActionTarget(null);
            setActionError(false);
            setConfirmingDelete(false);
            setDeleteError(false);
          }}
          aria-label={t('actions.close')}
          style={{ minWidth: 44, minHeight: 44 }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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
        <AdminBackHeader onBack={() => setView('bench')} title={t('archive.title')} />
        <div className="flex flex-col gap-4 px-4 pb-6">
          {archiveError && <ErrorState message={t('archive.loadError')} />}
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

  if (view === 'new') {
    return (
      <div className="animate-slideInRight">
        <StringingIntake
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
    <div>
      <AdminBackHeader onBack={onBack} title={t('benchTitle')} />
      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* The shop sign. Separate from NEXT_PUBLIC_FLAG_STRINGING on purpose:
            that says whether this code exists, this says whether Grant is
            taking rackets this week. Closing does NOT stop the bench — jobs in
            flight still need finishing and a walk-up can still be logged. */}
        <div
          className="glass-card p-5 space-y-3"
          style={
            shopOpen
              ? { background: 'var(--banner-green-bg)', borderColor: 'var(--banner-green-border)' }
              : undefined
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <span
              className="material-icons icon-md"
              style={{ color: shopOpen ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {shopOpen ? 'check_circle' : 'lock'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bpm-h3 m-0">
                {shopOpen === null ? t('shop.unknown') : shopOpen ? t('shop.open') : t('shop.closed')}
              </div>
              <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: 'var(--space-05) 0 0' }}>
                {shopOpen === null
                  ? t('shop.unknownHint')
                  : shopOpen
                    ? t('shop.openHint')
                    : t('shop.closedHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleShop}
              disabled={shopBusy || !online || shopOpen === null}
              className={`cc-btn ${shopOpen ? 'cc-btn-secondary' : 'cc-btn-primary'}`}
            >
              {shopOpen ? t('shop.closeCta') : t('shop.openCta')}
            </button>
          </div>
        </div>

        {/* What the club stocks — the list behind the request form's dropdown.
            Sits with the shop sign because both are "how the service is set
            up" rather than "what is on the bench right now". */}
        <OfferedStringsCard />

        {/* The rate card players read behind "View pricing" on Home. */}
        <PricingCard />

        {/* Mine / All. The wrapper needs `flex` and each tab `flex-1` —
            .segment-control sets no display, so without it the active pill
            overlaps its neighbour. */}
        <div className="segment-control flex">
          <button
            type="button"
            onClick={() => setMine(true)}
            className={`flex-1 flex items-center justify-center ${mine ? 'segment-tab-active' : 'segment-tab-inactive'}`}
          >
            {t('mine')}
          </button>
          <button
            type="button"
            onClick={() => setMine(false)}
            className={`flex-1 flex items-center justify-center ${mine ? 'segment-tab-inactive' : 'segment-tab-active'}`}
          >
            {t('all')}
          </button>
        </div>

        {loadError && <ErrorState message={t('loadError')} />}
        {!loadError && jobs === null && <AdminPageSkeleton />}
        {!loadError && jobs !== null && jobs.length === 0 && (
          /* The bench list IS this page's content; the segment control and
             Add job are chrome around it. A 13px muted line wedged between two
             chunky controls at 16px each read as a layout gap rather than an
             answer. */
          <EmptyState icon="sports_tennis">{mine ? t('emptyMine') : t('empty')}</EmptyState>
        )}

        {jobs?.map((job) => renderJob(job, false))}

        <button
          type="button"
          onClick={() => setView('new')}
          disabled={!online}
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%' }}
        >
          {t('addJob')}
        </button>

        {/* Always rendered, even at zero and even when the count is unknown.
            Hiding the way back to archived work when the archive fails to load
            would be the lying-empty-state rule again — and the one thing an
            archive must never do is become unreachable. */}
        <button
          type="button"
          onClick={() => setView('archive')}
          className="cc-btn cc-btn-ghost"
          style={{ width: '100%' }}
        >
          {archivedJobs === null
            ? t('archive.openUnknown')
            : t('archive.open', { count: archivedJobs.length })}
        </button>
      </div>
      {actionSheet}
    </div>
  );
}
