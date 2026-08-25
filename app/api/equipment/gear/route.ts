import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { verifyMemberAuth, isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { rackets } from '@/lib/activeRacket';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { PlayerGear, GearItem, EquipmentCategory } from '@/lib/types';
import { resolveActiveMemberId } from '@/lib/memberResolve';

export const dynamic = 'force-dynamic';

const MAX_RACKETS = 10;
/**
 * Per-category cap. `MAX_RACKETS` only ever counted rackets, so every other
 * category was effectively UNCAPPED — the route's own comment below flags that
 * a non-racket value "would bypass MAX_RACKETS". Harmless while nothing could
 * add one; now that strings are selectable it is a real hole.
 *
 * Five for consumables: a player keeps a couple of string types, not ten.
 */
const MAX_PER_CATEGORY: Partial<Record<EquipmentCategory, number>> = { racket: MAX_RACKETS };
const DEFAULT_CATEGORY_CAP = 5;

function capFor(category: EquipmentCategory): number {
  return MAX_PER_CATEGORY[category] ?? DEFAULT_CATEGORY_CAP;
}
const BAG_WRITES_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const VALID_CATEGORIES = new Set<EquipmentCategory>(['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip']);

let ready: Promise<void> | null = null;
function ensureGear(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('playerGear', '/memberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}


/**
 * Shared gate for the three bag verbs: rate limit, then member resolution,
 * then ownership. Rate limit comes first (Rule 4) so it cannot be bypassed by
 * an unauthorized caller, and nothing mutates before ownership passes.
 *
 * Keyed on name+IP rather than memberId+IP: the key must be computable before
 * the member lookup, or the limiter sits behind the DB call it exists to
 * protect.
 */
async function authorizeBagWrite(req: NextRequest, name: string) {
  const key = `gear-bag:${name.toLowerCase()}:${getClientIp(req)}`;
  if (!checkRateLimit(key, BAG_WRITES_PER_HOUR, HOUR_MS)) {
    return { error: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) };
  }
  const memberId = await resolveActiveMemberId(name);
  if (!memberId) return { error: NextResponse.json({ error: 'member_not_found' }, { status: 404 }) };
  const caller = verifyMemberAuth(req);
  if (caller?.memberId !== memberId && !(await isAdminAuthedWithMember(req)).authed) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { memberId };
}

/** Cosmos returns `_etag` on every read; it is the concurrency token. */
type StoredGear = PlayerGear & { _etag?: string };

async function readGearDoc(memberId: string): Promise<StoredGear | undefined> {
  const container = getContainer('playerGear');
  const { resource } = await container.item(`gear-${memberId}`, memberId).read();
  return resource as StoredGear | undefined;
}

async function writeGearDoc(memberId: string, prior: StoredGear | undefined, next: Partial<PlayerGear>) {
  const doc: PlayerGear = {
    id: `gear-${memberId}`,
    memberId,
    items: next.items ?? prior?.items ?? [],
    activeRacketId: 'activeRacketId' in next ? next.activeRacketId : prior?.activeRacketId,
    playFormat: 'playFormat' in next ? next.playFormat : prior?.playFormat,
    budgetMaxCad: 'budgetMaxCad' in next ? next.budgetMaxCad : prior?.budgetMaxCad,
    stringLog: prior?.stringLog,
    shoesMileageSessions: prior?.shoesMileageSessions,
    updatedAt: new Date().toISOString(),
  };
  // Guarded against the etag we read. Every verb here is a read-modify-write
  // of the WHOLE document, so two overlapping writers each computed their
  // `items` from the same snapshot and the slower one clobbered the faster:
  // DELETE reads [X, Y] and commits [Y]; an overlapping PUT reads [X, Y],
  // commits [X, Y'] a moment later and wins — X is back in the database while
  // the client shows it gone until the next mount. Not hypothetical across
  // devices: bpm-stable and bpm-next share one Cosmos account, and the two
  // clients favour different verbs (see PUT's comment).
  //
  // The no-prior case uses `create`, not an unconditional upsert, because the
  // race is just as real there: two adds to a member's first-ever bag both
  // read "no document", both build a one-item bag, and one racket vanishes
  // with an HTTP 200. `create` is the verb with certain semantics here — it
  // rejects a duplicate id with 409, which `commitGearDoc` retries into the
  // IfMatch path. (`IfNoneMatch: '*'` would express the same intent but its
  // behaviour can't be verified here before shipping; `create` can.)
  const container = getContainer('playerGear');
  const { resource } = prior?._etag
    ? await container.items.upsert(doc, { accessCondition: { type: 'IfMatch', condition: prior._etag } })
    : await container.items.create(doc);
  return resource;
}

/** A stale-etag or duplicate-create rejection — a retry signal, not a failure. */
function isWriteConflict(error: unknown): boolean {
  const e = error as { code?: number | string; statusCode?: number } | null;
  return e?.code === 412 || e?.statusCode === 412 || e?.code === 409 || e?.statusCode === 409;
}

/** Bounded — enough to absorb a genuine race, not enough to hide a live-lock. */
const MAX_GEAR_WRITE_ATTEMPTS = 3;

type GearComputation =
  | { ok: true; next: Partial<PlayerGear> }
  | { ok: false; response: NextResponse };

/**
 * Read → compute → write as one optimistically-concurrent unit.
 *
 * `compute` re-runs on every attempt ON PURPOSE. It carries each verb's
 * validation (duplicate, bag_full, racket_not_found), and after a losing race
 * those answers may legitimately change — the racket you were about to add
 * may now already be there. Retrying only the write would commit a decision
 * made against a document that no longer exists.
 */
async function commitGearDoc(
  memberId: string,
  compute: (prior: StoredGear | undefined) => GearComputation,
): Promise<NextResponse> {
  for (let attempt = 0; attempt < MAX_GEAR_WRITE_ATTEMPTS; attempt++) {
    const prior = await readGearDoc(memberId);
    const computed = compute(prior);
    if (!computed.ok) return computed.response;
    try {
      return NextResponse.json({ gear: await writeGearDoc(memberId, prior, computed.next) });
    } catch (error) {
      if (!isWriteConflict(error)) throw error;
    }
  }
  // Sustained contention on one member's bag. Honest 409 rather than a 500:
  // nothing is broken and the caller's own retry is reasonable.
  return NextResponse.json({ error: 'save_conflict' }, { status: 409 });
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
    if (!name) return NextResponse.json({ gear: null });
    const memberId = await resolveActiveMemberId(name);
    if (!memberId) return NextResponse.json({ gear: null });

    const container = getContainer('playerGear');
    const { resource } = await container.item(`gear-${memberId}`, memberId).read();
    return NextResponse.json({ gear: (resource as PlayerGear | undefined) ?? null });
  } catch (error) {
    console.error('GET equipment/gear error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}

// The three verbs below make the gear doc behave like a bag: append, set the
// active-racket pointer, and remove. Each reads fresh and merges
// server-side — the client never sends the whole items array, so a failed
// read can't wipe the bag (see the atomic-append lesson in CLAUDE.md).
export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (!body.item || typeof body.item !== 'object') {
      return NextResponse.json({ error: 'item_required' }, { status: 400 });
    }
    // Reject anything outside the EquipmentCategory union before it can land
    // in the doc. Unvalidated, a non-'racket' value would bypass MAX_RACKETS
    // (which only counts rackets()) and produce an item BagList never
    // renders — no delete affordance, so the user can't remove it.
    if (!VALID_CATEGORIES.has(body.item.category)) {
      return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
    }
    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    return commitGearDoc(auth.memberId, (prior) => {
      const existing = prior?.items ?? [];
      const catalogId = typeof body.item.catalogId === 'string' ? body.item.catalogId : null;
      const label = String(body.item.label ?? '').slice(0, 80);

      // Primary dedupe key is catalogId. Free-text ("Other") entries have no
      // catalogId, so without a fallback a caller could add the same racket
      // repeatedly by omitting it — dedupe those on the normalized label
      // against other catalogId-less entries.
      const isDuplicate = catalogId
        ? existing.some((i) => i.catalogId === catalogId)
        : existing.some((i) => !i.catalogId && i.label.trim().toLowerCase() === label.trim().toLowerCase());
      if (isDuplicate) {
        return { ok: false, response: NextResponse.json({ error: 'duplicate_racket' }, { status: 409 }) };
      }
      // Counted within the incoming item's OWN category. Rackets keep their
      // existing limit and their existing 'bag_full' error code, so nothing that
      // handles that response has to change.
      const incomingCategory = body.item.category as EquipmentCategory;
      const sameCategory = existing.filter(
        (i) => ((i.category ?? 'racket') as EquipmentCategory) === incomingCategory,
      );
      if (sameCategory.length >= capFor(incomingCategory)) {
        return { ok: false, response: NextResponse.json({ error: 'bag_full' }, { status: 409 }) };
      }

      const incoming: GearItem = {
        id: randomBytes(12).toString('hex'),
        catalogId,
        category: body.item.category,
        label,
        acquiredAt: body.item.acquiredAt,
        notes: typeof body.item.notes === 'string' ? body.item.notes.slice(0, 200) : undefined,
      };

      const items = [...existing, incoming];
      // Only claim the pointer when the bag had NO rackets before this add —
      // a legacy bag (rackets present, pointer absent) already has an
      // effective active racket via activeRacket()'s items[0] fallback, and
      // appending must never silently move it onto the new racket.
      const priorRackets = rackets(prior ?? null);
      const activeRacketId = prior?.activeRacketId
        ?? (priorRackets.length === 0 && incoming.category === 'racket' ? incoming.id : undefined);

      return { ok: true, next: { items, activeRacketId } };
    });
  } catch (error) {
    console.error('POST equipment/gear error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    const activeRacketId = typeof body.activeRacketId === 'string' ? body.activeRacketId : '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

    const FORMATS = ['singles', 'doubles', 'both'] as const;
    const next: Partial<PlayerGear> = {};
    if ('playFormat' in body) {
      if (!FORMATS.includes(body.playFormat)) {
        return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
      }
      next.playFormat = body.playFormat;
    }
    if ('budgetMaxCad' in body) {
      const v = body.budgetMaxCad;
      // Bounded so a typo can't store a value that silently disables the
      // budget scorer for everything.
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 5000)) {
        return NextResponse.json({ error: 'invalid_budget' }, { status: 400 });
      }
      next.budgetMaxCad = v ?? undefined;
    }

    // activeRacketId is required only when this call isn't setting a
    // preference field — the original PATCH contract ("set my active
    // racket") vs. the new one ("set my format/budget preference"), sharing
    // one verb and one auth gate.
    if (!activeRacketId && !('playFormat' in body) && !('budgetMaxCad' in body)) {
      return NextResponse.json({ error: 'active_racket_required' }, { status: 400 });
    }

    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    return commitGearDoc(auth.memberId, (prior) => {
      if (activeRacketId) {
        if (!rackets(prior ?? null).some((i) => i.id === activeRacketId)) {
          return { ok: false, response: NextResponse.json({ error: 'racket_not_found' }, { status: 404 }) };
        }
        next.activeRacketId = activeRacketId;
      }
      return { ok: true, next };
    });
  } catch (error) {
    console.error('PATCH equipment/gear error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const url = new URL(req.url);
    const name = url.searchParams.get('name')?.trim().slice(0, 50) ?? '';
    const itemId = url.searchParams.get('itemId') ?? '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (!itemId) return NextResponse.json({ error: 'item_required' }, { status: 400 });

    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    return commitGearDoc(auth.memberId, (prior) => {
      const existing = prior?.items ?? [];
      if (!existing.some((i) => i.id === itemId)) {
        return { ok: false, response: NextResponse.json({ error: 'racket_not_found' }, { status: 404 }) };
      }

      const items = existing.filter((i) => i.id !== itemId);
      // Removing the active racket must leave a coherent pointer, never one
      // aimed at a deleted item. Uses the shared helper so a legacy item with
      // no `category` is still a candidate to inherit the pointer.
      const remainingRackets = rackets({ ...(prior as PlayerGear), items });
      const activeRacketId = prior?.activeRacketId === itemId
        ? remainingRackets[0]?.id
        : prior?.activeRacketId;

      return { ok: true, next: { items, activeRacketId } };
    });
  } catch (error) {
    console.error('DELETE equipment/gear error:', error);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
}

// Gear writes are identity-bound: the caller must hold the member_session
// cookie for the target member (minted at sign-up, no PIN required) or be an
// admin. See the owner/admin check below. GET stays public — a racket
// preference is low-sensitivity to read.
export async function PUT(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (!body.item || typeof body.item !== 'object') {
      return NextResponse.json({ error: 'item_required' }, { status: 400 });
    }
    // Same guard as POST, and now equally load-bearing here: FIX 1 made PUT
    // append instead of replace, so an invalid category is no longer
    // self-limiting (the old replace-by-category semantics meant the next
    // save of that bogus category overwrote it). Appended, it lands an item
    // BagList never renders and nothing can delete.
    if (!VALID_CATEGORIES.has(body.item.category)) {
      return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
    }
    const memberId = await resolveActiveMemberId(name);
    if (!memberId) return NextResponse.json({ error: 'member_not_found' }, { status: 404 });

    // Gear is member-scoped: only the member themselves (proven by the
    // member_session cookie minted at sign-up — no PIN required) or an admin
    // may write it. Closes the name-keyed impersonation hole while keeping the
    // "same trust as anon sign-up" bar the feature was designed around.
    const caller = verifyMemberAuth(req);
    const isOwner = caller?.memberId === memberId;
    if (!isOwner && !(await isAdminAuthedWithMember(req)).authed) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    return commitGearDoc(memberId, (prior) => {
      const existing = prior?.items ?? [];
      const catalogId = typeof body.item.catalogId === 'string' ? body.item.catalogId : null;
      const label = String(body.item.label ?? '').slice(0, 80);

      // Bag-aware since the final-review fix wave (2026-08): bpm-stable still
      // runs the pre-branch client, which saves via PUT, while bpm-next saves
      // via POST — and both deployments share one Cosmos DB. The old PUT wiped
      // every existing item of the same category before writing, so a
      // stable-side player saving one racket would silently delete every other
      // racket (and the activeRacketId pointer) a next-side player had built in
      // the same bag. Mirrors POST's append/dedupe semantics so either client
      // is safe against the other. Unlike POST, PUT is idempotent by contract:
      // a match (by catalogId, or by normalized label when catalogId is
      // absent) UPDATES that item in place instead of appending a duplicate or
      // 409ing, so re-saving the same racket twice is a no-op on bag shape.
      const matchIndex = catalogId
        ? existing.findIndex((i) => i.catalogId === catalogId)
        : existing.findIndex((i) => !i.catalogId && i.label.trim().toLowerCase() === label.trim().toLowerCase());

      const incoming: GearItem = {
        id: matchIndex >= 0 ? existing[matchIndex].id
          : (typeof body.item.id === 'string' ? body.item.id : randomBytes(12).toString('hex')),
        catalogId,
        category: body.item.category,
        label,
        acquiredAt: body.item.acquiredAt,
        tensionLbs: typeof body.item.tensionLbs === 'number' ? body.item.tensionLbs : undefined,
        notes: typeof body.item.notes === 'string' ? body.item.notes.slice(0, 200) : undefined,
      };

      let items: GearItem[];
      if (matchIndex >= 0) {
        items = existing.map((i, idx) => (idx === matchIndex ? incoming : i));
      } else {
        if (rackets(prior ?? null).length >= MAX_RACKETS) {
          return { ok: false, response: NextResponse.json({ error: 'bag_full' }, { status: 409 }) };
        }
        items = [...existing, incoming];
      }

      // NOT the same pointer rule as POST. POST's contract is "add to my bag",
      // so preserving the existing pointer is correct there. PUT's contract is
      // "set my racket" — a caller PUTting a racket means "this is the one I'm
      // using now," so the incoming racket must always become the active one.
      // Preserving the prior pointer here (as an earlier pass of this fix
      // wrongly did, mirroring POST) meant PUT A then PUT B left `items` as
      // [A, B] but activeRacket() still resolved to A — the hero card kept
      // showing the old racket after a successful "Saved!", while the bag
      // silently grew. A legacy pointerless bag regressed the same way: append
      // leaves items[0] as the old racket, so even the fallback returned it.
      const activeRacketId = incoming.category === 'racket' ? incoming.id : prior?.activeRacketId;

      return { ok: true, next: { items, activeRacketId } };
    });
  } catch (error) {
    console.error('PUT equipment/gear error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
