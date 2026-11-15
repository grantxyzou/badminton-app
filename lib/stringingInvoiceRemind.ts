/**
 * Reminders for a restring invoice nobody has paid
 * (docs/plans/stringing-invoice.md). Run once an hour per club by the tick.
 *
 * Grant asked whether a reminder goes to the player or the stringer: both, in
 * sequence, each once.
 *   - Day 3 after the LATEST send: the player (push without the amount, the
 *     email with it, a walk-up's email). `invoice.playerRemindedAt`.
 *   - Day 7: whoever sent it (push, no amount), so they can ask in person at
 *     the next session. `invoice.senderRemindedAt`. A sender no longer on the
 *     roster, or an unknown one, hands it to the club's organisers.
 *
 * Each is stamped on the invoice under the job's etag BEFORE anything is sent
 * (the request nudge's and the payment reminders' rule), so a repeated or
 * crashed tick can miss one but never send one twice. A resend clears both
 * stamps (`withInvoiceSent`), so the clocks count from the latest send.
 * Never throws past a single job.
 */
import { groupScope } from './groupScope';
import { rosterMembers } from './roster';
import { sendPushToMembers } from './push';
import { buildInvoiceUnpaidPayload } from './pushMessages';
import { deliverInvoice } from './stringingInvoice';
import { INVOICE_REMIND_PLAYER_DAYS, INVOICE_REMIND_SENDER_DAYS } from './stringingInvoiceView';
import type { StringingJob } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InvoiceRemindResult extends Record<string, number> {
  /** Invoiced, unpaid, not withdrawn. */
  open: number;
  player: number;
  sender: number;
}

/** Whole days since the latest send, or null for a job with no readable send. */
export function daysSinceSent(job: Pick<StringingJob, 'invoice'>, now: number): number | null {
  const at = Date.parse(job.invoice?.lastSentAt ?? job.invoice?.sentAt ?? '');
  return Number.isFinite(at) ? Math.floor((now - at) / DAY_MS) : null;
}

export function playerReminderDue(job: Pick<StringingJob, 'invoice'>, now: number): boolean {
  const d = daysSinceSent(job, now);
  return d !== null && d >= INVOICE_REMIND_PLAYER_DAYS && !job.invoice?.playerRemindedAt;
}

export function senderReminderDue(job: Pick<StringingJob, 'invoice'>, now: number): boolean {
  const d = daysSinceSent(job, now);
  return d !== null && d >= INVOICE_REMIND_SENDER_DAYS && !job.invoice?.senderRemindedAt;
}

const openInvoice = (j: StringingJob) => !!j.invoice && !j.paidAt && !j.cancelledAt;

type Roster = Awaited<ReturnType<typeof rosterMembers>>;

/** Who hears on day 7, and where the push opens for them. */
function senderRecipients(job: StringingJob, roster: Roster): { memberId: string; opens: 'admin' | 'stringing' }[] {
  const sender = job.invoice?.sentBy ? roster.find((r) => r.member.id === job.invoice!.sentBy) : undefined;
  if (sender) return [{ memberId: sender.member.id, opens: sender.member.role === 'admin' ? 'admin' : 'stringing' }];
  return roster
    .filter(({ member, membership }) => (membership ? membership.role === 'owner' : member.role === 'admin'))
    .map(({ member }) => ({ memberId: member.id, opens: 'admin' as const }));
}

export async function runInvoiceReminders(groupId: string, now: number): Promise<InvoiceRemindResult> {
  const scope = groupScope(groupId);
  const rows = await scope.query<StringingJob>('stringingJobs', {
    where: 'IS_DEFINED(c.invoice) AND (NOT IS_DEFINED(c.paidAt) OR c.paidAt = null)',
  });
  // Re-checked in JS: the mock store applies no WHERE it does not recognise.
  const open = rows.filter(openInvoice);
  const result: InvoiceRemindResult = { open: open.length, player: 0, sender: 0 };
  let roster: Roster | null = null;

  for (const job of open) {
    try {
      const toPlayer = playerReminderDue(job, now);
      const toSender = senderReminderDue(job, now);
      if (!toPlayer && !toSender) continue;
      const stamp = new Date(now).toISOString();
      const invoice = {
        ...job.invoice!,
        ...(toPlayer ? { playerRemindedAt: stamp } : {}),
        ...(toSender ? { senderRemindedAt: stamp } : {}),
      };
      // Stamp first, under the read's etag. `undefined`: paid, re-sent or
      // edited since the read; next hour reads it fresh.
      const written = await scope.replace<StringingJob>('stringingJobs', { ...job, invoice }, job.memberId);
      if (!written) continue;
      const days = daysSinceSent(job, now) ?? 0;

      if (toPlayer) {
        await deliverInvoice(written, { reminder: true, days });
        result.player += 1;
      }
      if (toSender) {
        roster ??= await rosterMembers(groupId);
        const to = senderRecipients(written, roster);
        for (const opens of ['admin', 'stringing'] as const) {
          const ids = to.filter((r) => r.opens === opens).map((r) => r.memberId);
          if (ids.length) await sendPushToMembers(ids, (locale) => buildInvoiceUnpaidPayload(written, days, opens, locale));
        }
        result.sender += 1;
      }
    } catch (err) {
      console.error('[stringing-invoice] a reminder failed (the others continue):', err);
    }
  }
  return result;
}
