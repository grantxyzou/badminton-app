'use client';

import { useEffect, useState, useCallback } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface AdminDashTilesProps {
  onOpenBirds: () => void;
  onOpenRoster: () => void;
}

interface TileData {
  birdStock: number;
  birdWeeksLeft: number | null;
  activeMembers: number;
  totalMembers: number;
  dormantMembers: number;
}

export default function AdminDashTiles({ onOpenBirds, onOpenRoster }: AdminDashTilesProps) {
  const [data, setData] = useState<TileData | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [birdsRes, membersRes] = await Promise.all([
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
      ]);
      if (!birdsRes.ok || !membersRes.ok) {
        setLoadError(true);
        setData(null);
        return;
      }
      const birds = await birdsRes.json() as { currentStock?: number; burnPerSession?: number };
      const members = await membersRes.json() as Array<{ active?: boolean; sessionCount?: number; lastSeen?: string }>;

      let weeksLeft: number | null = null;
      const stock = birds?.currentStock ?? 0;
      const burn = birds?.burnPerSession ?? 0;
      if (burn > 0 && stock > 0) {
        weeksLeft = Math.floor(stock / burn);
      }

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

      setData({
        birdStock: birds?.currentStock ?? 0,
        birdWeeksLeft: weeksLeft,
        activeMembers: activeList.length - dormant,
        totalMembers: activeList.length,
        dormantMembers: dormant,
      });
    } catch {
      setLoadError(true);
      setData(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loadError) {
    return (
      <div
        className="cc-dgrid"
        role="alert"
        style={{ gridColumn: '1 / -1', display: 'block', padding: '12px 14px', borderRadius: 'var(--radius-xl)', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}
      >
        <p style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
          Couldn&apos;t load Birds + Roster summaries — refresh to retry.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div key="tiles-loading" className="cc-dgrid" role="status" aria-label="Loading">
        <CardSkeleton height={92} />
        <CardSkeleton height={92} />
      </div>
    );
  }

  const birdsAlertClass = data.birdStock < 5 ? 'cc-dcard alert' : data.birdStock < 10 ? 'cc-dcard warn' : 'cc-dcard';

  return (
    <div key="tiles-loaded" className="cc-dgrid animate-fadeIn">
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
        <span className="big">{data.birdStock}</span>
        <span className="small">
          {data.birdWeeksLeft !== null
            ? `~${data.birdWeeksLeft} week${data.birdWeeksLeft === 1 ? '' : 's'} left`
            : 'tubes on hand'}
        </span>
      </button>

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
          {data.activeMembers}
          <span style={{ color: 'var(--ink-faint)', fontSize: 14, fontWeight: 500 }}>/{data.totalMembers}</span>
        </span>
        <span className="small">
          active{data.dormantMembers > 0 && ` · ${data.dormantMembers} dormant`}
        </span>
      </button>
    </div>
  );
}
