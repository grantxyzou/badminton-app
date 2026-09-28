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
