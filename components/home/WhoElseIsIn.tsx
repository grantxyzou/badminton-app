'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import MemberAvatar from '@/components/primitives/MemberAvatar';
import Collapse from '@/components/primitives/Collapse';

/* Five, not more: every face is width the label cannot use, and past five the
   sentence wrapped onto a second line at a phone width. */
const MAX_FACES = 5;

/**
 * "Sindhu, Kento and 3 others are in", under the sign-up count. Tap it and the
 * roster opens in place.
 *
 * SINCE 2026-09-16 THIS IS THE SIGN-UP LIST. The Sign-Ups tab left the nav
 * (Stringing took its slot), so the opened list carries what that tab did:
 * everyone in sign-up order and numbered, your own row marked, the waitlist as
 * a second section continuing the numbering, and a kudos button per name.
 * Cancelling your spot lives on the card itself (HomeTab), not in here.
 *
 * MOTION, per the motion system (app/globals.css, docs/plans/motion-pass.md):
 * - Each face APPEARS (`.motion-fade`, opacity only) when it first mounts,
 *   staggered but capped under 150ms in total. Faces are keyed by name, so a
 *   later refresh animates only someone who genuinely just joined.
 * - The list OPENS through `<Collapse>` and the chevron TURNS, only because
 *   someone asked for it.
 *
 * The collapsed row is about OTHER people: the faces lead with the newest and
 * leave the viewer out. The opened list is the roster, so the viewer is in it.
 *
 * Renders nothing when nobody else is in. That is a real empty (the roster
 * loaded and holds no one else), and the count above it already says so.
 */
export default function WhoElseIsIn({
  active,
  waitlist = [],
  me,
  onKudos,
}: {
  /** The active roster, in sign-up order. */
  active: string[];
  /** The waitlist, in order. */
  waitlist?: string[];
  me: string | null;
  /** Present only when the viewer may give kudos (they are on this roster). */
  onKudos?: (name: string) => void;
}) {
  const t = useTranslations('home.signup');
  const tPlayers = useTranslations('players');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const mine = me?.toLowerCase() ?? null;
  const isMe = (n: string) => n.toLowerCase() === mine;
  const others = active.filter((n) => !isMe(n)).reverse();
  if (others.length === 0) return null;

  const [a, b] = others;
  const label =
    others.length === 1
      ? t('othersInOne', { a })
      : others.length === 2
        ? t('othersInTwo', { a, b })
        : t('othersInMany', { a, b, count: others.length - 2 });
  const faces = others.slice(0, MAX_FACES);
  const hidden = others.length - faces.length;

  const row = (n: string, position: number, tone: 'green' | 'amber', kudos: boolean) => (
    <li key={n} className={`roster-row${isMe(n) ? ` player-highlight-${tone}` : ''}`}>
      <span className="roster-row__pos">{position}</span>
      <MemberAvatar name={n} size={24} />
      <span className="roster-row__name">{n}</span>
      {kudos && onKudos && !isMe(n) && (
        <button
          type="button"
          className="roster-row__kudos"
          onClick={() => onKudos(n)}
          aria-label={tPlayers('kudosAction', { name: n })}
        >
          <span className="material-icons icon-sm" aria-hidden="true">volunteer_activism</span>
        </button>
      )}
    </li>
  );

  return (
    <div>
      <button
        type="button"
        className="who-else-in"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar-stack" aria-hidden="true">
          {faces.map((n, i) => (
            <span
              key={n}
              className="avatar-stack__face motion-fade"
              style={{ animationDelay: `${Math.min(i, 5) * 25}ms` }}
            >
              <MemberAvatar name={n} size={24} />
            </span>
          ))}
          {hidden > 0 && <span className="avatar-stack__more">+{hidden}</span>}
        </span>
        <span className="who-else-in__label">{label}</span>
        <span className="material-icons icon-sm motion-chevron" aria-hidden="true">
          expand_more
        </span>
      </button>
      <Collapse open={open} id={listId} spaceAbove="var(--space-3)">
        <div className="roster">
          <ol className="roster-list">{active.map((n, i) => row(n, i + 1, 'green', true))}</ol>
          {waitlist.length > 0 && (
            <>
              <p className="section-label-muted roster-waitlist-label">{tPlayers('waitlistHeader')}</p>
              <ol className="roster-list">
                {waitlist.map((n, i) => row(n, active.length + i + 1, 'amber', false))}
              </ol>
            </>
          )}
        </div>
      </Collapse>
    </div>
  );
}
