/**
 * The account emails: confirm your address, the sign-in code, the password
 * reset, and "You're in".
 *
 * Follows `lib/reportEmail.ts` exactly, and for the same reason: env-gated on
 * `GMAIL_USER` / `GMAIL_APP_PASSWORD`, with `nodemailer` imported lazily so it
 * is neither loaded nor required to be installed in environments that do not
 * send. A developer with no Gmail credentials can still run the whole sign-up
 * flow locally — the mail simply reports `{ sent: false }`.
 *
 * That is a deliberate exception to the "legible-fail" rule, scoped narrowly:
 * a failed send must not fail the sign-up, because the account is already
 * created and usable at that point. The CALLER is responsible for telling the
 * user whether the mail went out, and for offering a resend.
 *
 * Each email is plain text AND the branded HTML frame (`lib/emailLayout.ts`,
 * docs/plans/branded-emails.md), composed by a pure `compose*` function so the
 * words are tested without a send. The plain text is the one a mail app with
 * no HTML shows, and it is unchanged from before the frame.
 *
 * Copy follows the friend-voice principle — this is a badminton group, not a
 * bank.
 */
import { APP_NAME } from './brand';
import { gmailTransport } from './mailTransport';
import { outboundOriginOrNull } from './appOrigin';
import { button, clubChip, codeBox, emailHtml, heading, linkLine, muted, para } from './emailLayout';

export interface AuthMailResult {
  sent: boolean;
}

export interface Composed {
  subject: string;
  text: string;
  html: string;
}

/**
 * When mail cannot be sent, print the link to the server log — DEVELOPMENT
 * ONLY.
 *
 * Without this the verification and reset flows are untestable locally: the
 * token exists only inside an email that never leaves, and its hash is all the
 * database keeps. The `NODE_ENV === 'development'` guard is not decorative —
 * these URLs are live single-use credentials, and logging one in production
 * would put an account-takeover link into whatever aggregates the logs.
 *
 * Matches the fail-closed shape of `getSessionSecret()` in lib/auth.ts: an
 * explicitly-local env only, never merely "not production".
 */
function logUnsentLinkInDev(kind: string, to: string, url: string): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.info(`[dev] ${kind} email NOT sent (no SMTP). Link for ${to}:\n  ${url}`);
}

async function send(to: string, copy: Composed): Promise<AuthMailResult> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass || !to) return { sent: false };

  const transport = await gmailTransport(user, pass);

  await transport.sendMail({
    from: `${APP_NAME} <${user}>`,
    to,
    subject: copy.subject,
    text: copy.text,
    html: copy.html,
  });
  return { sent: true };
}

/** Where the frame's logo loads from: the deployment's own origin, or none. */
function origin(): string | null {
  return outboundOriginOrNull();
}

export function composeVerificationEmail(name: string, url: string, from: string | null = null): Composed {
  const text = [
    `Hi ${name},`,
    '',
    `Tap this link to confirm your email address for ${APP_NAME}:`,
    url,
    '',
    "It works for the next 24 hours. If you didn't sign up, you can ignore this.",
    '',
    `— ${APP_NAME}`,
  ].join('\n');
  const html = emailHtml({
    origin: from,
    tag: 'Welcome',
    preheader: 'Tap to confirm. The link works for 24 hours.',
    body:
      heading('Confirm your email') +
      para(`Hi ${name},`) +
      para(`Tap the button to confirm your email address for ${APP_NAME}.`) +
      button('Confirm email', url) +
      linkLine(url) +
      muted("It works for the next 24 hours. If you didn't sign up, you can ignore this."),
    footer: `You got this because someone used this address to sign up for ${APP_NAME}.`,
  });
  return { subject: `Confirm your email — ${APP_NAME}`, text, html };
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  url: string,
): Promise<AuthMailResult> {
  const result = await send(to, composeVerificationEmail(name, url, origin()));
  if (!result.sent) logUnsentLinkInDev('verification', to, url);
  return result;
}

