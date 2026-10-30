/**
 * POST /api/members/import — bring a club's list onto its roster
 * (docs/plans/roster-import.md).
 *
 * The browser reads the paste or the `.csv` file (`lib/rosterImport.ts`) and
 * sends only names, each marked member or drop-in. `{ dryRun: true }` answers
 * what each row WOULD do, for the preview; without it the rows are applied
 * one at a time and each reports what happened. Both re-sort every row on the
 * server (`lib/rosterImportRun.ts`), so the preview is a reading, never a
 * promise the import trusts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { classifyImport, runImport, importMarksStored, IMPORT_MAX_ROWS, type ImportRowInput } from '@/lib/rosterImportRun';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/** A preview per edit plus the import itself — generous for a person, a ceiling for a script. */
const CALLS_PER_HOUR = 60;

function parseRows(value: unknown): ImportRowInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: ImportRowInput[] = [];
  for (const r of value) {
    if (!r || typeof r !== 'object') return null;
    const { name, regular, force } = r as Record<string, unknown>;
    if (typeof name !== 'string' || typeof regular !== 'boolean') return null;
    if (force !== undefined && typeof force !== 'boolean') return null;
    rows.push({ name, regular, force: force === true });
  }
  return rows;
}

export async function POST(req: NextRequest) {
  // Rule 4 — rate limit first.
  if (!checkRateLimit(`members-import:${getClientIp(req)}`, CALLS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Rule 3 — a mutating admin route re-reads the admin.
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  const body = await req.json().catch(() => null);
  const rows = parseRows(body?.rows);
  if (!rows) return NextResponse.json({ error: 'invalid_rows' }, { status: 400 });
  if (rows.length > IMPORT_MAX_ROWS) {
    return NextResponse.json({ error: 'too_many_rows', max: IMPORT_MAX_ROWS }, { status: 400 });
  }

  try {
    if (body?.dryRun === true) {
      return NextResponse.json({ rows: await classifyImport(auth.groupId, rows), marksStored: importMarksStored() });
    }
    return NextResponse.json({ results: await runImport(auth.groupId, rows) });
  } catch (error) {
    console.error('POST members/import error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
