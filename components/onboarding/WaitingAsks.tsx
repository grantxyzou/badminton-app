'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const POLL_MS = 20_000;

export interface Ask {
  groupId: string;
  club: string;
  name: string | null;
  state: 'waiting' | 'in' | 'closed';
}

interface Props {
  asks: Ask[];
  /** Let in: the cookie is moved to the club and the page reloads into it. */
  onIn: () => void;
}

/**
 * "Waiting for {club}" (docs/plans/one-way-in.md, step 4): an account that
 * asked to join through a club's link and is in no club yet. The organiser's
 * yes arrives by email, so nothing here has to stay open; while it IS open it
 * checks back every twenty seconds and when the app comes back to the front,
 * and moves straight into the club once let in.
 *
 * Only the person's own asks (`GET /api/groups/ask`), so "not let in this
 * time" is said plainly: it tells them nothing about anyone else.
 */
export default function WaitingAsks({ asks: initial, onIn }: Props) {
  const t = useTranslations('signedOut.waiting');
  const [asks, setAsks] = useState<Ask[]>(initial);
  const moving = useRef(false);

  const enter = useCallback(
    async (groupId: string) => {
      if (moving.current) return;
      moving.current = true;
      try {
        await fetch(`${BASE}/api/groups/switch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId }),
        });
      } catch {
        /* the reload still shows the club in their list */
      }
      onIn();
    },
    [onIn],
  );

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/groups/ask`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { asks?: Ask[] };
      if (!Array.isArray(body.asks)) return;
      const inNow = body.asks.find((a) => a.state === 'in' && asks.some((w) => w.groupId === a.groupId));
      if (inNow) {
        void enter(inNow.groupId);
        return;
      }
      setAsks(body.asks.filter((a) => a.state !== 'in'));
    } catch {
      /* a missed check is retried on the next tick */
    }
  }, [asks, enter]);

  const waiting = asks.some((a) => a.state === 'waiting');
  useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [waiting, check]);

  if (asks.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {asks.map((a) => (
        <div key={a.groupId} className="glass-card" style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-5)' }}>
          <p className="bpm-h3" style={{ margin: 0 }} role="status">
            {a.state === 'waiting' ? t('waitingTitle', { club: a.club }) : t('closedTitle', { club: a.club })}
          </p>
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>
            {a.state === 'waiting'
              ? a.name
                ? t('waitingBody', { name: a.name })
                : t('waitingBodyNoName')
              : t('closedBody')}
          </p>
        </div>
      ))}
    </div>
  );
}
