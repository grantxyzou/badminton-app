'use client';

import { useEffect, useState, useCallback } from 'react';

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

  const load = useCallback(async () => {
    try {
      const [birdsRes, membersRes, recentRes] = await Promise.all([
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions/recent?limit=6`, { cache: 'no-store' }),
      ]);
      const birds = birdsRes.ok ? await birdsRes.json() as { currentStock?: number; totalUsed?: number } : null;
      const members = membersRes.ok ? await membersRes.json() as Array<{ active?: boolean; sessionCount?: number; lastSeen?: string }> : [];
      const recent = recentRes.ok ? await recentRes.json() as Array<unknown> : [];

      let weeksLeft: number | null = null;
      if (birds && typeof birds.currentStock === 'number' && typeof birds.totalUsed === 'number') {
        const sessionsCount = Math.max(1, recent.length);
        const avgPerSession = birds.totalUsed / sessionsCount;
        if (avgPerSession > 0) weeksLeft = Math.floor(birds.currentStock / avgPerSession);
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
      setData(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!data) return null;

  const birdsAlertClass = data.birdStock < 5 ? 'cc-dcard alert' : data.birdStock < 10 ? 'cc-dcard warn' : 'cc-dcard';

  return (
    <div className="cc-dgrid">
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
