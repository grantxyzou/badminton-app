/**
 * THE ONE LINK (docs/superpowers/plans/2026-11-04-app-clip.md, Task 1.1).
 *
 * An invite travels as `/bpm/j/<token>`, a PATH, so one URL can do the right
 * thing on every phone: the full app opens it where it is installed, the App
 * Clip will on an iPhone without the app, and the website answers it everywhere
 * else by redirecting to the `?join=` page it has always had. It is a path and
 * not a query because App Clip experiences match the START of a URL and most
 * Android versions match App Links by path only. Claiming the home page instead
 * would have pulled the Google and Apple sign-in pages into the app.
 *
 * THE SIGN-UP LINK, `/bpm/s`, lives here too: the plain "sign-ups are open"
 * link the admin posts in the group chat each week. It is the club's
 * noticeboard, not a key, so it carries no token. It has a path of its own for
 * the same reason the invite does: the app can claim `/bpm/s` and open a member
 * straight onto this week's session, already signed in, where the bare `/bpm`
 * could not be claimed without taking the sign-in pages with it.
 *
 * This file is the ONLY owner of both formats. The redirect route
 * (`app/j/[token]/route.ts`), the link the Invite card shares
 * (`lib/useInvites.ts`), the paste parser (`lib/parseInviteInput.ts`) and the
 * native app's link handler (`components/NativeBridge.tsx`) all read it, so
 * the four cannot drift. Pure and dependency-free: it runs in the browser, on
 * the server and under node.
 */

/** The segment after the base path. Shared with the AASA example and the Android filter. */
export const INVITE_LINK_SEGMENT = '/j/';

/**
 * A token as `lib/invites.ts` mints it: 16 random bytes in hex. Matched without
 * regard to case and normalised to lower case, because a hand-copied link can
 * come back upper-cased and the server looks the token up by its hash.
 */
const TOKEN = /^[0-9a-f]{32}$/i;

export function isInviteToken(value: string): boolean {
  return TOKEN.test(value);
}

/** `<base>/j/<token>`: the path an invite travels as. */
export function invitePath(token: string, base: string): string {
  return `${base}${INVITE_LINK_SEGMENT}${token}`;
}

/**
 * The token in `<base>/j/<token>` (a trailing slash allowed), or `null` for any
 * other path. Nothing after the token is accepted: a link to anything else is
 * not an invite.
 */
export function tokenFromInvitePath(pathname: string, base: string): string | null {
  const prefix = `${base}${INVITE_LINK_SEGMENT}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/$/, '');
  return isInviteToken(rest) ? rest.toLowerCase() : null;
}

/** The sign-up link's segment after the base path: exact, no query, no token. */
export const SIGNUP_LINK_PATH = '/s';

/** `<base>/s`: the club's sign-up link, the one the weekly message carries. */
export function signupPath(base: string): string {
  return `${base}${SIGNUP_LINK_PATH}`;
}

/** True for `<base>/s` (a trailing slash allowed) and nothing else. */
export function isSignupPath(pathname: string, base: string): boolean {
  return pathname === signupPath(base) || pathname === `${signupPath(base)}/`;
}

/**
 * Where the sign-up link lands, on the website and in the app alike: Home,
 * where this week's sign-up card is. `?tab=home` is a deep link, honoured once
 * and stripped, so a phone that was last on another tab still lands on the week.
 */
export function signupLanding(base: string): string {
  return `${base}?tab=home`;
}
