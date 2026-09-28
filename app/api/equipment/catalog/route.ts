import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import type { EquipmentCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID: EquipmentCategory[] = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];

/**
 * The catalog is seed data: its only writer is `ensureCatalogSeeded` at cold
 * start, so a row changes with a DEPLOY, not with a tap. Every Stats mount
 * used to pay a full-category read (71 rackets) per process, per visitor, and
 * the Gear register opens it several times over. One memo per category, one
 * minute, and ONLY against real Cosmos — the mock store is what tests seed
 * and re-seed between cases, and a memo there would hand one case another's
 * catalog. The client keeps its own per-page cache (`useCatalog`); the
 * `Cache-Control` below lets the browser skip the round trip entirely for
 * five minutes, `private` because the response follows a member cookie.
 */
const MEMO_TTL_MS = 60 * 1000;
const memo = new Map<string, { at: number; items: unknown[] }>();

function memoEnabled() {
  return Boolean(process.env.COSMOS_CONNECTION_STRING);
}

/** Test seam: forget every memoized category. */
export function _resetCatalogMemo() {
  memo.clear();
}

export async function GET(req: NextRequest) {
  try {
    // Creates the container AND fills it from the curated seed if empty — the
    // production container was never seeded, so this read used to return [].
    await ensureCatalogSeeded();
    const raw = new URL(req.url).searchParams.get('category');
    // An UNRECOGNIZED category used to coerce silently to 'racket' and answer
    // 200. That is a trap for exactly this feature: the categories read as
    // "shoes" / "strings" / "shuttles" in the design but the enum is singular,
    // so a plural typo would have returned a list of RACKETS with a success
    // status and no way to notice. Absent still defaults to racket (the
    // existing callers rely on it); wrong is now an error.
    if (raw !== null && !(VALID as string[]).includes(raw)) {
      return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
    }
    const category = raw ?? 'racket';
    const headers = { 'Cache-Control': 'private, max-age=300' };
    const hit = memoEnabled() ? memo.get(category) : undefined;
    if (hit && Date.now() - hit.at < MEMO_TTL_MS) {
      return NextResponse.json({ items: hit.items }, { headers });
    }
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
    if (memoEnabled()) memo.set(category, { at: Date.now(), items });
    return NextResponse.json({ items }, { headers });
  } catch (error) {
    // Legible-fail: surface the failure, do NOT pretend an empty catalog.
    console.error('GET equipment/catalog error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
