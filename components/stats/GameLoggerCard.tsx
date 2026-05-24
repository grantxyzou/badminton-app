'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import GameLoggerSheet from './GameLoggerSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const ACCENT = 'var(--accent, #22c55e)';
const LOG_WINDOW_MS = 48 * 60 * 60 * 1000;

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
 * Slice-0 game-logger entry. The "Log Thursday" sheet only appears when the
 * viewer attended the active session AND it's within 48h of the session
 * datetime — the spec's short post-session window. Self-contained: fetches the
 * session + roster, resolves the viewer name, renders nothing when ineligible.
 */
export default function GameLoggerCard() {
  const t = useTranslations('valueHub');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  useEffect(() => {
    let live = true;
    if (!activeName) return;
    Promise.all([
      fetch(`${BASE}/api/session`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${BASE}/api/players`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([session, roster]) => {
        if (!live) return;
        const id = session?.sessionId || session?.id || null;
        const datetime: string | undefined = session?.datetime;
        const withinWindow = !!datetime && Date.now() < new Date(datetime).getTime() + LOG_WINDOW_MS;
        const attended = Array.isArray(roster)
          && roster.some((p: { name?: string }) =>
            typeof p?.name === 'string' && p.name.toLowerCase() === activeName.toLowerCase());
        setSessionId(id);
        setEligible(!!id && withinWindow && attended);
      })
      .catch(() => { if (live) setEligible(false); });
    return () => { live = false; };
  }, [activeName]);

  if (!eligible || !activeName || !sessionId) return null;

  return (
    <div className="glass-card p-5 space-y-3">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 22, color: ACCENT }}>sports_tennis</span>
        <div>
          <h3 className="bpm-h3 m-0">{t('logGameTitle')}</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, marginTop: 2 }}>{t('logGameHint')}</p>
        </div>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="cc-btn cc-btn-primary">
        {t('logGameSubmit')}
      </button>
      <GameLoggerSheet
        you={activeName}
        sessionId={sessionId}
        open={open}
        onClose={() => setOpen(false)}
        onLogged={() => { /* logged — future: refresh a games list */ }}
      />
    </div>
  );
}
