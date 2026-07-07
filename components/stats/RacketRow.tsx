'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import GearSheet from './GearSheet';
import RacketRecCard from './cards/RacketRecCard';
import type { PlayerGear } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

// Same identity chain as AttendanceCardLive: identity → stats preview-name → null.
function resolveActiveName(): string | null {
  const id = getIdentity();
  if (id?.name) return id.name;
  try {
    const stored = localStorage.getItem(STATS_NAME_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Stats racket row: two cards side-by-side. Left = YOUR racket (primary,
 * tappable to pick/change). Right = the recommendation (secondary nudge).
 * Picking a racket refetches gear so the left card updates immediately.
 */
export default function RacketRow() {
  const t = useTranslations('valueHub');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [racketLabel, setRacketLabel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  const loadGear = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const gear = d.gear as PlayerGear | null;
        const racket = gear?.items?.find((i) => i.category === 'racket');
        setRacketLabel(racket?.label ?? null);
        setLoaded(true);
        setLoadError(false);
      })
      .catch(() => { setLoadError(true); setLoaded(true); });
  }, [activeName]);

  useEffect(() => { loadGear(); }, [loadGear]);

  if (!activeName) return null;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {/* Left — your racket (primary), tappable to pick or change */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="glass-card"
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 112, textAlign: 'left', cursor: 'pointer' }}
        >
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: 0 }}>{t('yourRacket')}</p>
          {loadError ? (
            <span className="field-error" role="alert">{t('recError')}</span>
          ) : !loaded ? (
            <span className="shimmer-line rounded-lg" style={{ height: 15, width: '70%' }} aria-hidden="true" />
          ) : racketLabel ? (
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 600, lineHeight: 1.25 }}>{racketLabel}</span>
          ) : (
            <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>{t('noRacketYet')}</span>
          )}
        </button>

        {/* Right — recommendation (secondary) */}
        <RacketRecCard name={activeName} />
      </div>

      <GearSheet
        name={activeName}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={loadGear}
      />
    </>
  );
}
