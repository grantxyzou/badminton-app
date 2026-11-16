import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import { groupScope, type GroupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';
import { readOfferedStringsWithLinks, type OfferedStringsRead } from './stringingStrings';
import {
  STOCK_JOB_SELECT, countedJob, labelKey, metresFor, numberAttr, readStringCatalog, readStringPurchases, readStringUses,
  summarizeStringStock, withDeletedUses, type StringStockSummary,
} from './stringStock';
import {
  MAX_COUNT_SETS, MAX_GRAMS, STRING_COUNT_KIND, isFullness, setsByEye, setsByWeight,
  type StringCount, type StringCountLine,
} from './stringStocktakeMath';
import { isReelColourId } from './stringPalette';
import { isAdminAuthedWithMember, verifyLiveMemberAuth } from './auth';
import { canStringIn } from './roster';
import type { CatalogItem, StringPurchase, StringingJob } from './types';

export * from './stringStocktakeMath';

/**
 * THE STOCKTAKE — storage, the one stock loader, and who may count
 * (docs/plans/string-photo-stocktake.md, scanning: docs/plans/string-barcode-stocktake.md). A count is a `kind: 'stringCount'`
 * row in `clubSettings` beside the purchases and the deleted jobs' uses — no
 * new container (the account sits at Cosmos's cap). Never edited: a later
 * count of a string replaces the earlier one in the arithmetic, and every
 * count stays as the record of who counted what, and when.
 */

export async function readStringCounts(scope: GroupScope): Promise<StringCount[]> {
  await ensureClubSettings();
  // A literal, as `readStringPurchases`: the mock knows no `@kind`.
  const rows = await scope.query<StringCount & { kind?: string }>('clubSettings', { where: `c.kind = '${STRING_COUNT_KIND}'` });
  return rows.filter((r) => r.kind === STRING_COUNT_KIND);
}

export interface LoadedStock {
  offered: OfferedStringsRead;
  purchases: StringPurchase[];
  catalog: Map<string, CatalogItem>;
  jobs: StringingJob[];
  counts: StringCount[];
  summary: StringStockSummary;
}

/**
 * EVERY stock reader goes through here: the bench's stock route, the players'
 * shelf bands, the club report and the stocktake. They used to make the same
 * five reads each, and a reader that forgot one (the deleted jobs' uses, the
 * colour, the own-string marker, now the counts) silently counted differently.
 * `at` names a failing read (the stock route's 503 carries it).
 */
export async function loadStringStock(
  groupId: string,
  opts: { now?: Date; at?: <T>(name: string, p: Promise<T>) => Promise<T> } = {},
): Promise<LoadedStock> {
  const at = opts.at ?? (<T,>(_n: string, p: Promise<T>) => p);
  const scope = groupScope(groupId);
  const [offered, purchases, catalog, jobs, uses, counts] = await Promise.all([
    at('offered', readOfferedStringsWithLinks(groupId)),
    at('purchases', readStringPurchases(scope)),
    at('catalog', readStringCatalog()),
    // Every job, archived included: a racket strung last winter still used a set.
    at('jobs', scope.query<StringingJob>('stringingJobs', { select: STOCK_JOB_SELECT })),
    // A deleted job's set stays used (`recordStringUse`).
    at('uses', readStringUses(scope)),
    at('counts', readStringCounts(scope)),
  ]);
  if (!offered) throw Object.assign(new Error('offered strings unreadable'), { step: 'offered' });
  const summary = summarizeStringStock({
    offered: offered.strings, links: offered.links, aliases: offered.aliases, purchases,
    jobs: withDeletedUses(jobs.map(countedJob), uses), catalog, customColours: offered.customColours,
    counts, ...(opts.now ? { now: opts.now } : {}),
  });
  return { offered, purchases, catalog, jobs, counts, summary };
}

// ── Who may count ──────────────────────────────────────────────────────────

/**
 * An admin of this club, or a member who strings for it (Grant, 2026-11-15:
 * "Admins and stringers"). The stringer is the one at the shelf. Re-read on
 * every call: a demoted admin or a stringer whose switch was turned off stops
 * at once. Null = neither.
 */
export async function stocktakeCaller(req: NextRequest, groupId: string): Promise<{ memberId: string; admin: boolean } | null> {
  const admin = await isAdminAuthedWithMember(req);
  if (admin.authed) return { memberId: admin.memberId, admin: true };
  const member = await verifyLiveMemberAuth(req);
  if (!member) return null;
  const stringer = await canStringIn(groupId, member.memberId).catch(() => false);
  return stringer ? { memberId: member.memberId, admin: false } : null;
}

// ── Saving a count ─────────────────────────────────────────────────────────

export class StocktakeError extends Error {
  constructor(public readonly code: 'invalid_request' | 'unknown_string' | 'invalid_count') {
    super(code);
  }
}

/** What each shelf string holds, for the server's own arithmetic. */
export function shelfSizes(loaded: Pick<LoadedStock, 'offered' | 'catalog' | 'summary'>): Map<string, { label: string; setMetres: number; reelMetres: number; appSets: number }> {
  const out = new Map<string, { label: string; setMetres: number; reelMetres: number; appSets: number }>();
  for (const label of loaded.offered.strings) {
    const item = loaded.offered.links[label] ? loaded.catalog.get(loaded.offered.links[label]) : undefined;
    const line = loaded.summary.lines.find((l) => labelKey(l.label) === labelKey(label));
    const setMetres = line?.setMetres ?? metresFor('set', item);
    out.set(labelKey(label), { label, setMetres, reelMetres: numberAttr(item, 'reelLengthM') ?? metresFor('reel', item), appSets: line?.remainingSets ?? 0 });
  }
  return out;
}

const int = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const num = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);

