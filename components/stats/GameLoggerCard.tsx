'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import GameLoggerSheet from './GameLoggerSheet';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

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
 * Game-logger entry. Usable any day — logging is decoupled from the session
 * window and roster (the server files the game under the active session and
 * only requires the member_session cookie). We still resolve the active
 * sessionId as the bucket the sheet posts to.
 *
 * Honest tri-state (no silent null on failure — see "lying empty state" rule):
 *   loading      → render nothing (transient; avoids a no→yes flash)
 *   no-identity  → render nothing (the tab's StatsSignedOut covers signed-out)
 *   error        → an explicit "couldn't load" pill, never a blank
 *   ready        → the always-on logger
 */
type Status = 'loading' | 'no-identity' | 'ready' | 'error';

export default function GameLoggerCard() {
  const t = useTranslations('valueHub');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [identResolved, setIdentResolved] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setActiveName(resolveActiveName());
    setIdentResolved(true);
  }, []);

  useEffect(() => {
    if (!identResolved) return;
    if (!activeName) { setStatus('no-identity'); return; }
    let live = true;
    setStatus('loading');
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('session_load_failed'))))
      .then((session) => {
        if (!live) return;
        // The game is filed under the active session server-side regardless;
        // this is just the bucket the sheet posts to.
        const id = session?.sessionId || session?.id || null;
        setSessionId(id);
        setStatus('ready');
      })
      .catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, [identResolved, activeName]);

  if (status === 'no-identity') return null;
  // Loading: reserve the card's footprint instead of rendering blank.
  if (status === 'loading') return <CardSkeleton height={120} />;

  if (status === 'error') {
    return (
      <div className="glass-card p-5">
        <p className="text-xs" role="alert" style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
          {t('logGameError')}
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-5 space-y-3 animate-fadeIn">
      <CardHeader icon="sports_tennis" title={t('logGameTitle')} subtitle={t('logGameHint')} />
      <button type="button" onClick={() => setOpen(true)} className="cc-btn cc-btn-primary">
        {t('logGameSubmit')}
      </button>
      {activeName && sessionId && (
        <GameLoggerSheet
          you={activeName}
          sessionId={sessionId}
          open={open}
          onClose={() => setOpen(false)}
          onLogged={() => { /* logged — future: refresh a games list */ }}
        />
      )}
    </div>
  );
}