/**
 * The sign-in code (docs/plans/one-way-in.md, step 3). The code is in the
 * SUBJECT as well as the body, so it can be read off the notification and
 * typed without opening the mail; it is single-use, lives ten minutes and is
 * worth nothing without the address it was sent to. In the HTML it is the
 * biggest thing on the page, and the inbox preview line leaves it out, since
 * the subject already shows it.
 */
export function composeSignInCodeEmail(name: string, code: string, from: string | null = null): Composed {
  const text = [
    `Hi ${name},`,
    '',
    `Your ${APP_NAME} sign-in code is:`,
    '',
    `    ${code}`,
    '',
    "Type it into the app to log in. It works for ten minutes, once. If you didn't ask for it, ignore this: nobody can log in without it.",
    '',
    `— ${APP_NAME}`,
  ].join('\n');
  const html = emailHtml({
    origin: from,
    tag: 'Sign in',
    preheader: 'Type it into the app. It works for ten minutes, once.',
    body:
      heading('Your sign-in code') +
      para(`Hi ${name}, type this into ${APP_NAME} to log in.`) +
      codeBox(code) +
      muted("It works for ten minutes, once. If you didn't ask for it, ignore this: nobody can log in without it."),
    footer: `You got this because someone asked to log in to ${APP_NAME} with this address.`,
  });
  return { subject: `${code} is your ${APP_NAME} code`, text, html };
}

export async function sendSignInCodeEmail(to: string, name: string, code: string): Promise<AuthMailResult> {
  const result = await send(to, composeSignInCodeEmail(name, code, origin()));
  if (!result.sent) logUnsentLinkInDev('sign-in code', to, code);
  return result;
}

/**
 * "You're in" (docs/plans/one-way-in.md, step 4): an organiser let this
 * person into a club they asked to join. No credential in it, so nothing to
 * log in development.
 */
export function composeJoinedEmail(name: string, club: string, url: string | null, from: string | null = null): Composed {
  const text = [
    `Hi ${name},`,
    '',
    `You're in ${club}. Open ${APP_NAME} to sign up for the next session${url ? ':' : '.'}`,
    ...(url ? [url] : []),
    '',
    `— ${APP_NAME}`,
  ].join('\n');
  const html = emailHtml({
    origin: from,
    tag: 'Welcome',
    preheader: `Open ${APP_NAME} to sign up for the next session.`,
    body:
      clubChip(club) +
      heading("You're in") +
      para(`Hi ${name},`) +
      para(`An organiser let you into ${club}. Open ${APP_NAME} to sign up for the next session.`) +
      (url ? button(`Open ${APP_NAME}`, url) : ''),
    footer: `You got this because you asked to join ${club}.`,
  });
  return { subject: `You're in ${club}`, text, html };
}

export async function sendJoinedEmail(to: string, name: string, club: string, url: string | null): Promise<AuthMailResult> {
  return send(to, composeJoinedEmail(name, club, url, origin()));
}

export function composePasswordResetEmail(name: string, url: string, from: string | null = null): Composed {
  const text = [
    `Hi ${name},`,
    '',
    `Someone asked to reset your ${APP_NAME} password. Tap here to pick a new one:`,
    url,
    '',
    "This link works for one hour and can only be used once. If it wasn't you, ignore this — your password hasn't changed.",
    '',
    `— ${APP_NAME}`,
  ].join('\n');
  const html = emailHtml({
    origin: from,
    tag: 'Password',
    preheader: 'The link works for one hour.',
    body:
      heading('Pick a new password') +
      para(`Hi ${name},`) +
      para(`Someone asked to reset your ${APP_NAME} password. Tap the button to pick a new one.`) +
      button('Reset password', url) +
      linkLine(url) +
      muted("This link works for one hour and can only be used once. If it wasn't you, ignore this. Your password hasn't changed."),
    footer: 'You got this because a password reset was requested for this address.',
  });
  return { subject: `Reset your password — ${APP_NAME}`, text, html };
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  url: string,
): Promise<AuthMailResult> {
  const result = await send(to, composePasswordResetEmail(name, url, origin()));
  if (!result.sent) logUnsentLinkInDev('password reset', to, url);
  return result;
}
