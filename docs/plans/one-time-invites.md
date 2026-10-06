# One-time invites

**Track:** members-only (docs/plans/members-only.md) — how a new person gets in
**Status:** in-flight (built 2026-10-06; ships with its PR)
**Review on:** 2026-11-06 — did an admin get stuck creating or sending a link, and did anyone report a link that "didn't work" (used, expired, or the old club-wide one)?

## Problem

Grant, 2026-10-06, after the invite link was fixed (#517) and he asked whether
it expires: "lets make it one time used link." Until then a club had ONE link
and ONE code, both permanent and multi-use, sitting in the group chat for a
season; the only revocation was regenerating the pair. A link forwarded once
too far was an open door with no record of who came through it.

## Kill criterion

Admins stop creating links because it is a chore, and newcomers come in
through "I play here already" (an admin approval) instead. If, by the review
date, fewer new accounts arrive by invite than by access request, the
per-person link is more friction than the club wants, and the club-wide link
should come back as an option.

## Non-goals

- A per-invite name or note ("for Tai Tzu"). The admin knows who they sent it
  to; the join notice (#517) names who used it.
- An audit list of USED invites in the card. The join notice is the record.
- Any change to the "I play here already" access-request path.

## Decisions

- **Replace, not add.** Grant chose per-person one-time links over keeping the
  club-wide link alongside them: a permanent door next to single-use ones makes
  single-use decorative. The old club-wide link and code stop working on
  deploy; the admin re-shares a fresh one.
- **7-day expiry** for an unused link, so a forgotten one cannot be found and
  used months later. Grant's choice over 24 hours and never.
- **Each link carries its own one-time code**, same rules, for the places a
  link will not paste (WeChat).
- **The weekly "Share sign-up link" goes back to the plain app address.** A
  one-time link in a group chat is used up by the first tap.
- **The club record is the authority, not the invite doc.** A `Group` keeps a
  list of its live invites (`invites`, additive); an invite is live exactly
  while it is on that list and unexpired. Using one REMOVES it from the list
  under an etag condition, so two people racing on the same link cannot both
  get in; whichever write lands second is refused. The invite docs themselves
  are then stamped used and their plaintext dropped. This keeps the
  pointer-as-authority shape the multi-use design had (the delete was never
  load-bearing) and makes single-use a comparison on READ plus one
  conditional write.
- **Claim first, release on refusal.** The sign-up terminals claim the invite
  before creating the account and put it back if the sign-up then fails for
  another reason (name taken, a database error). Claiming after success would
  let two sign-ups through on one link.
- **A repeat join does not consume.** A member already on the roster who taps
  a one-time link gets "welcome back" and the link stays live for the person
  it was meant for.

## Shape

| Piece | File |
|---|---|
| Mint, list, revoke, resolve, claim | `lib/invites.ts` |
| Live-invite list on the club record | `lib/types.ts` → `Group.invites` |
| Claim carried through sign-up | `lib/inviteSignup.ts`, `app/api/auth/{signup,complete-signup}/route.ts`, `app/api/groups/join/route.ts` |
| Admin API: list, create, revoke | `app/api/groups/invite/route.ts` |
| Admin card | `components/admin/CommandCenter/InviteCard.tsx`, `lib/useInvites.ts` |
| Weekly share without an invite | `lib/signupShare.ts`, `NextSessionCard`, `AdvanceSessionForm` |
