'use client';

import { useEffect, useState } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { StateLink } from '@/components/primitives/StateCard';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface AdminDashTilesProps {
  onOpenBirds: () => void;
  onOpenRoster: () => void;
}

/** Why a tile has no number. Each gets its own glass colour, because they ask
 *  different things of the admin: a failed read is worth retrying, a refused
 *  one means the admin session is gone and only signing in again will help. */
type TileProblem = 'failed' | 'refused';

interface BirdsData {
  birdStock: number;
  birdWeeksLeft: number | null;
}

interface RosterData {
  activeMembers: number;
  totalMembers: number;
  dormantMembers: number;
}

type Tile<T> = { data: T; problem: null } | { data: null; problem: TileProblem } | null;

function problemOf(res: Response): TileProblem {
  return res.status === 401 || res.status === 403 ? 'refused' : 'failed';
}

export default function AdminDashTiles({ onOpenBirds, onOpenRoster }: AdminDashTilesProps) {
  // null = still loading. The two reads are independent: one failing no longer
  // blanks the other, so a working Roster count stays on screen beside a
  // failed Birds tile.
  const [birds, setBirds] = useState<Tile<BirdsData>>(null);
  const [roster, setRoster] = useState<Tile<RosterData>>(null);
  // Bumped by Try again to re-run the fetch effect below; the tiles reset in
  // that click handler, so the effect's only setStates stay asynchronous.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [birdsRes, membersRes] = await Promise.allSettled([
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
      ]);
      if (cancelled) return;

      try {
        if (birdsRes.status === 'rejected') throw new Error('network');
        if (!birdsRes.value.ok) {
          setBirds({ data: null, problem: problemOf(birdsRes.value) });
        } else {
          const b = (await birdsRes.value.json()) as { currentStock?: number; burnPerSession?: number };
          const stock = b?.currentStock ?? 0;
          const burn = b?.burnPerSession ?? 0;
          if (!cancelled) {
            setBirds({
              data: { birdStock: stock, birdWeeksLeft: burn > 0 && stock > 0 ? Math.floor(stock / burn) : null },
              problem: null,
            });
          }
        }
      } catch {
        if (!cancelled) setBirds({ data: null, problem: 'failed' });
      }

      try {
        if (membersRes.status === 'rejected') throw new Error('network');
        if (!membersRes.value.ok) {
          setRoster({ data: null, problem: problemOf(membersRes.value) });
        } else {
          const members = (await membersRes.value.json()) as Array<{ active?: boolean; sessionCount?: number; lastSeen?: string }>;
          const activeList = Array.isArray(members) ? members.filter((m) => m.active !== false) : [];
          const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
          const dormant = activeList.filter((m) => {
            if (!m.sessionCount || m.sessionCount === 0) return true;
            if (m.lastSeen) {
              const t = new Date(m.lastSeen).getTime();
              if (Number.isFinite(t) && t < sixtyDaysAgo) return true;
            }
            return false;
          }).length;
          if (!cancelled) {
            setRoster({
              data: { activeMembers: activeList.length - dormant, totalMembers: activeList.length, dormantMembers: dormant },
              problem: null,
            });
          }
        }
      } catch {
        if (!cancelled) setRoster({ data: null, problem: 'failed' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (birds === null || roster === null) {
    return (
      <div key="tiles-loading" className="cc-dgrid" role="status" aria-label="Loading">
        <CardSkeleton height={92} />
        <CardSkeleton height={92} />
      </div>
    );
  }

  const retry = () => {
    setBirds(null);
    setRoster(null);
    setAttempt((n) => n + 1);
  };

  /** A tile with no number: its own glass colour, a dash, and one sentence. */
  const problemTile = (icon: string, label: string, problem: TileProblem) => (
    <div className="cc-dcard" data-tone={problem === 'failed' ? 'danger' : 'warn'} style={{ cursor: 'default' }}>
      <span className="htitle">
        <span className="material-icons">{icon}</span>
        {label}
      </span>
      <span className="big" aria-hidden="true">—</span>
      <span className="small" role={problem === 'failed' ? 'alert' : 'status'}>
        {problem === 'failed' ? (
          <>Couldn&apos;t load. <StateLink onClick={retry}>Try again</StateLink></>
        ) : (
          <>Session expired. <StateLink onClick={() => window.location.reload()}>Reload</StateLink></>
        )}
      </span>
    </div>
  );

  const birdsAlertClass = birds.data
    ? birds.data.birdStock < 5 ? 'cc-dcard alert' : birds.data.birdStock < 10 ? 'cc-dcard warn' : 'cc-dcard'
    : 'cc-dcard';

  return (
    <div key="tiles-loaded" className="cc-dgrid motion-fade">
      {birds.problem ? problemTile('inventory_2', 'Birds', birds.problem) : (
        <button
          type="button"
          className={birdsAlertClass}
          onClick={onOpenBirds}
          style={{ textAlign: 'left' }}
          aria-label="Bird inventory"
        >
          <span className="htitle">
            <span className="material-icons">inventory_2</span>
            Birds
          </span>
          <span className="big">{birds.data.birdStock}</span>
          <span className="small">
            {birds.data.birdWeeksLeft !== null
              ? `~${birds.data.birdWeeksLeft} week${birds.data.birdWeeksLeft === 1 ? '' : 's'} left`
              : 'tubes on hand'}
          </span>
        </button>
      )}

      {roster.problem ? problemTile('group', 'Roster', roster.problem) : (
        <button
          type="button"
          className="cc-dcard"
          onClick={onOpenRoster}
          style={{ textAlign: 'left' }}
          aria-label="Roster"
        >
          <span className="htitle">
            <span className="material-icons">group</span>
            Roster
          </span>
          <span className="big" style={{ color: 'var(--accent)' }}>
            {roster.data.activeMembers}
            <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--fs-md)', fontWeight: 500 }}>/{roster.data.totalMembers}</span>
          </span>
          <span className="small">
            active{roster.data.dormantMembers > 0 && ` · ${roster.data.dormantMembers} dormant`}
          </span>
        </button>
      )}
    </div>
  );
}
