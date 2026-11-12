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
 *   colours — the colours the club has each string in, as palette ids
 *             (`lib/stringPalette.ts`); missing = not said.
 *   colourStock — which of a string's colours are on the shelf, from
 *             colour-tagged purchases: `{ inStock: ids, mixed }`, never a
 *             count; missing = no tagged purchase
 *             (docs/plans/string-stock-by-colour.md).
 *   notes   — the stringer's note for players on that string's page ("Your
 *             stringer recommends"); missing = no note. Same rules as the
 *             others on PATCH: absent keeps the stored notes, and an empty
 *             note is dropped, which is how one is deleted.
 * PATCH also takes `{ rename: { from, to } }` on its own: one string renamed,
 * with its price, link, colours, note and old spellings carried across on the
 * STORED doc, and the old name counted as the new one. And `{ colours:
 * { <label>: ids } }` on its own: those strings' reel colours, merged into the
 * stored map.
 *
 * A STRINGER who is not an admin may send those two and nothing else
 * (docs/plans/stringer-shelf-edits.md; Grant, 2026-11-12: "open up reel and
 * string name, colour for stringers"). Any other key is a 403, never quietly
 * dropped, and the answer carries the list and the colours only.
 * A throttled or failed read answers every field `null`: unknown, not empty.
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, requireMember, verifyLiveMemberAuth } from '@/lib/auth';
import { canStringIn } from '@/lib/roster';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureClubSettings } from '@/lib/stringingShop';
import {
  readOfferedStringsWithLinks,
  normaliseOfferedStrings,
  normaliseLinks,
  normalisePrices,
  normaliseAliases,
  normaliseColours,
  normaliseNotes,
  mergeColours,
  renameOffered,
  stringsDocId,
  type OfferedStringsDoc,
} from '@/lib/stringingStrings';
import { readStringCatalog } from '@/lib/stringStock';
import { forgetShelfExtras, readShelfExtras } from '@/lib/stringShelfRead';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const UNKNOWN = { strings: null, links: null, prices: null, stock: null, players: null, colours: null, colourStock: null, notes: null };

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
    colours: read.colours,
    stock: extras?.stock ?? null,
    players: extras?.players ?? null,
    colourStock: extras?.colourStock ?? null,
    notes: read.notes,
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
  // Null for an admin. A stringer in THIS club (`canStringIn`), re-read on a
  // live cookie so "Sign out everywhere" and a revoked switch both stop it.
  let stringerId: string | null = null;
  if (!admin.authed) {
    const session = await verifyLiveMemberAuth(req);
    const strings = session ? await canStringIn(resolveGroupId(req), session.memberId).catch(() => false) : false;
    if (!session || !strings) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    stringerId = session.memberId;
  }
  const actorId = admin.authed ? admin.memberId : stringerId;

  const body = await req.json().catch(() => null);
  if (stringerId) {
    // The name and the reel, one at a time; never the list, a price, a link or an alias.
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
    if (keys.length !== 1 || (keys[0] !== 'rename' && keys[0] !== 'colours')) {
      return NextResponse.json({ error: 'forbidden_field' }, { status: 403 });
    }
  }
  if (body && typeof body === 'object' && 'rename' in body) return rename(req, body.rename, actorId, stringerId !== null);
  if (body && typeof body === 'object' && 'colours' in body && !('strings' in body)) {
    return setColours(req, body.colours, actorId, stringerId !== null);
  }
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
    // Colours, the same again.
    const colours = normaliseColours(body?.colours === undefined ? prior?.colours ?? {} : body.colours, strings);
    // And the stringer's notes for players.
    const notes = normaliseNotes(body?.notes === undefined ? prior?.notes ?? {} : body.notes, strings);
    const doc: OfferedStringsDoc = {
      id: stringsDocId(groupId),
      strings,
      links,
      prices,
      aliases,
      colours,
      notes,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    };
    // Upsert, like the shop sign. The maps are merged ABOVE, from the stored
    // doc, for any the caller did not send — which is why the bench sends only
    // the map it changed: a stale phone sending all five would write its old
    // copies of the other four back over another device's edits. The list
    // itself is always sent, and replacing it is what the caller means.
    await groupScope(groupId).upsert('clubSettings', doc);
    // The list changed, so the stock and count keyed by it may have too.
    forgetShelfExtras(groupId);
    // Aliases go back to the admin who saved them; the public GET never lists them.
    return NextResponse.json({ strings: doc.strings, links: doc.links, prices: doc.prices, aliases, colours, notes });
  } catch (err) {
    console.error('PATCH /api/stringing/strings failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}

const RENAME_STATUS = { invalid_name: 400, not_offered: 404, name_taken: 409 } as const;

/** What a stringer is told back: the list and its reel colours, nothing of the admin's. */
function answer(read: { strings: string[]; links: Record<string, string>; prices: Record<string, number | null>; aliases: Record<string, string>; colours: Record<string, string[]>; notes?: Record<string, string> }, stringer: boolean) {
  return NextResponse.json(
    stringer
      ? { strings: read.strings, colours: read.colours }
      : { strings: read.strings, links: read.links, prices: read.prices, aliases: read.aliases, colours: read.colours, notes: read.notes ?? {} },
  );
}

/** Some strings' reel colours, merged into the stored doc (rate limit and auth already passed). */
async function setColours(req: NextRequest, value: unknown, memberId: string | null, stringer: boolean) {
  try {
    await ensureClubSettings();
    const groupId = resolveGroupId(req);
    const prior = await readOfferedStringsWithLinks(groupId);
    if (!prior) return NextResponse.json({ error: 'write_failed' }, { status: 503 });
    const colours = mergeColours(prior.colours, value, prior.strings);
    if (!colours) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const next = { ...prior, colours };
    const doc: OfferedStringsDoc = { id: stringsDocId(groupId), ...next, updatedAt: new Date().toISOString(), updatedBy: memberId };
    await groupScope(groupId).upsert('clubSettings', doc);
    forgetShelfExtras(groupId);
    return answer(next, stringer);
  } catch (err) {
    console.error('PATCH /api/stringing/strings colours failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}

/** One string renamed on the stored doc (rate limit and auth already passed). */
async function rename(req: NextRequest, op: unknown, memberId: string | null, stringer: boolean) {
  const from = (op as { from?: unknown } | null)?.from;
  const to = (op as { to?: unknown } | null)?.to;
  try {
    await ensureClubSettings();
    const groupId = resolveGroupId(req);
    const prior = await readOfferedStringsWithLinks(groupId);
    if (!prior) return NextResponse.json({ error: 'write_failed' }, { status: 503 });
    const result = renameOffered(prior, from, to);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: RENAME_STATUS[result.error] });
    const next = result.value;
    const doc: OfferedStringsDoc = {
      id: stringsDocId(groupId),
      ...next,
      updatedAt: new Date().toISOString(),
      updatedBy: memberId,
    };
    await groupScope(groupId).upsert('clubSettings', doc);
    forgetShelfExtras(groupId);
    return answer(next, stringer);
  } catch (err) {
    console.error('PATCH /api/stringing/strings rename failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
