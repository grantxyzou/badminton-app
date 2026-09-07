'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Waiting {
  name: string;
  at: number;
}

/**
 * People waiting to be let in.
 *
 * The push notification is the fast path; this card is the one that works when
 * push is off, unconfigured, or simply missed — which for a notification about
 * one person on a Tuesday is most of the time. Without it the whole feature
 * depends on a channel nobody has promised to watch.
 *
 * RENDERS NOTHING WHEN NOBODY IS WAITING, which is the correct silence for a
 * card that is normally empty — but it renders its ERROR loudly, because "we
 * could not ask" and "nobody is waiting" look identical and only one of them
 * means someone is locked out.
 */
export default function AccessRequestsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const online = useOnline();
  const [waiting, setWaiting] = useState<Waiting[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/access-requests`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`access requests ${res.status}`);
      const body = await res.json();
      setWaiting(Array.isArray(body.requests) ? body.requests : []);
    } catch {
      setWaiting(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function decide(name: string, decision: 'approve' | 'decline') {
    if (busy || !online) return;
    setBusy(name);
    try {
      const res = await fetch(`${BASE}/api/admin/access-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, decision }),
      });
      if (!res.ok) throw new Error(`decide ${res.status}`);
      await load();
    } catch {
      setLoadError(true);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <section className="glass-card p-5 space-y-3" aria-label="Sign-in requests">
        <CardHeader icon="how_to_reg" title="Sign-in requests" />
        <ErrorState message="Couldn't load sign-in requests — pull to refresh." />
      </section>
    );
  }
  // Empty is the normal state and deserves no card at all.
  if (!waiting || waiting.length === 0) return null;

  return (
    <section className="glass-card p-5 space-y-3" aria-label="Sign-in requests">
      <CardHeader
        icon="how_to_reg"
        title="Sign-in requests"
        subtitle="They can't sign in and asked to be let in."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {waiting.map((r) => (
          <div
            key={r.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--inner-card-bg)',
              border: '1px solid var(--inner-card-border)',
            }}
          >
            <span className="fs-md" style={{ flex: 1, fontWeight: 600, minWidth: 0 }}>
              {r.name}
            </span>
            {/* No device string, no IP, no location. They would be theatre —
                unverifiable detail beside an approve button makes a decision
                feel checked when it was not. The request is device-bound by a
                secret, so approving admits the person who ASKED and nobody
                else; that is what actually makes one tap safe. */}
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              disabled={busy !== null || !online}
              onClick={() => void decide(r.name, 'decline')}
            >
              Ignore
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-primary"
              disabled={busy !== null || !online}
              onClick={() => void decide(r.name, 'approve')}
            >
              {busy === r.name ? 'Letting in…' : 'Let them in'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
