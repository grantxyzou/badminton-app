'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import EmptyState from '@/components/primitives/EmptyState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The card with a row of names, measured on the page at 430px (2026-10-21). */
const READINESS_SKELETON_HEIGHT = 202;
/** "Only a PIN" with one row of names, measured on the page at 430px (2026-11-10). */
const PIN_ONLY_SKELETON_HEIGHT = 202;

interface PinOnlyEntry {
  name: string;
  rank?: 'organiser' | 'admin';
}

interface Readiness {
  total: number;
  ready: number;
  cannotSignIn: string[];
  /** Absent from a server older than docs/plans/pin-retirement.md step 1. */
  pinOnly?: PinOnlyEntry[];
}

const RANK_LABEL: Record<NonNullable<PinOnlyEntry['rank']>, string> = { organiser: 'Organiser', admin: 'Admin' };

/** A name that opens the member in the Roster. A name with nowhere to go was
 *  a list of problems with no fix attached. */
function NameChip({ name, note, onOpenMember }: { name: string; note?: string; onOpenMember?: (name: string) => void }) {
  return (
    <button
      type="button"
      // `.tap-44`: a 26px chip with a 44pt tap (the Apple pass, globals.css).
      className="fs-sm tap-44"
      disabled={!onOpenMember}
      onClick={() => onOpenMember?.(name)}
      aria-label={onOpenMember ? `Open ${name} in the roster` : undefined}
      style={{
        padding: 'var(--space-1) var(--space-4)',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--inner-card-bg)',
        border: '1px solid transparent',
        color: 'var(--text-primary)',
        cursor: onOpenMember ? 'pointer' : 'default',
      }}
    >
      {name}
      {note ? <span style={{ color: 'var(--text-muted)' }}> · {note}</span> : null}
    </button>
  );
}

// Rows 12px apart: each chip's 44pt tap reaches 9px past it, and at 6px a
// wrapped row's taps covered the row above.
const chipList = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-2)', rowGap: 'var(--space-4)' } as const;

/**
 * "Only a PIN" (docs/plans/pin-retirement.md, step 1): members whose ONE way
 * in is a PIN, so a forgotten one means asking for a recovery code. The page
 * only — on the console it would be a standing list nobody can clear from
 * there. Organisers and admins come first (the server sorts them): a
 * rank-holder on a PIN is the account a recovery code could take over.
 */
function PinOnlySection({ data, onOpenMember }: { data: Readiness & { pinOnly: PinOnlyEntry[] }; onOpenMember?: (name: string) => void }) {
  const title = 'Only a PIN';
  const count = data.pinOnly.length;
  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
      <CardHeader icon="lock" title={title} subtitle="Who can't get back in by themselves if they forget it." />
      <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
        <strong>{count}</strong> of {data.total} members sign in with a PIN only.
      </p>
      {count === 0 ? (
        <EmptyState>Nobody relies on a PIN alone.</EmptyState>
      ) : (
        <>
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Ask them to add Apple, Google or an email in Profile &rarr; How you sign in. Then a forgotten PIN is
            something they can fix themselves. Organisers and admins first.
          </p>
          <ul style={chipList}>
            {data.pinOnly.map((entry) => (
              <li key={entry.name}>
                <NameChip name={entry.name} note={entry.rank ? RANK_LABEL[entry.rank] : undefined} onOpenMember={onOpenMember} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
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
export default function SignInReadinessCard({
  refreshKey = 0,
  onOpenMember,
  standalone = false,
}: {
  refreshKey?: number;
  onOpenMember?: (name: string) => void;
  /**
   * On its own page (Admin → People → Sign-in readiness, 2026-10-21) the card
   * is the whole screen, so it holds its place while loading and says so
   * when nobody is locked out, instead of rendering nothing.
   */
  standalone?: boolean;
}) {
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
  if (!data) {
    if (!standalone) return null;
    // Both cards hold their place, so the page does not grow when the list lands.
    return (
      <>
        <CardSkeleton height={READINESS_SKELETON_HEIGHT} />
        <CardSkeleton height={PIN_ONLY_SKELETON_HEIGHT} />
      </>
    );
  }
  const main = readinessSection(data, standalone, title, onOpenMember);
  if (!standalone || !Array.isArray(data.pinOnly)) return main;
  return (
    <>
      {main}
      <PinOnlySection data={{ ...data, pinOnly: data.pinOnly }} onOpenMember={onOpenMember} />
    </>
  );
}

function readinessSection(
  data: Readiness,
  standalone: boolean,
  title: string,
  onOpenMember?: (name: string) => void,
) {
  const locked = data.cannotSignIn.length;
  if (locked === 0) {
    if (!standalone) return null;
    return (
      <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
        <CardHeader icon="key" title={title} subtitle="Who has a way to sign in." />
        <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
          <strong>{data.ready}</strong> of {data.total} members can sign in.
        </p>
        <EmptyState>Everyone has a PIN, password or Google. Nobody is locked out.</EmptyState>
      </section>
    );
  }

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
      <ul style={chipList}>
        {data.cannotSignIn.map((name) => (
          <li key={name}>
            {/* Opens the member, recovery code inside. */}
            <NameChip name={name} onOpenMember={onOpenMember} />
          </li>
        ))}
      </ul>
    </section>
  );
}
