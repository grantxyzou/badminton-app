'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import ErrorState from '@/components/primitives/ErrorState';
import GearSheet from './GearSheet';
import BagList from './BagList';
import { useGear } from './useGear';
import RacketRecCard from './cards/RacketRecCard';
import YourRacketCard from './cards/YourRacketCard';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

/** Mirrors app/api/equipment/gear/route.ts. Kept in sync so the tab can
 *  PREVENT a full bag (disabled Add button) rather than catch the 409 after
 *  the player has already gone looking for a racket to add. */
const MAX_RACKETS = 10;

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
 * The Equipment tab — which IS the player's bag.
 *
 * Reads top-down: the racket you're using today (hero), what we'd suggest
 * next, then every racket you own, then a way to add one. Adding is the only
 * thing that opens a sheet, and that sheet does nothing else.
 *
 * The hero is deliberately not tappable. With the bag on the tab, switching
 * and removing both have a home in the list below it, so a tappable hero would
 * be a second route to the same picker — the trap RacketRecCard already argues
 * against ("a button that expands nothing is worse than a plain card").
 */
export default function RacketRow() {
  const t = useTranslations('valueHub');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionError, setActionError] = useState(false);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  const gear = useGear(activeName);
  const racketLabel = gear.active?.label ?? null;
  const catalogId = gear.active?.catalogId ?? null;

  const [catalogItem, setCatalogItem] = useState<CatalogItem | null>(null);
  // True once the catalog lookup for the current catalogId has resolved, one
  // way or another (found / not found / fetch failed). Nothing with no
  // catalogId to resolve counts as settled by definition. Gates what the hero
  // card is shown so the stored label never gets replaced by a spec-rich
  // display and then silently "reflow" underneath it — see YourRacketCard's
  // docstring contract.
  const [catalogSettled, setCatalogSettled] = useState(true);

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

  const bagFull = gear.rackets.length >= MAX_RACKETS;
  const ownedCatalogIds = gear.rackets
    .map((r) => r.catalogId)
    .filter((id): id is string => typeof id === 'string');

  async function runAction(op: Promise<{ ok: boolean }>) {
    setActionError(false);
    const res = await op;
    if (!res.ok) setActionError(true);
  }

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
          loading={!gear.loaded}
          error={gear.loadError}
        />
        <RacketRecCard name={activeName} mine={catalogItem} />

        {/* A failed gear read must render as a failure, not a truthful "you
            own no rackets" — a player with three rackets must never see an
            empty bag because a fetch hiccuped. Suppress the list entirely
            while this is up so the two can't show at once. */}
        {gear.loadError && <ErrorState message={t('recError')} />}
        {!gear.loadError && (
          <BagList
            items={gear.rackets}
            activeId={gear.active?.id}
            onActivate={(id) => runAction(gear.activate(id))}
            onRemove={(id) => runAction(gear.remove(id))}
            busy={gear.busy}
          />
        )}

        {actionError && <ErrorState message={t('recError')} />}
        {bagFull && <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{t('bagFull')}</p>}

        <button
          type="button"
          className="cc-btn cc-btn-secondary"
          disabled={gear.busy || bagFull || gear.loadError}
          onClick={() => setSheetOpen(true)}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {t('addRacket')}
        </button>
      </div>

      <GearSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        ownedCatalogIds={ownedCatalogIds}
        onPick={gear.add}
        busy={gear.busy}
        online={gear.online}
      />
    </>
  );
}
