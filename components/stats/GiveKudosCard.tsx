'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useActiveName } from '@/lib/useActiveName';
import { useOnline } from '@/lib/useOnline';
import { KUDOS_TAGS, TAG_ICON, type KudosTag } from '@/lib/kudos';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const LOG_WINDOW_MS = 48 * 60 * 60 * 1000;

interface Game { teamA?: string[]; teamB?: string[] }

/** A read that either produced a body or did not. `{ ok: false }` is UNKNOWN —
 *  never a stand-in value, which is how the old `r.ok ? r.json() : { games: [] }`
 *  rewrote an HTTP failure into success-with-no-games before any `.catch` could
 *  see it. */
type Read<T> = { ok: true; value: T } | { ok: false };

async function readJson<T>(url: string): Promise<Read<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false };
    return { ok: true, value: (await res.json()) as T };
  } catch {
    return { ok: false };
  }
}

/**
 * Post-session "send kudos" card. Like GameLoggerCard it only appears within
 * 48h of a session you logged games in. Co-players are derived from those games
 * (you can only kudos people you actually played with — the server re-checks).
 * Positive-only: a fixed set of tags, one tap each, no scores.
 */
export default function GiveKudosCard() {
  const t = useTranslations('stats');
  const online = useOnline();
  // Subscribed, not resolved-once — see the note in SkillTrendCard.
  const { name: you } = useActiveName();
  const [coPlayers, setCoPlayers] = useState<string[]>([]);
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  // Key `${name}:${tag}` → 'sending' | 'sent'.
  const [status, setStatus] = useState<Record<string, 'sending' | 'sent'>>({});
  // A POST that did not land. Same shape as LearnRegister's `saveError`:
  // cleared at the start of every attempt, so it never outlives its cause.
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    let live = true;
    if (!you) return;
    Promise.all([
      readJson<{ datetime?: string }>(`${BASE}/api/session`),
      readJson<{ games?: Game[] }>(`${BASE}/api/games`),
    ])
      .then(([sessionRead, gamesRead]) => {
        if (!live) return;
        // The session read decides whether the 48h window is even open. If it
        // failed, the window is UNKNOWN — and "unknown" must not render as the
        // card's designed absence, which is a claim that there is nothing to
        // do here.
        if (!sessionRead.ok) { setLoad('error'); return; }

        const datetime = sessionRead.value?.datetime;
        const start = datetime ? new Date(datetime).getTime() : NaN;
        const now = Date.now();
        const withinWindow = !!datetime && now >= start && now < start + LOG_WINDOW_MS;

        // Known-outside-the-window: no card belongs here at all, and a games
        // failure is irrelevant because we would not have read it. This is the
        // legitimate emptiness the error state must stay distinct from.
        if (!withinWindow) { setCoPlayers([]); setLoad('ready'); return; }

        // In the window, so the games list IS the card's content. A failed read
        // used to arrive as `{ games: [] }`, emptying `coPlayers` and unmounting
        // the card — a player who logged games silently lost the ability to
        // send kudos.
        if (!gamesRead.ok) { setLoad('error'); return; }

        const youLower = you.toLowerCase();
        const others = new Set<string>();
        for (const g of (gamesRead.value?.games ?? []) as Game[]) {
          const all = [...(g.teamA ?? []), ...(g.teamB ?? [])];
          if (!all.some((n) => n.toLowerCase() === youLower)) continue;
          for (const n of all) if (n.toLowerCase() !== youLower) others.add(n);
        }
        setCoPlayers([...others].sort());
        setLoad('ready');
      });
    return () => { live = false; };
  }, [you]);

  const send = useCallback(async (recipientName: string, tag: KudosTag) => {
    const key = `${recipientName}:${tag}`;
    setSendError(false);
    setStatus((s) => ({ ...s, [key]: 'sending' }));
    // A failed send drops the 'sending' key, which re-enables the button — and
    // on its own that looks exactly like a button nobody ever pressed. The
    // member walks away believing they sent recognition that was never
    // written, so the failure has to say so.
    const failed = () => {
      setStatus((s) => { const n = { ...s }; delete n[key]; return n; });
      setSendError(true);
    };
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
        failed();
      }
    } catch {
      failed();
    }
  }, []);

  if (!you || load === 'loading') return null;

  if (load === 'error') {
    return (
      <div className="glass-card p-5 space-y-3">
        <CardHeader icon="volunteer_activism" title={t('kudos.giveTitle')} subtitle={t('kudos.giveHint')} />
        <ErrorState message={t('kudos.error')} />
      </div>
    );
  }

  // Loaded, and there is genuinely nobody to thank (outside the window, or no
  // logged games with anyone else). Renders nothing, as designed.
  if (coPlayers.length === 0) return null;

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
                    {/* Inherits the button's colour, so the glyph turns accent
                        along with the pill once sent. */}
                    <span
                      className="material-icons"
                      aria-hidden="true"
                      style={{ marginRight: 4, fontSize: 'var(--icon-sm)', verticalAlign: 'text-bottom' }}
                    >
                      {TAG_ICON[tag]}
                    </span>
                    {t(`kudos.tag.${tag}`)}
                    {sent && (
                      <span
                        className="material-icons"
                        aria-hidden="true"
                        style={{ marginLeft: 4, fontSize: 'var(--icon-sm)', verticalAlign: 'text-bottom' }}
                      >
                        check_circle
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {sendError && <ErrorState message={t('kudos.sendError')} />}
    </div>
  );
}
