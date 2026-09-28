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
