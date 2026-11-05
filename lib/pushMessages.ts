/**
 * Notification copy. Pure functions — no I/O, no env reads — so the wording is
 * unit-testable without a send path.
 *
 * IN THE READER'S LANGUAGE since 2026-11-05 (audit). The service worker has no
 * next-intl access, so the language is decided here, server-side: every
 * member-facing builder takes a `locale`, and its caller hands `sendPushToMembers`
 * a function of the locale, which the send calls once per language among the
 * recipients' devices (`PushSubscriptionDoc.locale`, stamped at subscribe and
 * refreshed when the member switches language). The words live in the `push`
 * group of `messages/*.json`, like every other member-facing string. Pushes
 * to ADMINS (a new request, a join or access ask, the test) stay English,
 * matching the admin surfaces' English-only decision.
 *
 * Nothing here may include private data: a broadcast reaches every subscriber.
 * Session time and venue are already public via GET /api/session.
 */
import { createTranslator } from 'next-intl';
import type { Session } from './types';
import { safeTag, type PushLocale, type PushPayload } from './push';
import en from '../messages/en.json';
import zhCN from '../messages/zh-CN.json';
import { brandMessages, deepMerge, type MessageTree } from './messageTree';
import { shouldNotify, type PlayerNotice } from './stringingNotify';
import { APP_SHORT_NAME } from './brand';
import { formatReadyBy } from './stringingDue';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** The merged, branded message tree per language, built once. */
const trees = new Map<PushLocale, MessageTree>();
function treeFor(locale: PushLocale): MessageTree {
  let tree = trees.get(locale);
  if (!tree) {
    const base = en as unknown as MessageTree;
    tree = brandMessages(locale === 'zh-CN' ? deepMerge(base, zhCN as unknown as MessageTree) : base);
    trees.set(locale, tree);
  }
  return tree;
}

/** `t('signupOpen.title')` in the reader's language, from `messages/*.json` → `push`. */
function pushT(locale: PushLocale): (key: string, values?: Record<string, string>) => string {
  const t = createTranslator({ locale, messages: treeFor(locale) as Record<string, never>, namespace: 'push' as never });
  return (key, values) => (t as unknown as (k: string, v?: Record<string, string>) => string)(key, values);
}

/** The `Intl` locale for a push language: Canadian English, as before, or Chinese. */
const intlLocale = (locale: PushLocale) => (locale === 'zh-CN' ? 'zh-CN' : 'en-CA');

/**
 * "Thu, Aug 7 at 7:00 PM" — undefined when the datetime is missing/unparseable.
 * In the club's clock, `America/Vancouver`, like every session time the app
 * shows: without it the server's zone decided, and App Service runs in UTC, so
 * a 7 PM session went out as the next morning (audit, 2026-11-05).
 */
function formatWhen(datetime: string | undefined, locale: PushLocale = 'en'): string | undefined {
  if (!datetime) return undefined;
  const parsed = Date.parse(datetime);
  if (Number.isNaN(parsed)) return undefined;
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Vancouver',
    }).format(new Date(parsed));
  } catch {
    return undefined;
  }
}

/**
 * Sign-ups just opened. Body degrades gracefully: with a parseable datetime it
 * names the session, otherwise it still says the useful part.
 */
export function buildSignupOpenPayload(session: Partial<Session>, locale: PushLocale = 'en'): PushPayload {
  const t = pushT(locale);
  const when = formatWhen(session.datetime, locale);
  const where = typeof session.locationName === 'string' ? session.locationName.trim() : '';

  let body: string;
  if (when && where) body = t('signupOpen.bodyWhenWhere', { when, where });
  else if (when) body = t('signupOpen.bodyWhen', { when });
  else body = t('signupOpen.body');

  return {
    title: t('signupOpen.title'),
    body,
    url: `${BASE}/`,
    // Session-scoped so a re-send for the SAME session collapses, but a genuine
    // next-week notification is its own banner.
    tag: safeTag(`signup-open-${session.id ?? session.sessionId ?? 'current'}`),
  };
}

/**
 * A spot opened and this person was moved off the waitlist
 * (docs/plans/waitlist-auto-promote.md). The day is named in Vancouver time —
 * session times display there whatever the server's zone (CLAUDE.md), and an
 * evening session read in UTC lands on the next day. No money: a banner shows
 * on a lock screen.
 */
export function buildWaitlistPromotedPayload(session: Partial<Session>, locale: PushLocale = 'en'): PushPayload {
  const t = pushT(locale);
  let day: string | undefined;
  const parsed = typeof session.datetime === 'string' ? Date.parse(session.datetime) : NaN;
  if (Number.isFinite(parsed)) {
    try {
      day = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: 'America/Vancouver' }).format(new Date(parsed));
    } catch {
      day = undefined;
    }
  }
  return {
    title: t('waitlistIn.title'),
    body: day ? t('waitlistIn.bodyDay', { day }) : t('waitlistIn.body'),
    url: `${BASE}/`,
    tag: safeTag(`waitlist-in-${session.id ?? session.sessionId ?? 'current'}`),
  };
}

/** A nudge to settle up: a count, never an amount (lock-screen rule). */
export function buildReminderPayload(lineCount: number, locale: PushLocale = 'en'): PushPayload {
  const t = pushT(locale);
  return {
    title: t('reminder.title'),
    body: lineCount > 1 ? t('reminder.bodyMany') : t('reminder.bodyOne'),
    url: `${BASE}/?tab=home`,
    tag: 'settle-up',
  };
}

