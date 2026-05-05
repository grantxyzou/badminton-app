import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, sessionIdFromDate } from '@/lib/cosmos';
import { isAdminAuthed } from '@/lib/auth';

/**
 * Admin-only one-shot backfill endpoint for historical attendance.
 *
 * Use case: an existing playing group adopts the app mid-cycle and wants to
 * see prior weeks' attendance reflected in the Stats heatmap. Each call to
 * this endpoint records one (session, attended-names) pair.
 *
 * Design choices:
 * - Idempotent: re-running the same payload upserts the same session record
 *   and leaves player records that already exist alone (no duplicates).
 * - Minimal session schema: title + datetime are populated from the date;
 *   no cost / location / deadline fields. The heatmap only cares about the
 *   session's existence and `datetime` for bucketing into a day.
 * - Names not in the array don't get records — the heatmap renders those
 *   cells as "missed" automatically (session exists, no player record for
 *   that name).
 * - Only callable by admins. Bulk session+player creation is a privileged
 *   operation that bypasses the usual rate limits + invite-list checks.
 */

interface Body {
  /** ISO date or datetime. Date-only strings get a default 20:00:00 local-time
   *  treatment so they bucket cleanly into the day. */
  date?: unknown;
  /** Names of members who attended this session. Case-preserved on insert
   *  but matched case-insensitively when checking for existing player records. */
  names?: unknown;
  /** Session time in 24h "HH:MM" format. Optional; defaults to "20:00".
   *  Only matters for display in admin views — the heatmap buckets by day. */
  time?: unknown;
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const dateOnly = date.slice(0, 10);

  if (!Array.isArray(body.names) || body.names.length === 0) {
    return NextResponse.json({ error: 'names must be a non-empty array' }, { status: 400 });
  }
  const names = body.names
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n.length <= 50);

  const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : '20:00';

  // Build a Pacific-time-tagged ISO so sessionIdFromDate (slice 0-10) gives
  // YYYY-MM-DD matching the date the user typed in. Use -07:00 as the offset
  // (Pacific Daylight Time); for backfill purposes the offset only affects
  // display, not heatmap bucketing.
  const datetime = `${dateOnly}T${time}:00-07:00`;
  const sessionId = sessionIdFromDate(datetime);

  const sessionsContainer = getContainer('sessions');
  const playersContainer = getContainer('players');

  // Upsert the session record (idempotent — re-running the same date is fine).
  const sessionDoc = {
    id: sessionId,
    sessionId,
    title: 'Weekly Badminton Session',
    datetime,
    courts: 2,
    maxPlayers: 12,
    signupOpen: false, // historical, no live signups
    backfilled: true,  // marker so future maintenance can identify these
  };
  await sessionsContainer.items.upsert(sessionDoc);

  // Look up existing player records for this session to avoid duplicates.
  const { resources: existing } = await playersContainer.items
    .query({
      query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
      parameters: [{ name: '@sessionId', value: sessionId }],
    })
    .fetchAll();
  const existingByLowerName = new Map<string, { id: string; name: string }>(
    (existing as { id: string; name: string }[]).map((p) => [p.name.toLowerCase(), p]),
  );

  // For each name: if a record exists for this session, leave it; otherwise
  // create a minimal historical player record.
  let created = 0;
  let skipped = 0;
  for (const name of names) {
    const lower = name.toLowerCase();
    if (existingByLowerName.has(lower)) {
      skipped += 1;
      continue;
    }
    await playersContainer.items.create({
      id: randomBytes(12).toString('hex'),
      name,
      sessionId,
      timestamp: datetime,
      deleteToken: randomBytes(16).toString('hex'),
      paid: true,
      removed: false,
      waitlisted: false,
      backfilled: true, // marker for future maintenance
    });
    created += 1;
  }

  return NextResponse.json({
    sessionId,
    date: dateOnly,
    namesProvided: names.length,
    playerRecordsCreated: created,
    playerRecordsSkipped: skipped,
  });
}
