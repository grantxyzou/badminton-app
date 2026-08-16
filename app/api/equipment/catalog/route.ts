import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { isFlagOn } from '@/lib/flags';
import type { EquipmentCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID: EquipmentCategory[] = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    // Creates the container AND fills it from the curated seed if empty — the
    // production container was never seeded, so this read used to return [].
    await ensureCatalogSeeded();
    const raw = new URL(req.url).searchParams.get('category');
    const category = (VALID as string[]).includes(raw ?? '') ? raw! : 'racket';
    const container = getContainer('equipmentCatalog');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.category = @category',
        parameters: [{ name: '@category', value: category }],
      })
      .fetchAll();
    // JS-side category filter so the mock store (which ignores @category) and
    // real Cosmos agree. Per CLAUDE.md: filter JS-side where mock + prod must match.
    const items = resources.filter((r) => r.category === category);
    return NextResponse.json({ items });
  } catch (error) {
    // Legible-fail: surface the failure, do NOT pretend an empty catalog.
    console.error('GET equipment/catalog error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