/**
 * The body a counter sends, checked and re-added on the SERVER: the client's
 * own "you count 15" is a preview, never what is stored. Each line names a
 * shelf string (exactly as offered, any case), how many packets, and each
 * reel either by eye (a fullness) or by weight. At most one line per string
 * and colour.
 */
export function validateCount(
  body: Record<string, unknown>,
  sizes: ReturnType<typeof shelfSizes>,
): { source: 'scan' | 'hand'; lines: StringCountLine[] } {
  // 'photo' is no longer offered (docs/plans/string-barcode-stocktake.md); old rows keep it.
  const source = body.source === 'scan' ? 'scan' : body.source === 'hand' ? 'hand' : null;
  if (!source || !Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 60) throw new StocktakeError('invalid_request');
  const lines: StringCountLine[] = [];
  const seen = new Set<string>();
  for (const raw of body.lines) {
    if (!raw || typeof raw !== 'object') throw new StocktakeError('invalid_request');
    const r = raw as Record<string, unknown>;
    const size = typeof r.label === 'string' ? sizes.get(labelKey(r.label)) : undefined;
    if (!size) throw new StocktakeError('unknown_string');
    const color = isReelColourId(r.color) ? r.color : undefined;
    const dedupe = `${labelKey(size.label)}|${color ?? ''}`;
    if (seen.has(dedupe)) throw new StocktakeError('invalid_request');
    seen.add(dedupe);
    const packets = r.packets === undefined ? 0 : int(r.packets, MAX_COUNT_SETS);
    if (packets === null) throw new StocktakeError('invalid_count');
    const reels: NonNullable<StringCountLine['reels']> = [];
    let sets = packets;
    if (r.reels !== undefined) {
      if (!Array.isArray(r.reels) || r.reels.length > 20) throw new StocktakeError('invalid_count');
      for (const reel of r.reels) {
        const e = (reel ?? {}) as Record<string, unknown>;
        if (e.by === 'eye' && isFullness(e.fullness)) {
          reels.push({ by: 'eye', fullness: e.fullness });
          sets += setsByEye(e.fullness, size.reelMetres, size.setMetres);
        } else if (e.by === 'weigh') {
          const grams = num(e.grams, MAX_GRAMS);
          const tareGrams = num(e.tareGrams, MAX_GRAMS);
          const gramsPerMetre = num(e.gramsPerMetre, 5);
          if (grams === null || tareGrams === null || !gramsPerMetre) throw new StocktakeError('invalid_count');
          reels.push({ by: 'weigh', grams, tareGrams, gramsPerMetre });
          sets += setsByWeight(grams, tareGrams, gramsPerMetre, size.setMetres);
        } else {
          throw new StocktakeError('invalid_count');
        }
      }
    }
    if (sets > MAX_COUNT_SETS) throw new StocktakeError('invalid_count');
    lines.push({
      label: size.label, sets, appSets: size.appSets,
      ...(color ? { color } : {}),
      ...(packets > 0 ? { packets } : {}),
      ...(reels.length > 0 ? { reels } : {}),
    });
  }
  return { source, lines };
}

export async function saveStringCount(groupId: string, input: { source: 'scan' | 'hand'; lines: StringCountLine[] }, memberId: string): Promise<StringCount> {
  await ensureClubSettings();
  const doc: StringCount = {
    id: `sc-${randomBytes(8).toString('hex')}`,
    kind: STRING_COUNT_KIND,
    countedAt: new Date().toISOString(),
    countedBy: memberId,
    source: input.source,
    lines: input.lines,
  };
  return groupScope(groupId).create<StringCount>('clubSettings', doc);
}
