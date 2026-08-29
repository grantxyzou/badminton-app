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

/**
 * Strip markdown to plain text for a notification body.
 *
 * Announcements are stored as RAW MARKDOWN (CLAUDE.md) and rendered in-app by
 * `renderMarkdown`. A push banner has no renderer, so sending the stored string
 * verbatim would put literal `**bold**` and `[text](url)` on a lock screen.
 *
 * Deliberately a flattener and not a parser: it removes the tokens the app's
 * own mini-markdown supports and leaves everything else alone. It never has to
 * be correct about nested or exotic syntax, because the worst case is a
 * stray character in a banner, not a rendering fault.
 */
export function flattenMarkdown(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // images — nothing to show
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // links → their text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')            // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')               // italic
    .replace(/`([^`]*)`/g, '$1')                   // inline code
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')            // headings
    .replace(/^\s{0,3}[-*+]\s+/gm, '• ')           // bullets — readable inline
    .replace(/^\s{0,3}>\s?/gm, '')                 // quotes
    .replace(/\s*\n\s*/g, ' ')                     // collapse to one line
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * A new announcement was posted.
 *
 * Fires on CREATE only — `PATCH /api/announcements` upserts an edit, and
 * re-notifying everyone because a typo was fixed is exactly the kind of empty
 * interruption that teaches people to swipe these away.
 *
 * The announcement text IS the body: unlike sign-ups-open there is no useful
 * generic fallback, because the whole content is the news. Truncation is
 * `lib/push.ts`'s job (MAX_BODY), so this does not second-guess the length.
 */
export function buildAnnouncementPayload(announcement: { id?: string; text?: string }): PushPayload {
  const body = flattenMarkdown(typeof announcement.text === 'string' ? announcement.text : '');
  return {
    title: 'New announcement',
    body: body || 'Tap to read it in the app.',
    url: `${BASE}/`,
    // Per-announcement, so two different notices both show rather than the
    // second silently replacing the first.
    tag: safeTag(`announcement-${announcement.id ?? 'latest'}`),
  };
}
