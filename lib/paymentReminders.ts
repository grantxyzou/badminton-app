/**
 * PAYMENT REMINDERS (docs/plans/payments.md, Phase 1b).
 *
 * Who is nudged, and when — pure — plus the run that sends them.
 *
 * THE TRIGGER IS THE CLUB'S OWN GMAIL SCRIPT. App Service runs nothing on a
 * schedule, and the script that forwards Interac emails already holds the
 * club's payments key and already runs on a timer. A daily call from it to
 * `POST /api/payments/remind` needs no new secret anywhere and is per-club by
 * construction (the key names its group). A GitHub Action was the first plan;
 * it would have needed a deployment-wide secret and a list of clubs.
 *
 * THE RULES, all of which exist to stop a reminder being wrong:
 *   - only a FINALIZED (settled) bill — never a live estimate;
 *   - not a line the member marked "I've sent it" — they said they paid;
 *   - two nudges per line: settle + 3 days, then + 7 days, then silence. A
 *     third is nagging, and the admin can always ask in person;
 *   - nothing settled more than 30 days ago. Turning reminders on must not
 *     wake months of hand-ticked history — the same trap the soft hold had;
 *   - ONE push per person per run, however many lines are due;
 *   - NO AMOUNT in the push. It renders on a locked phone, in a gym, in
 *     front of whoever is standing there (the stringing-notification rule).
 */
import { groupScope, type GroupScope } from './groupScope';
import { computeOwed, type UnpaidSession } from './owedBalance';
import { resolveIdentity } from './playerIdentity';
import { rosterMembers } from './roster';
import { sendPushToMembers, type PushPayload } from './push';
import type { Player } from './types';

const DAY = 24 * 60 * 60 * 1000;
export const REMINDER_STAGES_DAYS = [3, 7] as const;
export const REMINDER_MAX_AGE_DAYS = 30;

/** Is this line due its next reminder at `now`? Pure. */
export function reminderDue(line: Pick<UnpaidSession, 'settled' | 'selfReported' | 'settledAt' | 'remindedCount'>, now: number): boolean {
  if (!line.settled || line.selfReported || !line.settledAt) return false;
  const settled = Date.parse(line.settledAt);
  if (!Number.isFinite(settled)) return false;
  const age = now - settled;
  if (age > REMINDER_MAX_AGE_DAYS * DAY) return false;
  const stage = REMINDER_STAGES_DAYS[line.remindedCount];
  return stage !== undefined && age >= stage * DAY;
}

export function reminderPayload(lineCount: number): PushPayload {
  return {
    title: 'Time to settle up',
    // English only: the push has no locale to decide from (CLAUDE.md, Push).
    body: lineCount > 1 ? 'You’ve got a couple of sessions to settle up.' : 'You’ve got a session to settle up.',
    url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/?tab=home`,
    tag: 'settle-up',
  };
}

export interface DueReminder {
  memberId: string;
  name: string;
  lines: UnpaidSession[];
}

/** Everyone on the roster with at least one line due now. */
export async function dueReminders(scope: GroupScope, now: number): Promise<DueReminder[]> {
  const out: DueReminder[] = [];
  for (const { member } of await rosterMembers(scope.groupId)) {
    const identity = await resolveIdentity({ memberId: member.id }, scope.groupId);
    const { sessions } = await computeOwed(scope, identity);
    const lines = sessions.filter((s) => reminderDue(s, now));
    if (lines.length > 0) out.push({ memberId: member.id, name: member.name, lines });
  }
  return out;
}

export interface ReminderRun {
  reminded: number;
  sent: number;
}

/**
 * Stamp, then send. Stamping FIRST means a run that dies half way cannot
 * repeat a nudge tomorrow — a missed reminder is cheaper than a double one.
 * A member with no device subscribed is still stamped: the reminder was due,
 * and there was nowhere to send it.
 */
export async function runReminders(groupId: string, now: number = Date.now()): Promise<ReminderRun> {
  const scope = groupScope(groupId);
  const due = await dueReminders(scope, now);
  const at = new Date(now).toISOString();
  let sent = 0;
  for (const d of due) {
    let stamped = 0;
    for (const line of d.lines) {
      const row = await scope.read<Player & Record<string, unknown>>('players', line.playerId, line.sessionId);
      if (!row || row.paid === true) continue;
      const remindedAt = Array.isArray(row.remindedAt) ? row.remindedAt : [];
      if (await scope.replace('players', { ...row, remindedAt: [...remindedAt, at] }, line.sessionId)) stamped += 1;
    }
    if (stamped === 0) continue;
    const result = await sendPushToMembers([d.memberId], reminderPayload(stamped));
    sent += result.sent;
  }
  return { reminded: due.length, sent };
}
