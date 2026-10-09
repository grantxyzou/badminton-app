/**
 * The one reading of "the server refused this caller".
 *
 * A 401 (no credential, or one that expired) and a 403 (a credential that is
 * not this member's, or not an admin's) mean the same thing to every client
 * surface in the app: retrying will not help, and the honest state is
 * "signed out / not yours", not "couldn't load". Ten components each spelled
 * the pair out by hand; one spelled it `=== 401` alone for a while and read a
 * 403 as a load failure. Name the pair once.
 */
export function isRefused(res: Pick<Response, 'status'>): boolean {
  return res.status === 401 || res.status === 403;
}

/**
 * The one reading of "this group has no session yet".
 *
 * A brand-new group has no active session until its organiser makes one, and
 * every read that needs a session answers 404 `no_active_session`
 * (`noActiveSession()` in `lib/groupContext.ts`). That is a STATE, not a
 * failure: a client that reads it as `!res.ok` tells a new organiser
 * "Couldn't check" / "Couldn't load the current session" on their very first
 * visit. Found walking the create-a-group journey on 2026-10-09. Reads the
 * body from a clone, so the caller can still consume the original.
 */
export async function isNoActiveSession(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  const body = (await res.clone().json().catch(() => null)) as { error?: string } | null;
  return body?.error === 'no_active_session';
}
