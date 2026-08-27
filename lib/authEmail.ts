/**
 * The two transactional emails for the email+password provider.
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
 * Copy follows the friend-voice principle — this is a badminton group, not a
 * bank.
 */
export interface AuthMailResult {
  sent: boolean;
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

async function send(to: string, subject: string, text: string): Promise<AuthMailResult> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass || !to) return { sent: false };

  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });

  await transport.sendMail({
    from: `BPM Badminton <${user}>`,
    to,
    subject,
    text,
  });
  return { sent: true };
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  url: string,
): Promise<AuthMailResult> {
  const body = [
    `Hi ${name},`,
    '',
    'Tap this link to confirm your email address for BPM Badminton:',
    url,
    '',
    "It works for the next 24 hours. If you didn't sign up, you can ignore this.",
    '',
    '— BPM Badminton',
  ].join('\n');
  const result = await send(to, 'Confirm your email — BPM Badminton', body);
  if (!result.sent) logUnsentLinkInDev('verification', to, url);
  return result;
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  url: string,
): Promise<AuthMailResult> {
  const body = [
    `Hi ${name},`,
    '',
    'Someone asked to reset your BPM Badminton password. Tap here to pick a new one:',
    url,
    '',
    "This link works for one hour and can only be used once. If it wasn't you, ignore this — your password hasn't changed.",
    '',
    '— BPM Badminton',
  ].join('\n');
  const result = await send(to, 'Reset your password — BPM Badminton', body);
  if (!result.sent) logUnsentLinkInDev('password reset', to, url);
  return result;
}
