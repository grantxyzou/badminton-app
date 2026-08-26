'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import StatCard from './StatCard';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * The three-tile overview strip that sits above the register switch and stays
 * visible in every register: Level / Games / Kudos.
 *
 * EACH TILE RESOLVES INDEPENDENTLY. Three separate reads, three separate
 * states — one failed fetch must never blank the other two. That is why this
 * is not a single `Promise.all` with one `loading` flag: a 500 on the kudos
 * container would otherwise erase a level the member can see perfectly well.
 *
 * No tile ever shows a confident zero it hasn't earned:
 *   - level with no check-in yet  -> "—" + "Take a check-in"   (not 0.0)
 *   - any tile that failed to load -> "—" + "Couldn't load"     (not 0)
 *   - a genuine zero              -> "0" + its normal caption
 * Distinguishing loaded-empty from load-failed is the house rule; a card that
 * confidently reports nothing when the backend is broken is how the v1.3
 * Cosmos misconfiguration stayed invisible.
 */

type Tile<T> = { status: 'loading' | 'ready' | 'error'; data: T | null };

const PENDING = { status: 'loading' as const, data: null };

interface Snapshot {
  takenAt?: string;
  overall?: number | null;
}

export interface OverviewStripProps {
  /** The name Stats is rendering for. Null renders nothing. */
  activeName: string | null;
}

export default function OverviewStrip({ activeName }: OverviewStripProps) {
  const t = useTranslations('stats.overview');
  const locale = useLocale();

  const [level, setLevel] = useState<Tile<number | null>>(PENDING);
  const [trend, setTrend] = useState<Tile<Snapshot[]>>(PENDING);
  const [games, setGames] = useState<Tile<number>>(PENDING);
  const [kudos, setKudos] = useState<Tile<number>>(PENDING);

  useEffect(() => {
    if (!activeName) return;
    const n = encodeURIComponent(activeName);
    let live = true;

    // Deliberately four independent fetches with four independent setStates.
    const get = (url: string) =>
      fetch(`${BASE}${url}`, { cache: 'no-store' }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      );

    get(`/api/stats/level?name=${n}`)
      .then((d) => {
        if (!live) return;
        const raw = d?.level?.level;
        setLevel({ status: 'ready', data: typeof raw === 'number' ? raw : null });
      })
      .catch(() => live && setLevel({ status: 'error', data: null }));

    // The level number and its delta come from different places: the canonical
    // level folds games and legacy stage, while the "since April" comparison
    // needs the raw check-in history. A failed trend read degrades the caption
    // to the baseline line — it never blanks the number.
    get(`/api/assessments?name=${n}`)
      .then((d) => live && setTrend({ status: 'ready', data: (d?.assessments ?? []) as Snapshot[] }))
      .catch(() => live && setTrend({ status: 'error', data: null }));

    get(`/api/games?all=true&name=${n}`)
      .then((d) => live && setGames({ status: 'ready', data: (d?.games ?? []).length }))
      .catch(() => live && setGames({ status: 'error', data: null }));

    get(`/api/kudos?name=${n}`)
      .then((d) => {
        if (!live) return;
        // `GET /api/kudos` returns `{ kudos: KudosCount[] }` — per-tag counts
        // only, never rater identities. Summed here for the headline figure.
        const counts = (d?.kudos ?? []) as { count?: number }[];
        setKudos({
          status: 'ready',
          data: counts.reduce((sum, c) => sum + (typeof c.count === 'number' ? c.count : 0), 0),
        });
      })
      .catch(() => live && setKudos({ status: 'error', data: null }));

    return () => {
      live = false;
    };
  }, [activeName]);

  if (!activeName) return null;

  const monthOf = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(locale, { month: 'long' }).format(d);
  };

  // ── Level tile ────────────────────────────────────────────────────────────
  let levelValue: string = t('noValue');
  let levelCaption: string = t('takeCheckIn');
  if (level.status === 'error') {
    levelCaption = t('loadError');
  } else if (level.status === 'ready' && level.data !== null) {
    levelValue = level.data.toFixed(1);
    const snaps = trend.data ?? [];
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : undefined;
    const latest = snaps[snaps.length - 1];
    const month = monthOf(prev?.takenAt);
    if (
      prev &&
      month &&
      typeof prev.overall === 'number' &&
      typeof latest?.overall === 'number'
    ) {
      const delta = latest.overall - prev.overall;
      // Never render "▲ 0.0" — a delta the member can't perceive reads as a
      // change that didn't happen.
      if (Math.abs(delta) < 0.05) {
        levelCaption = t('levelWith', { month });
      } else {
        const mag = Math.abs(delta).toFixed(1);
        levelCaption = delta > 0 ? t('up', { delta: mag, month }) : t('down', { delta: mag, month });
      }
    } else {
      // One snapshot (or no usable trend) — there is nothing to compare to yet.
      levelCaption = t('baseline');
    }
  } else if (level.status === 'loading') {
    levelCaption = '';
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'stretch' }}>
      {/* Left tile is wider — the level is the headline of the three. */}
      <div style={{ flex: 1.2, minWidth: 0 }}>
        <StatCard
          tone="accent"
          size="tile"
          label={t('level')}
          value={levelValue}
          unit={levelValue === t('noValue') ? undefined : t('ofFive')}
          caption={levelCaption}
        />
      </div>
      <GlassTile
        label={t('games')}
        value={countText(games, t('noValue'))}
        caption={games.status === 'error' ? t('loadError') : t('gamesCaption')}
      />
      <GlassTile
        label={t('kudos')}
        value={countText(kudos, t('noValue'))}
        caption={kudos.status === 'error' ? t('loadError') : t('kudosCaption')}
        valueColor="var(--accent-amber)"
      />
    </div>
  );
}

/** A real zero is a real answer; unknown and failed are not. */
function countText(tile: Tile<number>, dash: string): string {
  if (tile.status === 'ready' && tile.data !== null) return String(tile.data);
  return dash;
}

function GlassTile({
  label,
  value,
  caption,
  valueColor = 'var(--text-primary)',
}: {
  label: string;
  value: ReactNode;
  caption: string;
  valueColor?: string;
}) {
  return (
    <div
      className="glass-card p-4"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--fs-2xs)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-stat-lg)',
          fontWeight: 700,
          color: valueColor,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{caption}</span>
    </div>
  );
}
