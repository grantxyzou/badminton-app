/**
 * The EMAIL adapter for `PlayerNotice`. One of the two doors the seam in
 * `lib/stringingNotify.ts` describes; the other is in-app.
 *
 * It takes a `PlayerNotice` and nothing else about the job, so the copy here
 * cannot drift from what the in-app card says — the quote included ("$30").
 *
 * FAILS SOFT, ALWAYS. Sending is triggered by an ADMIN moving a job along the
 * bench. If the mail server is down, the bench must still work — the admin's
 * action is about the racket, not the email. Every failure here is logged and
 * swallowed, and `sent: false` is a first-class answer rather than an error.
 *
 * WHY THE COPY IS ENGLISH AND NOT TRANSLATED
 * ------------------------------------------
 * next-intl resolves the locale from the REQUEST cookie, and the request that
 * triggers this is the admin's, not the player's. Translating here would
 * reliably send the stringer's language to the player rather than their own.
 * The app stores no per-member locale, so English is the honest choice until it
 * does. The IN-APP notice has no such problem — it renders in the player's own
 * browser — and is translated properly.
 */
import type { PlayerNotice } from './stringingNotify';
import { gmailTransport } from './mailTransport';
import { APP_NAME } from './brand';
import { outboundOriginOrNull } from './appOrigin';
import { emailHtml, heading, para, racketCard, signoff } from './emailLayout';
import { racketPictureFor } from './emailRacket';
import { formatReadyBy } from './stringingDue';

export interface MailResult {
  sent: boolean;
}

/**
 * Mirrors the shape of `lib/authEmail.ts`'s private sender rather than
 * exporting that one: this path must never be able to send an auth email, and
 * sharing a transport is how a subject line ends up on the wrong template.
 */
async function send(to: string, subject: string, text: string, html: string): Promise<MailResult> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  // No SMTP configured (local dev, tests) is NOT a failure — the whole feature
  // is additive, and the in-app notice is the channel that always works.
  if (!user || !pass || !to) return { sent: false };

  const transport = await gmailTransport(user, pass);
  // The SENDER is the product: one mailbox serves every club, and the From
  // name is what a mail client shows in the inbox list. The sign-off inside
  // the body is the CLUB — see `composeEmail`.
  await transport.sendMail({ from: `${APP_NAME} <${user}>`, to, subject, text, html });
  return { sent: true };
}

/** Subject, text and HTML per stage. Only `being_strung` and `ready_for_you`
 *  reach here — `shouldNotify` filters the rest, because telling someone about
 *  a racket they are holding is how an app teaches people to ignore it.
 *  `pictures` says where the logo and the racket render load from (none in a
 *  test). */
export function composeEmail(
  notice: PlayerNotice,
  playerName: string,
  clubName: string = APP_NAME,
  pictures: { origin: string | null; racket: string | null } = { origin: null, racket: null },
): { subject: string; text: string; html: string } | null {
  const racket = `${notice.racketLabel} (${notice.jobNo})`;
  const price = notice.quote ? `\nQuote: ${notice.quote}` : '';
  const ready = notice.key === 'ready_for_you';
  if (!ready && notice.key !== 'being_strung') {
    // A stage that does not justify interrupting anyone. Returning null rather
    // than throwing keeps the caller's shape simple: no copy means no send.
    return null;
  }

  const when = notice.readyBy ? `\n${ready ? 'Ready since' : 'Expected ready'}: ${notice.readyBy}` : '';
  const subject = ready ? `Your racket is ready — ${notice.jobNo}` : `Your racket is on the bench — ${notice.jobNo}`;
  const lead = ready ? `${racket} is strung and ready to pick up.` : `${racket} is being strung now.`;
  const close = ready ? 'See you on the court.' : "We'll let you know when it's ready.";
  const text = `Hi ${playerName},\n\n${lead}${when}${price}\n\n${close}\n— ${clubName}`;

  const html = emailHtml({
    origin: pictures.origin,
    tag: 'Stringing',
    preheader: ready ? `Your ${notice.racketLabel} is strung and ready to pick up.` : `Your ${notice.racketLabel} is being strung now.`,
    body:
      heading(ready ? 'Your racket is ready' : 'Your racket is on the bench') +
      para(`Hi ${playerName},`) +
      para(ready ? `Your ${notice.racketLabel} is strung and ready to pick up.` : `Your ${notice.racketLabel} is being strung now. We'll let you know when it's ready.`) +
      racketCard({
        job: { racketLabel: notice.racketLabel, ...notice.spec },
        pictureUrl: pictures.racket,
        facts: [
          ...(notice.readyBy ? [{ label: ready ? 'Ready since' : 'Expected ready', value: formatReadyBy(notice.readyBy, 'en-US') ?? notice.readyBy }] : []),
          { label: 'Job', value: notice.jobNo, mono: true },
        ],
        cost: notice.quote ? { label: 'Quote', value: notice.quote } : { label: 'Price', value: 'Ask', note: 'Your stringer will price it' },
      }) +
      signoff('See you on the court.', clubName),
    footer: ready ? 'This is the last email about this racket.' : "This email is about one racket. You'll get one more when it's ready.",
  });
  return { subject, text, html };
}

/**
 * Send the notice, if this stage warrants one and we have an address.
 *
 * Returns `sent: false` for every non-send reason — no address, a quiet stage,
 * no SMTP, or a thrown transport error — because the caller cannot act on the
 * difference and must not fail because of it.
 */
export async function sendStringingNotice(
  notice: PlayerNotice,
  to: string | null | undefined,
  playerName: string,
  /**
   * The club whose stringer did the work, for the sign-off.
   *
   * Optional, defaulting to the product name, because the alternative is
   * worse in a specific way: a racket strung by one club must never be signed
   * with another club's name, and a required parameter that every caller
   * satisfies with whatever is in scope is how that happens. Absent means "we
   * do not know which club", and the product name is the honest answer to
   * that — it names the software the person is using, which is true.
   */
  clubName?: string,
): Promise<MailResult> {
  if (!to || !notice.channels.includes('email')) return { sent: false };
  try {
    const origin = outboundOriginOrNull();
    const copy = composeEmail(notice, playerName, clubName ?? APP_NAME, { origin, racket: await racketPictureFor(notice.racketLabel, origin) });
    if (!copy) return { sent: false };
    return await send(to, copy.subject, copy.text, copy.html);
  } catch (err) {
    console.error('stringing notice email failed:', err);
    return { sent: false };
  }
}
