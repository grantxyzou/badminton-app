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
 * whole list opens in place.
 *
 * The count says how full the week is; this says who with, which is the part
 * people actually ask the group chat. Faces come from the roster the card
 * already loaded, so it costs no request.
 *
 * MOTION, per the motion system (app/globals.css, docs/plans/motion-pass.md):
 * - Each face APPEARS (`.motion-fade`, opacity only) when it first mounts,
 *   staggered but capped under 150ms in total. It is a real list, which is the
 *   one case the motion pass allows a stagger; and because faces are keyed by
 *   name, a later refresh animates only someone who genuinely just joined.
 *   Nothing moves once they have landed.
 * - The list OPENS through `<Collapse>` and the chevron TURNS. That motion
 *   happens because someone asked for it, never on its own.
 *
 * `names` is the ACTIVE roster in sign-up order. The newest lead, since "who
 * just joined" is the live part of the list. The viewer is left out: your own
 * face in a row about other people reads as a bug.
 *
 * Renders nothing when nobody else is in. That is a real empty (the roster
 * loaded and holds no one else), and the count above it already says so.
 */
export default function WhoElseIsIn({ names, me }: { names: string[]; me: string | null }) {
  const t = useTranslations('home.signup');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const mine = me?.toLowerCase() ?? null;
  const others = names.filter((n) => n.toLowerCase() !== mine).reverse();
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
        <ul className="who-else-list">
          {others.map((n) => (
            <li key={n}>
              <MemberAvatar name={n} size={24} />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  );
}
