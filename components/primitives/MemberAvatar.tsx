'use client';

import { avatarColors } from '@/lib/avatar';
import { racketSrc } from '@/lib/racketLook';
import { racketAvatarGround, type MemberAvatar as Avatar } from '@/lib/memberAvatar';
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
  const neutral = tone === 'neutral' && !racketId;
  // A racket sits on a ground chosen against its own frame paint
  // (`racketAvatarGround`); an initial keeps the per-name colour.
  const colours = racketId
    ? { bg: racketAvatarGround(racketId), fg: 'inherit' }
    : neutral
      ? null
      : avatarColors(name);
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
        <img
          // Keyed so a changed racket (AvatarSheet's shuffle) fades in anew.
          key={racketId}
          className="member-avatar__racket"
          src={racketSrc(racketId)}
          alt=""
          loading="lazy"
          decoding="async"
          data-loaded="false"
          // An image already in the cache can finish before React attaches
          // onLoad, so the ref checks `complete` at commit — before paint — or
          // a cached avatar would sit invisible forever. A failed load is
          // shown too: the broken state is the honest one.
          ref={markIfLoaded}
          onLoad={markLoaded}
          onError={markLoaded}
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function markLoaded(e: { currentTarget: HTMLImageElement }) {
  e.currentTarget.dataset.loaded = 'true';
}

function markIfLoaded(el: HTMLImageElement | null) {
  if (el?.complete) el.dataset.loaded = 'true';
}
