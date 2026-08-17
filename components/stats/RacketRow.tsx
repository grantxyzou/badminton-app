'use client';
import { useEffect, useState, useCallback } from 'react';
import { getIdentity } from '@/lib/identity';
import GearSheet from './GearSheet';
import RacketRecCard from './cards/RacketRecCard';
import YourRacketCard from './cards/YourRacketCard';
import type { PlayerGear, CatalogItem } from '@/lib/types';

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
 * Stats racket row: a vertical stack. Your racket leads (hero treatment,
 * tappable to pick/change); the recommendation follows below it, compared
 * against what you already own. Picking a racket refetches gear so the
 * catalog item resolves fresh and both cards update immediately.
 */
export default function RacketRow() {
  const [activeName, setActiveName] = useState<string | null>(null);
  const [racketLabel, setRacketLabel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  const [catalogItem, setCatalogItem] = useState<CatalogItem | null>(null);
  const [catalogId, setCatalogId] = useState<string | null>(null);

  const loadGear = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const gear = d.gear as PlayerGear | null;
        const racket = gear?.items?.find((i) => i.category === 'racket');
        setRacketLabel(racket?.label ?? null);
        setCatalogId(racket?.catalogId ?? null);
        setLoaded(true);
        setLoadError(false);
      })
      .catch(() => { setLoadError(true); setLoaded(true); });
  }, [activeName]);

  useEffect(() => { loadGear(); }, [loadGear]);

  // Resolve the catalog row so the card can show specs. A dangling catalogId
  // leaves catalogItem null and the card falls back to the stored label.
  useEffect(() => {
    if (!catalogId) { setCatalogItem(null); return; }
    let live = true;
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setCatalogItem(items.find((i) => i.id === catalogId) ?? null);
      })
      .catch(() => { if (live) setCatalogItem(null); });
    return () => { live = false; };
  }, [catalogId]);

  if (!activeName) return null;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <YourRacketCard
          item={catalogItem}
          label={racketLabel}
          loading={!loaded}
          error={loadError}
          onEdit={() => setSheetOpen(true)}
        />
        <RacketRecCard name={activeName} mine={catalogItem} />
      </div>

      <GearSheet
        name={activeName}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={loadGear}
        currentLabel={racketLabel}
      />
    </>
  );
}
