'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Slice-0 recommendation card. Fetches the single deterministic racket pick
 * for the active player (stage-aware, all-rounder fallback — see
 * `lib/recommend.ts`). Legible-fail per CLAUDE.md: a load failure renders a
 * distinct error pill, never a confidently-empty card.
 */
export default function RacketRecCard({ name }: { name: string }) {
  const t = useTranslations('valueHub');
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [reason, setReason] = useState<string>('');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    if (!name) return;
    fetch(`${BASE}/api/recommend?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        setItem(d.item ?? null);
        setReason(d.reason ?? '');
        setLoadError(false);
      })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [name]);

  if (loadError) {
    return <p className="text-red-400 text-xs" role="alert">{t('recError')}</p>;
  }
  // loaded-empty (no catalog / no pick yet): render nothing, not a fake card.
  if (!item) return null;

  return (
    <div className="cc-mini-card">
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>{t('recTitle')}</p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, margin: '2px 0' }}>{item.brand} {item.model}</p>
      {reason && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{reason}</p>}
    </div>
  );
}
