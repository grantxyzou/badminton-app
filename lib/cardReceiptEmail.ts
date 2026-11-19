/**
 * "Payment received": BPM's own receipt for money paid by card
 * (docs/plans/branded-emails.md). Stripe sends its own receipt only when an
 * email is attached to the payment and the club's account has receipts on;
 * this one is sent by the app, in the app's frame, naming the lines it paid.
 *
 * WHEN: `applyPaidSource` in `lib/cardPay.ts` calls it after every write and
 * any refund, with the lines THIS delivery newly marked paid. A redelivered
 * event marks nothing new (its lines read as already this payment's), so it
 * sends nothing: the receipt cannot go twice for the same lines.
 *
 * NEVER THROWS, and sends nothing without an address or SMTP. It runs inside
 * the webhook, and a mail problem must not answer Stripe with a 500 (which
 * would only retry an event whose money is already applied).
 *
 * MONEY IS ALLOWED HERE: an email is not a lock-screen banner. Only a push
 * body carries no amount, and nothing here pushes.
 */
import { gmailTransport } from './mailTransport';
import { outboundOriginOrNull } from './appOrigin';
import { getContainer } from './cosmos';
import { readGroup } from './groups';
import { APP_NAME } from './brand';
import { fmtMoney } from './fmt';
import { button, checkMark, detailList, emailHtml, heading, muted, paidBox, para } from './emailLayout';
import type { Member } from './types';

export interface ReceiptLine {
  /** "Badminton · Nov 13", "Badminton · Nov 13 · for Sam", "Stringing · J-0042". */
  label: string;
  amountCents: number;
}

export interface CardReceipt {
  name: string;
  club: string;
  lines: ReceiptLine[];
  /** The card fee kept for these lines (0 when the club charges none). */
  feeCents: number;
  /** Money sent back to the card in the same payment: lines no longer owed. */
  refundedCents: number;
  /** When the card was charged, ISO. */
  paidAt: string;
  appUrl: string | null;
}

const money = (cents: number) => fmtMoney(cents / 100);

/** "Nov 18, 2026", in the club's time zone (every club is in BC; CLAUDE.md, "Session times"). */
export function receiptDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** "Nov 13" from a session id ("session-2026-11-13", "g:session-2026-11-13"), or null. */
export function sessionDay(sessionId: string): string | null {
  const m = /session-(\d{4}-\d{2}-\d{2})$/.exec(sessionId);
  if (!m) return null;
  return new Date(`${m[1]}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/** Subject, text and HTML. Pure: the total is drawn once, in the green box. */
export function composeCardReceiptEmail(r: CardReceipt, origin: string | null = null): { subject: string; text: string; html: string } {
  const totalCents = r.lines.reduce((s, l) => s + l.amountCents, 0) + r.feeCents;
  const total = money(totalCents);
  const when = receiptDate(r.paidAt);
  const rows = [
    ...r.lines.map((l) => ({ label: l.label, value: money(l.amountCents) })),
    ...(r.feeCents > 0 ? [{ label: 'Card fee', value: money(r.feeCents) }] : []),
  ];
  const refundNote = r.refundedCents > 0
    ? `${money(r.refundedCents)} went back to your card for a line that was no longer owed.`
    : null;

  const text = [
    `Hi ${r.name},`,
    '',
    `Thanks. ${r.club} got your card payment of ${total} on ${when}.`,
    '',
    ...rows.map((x) => `  ${x.label}: ${x.value}`),
    '',
    ...(refundNote ? [refundNote, ''] : []),
    `Keep this email as your receipt. Questions about a charge? Ask your organiser.`,
    '',
    `— ${r.club}`,
  ].join('\n');

  const html = emailHtml({
    origin,
    tag: 'Receipt',
    preheader: `Thanks, ${r.name}. Your card payment to ${r.club} went through.`,
    body:
      checkMark() +
      heading('Payment received') +
      para(`Hi ${r.name},`) +
      para(`Thanks. ${r.club} got your card payment.`) +
      paidBox('Paid', total, `Card · ${when}`) +
      detailList(rows, { amounts: true }) +
      (refundNote ? para(refundNote) : '') +
      (r.appUrl ? button(`Open ${APP_NAME}`, r.appUrl) : '') +
      muted('Keep this email as your receipt. Questions about a charge? Ask your organiser.'),
    footer: `You got this email because you paid ${r.club} by card in ${APP_NAME}.`,
  });

  return { subject: `Payment received — ${r.club}: ${total}`, text, html };
}

/**
 * Send the receipt to the member who paid. `false` for every non-send (no
 * lines, no address, no SMTP, a read or transport error), and never a throw.
 */
export async function sendCardReceipt(
  groupId: string,
  memberId: string,
  lines: ReceiptLine[],
  feeCents: number,
  refundedCents: number,
  paidAt: string,
): Promise<boolean> {
  try {
    if (lines.length === 0) return false;
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const { resource: member } = await getContainer('members').item(memberId, memberId).read<Member>();
    if (!member?.email) return false;
    const club = (await readGroup(groupId))?.name?.trim() || APP_NAME;
    const origin = outboundOriginOrNull();
    const copy = composeCardReceiptEmail(
      { name: member.name, club, lines, feeCents, refundedCents, paidAt, appUrl: origin ? `${origin}/bpm/?tab=home` : null },
      origin,
    );
    const transport = await gmailTransport(user, pass);
    await transport.sendMail({ from: `${APP_NAME} <${user}>`, to: member.email, subject: copy.subject, text: copy.text, html: copy.html });
    return true;
  } catch (err) {
    console.error('[card-pay] receipt email failed (the payment is applied):', err);
    return false;
  }
}
