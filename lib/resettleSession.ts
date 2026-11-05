/**
 * Re-freeze a settled session's bill after a cover change, from the client.
 *
 * ONE request since 2026-11-05: `POST /api/session/settle { resettle: true }`
 * thaws and re-freezes together on the server. It used to be DELETE then
 * POST from here, which could leave the bill silently thawed between them,
 * and the POST billed only the rows still on the list — so "Cover & remove"
 * and "Remove without covering" both put the removed person's share on
 * everyone else and wiped their debt. ONE owner, shared by `CoverSheet` and
 * `PaymentsCard`'s uncover, so the two paths cannot disagree.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const RESETTLE_FAILED = 'Could not refresh the bill.';

export async function resettleSession(sessionId: string | null | undefined): Promise<void> {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  // ONE request (audit, 2026-11-05): the server thaws and re-freezes the bill
  // together, keeping everyone the old bill billed, and refuses before
  // touching anything when the new split would change what someone paid.
  // Two requests from here could leave the bill thawed between them.
  const post = await fetch(`${BASE}/api/session/settle${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resettle: true }),
  });
  if (!post.ok) {
    throw new Error(RESETTLE_FAILED);
  }
}
