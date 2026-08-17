import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { verifyMemberAuth, isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { rackets } from '@/lib/activeRacket';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { PlayerGear, GearItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_RACKETS = 10;
const BAG_WRITES_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

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

async function resolveMemberId(name: string): Promise<string | null> {
  const members = getContainer('members');
  const { resources } = await members.items
    .query({
      query: 'SELECT c.id FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  return resources[0]?.id ?? null;
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
  const memberId = await resolveMemberId(name);
  if (!memberId) return { error: NextResponse.json({ error: 'member_not_found' }, { status: 404 }) };
  const caller = verifyMemberAuth(req);
  if (caller?.memberId !== memberId && !(await isAdminAuthedWithMember(req)).authed) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { memberId };
}

async function readGearDoc(memberId: string): Promise<PlayerGear | undefined> {
  const container = getContainer('playerGear');
  const { resource } = await container.item(`gear-${memberId}`, memberId).read();
  return resource as PlayerGear | undefined;
}

async function writeGearDoc(memberId: string, prior: PlayerGear | undefined, next: Partial<PlayerGear>) {
  const doc: PlayerGear = {
    id: `gear-${memberId}`,
    memberId,
    items: next.items ?? prior?.items ?? [],
    activeRacketId: 'activeRacketId' in next ? next.activeRacketId : prior?.activeRacketId,
    stringLog: prior?.stringLog,
    shoesMileageSessions: prior?.shoesMileageSessions,
    updatedAt: new Date().toISOString(),
  };
  const { resource } = await getContainer('playerGear').items.upsert(doc);
  return resource;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
    if (!name) return NextResponse.json({ gear: null });
    const memberId = await resolveMemberId(name);
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
    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    const prior = await readGearDoc(auth.memberId);
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
      return NextResponse.json({ error: 'duplicate_racket' }, { status: 409 });
    }
    if (rackets(prior ?? null).length >= MAX_RACKETS) {
      return NextResponse.json({ error: 'bag_full' }, { status: 409 });
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

    return NextResponse.json({ gear: await writeGearDoc(auth.memberId, prior, { items, activeRacketId }) });
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
    if (!activeRacketId) return NextResponse.json({ error: 'active_racket_required' }, { status: 400 });

    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    const prior = await readGearDoc(auth.memberId);
    if (!rackets(prior ?? null).some((i) => i.id === activeRacketId)) {
      return NextResponse.json({ error: 'racket_not_found' }, { status: 404 });
    }
    return NextResponse.json({ gear: await writeGearDoc(auth.memberId, prior, { activeRacketId }) });
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

    const prior = await readGearDoc(auth.memberId);
    const existing = prior?.items ?? [];
    if (!existing.some((i) => i.id === itemId)) {
      return NextResponse.json({ error: 'racket_not_found' }, { status: 404 });
    }

    const items = existing.filter((i) => i.id !== itemId);
    // Removing the active racket must leave a coherent pointer, never one
    // aimed at a deleted item.
    const remainingRackets = items.filter((i) => i.category === 'racket');
    const activeRacketId = prior?.activeRacketId === itemId
      ? remainingRackets[0]?.id
      : prior?.activeRacketId;

    return NextResponse.json({ gear: await writeGearDoc(auth.memberId, prior, { items, activeRacketId }) });
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
    const memberId = await resolveMemberId(name);
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

    const incoming: GearItem = {
      id: typeof body.item.id === 'string' ? body.item.id : randomBytes(12).toString('hex'),
      catalogId: typeof body.item.catalogId === 'string' ? body.item.catalogId : null,
      category: body.item.category,
      label: String(body.item.label ?? '').slice(0, 80),
      acquiredAt: body.item.acquiredAt,
      tensionLbs: typeof body.item.tensionLbs === 'number' ? body.item.tensionLbs : undefined,
      notes: typeof body.item.notes === 'string' ? body.item.notes.slice(0, 200) : undefined,
    };

    const container = getContainer('playerGear');
    const { resource: existing } = await container.item(`gear-${memberId}`, memberId).read();
    const prior = existing as PlayerGear | undefined;

    // One racket at a time in Slice-0: replace any existing item of the same category.
    const keptItems = (prior?.items ?? []).filter((i) => i.category !== incoming.category);
    const doc: PlayerGear = {
      id: `gear-${memberId}`,
      memberId,
      items: [...keptItems, incoming],
      stringLog: prior?.stringLog,
      shoesMileageSessions: prior?.shoesMileageSessions,
      updatedAt: new Date().toISOString(),
    };
    const { resource } = await container.items.upsert(doc);
    return NextResponse.json({ gear: resource });
  } catch (error) {
    console.error('PUT equipment/gear error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
