import { isFlagOn } from '@/lib/flags';

/**
 * Whether the INVITE surfaces exist: the admin's link and code
 * (`GET /api/groups/invite`, the Command Center's Invite card, "Share sign-up
 * link") and the signed-out preview (`GET /api/groups/preview`).
 *
 * Multi-group needs them, and so does members-only: with that flag on a new
 * account can only be made with an invite, even while there is one club
 * (docs/plans/members-only.md), so the admin has to be able to hand one out.
 *
 * ONE DEFINITION, IMPORTED BY BOTH SIDES. The server's `lib/groupRoutes.ts`
 * had this rule and the client's `useInviteLink` had an older one (multi-group
 * alone). On 2026-10-03 production turned members-only on with multi-group
 * off, and the two disagreed in the one state that mattered: the server
 * answered the invite and nobody asked for it. The Invite card rendered with
 * no link, the shared sign-up link was the bare app address, and a new person
 * who opened it was asked for an invite code nobody could give them. A rule
 * added to a shared function is worthless if a caller reimplemented it —
 * CLAUDE.md, Gotchas. This file is client-safe (no server imports) so the hook
 * can use it directly; `__tests__/invites-on-canary.test.ts` fails the build
 * on a hand copy anywhere else.
 */
export const invitesOn = (): boolean =>
  isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') || isFlagOn('NEXT_PUBLIC_FLAG_MEMBERS_ONLY');
