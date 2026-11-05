/**
 * The admin's per-row calls on a session's sign-ups, shared by the two cards
 * that list them: `PaymentsCard` (a club that collects money in the app) and
 * `SessionListCard` (one that keeps its money outside it,
 * docs/plans/money-off-session-list.md). One copy of each request body, so the
 * two lists cannot drift on what "remove" or "promote" sends.
 *
 * Plain calls with no money in them. A card's own rules run BEFORE it calls
 * here — `PaymentsCard`'s cover-and-remove intercept, for one — and the
 * server's rules (capacity, the settled guard, the automatic promotion) run
 * after. Every call resolves; none throws.
 *
 * `sessionId` is passed only for a session other than the active one, which
 * the routes accept from an admin alone (security rule 7).
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type RowActionResult = { ok: true } | { ok: false; error: string };

async function send(
  method: 'POST' | 'PATCH' | 'DELETE',
  body: Record<string, unknown>,
  fallback: string,
): Promise<RowActionResult> {
  try {
    const res = await fetch(`${BASE}/api/players`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { ok: false, error: typeof data.error === 'string' && data.error ? data.error : fallback };
  } catch {
    return { ok: false, error: 'Network error.' };
  }
}

const onSession = (sessionId?: string | null) => (sessionId ? { sessionId } : {});

/** Add a player to the ACTIVE session by name, as the admin. */
export function addPlayerByName(name: string): Promise<RowActionResult> {
  return send('POST', { name }, 'Failed to add.');
}

/**
 * Take a player off the session. By NAME, because that is how the admin's
 * DELETE finds the row — it is the path that stamps `removedAt`, tags the row
 * removed by the admin, takes a host's guest with them and hands the spot on.
 */
export function removePlayer(name: string, sessionId?: string | null): Promise<RowActionResult> {
  return send('DELETE', { name, ...onSession(sessionId) }, 'Failed to remove.');
}

/** Move a waitlisted player into the session. The server answers 409 when it is full. */
export function promotePlayer(id: string, sessionId?: string | null): Promise<RowActionResult> {
  return send('PATCH', { id, waitlisted: false, ...onSession(sessionId) }, 'Failed to promote.');
}

/**
 * Move a confirmed player back to the waitlist. Nobody moves up into the spot
 * (docs/plans/waitlist-auto-promote.md: never on an admin's move back — the
 * first in line is often the same person).
 */
export function moveToWaitlist(id: string, sessionId?: string | null): Promise<RowActionResult> {
  return send('PATCH', { id, waitlisted: true, ...onSession(sessionId) }, 'Failed to move to the waitlist.');
}

/** Bring back a removed or cancelled player. Capacity-checked by the server. */
export function restorePlayer(id: string, sessionId?: string | null): Promise<RowActionResult> {
  return send('PATCH', { id, removed: false, ...onSession(sessionId) }, 'Failed to restore.');
}
