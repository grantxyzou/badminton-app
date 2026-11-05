'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import InviteCard from './InviteCard';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import CardHeader from '@/components/primitives/CardHeader';
import EmptyState from '@/components/primitives/EmptyState';
import ActionRow from '@/components/primitives/ActionRow';
import MemberAvatar from '@/components/primitives/MemberAvatar';
import Collapse from '@/components/primitives/Collapse';
import StatusBadge from '@/components/primitives/StatusBadge';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { sharedFetch } from '@/lib/sharedRead';
import { compareBySignup } from '@/lib/capacity';
import { membersFirstOpen } from '@/lib/membersFirst';
import { fmtSessionLabel } from '@/lib/fmt';
import { useOnline } from '@/lib/useOnline';
import {
  addPlayerByName,
  moveToWaitlist,
  promotePlayer,
  removePlayer,
  restorePlayer,
  type RowActionResult,
} from '@/lib/sessionRowActions';
import type { Session } from '@/lib/types';

/**
 * This week's sign-ups for a club that keeps its money outside the app
 * (`ClubRun.money === 'off'`, docs/plans/money-off-session-list.md).
 *
 * With money off the Command Center does not render `PaymentsCard`, which was
 * the only admin list of who signed up, so the organiser could read the list
 * on Home but not remove, add, move or restore anybody. This card is that list
 * WITHOUT money: its row type carries no amount, paid mark or cover, so no
 * money can reach a club that switched it off — by construction, not by a
 * branch someone has to remember.
 *
 * Order is `compareBySignup`, the order the capacity check, the automatic
 * promotion, "Copy list" and Home's list all use, and the waitlist is numbered
 * on from the confirmed list as Home numbers it, so the organiser and the
 * players read the same numbers.
 */

interface Player {
  id: string;
  name: string;
  timestamp?: string;
  removed?: boolean;
  removedAt?: string;
  cancelledBySelf?: boolean;
  lateCancel?: boolean;
  lateCancelHoursBefore?: number;
  waitlisted?: boolean;
  waitingForMembers?: boolean;
  /** A plus-one (docs/plans/plus-one.md): the host's memberId and the guest's own name. */
  guestOf?: string;
  guestName?: string;
}

interface SessionListCardProps {
  refreshKey?: number;
  /** Called after a change, so the session card's counts move with the list. */
  onChanged?: () => void;
}

