'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { useActiveName } from '@/lib/useActiveName';
import { KUDOS_TAGS, TAG_ICON, type KudosCount } from '@/lib/kudos';
import CardHeader from '@/components/primitives/CardHeader';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'ok'; kudos: KudosCount[] }
  | { kind: 'error' }
  | { kind: 'needsAuth' };

/**
 * Private "Kudos you've received" card — counts per tag, never rater identities.
 * Stays quiet (renders nothing) until at least one kudos lands, so it never
 * shows an empty shell. Legible-fail otherwise.
 */
export default function KudosReceivedCard() {
  const t = useTranslations('stats');
  // Subscribed, not resolved-once — see the note in SkillTrendCard.
  const { name: activeName } = useActiveName();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/kudos?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) return { _needsAuth: true } as const;
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        if (d?._needsAuth) setState({ kind: 'needsAuth' });
        else if (Array.isArray(d?.kudos)) setState({ kind: 'ok', kudos: d.kudos as KudosCount[] });
        else setState({ kind: 'error' });
        setLoaded(true);
      })
      .catch(() => { setState({ kind: 'error' }); setLoaded(true); });
  }, [activeName]);

  useEffect(() => { load(); }, [load]);

  if (!activeName || !loaded) return null;
  // Quiet until there's something to celebrate.
  if (state.kind === 'ok' && state.kudos.length === 0) return null;
  if (state.kind === 'needsAuth') return null; // read-only nicety; no nag

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="volunteer_activism" title={t('kudos.receivedTitle')} />
      {children}
    </div>
  );

  if (state.kind === 'error') {
    return <Frame><ErrorState message={t('kudos.error')} /></Frame>;
  }
  if (state.kind !== 'ok') return null;

  return (
    <Frame>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {KUDOS_TAGS.filter((tag) => state.kudos.some((k) => k.tag === tag)).map((tag) => {
          const count = state.kudos.find((k) => k.tag === tag)?.count ?? 0;
          return (
            <li key={tag} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--border))', fontSize: 'var(--fs-base)', color: 'var(--text-secondary)',
            }}>
              {/* Accent on received chips — these are success semantics. */}
              <span
                className="material-icons"
                aria-hidden="true"
                style={{ fontSize: 'var(--icon-sm)', color: 'var(--accent)' }}
              >
                {TAG_ICON[tag]}
              </span>
              <span>{t(`kudos.tag.${tag}`)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>×{count}</span>
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}