/** Fixed payload for the admin transport self-test. */
export function buildTestPayload(): PushPayload {
  return {
    title: `${APP_SHORT_NAME} test notification`,
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
/**
 * A stringing job moved to a stage worth interrupting someone for.
 *
 * CARRIES NO MONEY AT ALL — not the exact figure, and not the band either.
 *
 * That is a stricter rule than the one `toPlayerJob` follows, and deliberately
 * so. The band exists to hide a PROVISIONAL price from the player; `amountDue`
 * exists because a bill they owe has to be a number they can pay. A push
 * notification is neither situation: it renders on a LOCKED phone, in a gym, in
 * front of whoever is standing next to them. There is no version of a price
 * that belongs on that surface, and "your racket is ready" is a complete
 * message without one. Pinned by `__tests__/stringing-push.test.ts`.
 *
 * Returns null for the quiet stages rather than empty copy, so the caller has
 * one thing to check instead of two.
 */
export function buildStringingPayload(notice: PlayerNotice, locale: PushLocale = 'en'): PushPayload | null {
  if (!shouldNotify(notice.key)) return null;
  const t = pushT(locale);

  const racket = notice.racketLabel?.trim() || t('stringing.yourRacket');
  // Null for the legacy free-text rows ("Sunday"), which are not dates and are
  // shown back verbatim elsewhere. A banner just omits the line instead.
  const by = formatReadyBy(notice.readyBy, intlLocale(locale));

  const ready = notice.key === 'ready_for_you';
  const title = ready ? t('stringing.readyTitle') : t('stringing.strungTitle');
  let body: string;
  if (ready) {
    body = t('stringing.readyBody', { racket });
  } else {
    body = by ? t('stringing.strungBodyBy', { racket, by }) : t('stringing.strungBody', { racket });
  }

  return {
    title,
    body,
    // The racket's progress lives on the Stringing tab, not Home (2026-09-16).
    url: `${BASE}/?tab=stringing`,
    /* Job FIRST, stage last. `safeTag` caps at 32 chars, and if a long job
       number ever forced a truncation this way collapses the two stages of ONE
       racket — where stage-first would collapse two DIFFERENT rackets at the
       same stage, which is the worse of the two failures. */
    tag: safeTag(`str-${notice.jobNo}-${notice.key}`),
  };
}

export function buildAnnouncementPayload(announcement: { id?: string; text?: string }, locale: PushLocale = 'en'): PushPayload {
  const t = pushT(locale);
  const body = flattenMarkdown(typeof announcement.text === 'string' ? announcement.text : '');
  return {
    title: t('announcement.title'),
    // The announcement itself is shown as the organiser wrote it.
    body: body || t('announcement.empty'),
    url: `${BASE}/`,
    // Per-announcement, so two different notices both show rather than the
    // second silently replacing the first.
    tag: safeTag(`announcement-${announcement.id ?? 'latest'}`),
  };
}

/**
 * "The stringer changed something about your racket — come and look."
 *
 * CARRIES NO MONEY AT ALL, and this is the place the rule is most tempting to
 * break: the whole point of the notification is a price change, so
 * "Grant changed your quote to $34" writes itself. It is still wrong. A banner
 * renders on a locked phone, in a gym, in front of whoever is standing there,
 * and this one is worse than the ready-notice — a price is a negotiation, not
 * a status. It does not name the proposer either: the club changed something,
 * not which volunteer typed it.
 *
 * The number lives behind auth, one tap away, where only the person being
 * asked can read it.
 */
export function buildPendingEditPayload(job: {
  jobNo: string;
  racketLabel?: string | null;
}, locale: PushLocale = 'en'): PushPayload {
  const t = pushT(locale);
  const racket = job.racketLabel?.trim() || t('pendingEdit.yourRacket');
  return {
    title: t('pendingEdit.title'),
    body: t('pendingEdit.body', { racket }),
    url: `${BASE}/?tab=stringing`,
    // Job first, same reasoning as the stage payload above.
    tag: safeTag(`str-${job.jobNo}-edit`),
  };
}

/**
 * "Somebody wants a restring" — to the people who string, not the club.
 *
 * Player and racket only. No string, no tension, no price: the spec is on
 * the bench one tap away, and a lock screen is not the place for it. Opens
 * the admin tab; the bench is the first row there (audit 2026-10-11,
 * finding 04 — nothing told anyone a request existed).
 */
export function buildRequestPayload(job: {
  jobNo: string;
  memberName: string;
  racketLabel?: string | null;
}): PushPayload {
  const racket = job.racketLabel?.trim() || 'racket';
  return {
    title: 'New stringing request',
    body: `${job.memberName}'s ${racket} is waiting on the bench.`,
    url: `${BASE}/?tab=admin`,
    tag: safeTag(`str-${job.jobNo}-request`),
  };
}

/**
 * "This one's yours" — to the stringer a job was just assigned to. Same
 * lock-screen rule: player and racket, no spec. Opens the Stringing tab,
 * where their card lists exactly the jobs assigned to them.
 */
export function buildAssignmentPayload(job: {
  jobNo: string;
  memberName: string;
  racketLabel?: string | null;
}, locale: PushLocale = 'en'): PushPayload {
  const t = pushT(locale);
  const racket = job.racketLabel?.trim() || t('assignment.racket');
  return {
    title: t('assignment.title'),
    body: t('assignment.body', { name: job.memberName, racket }),
    url: `${BASE}/?tab=stringing`,
    tag: safeTag(`str-${job.jobNo}-assigned`),
  };
}
