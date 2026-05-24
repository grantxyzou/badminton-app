import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import type { PlayerGear, GearItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

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

// TODO(value-hub): gear writes are name-keyed and unauthenticated for Slice-0
// (a racket preference is low-sensitivity, same trust as anon sign-up). Bind to
// PIN/identity here if gear later carries sensitive data — verify body.pin
// against member.pinHash, same envelope as POST /api/players.
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
