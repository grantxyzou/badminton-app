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
 *
 * Plain text and the branded HTML frame (`lib/emailLayout.ts`), composed by
 * `composeReportEmail`. Everything in a report was typed by whoever sent it,
 * so the HTML half escapes all of it (the frame's blocks do) and keeps the
 * message's own line breaks.
 */
import { APP_NAME, APP_SHORT_NAME } from './brand';
import { gmailTransport } from './mailTransport';
import { outboundOriginOrNull } from './appOrigin';
import { detailList, emailHtml, heading, messageBox } from './emailLayout';

export interface ReportNotification {
  message: string;
  name?: string;
  category?: string;
  tab?: string;
  url?: string;
  createdAt: string;
}

export function composeReportEmail(report: ReportNotification, from: string | null = null): { subject: string; text: string; html: string } {
  const text = [
    report.message,
    '',
    '— context —',
    `from: ${report.name || '(anonymous)'}`,
    report.category ? `about: ${report.category}` : null,
    report.tab ? `tab: ${report.tab}` : null,
    report.url ? `url: ${report.url}` : null,
    `at: ${report.createdAt}`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const rows = [
    { label: 'From', value: report.name || '(anonymous)' },
    ...(report.category ? [{ label: 'About', value: report.category }] : []),
    ...(report.tab ? [{ label: 'Tab', value: report.tab }] : []),
    ...(report.url ? [{ label: 'URL', value: report.url, mono: true }] : []),
    { label: 'At', value: report.createdAt, mono: true },
  ];
  const html = emailHtml({
    origin: from,
    tag: 'Report',
    preheader: report.message.slice(0, 140),
    body: heading('Problem report') + messageBox(report.message) + detailList(rows),
    footer: `Sent automatically from the in-app problem report in ${APP_NAME}.`,
  });

  return { subject: `[${APP_SHORT_NAME}] Problem report${report.name ? ` from ${report.name}` : ''}`, text, html };
}

export async function notifyReport(report: ReportNotification): Promise<{ sent: boolean }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.REPORT_EMAIL_TO || user;
  if (!user || !pass || !to) return { sent: false };

  const transport = await gmailTransport(user, pass);
  const copy = composeReportEmail(report, outboundOriginOrNull());

  await transport.sendMail({
    from: `${APP_NAME} <${user}>`,
    to,
    subject: copy.subject,
    text: copy.text,
    html: copy.html,
  });

  return { sent: true };
}
