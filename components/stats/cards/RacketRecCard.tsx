'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Compact "We recommend" card — the secondary half of the Stats racket row
 * (your racket is primary, this is the nudge beside it). Stage-aware pick with
 * all-rounder fallback (see lib/recommend.ts). Legible-fail per CLAUDE.md: a
 * load failure shows a distinct error pill; while loading it shows neither a
 * fake pick nor an error.
 */
export default function RacketRecCard({ name }: { name: string }) {
  const t = useTranslations('valueHub');
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    if (!name) return;
    fetch(`${BASE}/api/recommend?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) { setItem(d.item ?? null); setLoaded(true); setLoadError(false); } })
      .catch(() => { if (live) { setLoadError(true); setLoaded(true); } });
    return () => { live = false; };
  }, [name]);

  return (
    <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 112 }}>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>{t('weRecommend')}</p>
      {loadError ? (
        <ErrorState message={t('recError')} />
      ) : !loaded ? null : !item ? (
        <EmptyState>{t('recEmpty')}</EmptyState>
      ) : (
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, margin: 0, lineHeight: 1.25 }}>
          {item.brand} {item.model}
        </p>
      )}
    </div>
  );
}
