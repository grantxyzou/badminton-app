'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { isFlagOn } from '@/lib/flags';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Readiness {
  total: number;
  ready: number;
  cannotSignIn: string[];
}

/**
 * "Who would be locked out?" — the list members-only's flip waits on
 * (docs/plans/members-only.md).
 *
 * BEFORE THE FLIP it always renders, including when everyone is ready: that
 * line is the go-ahead, and a card that vanished at zero would leave the admin
 * unsure whether the list was empty or had failed to load. AFTER the flip it
 * renders only while someone is still locked out, because by then an empty list
 * is ordinary and the card would be noise.
 *
 * A load failure is an explicit error, never a confident zero — "0 locked out"
 * is precisely the answer that would get the flag flipped.
 */
export default function SignInReadinessCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [loadError, setLoadError] = useState(false);
  const flipped = isFlagOn('NEXT_PUBLIC_FLAG_MEMBERS_ONLY');

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/sign-in-readiness`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`readiness ${res.status}`);
      setData((await res.json()) as Readiness);
    } catch {
      setData(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const title = 'Sign-in readiness';
  // `flex flex-col gap-3`, NOT `space-y-3`: the paragraphs below carry inline
  // `margin: 0`, and an inline margin beats `space-y`'s `> * + *` rule, which
  // left them flush under the subtitle. The CLAUDE.md gotcha, found on screen.

  if (loadError) {
    return (
      <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
        <CardHeader icon="key" title={title} />
        <ErrorState message="Couldn't check who can sign in — pull to refresh." />
      </section>
    );
  }
  if (!data) return null;
  const locked = data.cannotSignIn.length;
  if (flipped && locked === 0) return null;

  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
      <CardHeader
        icon="key"
        title={title}
        subtitle={
          flipped
            ? 'Members only is on. These members are locked out until you let them in.'
            : 'Before members only goes on, everyone needs a way to sign in.'
        }
      />
      <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
        <strong>{data.ready}</strong> of {data.total} members can sign in.
      </p>
      {locked === 0 ? (
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Everyone has a PIN, a password or Google. Nobody would be locked out.
        </p>
      ) : (
        <>
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {locked === 1 ? 'This member has' : `These ${locked} members have`} no PIN, password or Google yet. They can tap
            &ldquo;I play here already&rdquo; to ask you, or set up a sign-in on Profile while they still can.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {data.cannotSignIn.map((name) => (
              <li
                key={name}
                className="fs-sm"
                style={{
                  padding: 'var(--space-1) var(--space-4)',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--inner-card-bg)',
                  border: '1px solid var(--inner-card-border)',
                  color: 'var(--text-primary)',
                }}
              >
                {name}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
