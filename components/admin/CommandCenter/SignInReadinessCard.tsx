'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { useRevealReady } from '@/components/primitives/Reveal';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Readiness {
  total: number;
  ready: number;
  cannotSignIn: string[];
}

/**
 * "Who is locked out?" — members with no PIN, password or provider, who
 * cannot sign in now that members-only is permanent (docs/plans/members-only.md).
 *
 * It renders only while someone is locked out; an empty list is ordinary and
 * the card would be noise. (Before the flag retired on 2026-10-17 it also
 * rendered at zero, as the go-ahead for the flip.)
 *
 * A load failure is an explicit error, never a confident zero.
 */
export default function SignInReadinessCard({ refreshKey = 0, onOpenMember }: { refreshKey?: number; onOpenMember?: (name: string) => void }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/sign-in-readiness`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`readiness ${res.status}`);
      const d = (await res.json()) as Readiness;
      // A body without the list is a failed read, not a crash: the render below
      // reads `cannotSignIn.length`, and a TypeError there took down the whole
      // console (found once the console waited for this card to answer).
      if (!d || !Array.isArray(d.cannotSignIn)) throw new Error('readiness: malformed');
      setData(d);
    } catch {
      setData(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const title = 'Sign-in readiness';
  // The console's RevealSlot holds this place until the list has answered,
  // and closes it when there is nothing to work through.
  useRevealReady(data !== null || loadError);
  // `flex flex-col gap-3`, NOT `space-y-3`: the paragraphs below carry inline
  // `margin: 0`, and an inline margin beats `space-y`'s `> * + *` rule, which
  // left them flush under the subtitle. The CLAUDE.md gotcha, found on screen.

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="key"
        title={title}
        message={<>Couldn&apos;t check who can sign in. <StateLink onClick={() => void load()}>Try again</StateLink></>}
      >
        <PreviewRow width="48%" value="— of —" />
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <span className="state-line" style={{ width: '18%', height: 'var(--space-6)' }} />
          <span className="state-line" style={{ width: '22%', height: 'var(--space-6)' }} />
          <span className="state-line" style={{ width: '16%', height: 'var(--space-6)' }} />
        </div>
      </StateCard>
    );
  }
  if (!data) return null;
  const locked = data.cannotSignIn.length;
  if (locked === 0) return null;

  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
      <CardHeader
        icon="key"
        title={title}
        subtitle="These members are locked out until you let them in."
      />
      <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
        <strong>{data.ready}</strong> of {data.total} members can sign in.
      </p>
      <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
        {locked === 1 ? 'This member has' : `These ${locked} members have`} no PIN, password or Google yet. They can tap
        &ldquo;I play here already&rdquo; on the Log in page to ask you.
        {onOpenMember ? ' Tap a name to give them a recovery code.' : ''}
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {data.cannotSignIn.map((name) => (
          <li key={name}>
            {/* A name with nowhere to go was a list of problems with no
                fix attached; it opens the member, recovery code inside. */}
            <button
              type="button"
              className="fs-sm"
              disabled={!onOpenMember}
              onClick={() => onOpenMember?.(name)}
              aria-label={onOpenMember ? `Open ${name} in the roster` : undefined}
              style={{
                padding: 'var(--space-1) var(--space-4)',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--inner-card-bg)',
                border: '1px solid var(--inner-card-border)',
                color: 'var(--text-primary)',
                cursor: onOpenMember ? 'pointer' : 'default',
              }}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
