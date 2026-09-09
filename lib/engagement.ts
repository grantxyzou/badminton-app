const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

import type { ClientKind } from './events';

/** The kinds a CLIENT may send — server-only kinds (`pick_served`) are not in
 *  this type, and `POST /api/events` refuses them. */
export type EngagementKind = ClientKind;

/** What a `pick_*` beacon carries. Validated and bounded server-side. */
export interface EngagementMeta {
  catalogId?: string;
  engineVersion?: string;
  rating?: 'up' | 'down';
  category?: 'racket' | 'string';
}

/**
 * Fire-and-forget engagement beacon.
 *
 * Never throws, never blocks, never surfaces anything to the user. A 401 is the
 * *expected* response for anonymous or preview-name viewers (they hold no
 * `member_session` cookie), and those taps deliberately shouldn't count toward
 * the Slice-0 criterion — so a failure here is not an error state, it's the
 * design.
 *
 * This is the one deviation from the repo's legible-fail rule, and it is
 * deliberate: that rule protects the user from acting on data the app failed to
 * load. Nothing the user sees or decides depends on this call, so surfacing its
 * failure would be noise. It is not used for anything the UI reads back.
 */
export async function recordEngagement(kind: EngagementKind, meta?: EngagementMeta): Promise<void> {
  try {
    await fetch(`${BASE}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...meta }),
      cache: 'no-store',
      keepalive: true,
    });
  } catch {
    /* beacon only — see above */
  }
}
