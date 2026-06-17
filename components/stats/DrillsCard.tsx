'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import type { DrillPick } from '@/lib/drills';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

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

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="glass-card p-5 space-y-3">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 22, color: 'var(--accent, #22c55e)', marginTop: 1 }}>
          fitness_center
        </span>
        <div>
          <h3 className="bpm-h3 m-0">{t('drills.title')}</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', lineHeight: 1.35 }}>{t('drills.purpose')}</p>
        </div>
      </div>
      {children}
    </div>
  );

  if (state.kind === 'error') {
    return (
      <Frame>
        <p className="text-red-400 text-xs" role="alert">{t('drills.error')}</p>
      </Frame>
    );
  }

  if (state.kind === 'needsAuth') {
    return (
      <Frame>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('drills.needsAuth')}</p>
      </Frame>
    );
  }

  if (state.kind !== 'ok') return null;

  return (
    <Frame>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state.drills.map((d) => (
          <li key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{d.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                {t('drills.minutes', { n: d.minutes })} · {t(`drills.setting.${d.setting}`)}
              </span>
            </div>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{d.description}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{d.reason}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
