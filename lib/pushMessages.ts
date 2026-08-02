/**
 * Notification copy. Pure functions — no I/O, no env reads — so the wording is
 * unit-testable without a send path.
 *
 * ENGLISH ONLY for now. The service worker has no next-intl access, so payload
 * language must be decided server-side, and there is currently no per-member
 * locale to decide it from (locale lives in the NEXT_LOCALE cookie, which a
 * broadcast send doesn't have for anyone but the caller). The fix is an
 * additive optional `Member.locale`, written whenever LanguageToggle sets the
 * cookie — deliberately deferred so this change stays scoped to delivery.
 *
 * Nothing here may include private data: a broadcast reaches every subscriber.
 * Session time and venue are already public via GET /api/session.
 */
import type { Session } from './types';
import { safeTag, type PushPayload } from './push';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** "Thu, Aug 7 at 7:00 PM" — undefined when the datetime is missing/unparseable. */
function formatWhen(datetime: string | undefined): string | undefined {
  if (!datetime) return undefined;
  const parsed = Date.parse(datetime);
  if (Number.isNaN(parsed)) return undefined;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(parsed));
  } catch {
    return undefined;
  }
}

/**
 * Sign-ups just opened. Body degrades gracefully: with a parseable datetime it
 * names the session, otherwise it still says the useful part.
 */
export function buildSignupOpenPayload(session: Partial<Session>): PushPayload {
  const when = formatWhen(session.datetime);
  const where = typeof session.locationName === 'string' ? session.locationName.trim() : '';

  let body: string;
  if (when && where) body = `${when} at ${where}. Tap to grab a spot.`;
  else if (when) body = `${when}. Tap to grab a spot.`;
  else body = 'Tap to grab a spot before it fills up.';

  return {
    title: 'Sign-ups are open',
    body,
    url: `${BASE}/`,
    // Session-scoped so a re-send for the SAME session collapses, but a genuine
    // next-week notification is its own banner.
    tag: safeTag(`signup-open-${session.id ?? session.sessionId ?? 'current'}`),
  };
}

/** Fixed payload for the admin transport self-test. */
export function buildTestPayload(): PushPayload {
  return {
    title: 'BPM test notification',
    body: 'Push is working on this device.',
    url: `${BASE}/`,
    tag: 'bpm-test',
  };
}
