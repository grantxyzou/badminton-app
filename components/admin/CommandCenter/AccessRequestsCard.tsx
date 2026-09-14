'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import { useOnline } from '@/lib/useOnline';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Waiting {
  memberId: string;
  name: string;
  at: number;
  /** How many devices have an open request under this name. */
  count: number;
  /** Set only when `count` is 1 — the one request that can be approved. */
  requestId: string | null;
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

  async function decide(r: Waiting, decision: 'approve' | 'decline') {
    if (busy || !online) return;
    setBusy(r.memberId);
    try {
      const res = await fetch(`${BASE}/api/admin/access-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: r.memberId, requestId: r.requestId, decision }),
      });
      // 409: someone else asked under this name since the list loaded. Not a
      // failure — reloading shows the count, and the approve button goes.
      if (!res.ok && res.status !== 409) throw new Error(`decide ${res.status}`);
      await load();
    } catch {
      setLoadError(true);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="how_to_reg"
        title="Sign-in requests"
        message={<>Couldn&apos;t load sign-in requests. <StateLink onClick={() => void load()}>Try again</StateLink></>}
      >
        <PreviewRow icon="person" width="44%" value="" />
        <PreviewRow icon="person" width="36%" value="" />
      </StateCard>
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
        {waiting.map((r) => {
          const several = r.count > 1 || !r.requestId;
          return (
            <div
              key={r.memberId}
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="fs-md" style={{ display: 'block', fontWeight: 600 }}>
                  {r.name}
                </span>
                {several && (
                  <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>
                    {r.count} devices asked. Clear them, then have {r.name} ask again with you there.
                  </span>
                )}
              </div>
              {/* No device string, no IP, no location. They would be theatre —
                  unverifiable detail beside an approve button makes a decision
                  feel checked when it was not. The request is device-bound by a
                  secret, so approving admits the device that ASKED and nobody
                  else; that is what makes one tap safe. It is also why two
                  requests get no approve button: they cannot be told apart, so
                  either tap could let in the wrong one. */}
              {several ? (
                <button
                  type="button"
                  className="cc-btn cc-btn-secondary"
                  disabled={busy !== null || !online}
                  onClick={() => void decide(r, 'decline')}
                >
                  {busy === r.memberId ? 'Clearing…' : 'Clear'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="cc-btn cc-btn-ghost"
                    disabled={busy !== null || !online}
                    onClick={() => void decide(r, 'decline')}
                  >
                    Ignore
                  </button>
                  <button
                    type="button"
                    className="cc-btn cc-btn-primary"
                    disabled={busy !== null || !online}
                    onClick={() => void decide(r, 'approve')}
                  >
                    {busy === r.memberId ? 'Letting in…' : 'Let them in'}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
