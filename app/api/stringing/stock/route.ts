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
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { StringStockError, deleteStringPurchase, logStringPurchase, validatePurchase } from '@/lib/stringStock';
import { loadStringStock } from '@/lib/stringStocktake';
import { mirrorStringPurchase, mirrorStringPurchaseDeleted } from '@/lib/ledgerMirror';
import { forgetShelfExtras } from '@/lib/stringShelfRead';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stringing-stock-read:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // The FRESH check even on a read (Claude Security F23/F25, 2026-11-17): it
  // names who owes or what the club pays, and a signature-only check kept a
  // demoted or signed-out-everywhere admin reading it for the cookie's 30 days.
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  // Each read is labelled so a failure names the read, in the log and in
  // the 503 body: four reads behind one `Promise.all` answered production
  // with a bare "read_failed" on 2026-10-10 and nothing said which.
  let step = 'start';
  const at = <T,>(name: string, p: Promise<T>): Promise<T> => p.catch((err) => { step = name; throw err; });
  try {
    const groupId = resolveGroupId(req);
    // The one stock loader (lib/stringStocktake.ts): purchases, every job,
    // deleted jobs' uses and the stocktakes, as every other stock reader.
    const { offered, purchases, summary } = await loadStringStock(groupId, { now: new Date(), at }).catch((err) => {
      if ((err as { step?: string }).step) step = (err as { step: string }).step;
      throw err;
    });
    // `aliases` rides here, on the admin read, so the bench can show and undo
    // them (docs/plans/bench-redesign.md); the public strings read omits them.
    // `jobLines` is the earnings page's (job ids); the shelf has no use for it.
    const { jobLines: _jl, ...stock } = summary;
    return NextResponse.json({ ...stock, purchases, aliases: offered.aliases, customColours: offered.customColours });
  } catch (err) {
    console.error('GET /api/stringing/stock failed', { step }, err);
    return NextResponse.json({ error: 'read_failed', step }, { status: 503 });
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
    // A reel just logged should not read "Out" to players for another minute.
    forgetShelfExtras(groupId);
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
    forgetShelfExtras(groupId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof StringStockError) return NextResponse.json({ error: err.code }, { status: 404 });
    console.error('DELETE /api/stringing/stock failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
