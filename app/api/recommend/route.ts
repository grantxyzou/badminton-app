import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { recommendRacket } from '@/lib/recommend';
import { getCanonicalLevel, type LevelSubject } from '@/lib/levelStore';
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

/**
 * Name → subject id, mirroring `resolveSubject` in app/api/stats/level/route.ts:
 * the members directory is canonical; non-members fall back to a name-derived
 * key so they still get a level. Queries by @name (the mock store honors @name,
 * not @memberId).
 */
async function resolveSubject(name: string): Promise<LevelSubject> {
  const trimmed = name.trim();
  try {
    const { resources } = await getContainer('members')
      .items.query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = @name',
        parameters: [{ name: '@name', value: trimmed.toLowerCase() }],
      })
      .fetchAll();
    const member = resources[0] as { id?: string } | undefined;
    if (member?.id) return { memberId: member.id, name: trimmed };
  } catch {
    /* fall through to name-derived id */
  }
  return { memberId: `name:${trimmed.toLowerCase()}`, name: trimmed };
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

    // Stage now rides the canonical skill level (folds self check-ins + game
    // calibration + Member.stage as fallback) instead of the rarely-set
    // Member.stage alone. null canonical stage → undefined → all-rounder pick.
    // We read only `.stage` (a coarse 1–6) and return only {item, reason}, so
    // nothing from the private CanonicalLevel leaks through this public route.
    let stage: number | undefined;
    if (name) {
      const subject = await resolveSubject(name);
      const canonical = await getCanonicalLevel(subject);
      stage = typeof canonical.stage === 'number' ? canonical.stage : undefined;
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
