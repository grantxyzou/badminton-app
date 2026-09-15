'use client';

import { avatarColors } from '@/lib/avatar';
import { racketSrc } from '@/lib/racketLook';
import type { MemberAvatar as Avatar } from '@/lib/memberAvatar';
import { useMemberAvatars } from '@/lib/useMemberAvatars';

interface Props {
  name: string;
  /**
   * The member's picture when the caller already has it (Profile, the admin
   * roster). Omit it and the avatar is looked up by name through
   * `useMemberAvatars` — so the roster read happens only where an avatar is
   * actually on screen. `null` means "the initial", explicitly.
   */
  avatar?: Avatar | null;
  /** Diameter in px. */
  size?: number;
  /**
   * `neutral` for the one place there is only ever one person (Profile), where
   * a per-name colour is a stray brand colour, not a way to tell people apart.
   */
  tone?: 'name' | 'neutral';
}

/**
 * The circle beside a member's name, everywhere a name appears.
 *
 * A racket avatar is the head of that racket's catalog image
 * (`public/rackets/<id>.webp`), cropped by `.member-avatar__racket` — no upload,
 * no storage, nothing to moderate. Without one it is the initial it always was.
 * Decorative: the name beside it is the accessible label.
 */
export default function MemberAvatar({ name, avatar: given, size = 32, tone = 'name' }: Props) {
  const avatarFor = useMemberAvatars();
  const avatar = given === undefined ? avatarFor(name) : given;
  const racketId = avatar?.kind === 'racket' ? avatar.racketId : null;
  // A racket always sits on its colour: the renders are pale, and on the
  // neutral circle they all but vanish in the light theme.
  const neutral = tone === 'neutral' && !racketId;
  const colours = neutral ? null : avatarColors(name);
  return (
    <span
      aria-hidden="true"
      className={`member-avatar${neutral ? ' member-avatar--neutral' : ''}`}
      data-avatar={racketId ? 'racket' : 'initial'}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        ...(colours ? { background: colours.bg, color: colours.fg } : {}),
      }}
    >
      {racketId ? (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin static crop; next/image would add a loader round-trip per roster row
        <img className="member-avatar__racket" src={racketSrc(racketId)} alt="" loading="lazy" decoding="async" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
