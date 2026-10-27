/**
 * What an admin is told when "Check now" (the ledger reconcile,
 * `POST /api/admin/ledger/reconcile`) does not run.
 *
 * Both buttons — the Ledger page's check sheet and the E-transfers row —
 * used to turn every failure into one line, "Couldn't run the check — try
 * again", with the status thrown away and the body never read. A failure on
 * 2026-10-08 could only be chased by asking for the browser console, and it
 * never was (#733). The route already says which failure it is; this keeps it.
 *
 * Every message ends with the status code, so a screenshot is a diagnosis.
 * `null` is a request that never got an answer (offline, DNS, a dropped
 * connection): `fetch` threw, there is no status to show.
 */
import { isRefused } from './apiFetch';

export function reconcileFailureMessage(status: number | null, errorKey: string | null): string {
  if (status === null) return "Couldn't reach the server — check the connection and try again.";
  if (isRefused({ status })) return `The admin sign-in has run out — sign in again from Profile, then check. (${status})`;
  if (status === 429 || errorKey === 'rate_limited') return 'Checked a lot just now — wait a few minutes, then try again. (429)';
  if (status === 404 && errorKey === 'not_found') return 'The ledger check is switched off on this server. (404)';
  if (errorKey === 'reconcile_failed') return `The check ran into an error on the server — try again; if it repeats, the server log has the cause. (${status})`;
  return `Couldn't run the check — try again. (${status}${errorKey ? ` ${errorKey}` : ''})`;
}

/** The message for a non-ok reconcile response, reading the route's `{ error }` key from its body. */
export async function reconcileFailureFrom(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return reconcileFailureMessage(res.status, typeof body?.error === 'string' ? body.error : null);
}
