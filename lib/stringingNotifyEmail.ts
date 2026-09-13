/**
 * The EMAIL adapter for `PlayerNotice`. One of the two doors the seam in
 * `lib/stringingNotify.ts` describes; the other is in-app.
 *
 * It takes a `PlayerNotice` and nothing else about the job, which is the whole
 * point of that type: there is no parameter here through which an exact price
 * could arrive, so "Grant quoted you $30.00" cannot be written by accident.
 * The band (`$28–32`) is all this module can see.
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
import { APP_NAME } from './brand';

export interface MailResult {
  sent: boolean;
}

/**
 * Mirrors the shape of `lib/authEmail.ts`'s private sender rather than
 * exporting that one: this path must never be able to send an auth email, and
 * sharing a transport is how a subject line ends up on the wrong template.
 */
async function send(to: string, subject: string, text: string): Promise<MailResult> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  // No SMTP configured (local dev, tests) is NOT a failure — the whole feature
  // is additive, and the in-app notice is the channel that always works.
  if (!user || !pass || !to) return { sent: false };

  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  // The SENDER is the product: one mailbox serves every club, and the From
  // name is what a mail client shows in the inbox list. The sign-off inside
  // the body is the CLUB — see `composeEmail`.
  await transport.sendMail({ from: `${APP_NAME} <${user}>`, to, subject, text });
  return { sent: true };
}

/** Subject + body per stage. Only `being_strung` and `ready_for_you` reach
 *  here — `shouldNotify` filters the rest, because telling someone about a
 *  racket they are holding is how an app teaches people to ignore it. */
export function composeEmail(notice: PlayerNotice, playerName: string, clubName: string = APP_NAME): { subject: string; text: string } | null {
  const racket = `${notice.racketLabel} (${notice.jobNo})`;
  const price = notice.priceRange ? `\nEstimate: ${notice.priceRange}` : '';

  if (notice.key === 'ready_for_you') {
    const when = notice.readyBy ? `\nReady since: ${notice.readyBy}` : '';
    return {
      subject: `Your racket is ready — ${notice.jobNo}`,
      text:
        `Hi ${playerName},\n\n` +
        `${racket} is strung and ready to pick up.${when}${price}\n\n` +
        `See you on the court.\n— ${clubName}`,
    };
  }

  if (notice.key === 'being_strung') {
    const when = notice.readyBy ? `\nExpected ready: ${notice.readyBy}` : '';
    return {
      subject: `Your racket is on the bench — ${notice.jobNo}`,
      text:
        `Hi ${playerName},\n\n` +
        `${racket} is being strung now.${when}${price}\n\n` +
        `We'll let you know when it's ready.\n— ${clubName}`,
    };
  }

  // A stage that does not justify interrupting anyone. Returning null rather
  // than throwing keeps the caller's shape simple: no copy means no send.
  return null;
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
  const copy = composeEmail(notice, playerName, clubName ?? APP_NAME);
  if (!copy) return { sent: false };
  try {
    return await send(to, copy.subject, copy.text);
  } catch (err) {
    console.error('stringing notice email failed:', err);
    return { sent: false };
  }
}
