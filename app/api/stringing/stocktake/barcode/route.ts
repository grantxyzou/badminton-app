/**
 * Teach the club a barcode (docs/plans/string-barcode-stocktake.md).
 *   POST { code, label, color?, form } — which shelf string a scanned code is,
 *        in which colour (absent = mixed / not sure), and whether it is a
 *        packet or a reel. Taught again, it replaces the old answer.
 *
 * Admins and the club's stringers, re-read on every call by `stocktakeCaller`,
 * like the count it serves. Saves nothing but the mapping: no person, no money.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { stringingServiceOnFor } from '@/lib/stringingService';
import { stocktakeCaller } from '@/lib/stringStocktake';
import { readOfferedStrings } from '@/lib/stringingStrings';
import { BarcodeError, saveStringBarcode, validateBarcode } from '@/lib/stringBarcodes';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stocktake-barcode:${getClientIp(req)}`, 120, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const groupId = resolveGroupId(req);
  const caller = await stocktakeCaller(req, groupId);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await stringingServiceOnFor(groupId))) return off();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const offered = await readOfferedStrings(groupId);
    // An unreadable shelf is a failure, never "no strings": every label would read as unknown.
    if (!offered) return NextResponse.json({ error: 'read_failed' }, { status: 503 });
    const input = validateBarcode(body ?? {}, offered);
    const saved = await saveStringBarcode(groupId, input, caller.memberId);
    return NextResponse.json({ code: saved.code, label: saved.label, form: saved.form, color: saved.color ?? null }, { status: 201 });
  } catch (err) {
    if (err instanceof BarcodeError) {
      return NextResponse.json({ error: err.code }, { status: err.code === 'changed_elsewhere' ? 409 : 400 });
    }
    console.error('POST /api/stringing/stocktake/barcode failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
