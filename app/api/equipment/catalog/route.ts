import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import type { EquipmentCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID: EquipmentCategory[] = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];

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

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureCatalog();
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
