/**
 * String inventory, admin side (docs/plans/string-inventory.md).
 *   GET    — the summary: per offered string, metres bought, sets used (jobs
 *            whose string has gone in), what is left and what it cost; plus
 *            the purchase log and the jobs whose label matched nothing.
 *   POST   — log a purchase (a reel or a pack of sets). Mirrored to the
 *            ledger as `strings` outlay.
 *   DELETE — remove a purchase (and void its ledger entry).
 *
 * Usage is COUNTED from `stringingJobs`, never logged, so there is no usage
 * write here — the bench moving a job to "strung" is the usage event.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { readOfferedStringsWithLinks } from '@/lib/stringingStrings';
import {
  StringStockError, deleteStringPurchase, logStringPurchase, readStringCatalog, readStringPurchases, summarizeStringStock, validatePurchase,
} from '@/lib/stringStock';
import { mirrorStringPurchase, mirrorStringPurchaseDeleted } from '@/lib/ledgerMirror';
import type { StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stringing-stock-read:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const groupId = resolveGroupId(req);
    const scope = groupScope(groupId);
    const [offered, purchases, catalog, jobs] = await Promise.all([
      readOfferedStringsWithLinks(groupId),
      readStringPurchases(scope),
      readStringCatalog(),
      // Every job, archived included: a racket strung last winter still used a set.
      scope.query<StringingJob>('stringingJobs', { select: 'c.id, c.stringLabel, c.status, c.archivedAt' }),
    ]);
    if (!offered) throw new Error('offered strings unreadable');
    const summary = summarizeStringStock({ offered: offered.strings, links: offered.links, purchases, jobs, catalog });
    return NextResponse.json({ ...summary, purchases });
  } catch (err) {
    console.error('GET /api/stringing/stock failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stringing-stock-write:${getClientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const input = validatePurchase(body);
    const groupId = resolveGroupId(req);
    const purchase = await logStringPurchase(groupId, input, admin.memberId);
    await mirrorStringPurchase(groupScope(groupId), purchase);
    return NextResponse.json({ purchase }, { status: 201 });
  } catch (err) {
    if (err instanceof StringStockError) return NextResponse.json({ error: err.code }, { status: 400 });
    console.error('POST /api/stringing/stock failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stringing-stock-write:${getClientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^sp-[0-9a-f]{16}$/.test(id)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  try {
    const groupId = resolveGroupId(req);
    const removed = await deleteStringPurchase(groupId, id);
    await mirrorStringPurchaseDeleted(groupScope(groupId), removed);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof StringStockError) return NextResponse.json({ error: err.code }, { status: 404 });
    console.error('DELETE /api/stringing/stock failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
