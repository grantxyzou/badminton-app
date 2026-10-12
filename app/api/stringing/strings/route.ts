/**
 * GET   /api/stringing/strings — what the club stocks. Readable by players.
 * PATCH /api/stringing/strings — set the list. Admin only.
 *
 * The GET is deliberately open, for the same reason the shop sign is: the
 * request form is the whole audience, and which strings a badminton club keeps
 * on the shelf is not a secret. Nothing else is returned — no timestamps, no
 * author. Since 2026-10-10 it also carries `links`, label → catalog id, for
 * the Stringing tab's "Strings we offer" card (docs/plans/string-inventory.md).
 *
 * Since the strings shelf (docs/design/strings-shelf-spec.md) it carries three
 * more maps, each keyed by offered label and each ADDITIVE:
 *   prices  — the stringer's restring price in cents; `null` = "Ask";
 *             missing = no price set.
 *   stock   — a BAND ('in' | 'low' | 'out'), never sets, metres or cost;
 *             missing = unknown (no purchase logged), which is never "out".
 *   players — how many on the roster have the string in their bag; only
 *             counts of `CLUB_GEAR_MIN_COHORT` (3) or more, the same privacy
 *             floor as `stats/club/gear`.
 * A throttled or failed read answers every field `null`: unknown, not empty.
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, requireMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureClubSettings } from '@/lib/stringingShop';
import {
  readOfferedStringsWithLinks,
  normaliseOfferedStrings,
  normaliseLinks,
  normalisePrices,
  normaliseAliases,
  stringsDocId,
  type OfferedStringsDoc,
} from '@/lib/stringingStrings';
import { readStringCatalog } from '@/lib/stringStock';
import { forgetShelfExtras, readShelfExtras } from '@/lib/stringShelfRead';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const UNKNOWN = { strings: null, links: null, prices: null, stock: null, players: null };

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-strings-read:${ip}`, 120, HOUR_MS)) {
    // Unknown, not empty. An empty list tells the form "nothing is stocked, go
    // custom"; a throttled read must not be allowed to say that confidently.
    return NextResponse.json(UNKNOWN);
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;
  // `links` (label → catalog id) rides beside `strings` since 2026-10-10
  // (docs/plans/string-inventory.md); a reader that wants only the list is
  // untouched. Unknown is unknown for every field.
  const groupId = resolveGroupId(req);
  const read = await readOfferedStringsWithLinks(groupId);
  if (!read) return NextResponse.json(UNKNOWN);
  // The list stands without the extras: a stock or gear read that fails
  // leaves those two maps unknown rather than taking the shelf down with it.
  const extras = await readShelfExtras(groupId, read.strings, read.links, read.aliases).catch((err) => {
    console.error('GET /api/stringing/strings: stock/players read failed', err);
    return null;
  });
  return NextResponse.json({
    strings: read.strings,
    links: read.links,
    prices: read.prices,
    stock: extras?.stock ?? null,
    players: extras?.players ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-strings-write:${ip}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const strings = normaliseOfferedStrings(body?.strings);
  if (strings === null) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    await ensureClubSettings();
    const groupId = resolveGroupId(req);
    // A link to a catalog row the catalog does not have is dropped, not
    // refused — the list is what is being saved. Absent `links` keeps the
    // ones already stored for labels that survive, so an older client that
    // sends only `strings` does not wipe them.
    const prior = await readOfferedStringsWithLinks(groupId);
    const validIds = new Set((await readStringCatalog()).keys());
    const links = normaliseLinks(body?.links === undefined ? prior?.links ?? {} : body.links, strings, validIds);
    // Prices follow the same rule as links: absent keeps what is stored for
    // the labels that remain, so an older client cannot wipe them.
    const prices = normalisePrices(body?.prices === undefined ? prior?.prices ?? {} : body.prices, strings);
    // And aliases (docs/plans/bench-redesign.md): absent keeps what is stored,
    // and an alias whose target left the list leaves with it.
    const aliases = normaliseAliases(body?.aliases === undefined ? prior?.aliases ?? {} : body.aliases, strings);
    const doc: OfferedStringsDoc = {
      id: stringsDocId(groupId),
      strings,
      links,
      prices,
      aliases,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.memberId,
    };
    // Upsert, like the shop sign. The maps are merged ABOVE, from the stored
    // doc, for any the caller did not send — which is why the bench sends only
    // the map it changed: a stale phone sending all four would write its old
    // copies of the other three back over another device's edits. The list
    // itself is always sent, and replacing it is what the caller means.
    await groupScope(groupId).upsert('clubSettings', doc);
    // The list changed, so the stock and count keyed by it may have too.
    forgetShelfExtras(groupId);
    // Aliases go back to the admin who saved them; the public GET never lists them.
    return NextResponse.json({ strings: doc.strings, links: doc.links, prices: doc.prices, aliases });
  } catch (err) {
    console.error('PATCH /api/stringing/strings failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
