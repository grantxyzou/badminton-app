'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { getIdentity } from '@/lib/identity';
import GearSheet from './GearSheet';
import RacketRecCard from './cards/RacketRecCard';
import YourRacketCard from './cards/YourRacketCard';
import { activeRacket } from '@/lib/activeRacket';
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
  // True once the catalog lookup for the current catalogId has resolved, one
  // way or another (found / not found / fetch failed). Nothing with no
  // catalogId to resolve counts as settled by definition. Gates what the hero
  // card is shown so the stored label never gets replaced by a spec-rich
  // display and then silently "reflow" underneath it — see YourRacketCard's
  // docstring contract.
  const [catalogSettled, setCatalogSettled] = useState(true);

  // Monotonic op counter, same pattern as GearSheet's gearOpRef: loadGear
  // fires both on mount and every time GearSheet's onSaved calls it after a
  // mutation (save/activate/remove). A plain per-call `live` closure only
  // guards a call against ITS OWN unmount — it does nothing to order two
  // overlapping loadGear() calls against each other. Rapid activate→remove
  // fires two GETs; without this, the older can resolve after the newer and
  // clobber the hero card with a stale (possibly just-deleted) racket, with
  // nothing left to refetch and correct it since onSaved already ran.
  const gearOpRef = useRef(0);

  const loadGear = useCallback(() => {
    if (!activeName) return;
    const opId = ++gearOpRef.current;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (opId !== gearOpRef.current) return;
        const gear = d.gear as PlayerGear | null;
        const racket = activeRacket(gear);
        setRacketLabel(racket?.label ?? null);
        setCatalogId(racket?.catalogId ?? null);
        setLoaded(true);
        setLoadError(false);
      })
      .catch(() => { if (opId === gearOpRef.current) { setLoadError(true); setLoaded(true); } });
  }, [activeName]);

  useEffect(() => { loadGear(); }, [loadGear]);

  // Resolve the catalog row so the card can show specs. A dangling catalogId
  // leaves catalogItem null and the card falls back to the stored label.
  useEffect(() => {
    if (!catalogId) { setCatalogItem(null); setCatalogSettled(true); return; }
    setCatalogSettled(false);
    let live = true;
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setCatalogItem(items.find((i) => i.id === catalogId) ?? null);
      })
      .catch(() => { if (live) setCatalogItem(null); })
      .finally(() => { if (live) setCatalogSettled(true); });
    return () => { live = false; };
  }, [catalogId]);

  if (!activeName) return null;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <YourRacketCard
          // Hold the stored label until the catalog lookup settles, so the
          // hero renders once in its final shape instead of the plain label
          // popping in first and the model/brand/specs reflowing in under it
          // a beat later. A catalog failure also lands here (settled, item
          // still null) — it degrades to the label, not a permanent shimmer.
          item={catalogSettled ? catalogItem : null}
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
