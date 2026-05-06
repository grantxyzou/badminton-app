'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface HeroData {
  sessionDate: string | null;
  signedUp: number;
  capacity: number;
  hoursToDeadline: number | null;
  unpaidCount: number;
  totalActive: number;
  birdStock: number;
  birdWeeksLeft: number | null;
  dormantCount: number;
}

interface AdminConsoleHeroProps {
  /** Tap "Open admin home →" or any tile → routes to the Admin tab */
  onOpenAdmin: () => void;
}

function fmtSessionDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtCountdown(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return 'no deadline';
  if (hours <= 0) return 'deadline passed';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m to deadline`;
  if (hours < 24) return `${Math.round(hours)}h to deadline`;
  return `${Math.round(hours / 24)}d to deadline`;
}

export default function AdminConsoleHero({ onOpenAdmin }: AdminConsoleHeroProps) {
  const [data, setData] = useState<HeroData | null>(null);

  const load = useCallback(async () => {
    try {
      // Fetch session, players (with removed for dormant proxy), birds, members
      const [sessionRes, playersRes, birdsRes, membersRes, recentRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players?all=true`, { cache: 'no-store' }),
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions/recent?limit=6`, { cache: 'no-store' }),
      ]);
      const session = sessionRes.ok ? await sessionRes.json() : null;
      const players = playersRes.ok ? (await playersRes.json()) as Array<{ paid?: boolean; removed?: boolean; waitlisted?: boolean }> : [];
      const birds = birdsRes.ok ? (await birdsRes.json()) as { currentStock?: number; totalUsed?: number } : null;
      const members = membersRes.ok ? (await membersRes.json()) as Array<{ active?: boolean; sessionCount?: number; lastSeen?: string }> : [];
      const recent = recentRes.ok ? (await recentRes.json()) as Array<{ sessionId: string }> : [];

      const active = players.filter((p) => !p.removed && !p.waitlisted);
      const unpaid = active.filter((p) => p.paid !== true).length;

      let hoursToDeadline: number | null = null;
      if (session?.deadline) {
        const ms = new Date(session.deadline).getTime() - Date.now();
        if (Number.isFinite(ms)) hoursToDeadline = ms / 3_600_000;
      }

      // Bird burn rate proxy: totalUsed / count(recent sessions). Same heuristic
      // as BirdInventoryCard; intentionally rough — the Birds page in plan 2
      // will surface the precise figure.
      let weeksLeft: number | null = null;
      if (birds && typeof birds.currentStock === 'number' && typeof birds.totalUsed === 'number') {
        const sessionsCount = Math.max(1, recent.length);
        const avgPerSession = birds.totalUsed / sessionsCount;
        if (avgPerSession > 0) weeksLeft = Math.floor(birds.currentStock / avgPerSession);
      }

      // Dormant proxy: members.active=true with sessionCount === 0 OR lastSeen > 60d ago.
      const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
      const dormant = Array.isArray(members)
        ? members.filter((m) => {
            if (m.active === false) return false;
            if (!m.sessionCount || m.sessionCount === 0) return true;
            if (m.lastSeen) {
              const t = new Date(m.lastSeen).getTime();
              if (Number.isFinite(t) && t < sixtyDaysAgo) return true;
            }
            return false;
          }).length
        : 0;

      setData({
        sessionDate: session?.datetime ?? null,
        signedUp: active.length,
        capacity: session?.maxPlayers ?? 0,
        hoursToDeadline,
        unpaidCount: unpaid,
        totalActive: active.length,
        birdStock: birds?.currentStock ?? 0,
        birdWeeksLeft: weeksLeft,
        dormantCount: dormant,
      });
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!data) return null;

  // "X things need you" — count the actionable signals.
  const needsYou = [
    data.unpaidCount > 0,
    data.birdWeeksLeft !== null && data.birdWeeksLeft <= 4,
    data.dormantCount > 0,
  ].filter(Boolean).length;

  return (
    <div className="admin-hero">
      <span className="badge">Admin console</span>
      <p className="ah-title">
        {needsYou === 0 ? 'All clear this week' : `${needsYou} thing${needsYou === 1 ? '' : 's'} need you`}
      </p>
      <p className="ah-subtitle">
        {fmtSessionDate(data.sessionDate)}
        {data.capacity > 0 && ` · ${data.signedUp}/${data.capacity} signed up`}
        {data.hoursToDeadline !== null && ` · ${fmtCountdown(data.hoursToDeadline)}`}
      </p>

      <div className="cc-grid3" style={{ marginTop: 12 }}>
        <button type="button" className="cc-tile warn" onClick={onOpenAdmin} aria-label="Unpaid players">
          <span className="num">{data.unpaidCount}</span>
          <span className="lbl">Unpaid</span>
          <span className="delta">/ {data.totalActive} players</span>
        </button>
        <button type="button" className="cc-tile bad" onClick={onOpenAdmin} aria-label="Bird inventory">
          <span className="num">{data.birdStock}</span>
          <span className="lbl">Bird tubes</span>
          <span className="delta">{data.birdWeeksLeft !== null ? `~${data.birdWeeksLeft} wk${data.birdWeeksLeft === 1 ? '' : 's'}` : '—'}</span>
        </button>
        <button type="button" className="cc-tile info" onClick={onOpenAdmin} aria-label="Dormant members">
          <span className="num">{data.dormantCount}</span>
          <span className="lbl">Dormant</span>
          <span className="delta">review →</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onOpenAdmin}
        className="btn-primary"
        style={{ marginTop: 12, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        Open admin home
        <span className="material-icons" style={{ fontSize: 18 }}>arrow_forward</span>
      </button>
    </div>
  );
}
