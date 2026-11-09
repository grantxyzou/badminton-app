---
paths:
  - "lib/memberAvatar.ts"
  - "lib/useMemberAvatars.ts"
  - "components/primitives/MemberAvatar.tsx"
  - "components/profile/EditProfilePage.tsx"
  - "scripts/make-birdie-avatars.mjs"
  - "__tests__/birdie-avatar-images.test.ts"
  - "lib/racketLook.ts"
  - "scripts/make-racket-avatars.mjs"
  - "app/api/members/me/**"
  - "app/api/members/route.ts"
  - "__tests__/member-avatar.test.ts"
  - "__tests__/racket-avatar-images.test.ts"
  - "__tests__/components/MemberAvatar.test.tsx"
---

# Avatars

<!-- Moved word for word from the root CLAUDE.md on 2026-11-09 (step 2 of the trim), to keep the always-loaded file short. -->

A member's picture is never an upload. It is one of two kinds (`lib/memberAvatar.ts`, a tagged union):
- **A RACKET**, `{ kind: 'racket', racketId }`, drawn as the head of that racket's pre-rendered catalog image (`public/rackets/<id>.webp`, `racketSrc`).
- **A BIRDIE**, `{ kind: 'birdie', colour }`, one of the six logo shuttles in `BIRDIE_COLOURS` (2026-11-09, Grant: "I like my logo icon more … refine but not realistic"; "no more animate birds"). Each is a pre-rendered 256 px square that carries its own pale ground (`public/brand/birdies/<colour>.webp`, `birdieSrc`, ~3 KB), drawn by `node scripts/make-birdie-avatars.mjs`, where the paint lives once. `__tests__/birdie-avatar-images.test.ts` fails on a colour with no file. It is served from the app's own `public/`, not `assetUrl()`, whose storage container holds only the racket and string renders.

Absent = the initial. A kind older code does not know reads as no picture (`normalizeAvatar`), so a rollback shows the initial. Chosen on Profile → Edit profile (`components/profile/EditProfilePage.tsx`: Yours = initial / my racket, then Birdies), saved on tap by `PATCH /api/members/me { avatar }` with the member's own cookie or an admin. Compare two pictures with `sameAvatar` and key them with `avatarKey`; never read `.racketId` without checking the kind.
- **`components/primitives/MemberAvatar.tsx` is the one avatar**, everywhere a name appears; `lib/useMemberAvatars.ts` is the one read (`GET /api/members`, module-cached, looked up only where an avatar renders). Don't hand-roll an initial circle or fetch avatars per card.
- **"My racket" is copied at save, not followed**, so a roster costs one `members` read and no gear read per name — and a racket becomes a public picture only when its owner picks it, because club gear is otherwise cohort-gated (`CLUB_GEAR_MIN_COHORT`).
- A racket avatar sits on a ground picked against its OWN frame paint (`racketAvatarGround`: light behind a dark frame, dark behind a light one) — the per-name colours swallowed both. Initials keep the per-name colour.
- **A roster-sized avatar (≤ `AVATAR_CROP_MAX_PX`, 48) loads the HEAD CROP**, `public/rackets/avatar/<id>.webp` (`racketAvatarSrc`): 128 px, flattened onto that racket's ground, ~3 KB where the list picture is ~18 KB (2026-11-05). Profile's 112 px circle keeps the full picture. Served through `assetUrl()` like the other racket pictures, so they move to Blob Storage with the rest (`scripts/assets/upload.sh` sends all of `rackets/`). `node scripts/make-racket-avatars.mjs` cuts them; the rule for the ground is `racketGround` in `lib/racketLook.ts` (the script imports it), and `__tests__/racket-avatar-images.test.ts` fails on a racket with no avatar or an avatar on the wrong ground.
