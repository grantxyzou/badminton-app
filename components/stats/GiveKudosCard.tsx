'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import { useOnline } from '@/lib/useOnline';
import { KUDOS_TAGS, type KudosTag } from '@/lib/kudos';
import CardHeader from '@/components/primitives/CardHeader';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const LOG_WINDOW_MS = 48 * 60 * 60 * 1000;

const TAG_EMOJI: Record<KudosTag, string> = {
  great_defense: '🛡️',
  clutch: '🔥',
  most_improved: '📈',
  good_sport: '🤝',
  nice_shot: '🎯',
};

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

interface Game { teamA?: string[]; teamB?: string[] }

/**
 * Post-session "send kudos" card. Like GameLoggerCard it only appears within
 * 48h of a session you logged games in. Co-players are derived from those games
 * (you can only kudos people you actually played with — the server re-checks).
 * Positive-only: a fixed set of tags, one tap each, no scores.
 */
export default function GiveKudosCard() {
  const t = useTranslations('stats');
  const online = useOnline();
  const [you, setYou] = useState<string | null>(null);
  const [coPlayers, setCoPlayers] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  // Key `${name}:${tag}` → 'sending' | 'sent'.
  const [status, setStatus] = useState<Record<string, 'sending' | 'sent'>>({});

  useEffect(() => { setYou(resolveActiveName()); }, []);

  useEffect(() => {
    let live = true;
    if (!you) return;
    Promise.all([
      fetch(`${BASE}/api/session`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${BASE}/api/games`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { games: [] })),
    ])
      .then(([session, gamesResp]) => {
        if (!live) return;
        const datetime: string | undefined = session?.datetime;
        const start = datetime ? new Date(datetime).getTime() : NaN;
        const now = Date.now();
        const withinWindow = !!datetime && now >= start && now < start + LOG_WINDOW_MS;
        const youLower = you.toLowerCase();
        const others = new Set<string>();
        if (withinWindow) {
          for (const g of (gamesResp?.games ?? []) as Game[]) {
            const all = [...(g.teamA ?? []), ...(g.teamB ?? [])];
            if (!all.some((n) => n.toLowerCase() === youLower)) continue;
            for (const n of all) if (n.toLowerCase() !== youLower) others.add(n);
          }
        }
        setCoPlayers([...others].sort());
        setReady(true);
      })
      .catch(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [you]);

  const send = useCallback(async (recipientName: string, tag: KudosTag) => {
    const key = `${recipientName}:${tag}`;
    setStatus((s) => ({ ...s, [key]: 'sending' }));
    try {
      const res = await fetch(`${BASE}/api/kudos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientName, tag }),
      });
      // 201 (sent) and 409 (already sent) both end at "sent".
      if (res.ok || res.status === 409) {
        setStatus((s) => ({ ...s, [key]: 'sent' }));
      } else {
        setStatus((s) => { const n = { ...s }; delete n[key]; return n; });
      }
    } catch {
      setStatus((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  }, []);

  if (!you || !ready || coPlayers.length === 0) return null;

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="volunteer_activism" title={t('kudos.giveTitle')} subtitle={t('kudos.giveHint')} />
      {!online && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{t('kudos.offline')}</p>
      )}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {coPlayers.map((name) => (
          <li key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-primary)' }}>{name}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {KUDOS_TAGS.map((tag) => {
                const st = status[`${name}:${tag}`];
                const sent = st === 'sent';
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={!online || st === 'sending' || sent}
                    onClick={() => send(name, tag)}
                    aria-pressed={sent}
                    className="cc-btn cc-btn-ghost"
                    style={{
                      fontSize: 'var(--fs-sm)', padding: '4px 10px',
                      opacity: sent ? 0.55 : 1,
                      borderColor: sent ? 'var(--accent)' : undefined,
                      color: sent ? 'var(--accent)' : undefined,
                    }}
                  >
                    <span aria-hidden="true" style={{ marginRight: 4 }}>{TAG_EMOJI[tag]}</span>
                    {t(`kudos.tag.${tag}`)}{sent ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
