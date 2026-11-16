/**
 * GET /api/admin/ledger/entries?range=30d|12w|all — the club's ledger as a
 * statement (`lib/ledgerEntries.ts`, `docs/plans/ledger-entries.md`): every
 * entry in the window, newest first, with who, what, how, and whether a later
 * entry reversed it. Read-only.
 *
 * Admin of the club the cookie names (the sync check, as the Ledger page's own
 * read): it names who paid what. 503 `read_failed` on any read that throws —
 * an empty statement would read as "no money moved".
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { listLedgerEntries } from '@/lib/ledgerEntries';
import type { RangeKey } from '@/lib/ledgerView';

export const dynamic = 'force-dynamic';

const RANGES = new Set<RangeKey>(['30d', '12w', 'all']);

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`ledger-entries:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();
  const asked = req.nextUrl.searchParams.get('range') as RangeKey | null;
  const range: RangeKey = asked && RANGES.has(asked) ? asked : '12w';
  try {
    return NextResponse.json(await listLedgerEntries(groupScope(resolveGroupId(req)), range));
  } catch (error) {
    console.error('GET /api/admin/ledger/entries:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
