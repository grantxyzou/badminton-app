'use client';

import { useTranslations } from 'next-intl';
import MemberAvatar from '@/components/primitives/MemberAvatar';

const MAX_FACES = 3;

/**
 * "Viktor, Akane and 4 others are in", under the sign-up count.
 *
 * The count says how full the week is; this says who with, which is the part
 * people actually ask the group chat. Faces come from the roster the card
 * already loaded, so it costs no request.
 *
 * `names` is the ACTIVE roster in sign-up order. The newest names lead, since
 * "who just joined" is the live part of the list. The viewer is left out: your
 * own face in a row about other people reads as a bug.
 *
 * Renders nothing when nobody else is in. That is a real empty (the roster
 * loaded and holds no one else), and the count above it already says so.
 */
export default function WhoElseIsIn({ names, me }: { names: string[]; me: string | null }) {
  const t = useTranslations('home.signup');
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

  return (
    <p className="who-else-in">
      <span className="avatar-stack" aria-hidden="true">
        {others.slice(0, MAX_FACES).map((n) => (
          <MemberAvatar key={n} name={n} size={24} />
        ))}
      </span>
      <span>{label}</span>
    </p>
  );
}
