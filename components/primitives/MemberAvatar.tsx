'use client';

import { avatarColors } from '@/lib/avatar';
import { AVATAR_CROP_MAX_PX, racketAvatarSrc, racketSrc } from '@/lib/racketLook';
import { birdieSrc, racketAvatarGround, type MemberAvatar as Avatar } from '@/lib/memberAvatar';
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
  /** Diameter in px at the default size; drawn in rem, so it scales. */
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
 * (`public/rackets/<id>.webp`), cropped by `.member-avatar__racket`; a birdie is
 * one of the six logo shuttles (`public/brand/birdies/<colour>.webp`). No upload,
 * no storage, nothing to moderate. Without either it is the initial it always was.
 * Decorative: the name beside it is the accessible label.
 */
export default function MemberAvatar({ name, avatar: given, size = 32, tone = 'name' }: Props) {
  const avatarFor = useMemberAvatars();
  const avatar = given === undefined ? avatarFor(name) : given;
  const racketId = avatar?.kind === 'racket' ? avatar.racketId : null;
  const birdie = avatar?.kind === 'birdie' ? avatar.colour : null;
  const neutral = tone === 'neutral' && !racketId && !birdie;
  // A racket sits on a ground chosen against its own frame paint
  // (`racketAvatarGround`); a birdie's picture carries its own ground; an
  // initial keeps the per-name colour.
  const colours = racketId
    ? { bg: racketAvatarGround(racketId), fg: 'inherit' }
    : birdie || neutral
      ? null
      : avatarColors(name);
  return (
    <span
      aria-hidden="true"
      className={`member-avatar${neutral ? ' member-avatar--neutral' : ''}`}
      data-avatar={racketId ? 'racket' : birdie ? 'birdie' : 'initial'}
      // In rem so the circle grows with the app's size factor (docs/plans/ui-scale.md):
      // `size` stays the designed diameter in px at the default text size.
      style={{
        width: `${size / 16}rem`,
        height: `${size / 16}rem`,
        fontSize: `${(size * 0.42) / 16}rem`,
        ...(colours ? { background: colours.bg, color: colours.fg } : {}),
      }}
    >
      {racketId ? (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin static crop; next/image would add a loader round-trip per roster row
        <img
          // Keyed so a changed racket fades in anew.
          key={racketId}
          className="member-avatar__racket"
          // A roster-sized circle takes the head crop (~6 KB, not ~18 KB);
          // Profile's large one keeps the full picture so it stays sharp.
          src={size <= AVATAR_CROP_MAX_PX ? racketAvatarSrc(racketId) : racketSrc(racketId)}
          alt=""
          // Every catalog image is 240×624. The CSS sets the rendered width;
          // these only give a lazy image its ratio before it loads (Chrome
          // flags a lazy <img> without them, though this one is absolute in
          // a fixed circle and cannot shift anything).
          width={240}
          height={624}
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
      ) : birdie ? (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin ~3 KB static picture, as the racket crop above
        <img
          key={birdie}
          className="member-avatar__birdie"
          src={birdieSrc(birdie)}
          alt=""
          width={256}
          height={256}
          loading="lazy"
          decoding="async"
          data-loaded="false"
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
