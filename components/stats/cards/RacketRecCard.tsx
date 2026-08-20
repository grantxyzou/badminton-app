'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { recordEngagement } from '@/lib/engagement';
import { compareRackets } from '@/lib/racketSpecs';
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
 */
export default function RacketRecCard({ name, mine }: { name: string; mine: CatalogItem | null }) {
  const t = useTranslations('valueHub');
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [needsCheckIn, setNeedsCheckIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    if (!name) return;
    fetch(`${BASE}/api/recommend?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        setItem(d.item ?? null);
        setReason(typeof d.reason === 'string' ? d.reason : null);
        setReasons(Array.isArray(d.reasons) ? d.reasons : null);
        setWarnings(Array.isArray(d.warnings) ? d.warnings : null);
        setNeedsCheckIn(d.needsCheckIn === true);
        setLoaded(true);
        setLoadError(false);
      })
      // A non-ok response (including a 403 — session expired / not this
      // caller's own name) lands here same as a network failure: "unknown"
      // must render the distinct error pill, never the empty-pick state.
      .catch(() => { if (live) { setLoadError(true); setLoaded(true); } });
    return () => { live = false; };
  }, [name]);

  function toggle() {
    setExpanded((prev) => !prev);
    // Fire-and-forget: an engagement beacon must never gate or degrade the UI.
    void recordEngagement('rec_card_tap');
  }

  const body = loadError ? (
    <ErrorState message={t('recError')} />
  ) : !loaded ? (
    <span className="shimmer-line rounded-lg" style={{ height: 15, width: '70%' }} aria-hidden="true" />
  ) : needsCheckIn ? (
    <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
      {t('needsCheckIn')}
    </p>
  ) : !item ? (
    <EmptyState>{t('recEmpty')}</EmptyState>
  ) : (
    <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 600, margin: 0, lineHeight: 1.25 }}>
      {item.brand} {item.model}
    </p>
  );

  const label = <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: 0 }}>{t('weRecommend')}</p>;

  const comparison = item ? compareRackets(mine, item) : null;
  const compareLine = comparison ? (
    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>
      {item?.brand} · {t(`compare${comparison.charAt(0).toUpperCase()}${comparison.slice(1)}`)}
    </p>
  ) : item ? (
    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>{item.brand}</p>
  ) : null;

  // Only interactive once there's a pick AND something to reveal. "Something"
  // is reasons OR warnings OR the flag-off single `reason` — NOT `reason`
  // alone: the engine can legitimately return `reasons: []` with a non-empty
  // `warnings` (e.g. a pure weight-safety flag with no positive reason to
  // report), and a warning is the one thing this card must never swallow. A
  // button that expands nothing is worse than a plain card, but a plain card
  // that hides a real warning is worse still.
  const hasReasons = !!reasons && reasons.length > 0;
  const hasWarnings = !!warnings && warnings.length > 0;
  const expandable = hasReasons || hasWarnings || !!reason;

  if (!item || !expandable) {
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
        hasReasons || hasWarnings ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {reasons?.map((r, i) => (
              <p key={`reason-${i}`} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                + {r}
              </p>
            ))}
            {warnings?.map((w, i) => (
              <p key={`warning-${i}`} style={{ fontSize: 'var(--fs-sm)', color: 'var(--sev-warn)', margin: 0, lineHeight: 1.4 }}>
                ! {w}
              </p>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
            {reason}
          </p>
        )
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
