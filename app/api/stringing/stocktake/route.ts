/**
 * The string stocktake (docs/plans/string-photo-stocktake.md).
 *   GET  — what the counter needs, per shelf string: what the app says is
 *          there, how long a set and a reel are, the last weigh-in's empty-reel
 *          weight and grams per metre. Sets only, never money: a stringer who
 *          is not an admin reads it too.
 *   POST — save a count. The server re-adds every line itself (the client's
 *          "you count 15" is a preview), stores it as a `stringCount` row, and
 *          from then on the shelf starts from it.
 *
 * Admins and the club's stringers (Grant, 2026-11-15: "Admins and stringers"),
 * re-read on every call by `stocktakeCaller`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { stringingServiceOnFor } from '@/lib/stringingService';
import { forgetShelfExtras } from '@/lib/stringShelfRead';
import {
  StocktakeError, gramsPerMetre, lastWeighIn, loadStringStock, saveStringCount, shelfSizes, stocktakeCaller, validateCount,
} from '@/lib/stringStocktake';
import { labelKey, numberAttr } from '@/lib/stringStock';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stocktake-read:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const groupId = resolveGroupId(req);
  const caller = await stocktakeCaller(req, groupId);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await stringingServiceOnFor(groupId))) return off();
  try {
    const loaded = await loadStringStock(groupId);
    const sizes = shelfSizes(loaded);
    const strings = loaded.offered.strings.map((label) => {
      const catalogId = loaded.offered.links[label] ?? null;
      const item = catalogId ? loaded.catalog.get(catalogId) : undefined;
      const size = sizes.get(labelKey(label))!;
      const line = loaded.summary.lines.find((l) => labelKey(l.label) === labelKey(label));
      const weigh = lastWeighIn(loaded.counts, label);
      return {
        label,
        catalogId,
        appSets: size.appSets,
        setMetres: size.setMetres,
        reelMetres: size.reelMetres,
        // The last weigh-in's figures, else the gauge's estimate and no empty-reel weight yet.
        gramsPerMetre: weigh?.gramsPerMetre ?? gramsPerMetre(numberAttr(item, 'gaugeMm')),
        tareGrams: weigh?.tareGrams ?? null,
        colours: loaded.offered.colours?.[label] ?? [],
        lastCount: line?.lastCount ?? null,
      };
    });
    return NextResponse.json({
      strings,
      customColours: loaded.offered.customColours,
      // Without a key the photo step is not offered; counting by hand still is.
      photo: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  } catch (err) {
    console.error('GET /api/stringing/stocktake failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stocktake-write:${getClientIp(req)}`, 20, 60 * 60_000)) {
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
    const loaded = await loadStringStock(groupId);
    const input = validateCount(body, shelfSizes(loaded));
    const count = await saveStringCount(groupId, input, caller.memberId);
    // Players' "In stock / Low / Out" reads the new figures at once.
    forgetShelfExtras(groupId);
    // One line per string for the summary: what the app said, what was counted.
    const byLabel = new Map<string, { label: string; appSets: number; counted: number }>();
    for (const l of count.lines) {
      const row = byLabel.get(l.label) ?? { label: l.label, appSets: l.appSets, counted: 0 };
      row.counted += l.sets;
      byLabel.set(l.label, row);
    }
    return NextResponse.json({ countedAt: count.countedAt, lines: [...byLabel.values()] }, { status: 201 });
  } catch (err) {
    if (err instanceof StocktakeError) return NextResponse.json({ error: err.code }, { status: 400 });
    console.error('POST /api/stringing/stocktake failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
