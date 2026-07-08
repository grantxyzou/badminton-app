'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { getIdentity } from '@/lib/identity';
import type { DrillPick } from '@/lib/drills';
import CardHeader from '@/components/primitives/CardHeader';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

/** Per-setting accent + subset-safe icon for the drill tiles. Colors are
 *  theme-aware tokens; icons are confirmed present in the Material Symbols
 *  subset (see app/layout.tsx). */
const SETTING_STYLE: Record<DrillPick['setting'], { color: string; icon: string }> = {
  solo: { color: 'var(--accent)', icon: 'fitness_center' },
  pair: { color: 'var(--accent-amber)', icon: 'sports_tennis' },
  group: { color: 'var(--sev-low-text)', icon: 'groups' },
};

/** Same identity chain as the other stats cards: real identity → preview-name → null. */
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

type LoadState =
  | { kind: 'idle' }
  | { kind: 'ok'; drills: DrillPick[] }
  | { kind: 'error' }
  | { kind: 'needsAuth' };

/**
 * Private "Practice this week" card — concrete drills for the member's
 * lowest-rated skills, from the deterministic drills engine. Legible-fail
 * throughout: an explicit error pill on load failure and an actionable
 * "sign in again" state on 403, never a confident-but-wrong empty list.
 */
export default function DrillsCard() {
  const t = useTranslations('stats');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<DrillPick | null>(null);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  const load = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/stats/drills?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) return { _needsAuth: true } as const;
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        if (d?._needsAuth) setState({ kind: 'needsAuth' });
        else if (Array.isArray(d?.drills)) setState({ kind: 'ok', drills: d.drills as DrillPick[] });
        else setState({ kind: 'error' });
        setLoaded(true);
      })
      .catch(() => {
        setState({ kind: 'error' });
        setLoaded(true);
      });
  }, [activeName]);

  useEffect(() => { load(); }, [load]);

  if (!activeName || !loaded) return null;
  // Nothing to work on yet (no check-in) — stay quiet rather than show an empty shell.
  if (state.kind === 'ok' && state.drills.length === 0) return null;

  if (state.kind === 'error') {
    return (
      <section className="space-y-3">
        <CardHeader icon="fitness_center" title={t('drills.title')} />
        <div className="glass-card p-4">
          <ErrorState message={t('drills.error')} />
        </div>
      </section>
    );
  }

  if (state.kind === 'needsAuth') {
    return (
      <section className="space-y-3">
        <CardHeader icon="fitness_center" title={t('drills.title')} />
        <div className="glass-card p-4">
          <EmptyState>{t('drills.needsAuth')}</EmptyState>
        </div>
      </section>
    );
  }

  if (state.kind !== 'ok') return null;

  return (
    <section className="space-y-4">
      {/* Section header lives on the page — not inside a card. */}
      <CardHeader icon="fitness_center" title={t('drills.title')} />
      {/* Discover-style: a horizontal, swipeable rail of glanceable drill
          tiles. Faces stay minimal (skill · title · duration); the full
          how-to opens in a bottom sheet on tap. Generous padding + inter-tile
          gap so the rail breathes (more than the reference). */}
      <ul
        style={{
          margin: 0,
          padding: 0,
          paddingTop: 'var(--space-1)',
          paddingBottom: 'var(--space-2)',
          listStyle: 'none',
          display: 'flex',
          gap: 'var(--space-4)',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        {state.drills.map((d) => {
          const s = SETTING_STYLE[d.setting];
          return (
            <li key={d.id} style={{ flex: '0 0 auto', scrollSnapAlign: 'start' }}>
              <button
                type="button"
                onClick={() => setSelected(d)}
                className="glass-card p-5"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 'var(--space-4)',
                  width: 'clamp(208px, 74vw, 252px)',
                  minHeight: 188,
                  textAlign: 'left',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                {/* Setting-colored icon disc. */}
                <span
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-pill)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: `color-mix(in srgb, ${s.color} 16%, transparent)`,
                  }}
                >
                  <span className="material-icons" style={{ fontSize: 'var(--icon-lg)', color: s.color }}>{s.icon}</span>
                </span>
                {/* Skill eyebrow + drill title (2-line clamp). */}
                <span style={{ display: 'block' }}>
                  <span
                    className="fs-2xs"
                    style={{
                      display: 'block',
                      marginBottom: 'var(--space-1)',
                      color: s.color,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontWeight: 700,
                    }}
                  >
                    {d.skillLabel}
                  </span>
                  <span
                    className="fs-md font-semibold"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      color: 'var(--text-primary)',
                      lineHeight: 'var(--lh-tight)',
                    }}
                  >
                    {d.title}
                  </span>
                </span>
                {/* Emphasized duration + setting label. */}
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                  <span
                    className="font-bold whitespace-nowrap"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat)', color: 'var(--text-primary)' }}
                  >
                    {t('drills.minutes', { n: d.minutes })}
                  </span>
                  <span className="fs-2xs" style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t(`drills.setting.${d.setting}`)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected && <DrillDetailSheet drill={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

/** Tap-through detail for a drill tile — the full how-to + why, in a sheet so
 *  the rail faces can stay glanceable. */
function DrillDetailSheet({ drill, onClose }: { drill: DrillPick; onClose: () => void }) {
  const t = useTranslations('stats');
  const s = SETTING_STYLE[drill.setting];
  return (
    <BottomSheet open onClose={onClose} ariaLabel={drill.title} maxHeight="70vh" className="max-w-lg mx-auto">
      <div
        style={{
          background: 'var(--glass-bg)',
          WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
          backdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
          border: '1px solid var(--glass-border)',
          borderBottom: 'none',
          boxShadow: 'var(--glass-shadow)',
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          minHeight: 0,
        }}
      >
        <BottomSheetHeader className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="bpm-h3 m-0" style={{ color: 'var(--text-primary)' }}>{drill.title}</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-full"
            style={{ width: 32, height: 32, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}
          >
            <span className="material-icons" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody className="px-5 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          {/* Meta: skill chip · duration · setting. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            <span
              className="fs-2xs"
              style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: s.color,
                border: `1px solid color-mix(in srgb, ${s.color} 35%, transparent)`,
                whiteSpace: 'nowrap',
              }}
            >
              {drill.skillLabel}
            </span>
            <span className="font-bold" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat)', color: 'var(--text-primary)' }}>
              {t('drills.minutes', { n: drill.minutes })}
            </span>
            <span className="fs-2xs" style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t(`drills.setting.${drill.setting}`)}
            </span>
          </div>
          <p className="fs-md" style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', margin: 0 }}>{drill.description}</p>
          <p className="fs-sm italic" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)', marginBottom: 0 }}>{drill.reason}</p>
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}
