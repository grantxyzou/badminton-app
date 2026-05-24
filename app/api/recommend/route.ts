import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { recommendRacket } from '@/lib/recommend';
import type { CatalogItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

let ready: Promise<void> | null = null;
function ensureCatalog(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('equipmentCatalog', '/category').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

function reasonFor(item: CatalogItem, stage?: number): string {
  if (typeof stage === 'number') {
    return `Players around your level often reach for the ${item.brand} ${item.model}.`;
  }
  return `A solid all-rounder lots of players start with: the ${item.brand} ${item.model}.`;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Probes by name — rate-limit like /api/members/me so it can't enumerate members + stages.
  const ip = getClientIp(req);
  if (!checkRateLimit(`recommend:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ item: null, reason: null });
  }
  try {
    await ensureCatalog();
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';

    let stage: number | undefined;
    if (name) {
      const members = getContainer('members');
      const { resources } = await members.items
        .query({
          query: 'SELECT c.stage FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
          parameters: [{ name: '@name', value: name }],
        })
        .fetchAll();
      const raw = resources[0]?.stage;
      stage = typeof raw === 'number' ? raw : undefined;
    }

    const catalog = getContainer('equipmentCatalog');
    const { resources: items } = await catalog.items
      .query({
        query: 'SELECT * FROM c WHERE c.category = @category',
        parameters: [{ name: '@category', value: 'racket' }],
      })
      .fetchAll();

    // recommendRacket filters to category='racket' internally, so the mock store
    // ignoring @category is harmless here.
    const item = recommendRacket({ stage, catalog: items as CatalogItem[] });
    if (!item) return NextResponse.json({ item: null, reason: null });
    return NextResponse.json({ item, reason: reasonFor(item, stage) });
  } catch (error) {
    console.error('GET recommend error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
