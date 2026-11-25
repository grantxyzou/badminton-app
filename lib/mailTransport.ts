import { APP_NAME } from './brand';

/**
 * The one Gmail SMTP transport, with TIMEOUTS.
 *
 * Three senders (`authEmail`, `reportEmail`, `stringingNotifyEmail`) each
 * built their own `createTransport` with none, and nodemailer's defaults are
 * two minutes to connect and ten to send. Two of those senders run INSIDE a
 * request — the stringing dispatcher inside the bench's PATCH — so a slow or
 * black-holed SMTP endpoint held the admin's tap for as long as App Service
 * allows (230 s) before the caller's "never throws" contract could even
 * apply. Gmail answers in well under a second; these bounds are generous for
 * the real service and short for the failure.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 15_000,
} as const;

export async function gmailTransport(user: string, pass: string) {
  const nodemailer = (await import('nodemailer')).default;
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass }, ...SMTP_TIMEOUTS });
}

/**
 * Who an email is FROM, by what it is about (Grant, 2026-11-25). Every email
 * leaves through the one account `GMAIL_USER` names: Gmail rewrites, or spam-
 * folders, a From address it was not signed in as, so only the NAME a mail app
 * shows varies, never the address.
 *
 *   app      — the app itself: confirm email, sign-in code, password reset,
 *              problem report. "BPM admin".
 *   club     — the club: "You're in", a card receipt. "BPM Six Feathers"; a
 *              club whose name already starts with "BPM" is not prefixed
 *              again ("BPM Core", never "BPM BPM Core").
 *   stringer — a racket's stringer: every stringing email and invoice.
 *              "Lin · BPM Core". A job with no stringer yet reads as its club.
 *
 * A name that cannot be read (no club, no stringer) falls back one step, and
 * the app is the last step, because a sender line naming nobody is worse.
 */
export type MailSender =
  | { kind: 'app' }
  | { kind: 'club'; club: string | null | undefined }
  | { kind: 'stringer'; stringer: string | null | undefined; club: string | null | undefined };

/** A display name for a header: one line, no control characters, bounded. */
function tidyName(s: string | null | undefined): string {
  return (s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function senderName(sender: MailSender): string {
  const app = `${APP_NAME} admin`;
  if (sender.kind === 'app') return app;
  const club = tidyName(sender.club);
  const clubName = club ? (club.toLowerCase().startsWith(APP_NAME.toLowerCase()) ? club : `${APP_NAME} ${club}`) : app;
  if (sender.kind === 'club') return clubName;
  const stringer = tidyName(sender.stringer);
  if (!stringer) return clubName;
  return `${stringer} · ${club || APP_NAME}`;
}

/** The From header nodemailer sends: the sender's name on the app's one address. */
export function mailFrom(sender: MailSender, address: string): { name: string; address: string } {
  return { name: senderName(sender), address };
}
