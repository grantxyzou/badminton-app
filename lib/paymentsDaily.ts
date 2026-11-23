/**
 * THE CLUB'S DAILY PAYMENTS RUN, on the hourly tick (`lib/tick.ts`;
 * docs/plans/payments-forwarding.md, Decisions, Grant 2026-11-23).
 *
 * Two jobs, once a day per club: the ledger check (`reconcileAndRecord`,
 * whenever the mirror is on) and, if the organiser switched them on, the
 * payment reminders (`runReminders`). Until 2026-11-23 the club's Gmail script
 * triggered both with a daily `POST /api/payments/remind`, so a club without
 * the script got neither; that route is gone.
 *
 * ONCE A DAY, BETWEEN `DAILY_HOUR` AND `DAILY_END_HOUR` IN THE CLUB'S CLOCK.
 * GitHub's schedule is late and skips runs (in practice the "hourly" tick
 * lands every few hours), so the rule is "the first tick between 10 a.m. and
 * 8 p.m. Vancouver whose day has not run yet", never "the 10 a.m. tick". The
 * END matters as much as the start: without it a day whose earlier ticks all
 * failed (or a club with nothing stamped, on deploy day) ran at 11 p.m. and
 * woke people with a push (security review, 2026-11-23). A day with no tick
 * inside the window is skipped; the reminder rules count days since settle,
 * so the next day's run sends what was due. `lastReminderRunAt` is the day's stamp,
 * written BEFORE either job: a run that crashes part-way waits for tomorrow
 * rather than repeating, the tick's rule ("miss one, never double one"), and
 * the reminders stamp each row before they send anyway.
 */
import { isFlagOn } from './flags';
import { readPaymentsSettings, notePaymentsSettings } from './paymentsInbox';
import { runReminders } from './paymentReminders';
import { reconcileAndRecord } from './ledgerReconcile';
import type { TickJobResult } from './tick';

/** Vancouver hour (0–23) from which a day's run may happen. */
export const DAILY_HOUR = 10;
/** Vancouver hour from which it may not (8 p.m.): no push in the evening or night. */
export const DAILY_END_HOUR = 20;
const CLUB_ZONE = 'America/Vancouver';

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: CLUB_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: CLUB_ZONE, hour: 'numeric', hourCycle: 'h23' });

/** The club's calendar day, `YYYY-MM-DD`. */
export function clubDay(at: number): string {
  return DAY_FMT.format(new Date(at));
}

/** Is today's run due at `now`, given when the last one ran? Pure. */
export function dailyRunDue(lastRunAt: string | undefined, now: number): boolean {
  const hour = Number(HOUR_FMT.format(new Date(now)));
  if (hour < DAILY_HOUR || hour >= DAILY_END_HOUR) return false;
  const last = lastRunAt ? Date.parse(lastRunAt) : NaN;
  return !Number.isFinite(last) || clubDay(last) !== clubDay(now);
}

/** One club's daily run. Counts only: the tick's answer names nobody. */
export async function runPaymentsDaily(groupId: string, now: number): Promise<TickJobResult> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) return {};
  const settings = await readPaymentsSettings(groupId);
  if (!dailyRunDue(settings?.lastReminderRunAt, now)) return {};
  await notePaymentsSettings(groupId, { lastReminderRunAt: new Date(now).toISOString() });

  const out: TickJobResult = { ran: 1 };
  // The ledger check rides on the run whether or not reminders are on:
  // reminders are a setting, the check is not. Its failure is logged and never
  // stops the reminders.
  if (isFlagOn('NEXT_PUBLIC_FLAG_LEDGER_MIRROR')) {
    try {
      const r = await reconcileAndRecord(groupId);
      out.checked = r.checked;
      out.mismatches = r.mismatches.length;
    } catch (err) {
      console.error('[paymentsDaily] ledger check failed', err);
      out.checkFailed = 1;
    }
  }
  // Re-read the switch: the check above can take seconds on a big club, and
  // an organiser who turned reminders off meanwhile must not be overruled.
  if ((await readPaymentsSettings(groupId))?.remindersOn === true) {
    const run = await runReminders(groupId, now);
    out.reminded = run.reminded;
    out.sent = run.sent;
  }
  return out;
}
