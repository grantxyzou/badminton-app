/**
 * Best-effort email notification for an in-app problem report.
 *
 * Env-gated: returns `{ sent: false }` when `GMAIL_USER` / `GMAIL_APP_PASSWORD`
 * are unset (local dev, tests) so the report path NEVER depends on SMTP being
 * configured. `nodemailer` is imported lazily so it isn't loaded — or required
 * to be installed — in environments that don't actually send.
 *
 * Transport is Gmail SMTP via an App Password (no new vendor account). Generate
 * the App Password at myaccount.google.com → Security → App passwords, then set
 * `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and optionally `REPORT_EMAIL_TO` (defaults
 * to the sending account) in Azure App Settings.
 */
export interface ReportNotification {
  message: string;
  name?: string;
  tab?: string;
  url?: string;
  createdAt: string;
}

export async function notifyReport(report: ReportNotification): Promise<{ sent: boolean }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.REPORT_EMAIL_TO || user;
  if (!user || !pass || !to) return { sent: false };

  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const body = [
    report.message,
    '',
    '— context —',
    `from: ${report.name || '(anonymous)'}`,
    report.tab ? `tab: ${report.tab}` : null,
    report.url ? `url: ${report.url}` : null,
    `at: ${report.createdAt}`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  await transport.sendMail({
    from: `BPM Badminton <${user}>`,
    to,
    subject: `[BPM] Problem report${report.name ? ` from ${report.name}` : ''}`,
    text: body,
  });

  return { sent: true };
}
