'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { recordEngagement } from '@/lib/engagement';
import { compareRackets } from '@/lib/racketSpecs';
import { isFlagOn } from '@/lib/flags';
import { useInsight } from '@/lib/useInsight';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Compact "We recommend" card — the secondary half of the Stats racket row
 * (your racket is primary/hero, this is the nudge stacked below it). Stage-aware pick with
 * all-rounder fallback (see lib/recommend.ts). Legible-fail per CLAUDE.md: a
 * load failure shows a distinct error pill; while loading it shows neither a
 * fake pick nor an error.
 *
 * Tapping expands the reason `/api/recommend` already returns (it was being
 * fetched and thrown away). That disclosure is also the card's first real
 * affordance: the Value-Hub Slice-0 kill-criterion asks whether members
 * interact with this card "more than once", and until now it was a plain
 * `<div>` with nothing to interact with — the metric could never have been
 * anything but zero. The tap is recorded via `recordEngagement`.
 *
 * Equipment insight (NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT): when the shared
 * distributed insight (`useInsight`) carries an `equipment` slice, its
 * `headline` replaces the templated compare line and its `support` replaces
 * the templated `reason` inside the reveal. When the slice names a `suggests`
 * catalog id, that racket is shown instead of the deterministic pick — but
 * ONLY once it resolves against the fetched catalog, so a stale/unknown id
 * (or a fetch failure) falls back to today's pick rather than a blank card.
 * Flag off, no signal, or a failed insight fetch are all indistinguishable
 * from today's card — this is deliberately never an error state, since the
 * card is fully usable without the insight (CLAUDE.md legible-fail rule).
 *
 * A `/api/recommend` load failure is a hard gate on interactivity, even when
 * the insight independently resolves a valid `suggests` + `support`: the
 * insight narrates the deterministic pick, it does not replace it, so a
 * failed pick must never render as a clickable button wrapped around its own
 * `role="alert"` error pill.
 */
export default function RacketRecCard({ name, mine }: { name: string; mine: CatalogItem | null }) {
  const t = useTranslations('valueHub');
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const equipmentOn = isFlagOn('NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT');
  // Only this hook's `data` is consumed — its own `error`/`loading` must never
  // feed loadError, which stays exclusively /api/recommend's. The insight is
  // an optional narration layer; a failure in it is not a card failure.
  const { data: insight } = useInsight(equipmentOn);
  const equipment = equipmentOn ? insight?.equipment ?? null : null;

  const [suggestedItem, setSuggestedItem] = useState<CatalogItem | null>(null);

  useEffect(() => {
    let live = true;
    if (!name) return;
    fetch(`${BASE}/api/recommend?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        setItem(d.item ?? null);
        setReason(typeof d.reason === 'string' ? d.reason : null);
        setLoaded(true);
        setLoadError(false);
      })
      .catch(() => { if (live) { setLoadError(true); setLoaded(true); } });
    return () => { live = false; };
  }, [name]);

  // Resolve the equipment insight's `suggests` catalog id against the same
  // public catalog endpoint RacketRow already uses to resolve `mine`. A
  // stale/unknown id, or a failed fetch, leaves suggestedItem null — the
  // render falls back to the deterministic /api/recommend pick, never a
  // blank card.
  useEffect(() => {
    let live = true;
    const suggestId = equipment?.suggests;
    if (!suggestId) { setSuggestedItem(null); return; }
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setSuggestedItem(items.find((i) => i.id === suggestId) ?? null);
      })
      .catch(() => { if (live) setSuggestedItem(null); });
    return () => { live = false; };
  }, [equipment?.suggests]);

  function toggle() {
    setExpanded((prev) => !prev);
    // Fire-and-forget: an engagement beacon must never gate or degrade the UI.
    void recordEngagement('rec_card_tap');
  }

  // The racket actually shown: the insight's suggestion once it resolves
  // against the catalog, else today's deterministic pick.
  const displayItem = suggestedItem ?? item;

  const body = loadError ? (
    <ErrorState message={t('recError')} />
  ) : !loaded ? (
    <span className="shimmer-line rounded-lg" style={{ height: 15, width: '70%' }} aria-hidden="true" />
  ) : !displayItem ? (
    <EmptyState>{t('recEmpty')}</EmptyState>
  ) : (
    <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 600, margin: 0, lineHeight: 1.25 }}>
      {displayItem.brand} {displayItem.model}
    </p>
  );

  const label = <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: 0 }}>{t('weRecommend')}</p>;

  const comparison = displayItem ? compareRackets(mine, displayItem) : null;
  // The generated headline takes the compare line's slot when present —
  // it's the AI's non-obvious read, strictly better than the templated
  // weight/balance/flex delta it replaces.
  const compareLine = equipment?.headline ? (
    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>{equipment.headline}</p>
  ) : comparison ? (
    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>
      {displayItem?.brand} · {t(`compare${comparison.charAt(0).toUpperCase()}${comparison.slice(1)}`)}
    </p>
  ) : displayItem ? (
    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>{displayItem.brand}</p>
  ) : null;

  // The reveal text: the generated support when present, else the templated
  // reason. Checked as "is there anything to reveal" — a null `reason` must
  // not swallow a present `equipment.support` (and vice versa).
  const revealText = equipment?.support ?? reason;

  // Only interactive once there's a pick AND something to reveal — AND
  // /api/recommend itself succeeded. loadError is a hard gate: the insight
  // is a narration layer on top of the deterministic pick, not a substitute
  // for it, so a resolved `suggests` + `support` must never turn the load
  // failure into a clickable button wrapped around its own error pill.
  if (loadError || !displayItem || !revealText) {
    return (
      <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label}
        {body}
        {compareLine}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={expanded}
      className="glass-card"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        textAlign: 'left',
        cursor: 'pointer',
        width: '100%',
      }}
    >
      {label}
      {body}
      {compareLine}
      {expanded && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
          {revealText}
        </p>
      )}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          marginTop: 'auto',
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-secondary)',
        }}
      >
        {expanded ? t('recWhyHide') : t('recWhyShow')}
        <span className="material-icons" style={{ fontSize: 'var(--icon-sm)' }} aria-hidden="true">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </span>
    </button>
  );
}
