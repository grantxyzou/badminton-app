import type { Session, PrevSessionSnapshot } from './types';

export type AnomalySeverity = 'info' | 'warning' | 'blocking';

export interface Anomaly {
  code: string;
  severity: AnomalySeverity;
  message: string;
  dismissable: boolean;
}

const LONG_BREAK_THRESHOLD_DAYS = 21;
const MS_PER_DAY = 86_400_000;

export function detectSettingsDrift(
  session: Session,
  snapshot: PrevSessionSnapshot | undefined,
): string[] {
  if (!snapshot) return [];
  const codes: string[] = [];
  if ((session.costPerCourt ?? 0) !== snapshot.costPerCourt) codes.push('cost_changed');
  if (session.courts !== snapshot.courtCount) codes.push('courts_changed');
  if (session.maxPlayers !== snapshot.maxPlayers) codes.push('max_players_changed');
  return codes;
}

export function detectLongBreak(
  prevDatetime: string | undefined,
  currentDatetime: string | undefined,
): boolean {
  if (!prevDatetime || !currentDatetime) return false;
  const prev = new Date(prevDatetime).getTime();
  const curr = new Date(currentDatetime).getTime();
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return false;
  return (curr - prev) > LONG_BREAK_THRESHOLD_DAYS * MS_PER_DAY;
}

export function detectSkipDate(
  currentDatetime: string | undefined,
  skipDates: string[] | undefined,
): boolean {
  if (!currentDatetime || !skipDates || skipDates.length === 0) return false;
  const date = currentDatetime.slice(0, 10);
  return skipDates.includes(date);
}

interface EvaluateInput {
  session: Session;
  prevSnapshot: PrevSessionSnapshot | undefined;
  prevSessionDatetime: string | undefined;
  skipDates: string[] | undefined;
  dismissed: string[];
}

export function evaluateAnomalies(input: EvaluateInput): Anomaly[] {
  const { session, prevSnapshot, prevSessionDatetime, skipDates, dismissed } = input;
  const out: Anomaly[] = [];

  for (const code of detectSettingsDrift(session, prevSnapshot)) {
    out.push({
      code,
      severity: 'warning',
      message: messageFor(code, session, prevSnapshot),
      dismissable: true,
    });
  }

  if (detectLongBreak(prevSessionDatetime, session.datetime)) {
    out.push({
      code: 'long_break',
      severity: 'warning',
      message: 'It has been more than 21 days since the last session. Settings might be stale.',
      dismissable: true,
    });
  }

  if (detectSkipDate(session.datetime, skipDates)) {
    const date = session.datetime?.slice(0, 10) ?? 'this date';
    out.push({
      code: 'skip_date',
      severity: 'blocking',
      message: `${date} is on your skip list. Did you mean to advance?`,
      dismissable: false,
    });
  }

  const dismissedSet = new Set(dismissed);
  return out.filter((a) => !dismissedSet.has(a.code));
}

function messageFor(code: string, session: Session, snapshot: PrevSessionSnapshot | undefined): string {
  if (!snapshot) return code;
  switch (code) {
    case 'cost_changed':
      return `Cost is $${session.costPerCourt ?? 0}/court this week, was $${snapshot.costPerCourt} last week. Confirm?`;
    case 'courts_changed':
      return `Courts changed from ${snapshot.courtCount} to ${session.courts}.`;
    case 'max_players_changed':
      return `Max players changed from ${snapshot.maxPlayers} to ${session.maxPlayers}.`;
    default:
      return code;
  }
}
