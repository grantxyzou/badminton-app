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
 * This file is the ONLY owner of the format. The redirect route
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
