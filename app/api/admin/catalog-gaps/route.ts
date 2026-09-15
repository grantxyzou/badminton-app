import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { readClubGearDocs } from '@/lib/clubGearDocs';
import { rosterMembers } from '@/lib/roster';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { catalogGaps } from '@/lib/catalogGaps';
import type { CatalogItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Rackets this club's members typed in by name because the catalog lacks them
 * (`lib/catalogGaps.ts`): the owner's list of models to add. Admin-only,
 * read-only, rate-limited.
 *
 * Names are shown: an admin can already open any member's bag, and "which
 * exact model is it?" is a question for a person. The read is the club gear
 * projection (`readClubGearDocs`), roster-narrowed and never selecting the fit
 * answers, so the arm answer cannot reach this list.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`catalog-gaps:${ip}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const groupId = resolveGroupId(req);
    await ensureCatalogSeeded();
    const [docs, roster, catalogRes] = await Promise.all([
      readClubGearDocs(groupId),
      rosterMembers(groupId),
      getContainer('equipmentCatalog').items
        .query({ query: 'SELECT * FROM c WHERE c.category = @category', parameters: [{ name: '@category', value: 'racket' }] })
        .fetchAll(),
    ]);
    const names = new Map(roster.map((r) => [r.member.id, r.membership?.name ?? r.member.name]));
    const catalog = (catalogRes.resources as CatalogItem[]).filter((r) => r.category === 'racket');
    return NextResponse.json({ gaps: catalogGaps(docs, names, catalog) });
  } catch (error) {
    console.error('GET admin/catalog-gaps error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
}