export default function SessionListCard({ refreshKey = 0, onChanged }: SessionListCardProps) {
  const online = useOnline();
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noSession, setNoSession] = useState(false);
  // Whether the members-first window is still running, taken when the list is
  // read (nothing runs on a timer; the next read after it ends lets them in).
  const [windowOpen, setWindowOpen] = useState(false);
  const loadedRef = useRef(false);

  const [target, setTarget] = useState<Player | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    // Skeleton on the first load only; a refetch keeps the list on screen.
    if (!loadedRef.current) setLoading(true);
    try {
      // The session card reads `/api/session` in the same commit; one request
      // while in flight (lib/sharedRead.ts). The list needs the removed rows
      // too, which only `?all=true` returns, and only to an admin.
      const [sessionRes, playersRes] = await Promise.all([
        sharedFetch('/api/session'),
        sharedFetch('/api/players?all=true'),
      ]);
      // A club with no session yet is not a failure: the session card says so,
      // and this card has nothing to add to it.
      if (sessionRes.status === 404) {
        const body = (await sessionRes.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === 'no_active_session') {
          setNoSession(true);
          setSession(null);
          setPlayers([]);
          setLoadError(false);
          loadedRef.current = true;
          return;
        }
      }
      if (!sessionRes.ok || !playersRes.ok) throw new Error('session list load failed');
      const s = (await sessionRes.json()) as Session;
      const rows = (await playersRes.json()) as Player[];
      setSession(s);
      setWindowOpen(membersFirstOpen(s, Date.now()));
      setPlayers(Array.isArray(rows) ? rows : []);
      setNoSession(false);
      setLoadError(false);
      loadedRef.current = true;
    } catch {
      // Never an empty list on a failed read: an organiser would read "nobody
      // signed up" off a dropped packet (the lying-empty-state rule).
      loadedRef.current = false;
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // The console's slot holds this place until the list has answered. A club
  // with no session closes the slot: the session card above is the whole story.
  useRevealReady(!loading, noSession);

  const lists = useMemo(() => {
    const live = players.filter((p) => !p.removed);
    const confirmed = live.filter((p) => !p.waitlisted).sort(compareBySignup);
    const waiting = live.filter((p) => p.waitlisted).sort(compareBySignup);
    const cancelled = players
      .filter((p) => p.removed)
      .sort((a, b) => (b.removedAt ?? '').localeCompare(a.removedAt ?? ''));
    return { confirmed, waiting, cancelled };
  }, [players]);

  const cap = session?.maxPlayers ?? null;
  const full = cap !== null && lists.confirmed.length >= cap;
  const lateCount = lists.cancelled.filter((p) => p.lateCancel).length;

  /** After a change: the console bumps its refresh key, which reloads this card too. */
  const changed = useCallback(() => {
    if (onChanged) onChanged();
    else void load();
  }, [onChanged, load]);

  function open(player: Player) {
    setTarget(player);
    setActionError('');
  }

  function close() {
    setTarget(null);
    setActionError('');
  }

  async function run(action: () => Promise<RowActionResult>) {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      const result = await action();
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      close();
      changed();
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!target) return;
    if (!confirm(`Remove ${target.name} from this session?`)) return;
    const name = target.name;
    void run(() => removePlayer(name));
  }

  async function restore(player: Player) {
    if (busy) return;
    setBusy(true);
    setRestoreError('');
    try {
      const result = await restorePlayer(player.id);
      if (!result.ok) {
        setRestoreError(result.error);
        return;
      }
      changed();
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    setAddError('');
    try {
      const result = await addPlayerByName(name);
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setAddName('');
      changed();
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <CardSkeleton height={240} />;
  if (noSession) return null;

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="format_list_numbered"
        title="This week's list"
        message={
          <>
            Couldn&apos;t load the list.{' '}
            <StateLink onClick={() => void load()}>Try again</StateLink>
          </>
        }
      >
        <PreviewRow width="46%" />
        <PreviewRow width="34%" />
        <PreviewRow width="40%" />
      </StateCard>
    );
  }

  const row = (p: Player, position: number) => (
    <li key={p.id}>
      <button
        type="button"
        className="roster-row roster-row--action"
        onClick={() => open(p)}
        aria-label={`Actions for ${p.name}`}
      >
        <span className="roster-row__pos">{position}</span>
        <MemberAvatar name={p.name} size={24} />
        <span className="roster-row__name">{p.name}</span>
        {p.waitlisted && p.waitingForMembers && windowOpen && (
          <StatusBadge variant="muted">Members first</StatusBadge>
        )}
        <span className="material-icons icon-md roster-row__more" aria-hidden="true">more_vert</span>
      </button>
    </li>
  );

  return (
    <section className="glass-card p-4 space-y-3" aria-label="This week's list">
      <CardHeader icon="format_list_numbered" title="This week's list" />

      {lists.confirmed.length === 0 && lists.waiting.length === 0 ? (
        <EmptyState icon="group_add">Nobody has signed up yet.</EmptyState>
      ) : (
        /* Folded behind one line, as Home folds the same list: a club of
           thirty-odd is a 1,500px wall in the middle of a screen whose job is
           a thirty-second check (verify-ui, Six Feathers seed, 2026-11-05).
           The line carries the counts, so the fold costs nothing to read. */
        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
              {cap !== null ? `${lists.confirmed.length} of ${cap} in` : `${lists.confirmed.length} in`}
              {lists.waiting.length > 0 ? ` · ${lists.waiting.length} waiting` : ''}
            </span>
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              className="cc-btn cc-btn-ghost fs-sm"
              aria-expanded={listOpen}
              aria-controls="cc-session-list-rows"
              aria-label={listOpen ? 'Hide the list' : 'Show the list'}
            >
              {listOpen ? 'Hide' : 'Show'}
              <span
                className="material-icons motion-chevron icon-md"
                aria-hidden="true"
                data-open={listOpen ? 'true' : 'false'}
              >
                expand_more
              </span>
            </button>
          </div>
          <Collapse open={listOpen} spaceAbove="var(--space-2)">
            <div id="cc-session-list-rows" className="roster">
              {lists.confirmed.length > 0 && (
                <ol className="roster-list" aria-label="In">
                  {lists.confirmed.map((p, i) => row(p, i + 1))}
                </ol>
              )}
              {lists.waiting.length > 0 && (
                <>
                  <p className="section-label-muted roster-waitlist-label">Waitlist</p>
                  <ol className="roster-list" aria-label="Waitlist">
                    {lists.waiting.map((p, i) => row(p, lists.confirmed.length + i + 1))}
                  </ol>
                </>
              )}
            </div>
          </Collapse>
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-3" style={{ paddingTop: 'var(--space-3)' }}>
        <input
          type="text"
          name="playerName"
          aria-label="Add player by name"
          autoComplete="off"
          value={addName}
          onChange={(e) => { setAddName(e.target.value); setAddError(''); }}
          placeholder="Add player by name"
          maxLength={50}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={adding || !addName.trim() || !online}
          className="cc-btn cc-btn-primary"
          style={{ minWidth: 64 }}
        >
          {adding ? '…' : 'Add'}
        </button>
      </form>
      {addError && <p role="alert" className="field-error">{addError}</p>}

      {/* Cancelled and removed, behind one line. The late count is in the line
          itself: a club that charges a late cancel outside the app reads it
          here, and nowhere else. */}
      {lists.cancelled.length > 0 && (
        <div>
          <div
            className="flex items-center justify-between gap-3"
            style={{ paddingTop: 'var(--space-2)', borderTop: '1px solid var(--divider)' }}
          >
            <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
              {lists.cancelled.length} cancelled
              {lateCount > 0 ? ` · ${lateCount} late` : ''}
            </span>
            <button
              type="button"
              onClick={() => setCancelledOpen((v) => !v)}
              className="cc-btn cc-btn-ghost fs-sm"
              aria-expanded={cancelledOpen}
              aria-controls="cc-session-list-cancelled"
              aria-label={cancelledOpen ? 'Hide cancelled' : 'Show cancelled'}
            >
              {cancelledOpen ? 'Hide' : 'Show'}
              <span
                className="material-icons motion-chevron icon-md"
                aria-hidden="true"
                data-open={cancelledOpen ? 'true' : 'false'}
              >
                expand_more
              </span>
            </button>
          </div>
          <Collapse open={cancelledOpen}>
            <ul id="cc-session-list-cancelled" role="list" className="roster-list" style={{ paddingTop: 'var(--space-2)' }}>
              {lists.cancelled.map((p) => (
                <li key={p.id} className="roster-row">
                  <span className="roster-row__name" style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                    {p.name}
                  </span>
                  {p.lateCancel && (
                    <StatusBadge
                      variant="state"
                      tone="waitlist"
                      ariaLabel={`Cancelled late, ${p.lateCancelHoursBefore ?? 0} hours before the session`}
                    >
                      Late · {p.lateCancelHoursBefore ?? 0}h
                    </StatusBadge>
                  )}
                  {p.removedAt && (
                    <span className="fs-2xs" style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
                      {p.cancelledBySelf ? 'cancelled' : 'removed'} {fmtSessionLabel(p.removedAt)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void restore(p)}
                    disabled={busy || !online}
                    className="cc-btn cc-btn-secondary fs-xs"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
            {restoreError && <p role="alert" className="field-error">{restoreError}</p>}
          </Collapse>
        </div>
      )}

      {/* One sheet per row: move, remove, and on a guest, invite them in.
          No money action exists here to offer. */}
      <BottomSheet open={target !== null} onClose={close} ariaLabel="Player actions">
        <BottomSheetHeader>
          <span className="fs-lg" style={{ fontWeight: 600 }}>{target?.name ?? 'Player'}</span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex items-center justify-center"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44 }}
          >
            <span className="material-icons icon-lg">close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody>
          <div className="flex flex-col gap-3">
            {actionError && <p role="alert" className="field-error">{actionError}</p>}
            {target && !target.waitlisted && (
              <ActionRow
                icon="hourglass_top"
                label="Move to the waitlist"
                hint="Nobody moves up into their spot. They wait in line by when they signed up."
                disabled={busy || !online}
                onClick={() => { const id = target.id; void run(() => moveToWaitlist(id)); }}
              />
            )}
            {target?.waitlisted && (
              <ActionRow
                icon="how_to_reg"
                label="Move into the session"
                hint={full ? 'The session is full. Remove someone or raise the cap first.' : 'Takes a free spot now.'}
                disabled={busy || full || !online}
                onClick={() => { const id = target.id; void run(() => promotePlayer(id)); }}
              />
            )}
            {/* A plus-one has no account (docs/plans/plus-one.md): the way in is an invite. */}
            {target?.guestOf && (
              <ActionRow
                icon="person_add"
                label="Invite to the club"
                hint={`A one-time link for ${target.guestName ?? target.name} to join`}
                disabled={!online}
                onClick={() => { const p = target; close(); setInviteFor(p.guestName ?? p.name); }}
              />
            )}
            {target && (
              <ActionRow
                icon="person_remove"
                label="Remove from session"
                hint={target.waitlisted ? undefined : 'The first person waiting takes the spot.'}
                disabled={busy || !online}
                onClick={remove}
              />
            )}
          </div>
        </BottomSheetBody>
      </BottomSheet>

      <BottomSheet open={inviteFor !== null} onClose={() => setInviteFor(null)} ariaLabel="Invite to the club">
        <BottomSheetHeader>
          <span className="fs-lg" style={{ fontWeight: 600 }}>Invite {inviteFor} to the club</span>
          <button
            type="button"
            onClick={() => setInviteFor(null)}
            aria-label="Close"
            className="flex items-center justify-center"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44 }}
          >
            <span className="material-icons icon-lg">close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody>
          {/* The club's own invite card: one link, one person, seven days. */}
          {inviteFor !== null && <InviteCard bare />}
        </BottomSheetBody>
      </BottomSheet>
    </section>
  );
}
