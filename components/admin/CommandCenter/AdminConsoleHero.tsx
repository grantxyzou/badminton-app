'use client';

import { useEffect, useState, useCallback } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';

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
  /** Tap "Open admin home →" — routes to the Admin tab dashboard. */
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
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      // Fetch session, players (with removed for dormant proxy), birds, members
      const [sessionRes, playersRes, birdsRes, membersRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players?all=true`, { cache: 'no-store' }),
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
      ]);
      // If any critical fetch failed, treat the hero as unable-to-load rather
      // than rendering a confidently empty 'all clear this week' state — the
      // exact lying-empty-state pattern that bit v1.3 (see MEMORY.md).
      if (!sessionRes.ok || !playersRes.ok || !birdsRes.ok || !membersRes.ok) {
        setLoadError(true);
        setData(null);
        return;
      }
      const session = await sessionRes.json();
      const players = (await playersRes.json()) as Array<{ paid?: boolean; removed?: boolean; waitlisted?: boolean }>;
      const birds = (await birdsRes.json()) as { currentStock?: number; burnPerSession?: number };
      const members = (await membersRes.json()) as Array<{ active?: boolean; sessionCount?: number; lastSeen?: string; createdAt?: string }>;

      const active = players.filter((p) => !p.removed && !p.waitlisted);
      const unpaid = active.filter((p) => p.paid !== true).length;

      let hoursToDeadline: number | null = null;
      if (session?.deadline) {
        const ms = new Date(session.deadline).getTime() - Date.now();
        if (Number.isFinite(ms)) hoursToDeadline = ms / 3_600_000;
      }

      // Burn rate now comes from the API (last-60d window). Apples-to-apples.
      let weeksLeft: number | null = null;
      const stock = birds?.currentStock ?? 0;
      const burn = birds?.burnPerSession ?? 0;
      if (burn > 0 && stock > 0) {
        weeksLeft = Math.floor(stock / burn);
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
      setLoadError(true);
      setData(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loadError) {
    return (
      <div
        className="admin-hero"
        style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'linear-gradient(160deg, rgba(239,68,68,0.06), rgba(var(--glass-tint), 0.02))' }}
      >
        <span className="badge" style={{ color: 'var(--color-red)' }}>Admin console</span>
        <p className="ah-title">Couldn&apos;t load</p>
        <p className="ah-subtitle">Refresh to retry — your stats aren&apos;t available right now.</p>
      </div>
    );
  }

  if (!data) return <CardSkeleton height={150} />;

  // "X things need you" — count the actionable signals. Birds with NO
  // burn-rate data (fresh install, no usage logged yet) get an 'awaiting'
  // signal rather than 'all clear', because we genuinely don't know.
  const birdsAwaitingData = data.birdWeeksLeft === null;
  const birdsLow = data.birdWeeksLeft !== null && data.birdWeeksLeft <= 4;
  const needsYou = [
    data.unpaidCount > 0,
    birdsLow,
    data.dormantCount > 0,
  ].filter(Boolean).length;

  return (
    <div className="admin-hero animate-fadeIn">
      <span className="badge">Admin console</span>
      <p className="ah-title">
        {needsYou === 0
          ? birdsAwaitingData
            ? 'Awaiting bird data'
            : 'All clear this week'
          : `${needsYou} thing${needsYou === 1 ? '' : 's'} need you`}
      </p>
      <p className="ah-subtitle">
        {fmtSessionDate(data.sessionDate)}
        {data.capacity > 0 && ` · ${data.signedUp}/${data.capacity} signed up`}
        {data.hoursToDeadline !== null && ` · ${fmtCountdown(data.hoursToDeadline)}`}
      </p>

      <div className="cc-grid3" style={{ marginTop: 12 }}>
        {/* Tiles are read-only stats — three buttons going to the same
            destination read as broken affordance. Real navigation is the
            single green CTA below. */}
        <div className="cc-tile cc-tile-static warn">
          <span className="num">{data.unpaidCount}</span>
          <span className="lbl">Unpaid</span>
          <span className="delta">/ {data.totalActive} players</span>
        </div>
        <div className="cc-tile cc-tile-static bad">
          <span className="num">{data.birdStock}</span>
          <span className="lbl">Bird tubes</span>
          <span className="delta">{data.birdWeeksLeft !== null ? `~${data.birdWeeksLeft} wk${data.birdWeeksLeft === 1 ? '' : 's'}` : '—'}</span>
        </div>
        <div className="cc-tile cc-tile-static info">
          <span className="num">{data.dormantCount}</span>
          <span className="lbl">Dormant</span>
          <span className="delta">in last 60d</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenAdmin}
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ marginTop: 14, gap: 8 }}
      >
        Open admin home
        <span className="material-icons" style={{ fontSize: 18 }}>arrow_forward</span>
      </button>
    </div>
  );
}
