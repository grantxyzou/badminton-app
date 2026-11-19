/**
 * A restring's INVOICE, the sending half (docs/plans/stringing-invoice.md).
 *
 * One tap, every channel this player can be reached on: a push (no amount,
 * the lock-screen rule) and an email with the amount and where to pay. A
 * walk-up gets the email when their contact is one, and nothing else (no
 * account, no push). When nothing reached anyone the route says so, and the
 * bench opens the invoice picture to share by hand.
 *
 * NEVER THROWS. It runs after the job's own write, like every other stringing
 * notice: a dead mail server cannot turn "Send invoice" into a 503, and the
 * invoice is already on the job (and on the player's Balance) either way.
 */
import { getContainer } from './cosmos';
import { sendPushToMembers } from './push';
import { buildInvoicePayload, buildInvoiceReminderPayload } from './pushMessages';
import { gmailTransport } from './mailTransport';
import { button, emailHtml, heading, muted, para, racketCard } from './emailLayout';
import { racketPictureFor } from './emailRacket';
import { outboundOriginOrNull } from './appOrigin';
import { readGroup } from './groups';
import { APP_NAME } from './brand';
import { fmtMoney } from './fmt';
import { isWalkUpJob, walkUpEmailOf } from './stringing';
import { invoiceNoOf } from './stringingInvoiceView';
import type { Member, StringingJob } from './types';

export interface InvoiceDelivery {
  /** Devices the push reached (0 is ordinary: nobody must allow notifications). */
  push: number;
  email: boolean;
  /** Did anything reach the person? False: the bench offers the picture to share. */
  reached: boolean;
}

/**
 * Subject, text and HTML for the invoice email. Pure. A member is sent to the
 * app (Home's Balance has Pay by card and the e-transfer details); a walk-up,
 * who has no account, is told to pay their stringer. The HTML is the shared
 * frame (`lib/emailLayout.ts`); `origin` and `racket` say where its pictures
 * load from (none in a test).
 */
export function composeInvoiceEmail(
  job: StringingJob,
  opts: { clubName?: string; appUrl?: string | null; walkUp?: boolean; reminder?: boolean; origin?: string | null; racket?: string | null } = {},
): { subject: string; text: string; html: string } {
  const club = opts.clubName?.trim() || APP_NAME;
  const no = job.invoice?.no ?? invoiceNoOf(job.jobNo);
  const amount = fmtMoney((job.priceCents ?? 0) / 100);
  const rows: [string, string][] = [
    ['Invoice', no],
    ['Job', job.jobNo],
    ['Racket', job.racketLabel],
    ['String', job.stringColor ? `${job.stringLabel} · ${job.stringColor}` : job.stringLabel],
    ['Tension', `${job.tensionMains} / ${job.tensionCrosses} lb`],
    ['Amount due', amount],
  ];
  const subject = `${opts.reminder ? 'Reminder: ' : ''}Invoice ${no} from ${club}: ${amount} for your restring`;
  const lead = `${club} has sent you an invoice for restringing your ${job.racketLabel}.`;
  const how = opts.walkUp
    ? 'Pay your stringer by e-transfer or at your next pickup.'
    : opts.appUrl
      ? `Open ${APP_NAME} to pay by card or e-transfer: ${opts.appUrl}`
      : `Open ${APP_NAME} to pay by card or e-transfer.`;
  const footer = 'You got this email because a restring was done for you. Questions? Reply to your stringer, not to this address.';

  const width = Math.max(...rows.map(([k]) => k.length));
  const box = rows.map(([k, v]) => `  ${k.padEnd(width)}   ${v}`).join('\n');
  const text = [`Hi ${job.memberName},`, '', lead, '', box, '', how, '', '—', footer].join('\n');

  // The HTML says the amount ONCE, at the bottom of the racket card; the
  // button does not repeat it.
  const action = !opts.walkUp && opts.appUrl
    ? button('Pay now', opts.appUrl) + muted(`Open ${APP_NAME} to pay by card or e-transfer.`)
    : para(how);
  const html = emailHtml({
    origin: opts.origin ?? null,
    tag: opts.reminder ? 'Reminder' : 'Invoice',
    preheader: `${amount} for your restring. ${opts.walkUp ? 'Pay your stringer.' : `Pay by card or e-transfer in ${APP_NAME}.`}`,
    body:
      heading(opts.reminder ? 'Reminder: invoice still open' : `Invoice from ${club}`) +
      para(`Hi ${job.memberName},`) +
      para(lead) +
      racketCard({
        job,
        pictureUrl: opts.racket ?? null,
        refs: { left: { label: 'Invoice', value: no }, right: { label: 'Job', value: job.jobNo } },
        facts: [],
        cost: { label: 'Amount due', value: amount, owed: true },
      }) +
      action,
    footer,
  });
  return { subject, text, html };
}

async function sendEmail(to: string, copy: { subject: string; text: string; html: string }): Promise<boolean> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return false;
  try {
    const transport = await gmailTransport(user, pass);
    await transport.sendMail({ from: `${APP_NAME} <${user}>`, to, subject: copy.subject, text: copy.text, html: copy.html });
    return true;
  } catch (err) {
    console.error('[stringing] invoice email failed (the invoice is saved):', err);
    return false;
  }
}

async function clubNameOf(groupId: string | undefined): Promise<string | undefined> {
  if (!groupId) return undefined;
  try {
    return (await readGroup(groupId))?.name?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Where a member pays: Home, whose Balance card has the line. */
export function invoiceAppUrl(): string | null {
  const origin = outboundOriginOrNull();
  return origin ? `${origin}/bpm/?tab=home` : null;
}

/** Send the invoice (or a reminder of it) to the player. Never throws. */
export async function deliverInvoice(job: StringingJob, opts: { reminder?: boolean; days?: number } = {}): Promise<InvoiceDelivery> {
  try {
    const club = await clubNameOf(job.groupId);
    const origin = outboundOriginOrNull();
    const pictures = { origin, racket: await racketPictureFor(job.racketLabel, origin) };
    if (isWalkUpJob(job)) {
      const to = walkUpEmailOf(job);
      const email = to ? await sendEmail(to, composeInvoiceEmail(job, { clubName: club, walkUp: true, reminder: opts.reminder, ...pictures })) : false;
      return { push: 0, email, reached: email };
    }

    let push = 0;
    try {
      push = (
        await sendPushToMembers([job.memberId], (locale) =>
          opts.reminder ? buildInvoiceReminderPayload(job, opts.days ?? 0, locale) : buildInvoicePayload(job, locale),
        )
      ).sent;
    } catch (err) {
      console.error('[stringing] invoice push failed (the invoice is saved):', err);
    }

    let email = false;
    try {
      const { resource: member } = await getContainer('members').item(job.memberId, job.memberId).read<Member>();
      if (member?.email) {
        email = await sendEmail(member.email, composeInvoiceEmail(job, { clubName: club, appUrl: invoiceAppUrl(), reminder: opts.reminder, ...pictures }));
      }
    } catch (err) {
      console.error('[stringing] invoice email lookup failed (the invoice is saved):', err);
    }
    return { push, email, reached: push > 0 || email };
  } catch (err) {
    console.error('[stringing] invoice delivery failed (the invoice is saved):', err);
    return { push: 0, email: false, reached: false };
  }
}
