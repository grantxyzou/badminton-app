/**
 * Re-freeze a settled session's bill after a cover change, from the client.
 *
 * DELETE preserves the paid checkmarks; POST re-stamps every `owedAmount` with
 * the cover flags applied. It is two requests because settle is, and that is
 * the hazard: if the DELETE lands and the POST does not (network, or settle's
 * own 400 when everyone is covered), the session is left UNSETTLED — the bill
 * silently thaws and the admin's screen reloads showing live numbers as if
 * they were the frozen ones. So BOTH responses are checked and either failure
 * throws; a caller that swallowed them (`.catch(() => {})`, no `ok` check) is
 * how `PaymentsCard`'s uncover diverged from `CoverSheet`'s, which had it
 * right. ONE owner now, so the two paths cannot disagree again.
 *
 * A 404 on the DELETE means "was not settled" and is not a failure — the POST
 * that follows is the whole point.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const RESETTLE_FAILED = 'Could not refresh the bill.';

export async function resettleSession(sessionId: string | null | undefined): Promise<void> {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const del = await fetch(`${BASE}/api/session/settle${q}`, { method: 'DELETE' });
  if (!del.ok && del.status !== 404) {
    throw new Error(RESETTLE_FAILED);
  }
  const post = await fetch(`${BASE}/api/session/settle${q}`, { method: 'POST' });
  if (!post.ok) {
    throw new Error(RESETTLE_FAILED);
  }
}
