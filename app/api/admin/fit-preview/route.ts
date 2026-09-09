import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { buildProfile } from '@/lib/racketProfile';
import { recommendFit, fitLevel, fitTechniqueCeiling, isScorable, canon, FIT_ENGINE_VERSION, type FitInput } from '@/lib/racketFit';
import { activeRacket, rackets } from '@/lib/activeRacket';
import type { CatalogItem, PlayerGear } from '@/lib/types';
import type { Rating } from '@/lib/assessment';

export const dynamic = 'force-dynamic';

/**
 * How the golden set is checked against real data, and how its cases are
 * drafted. Admin-only, read-only, rate-limited.
 *
 *   ?memberId=<id>  → the engine's top three ids + fitState for that member,
 *                     no reason text (this is a comparison surface, not a
 *                     second recommendation UI).
 *   (no param)      → one SKELETON per member who has a gear doc or a
 *                     check-in: the case shape `__tests__/fixtures/fit-golden.json`
 *                     wants, ids `gNN`, names dropped, `acceptable: []` for
 *                     the owner and the club stringer to fill by hand.
 *                     `scripts/dump-fit-cases.mjs` prints this.
 */
function toInput(gear: PlayerGear | null, ratings: Rating[], catalog: CatalogItem[]): FitInput {
  const profile = buildProfile({ ratings, gear });
  const active = activeRacket(gear);
  const anchorRow = active?.catalogId ? catalog.find((r) => r.id === active.catalogId) ?? null : null;
  const owned = rackets(gear).filter((i) => !i.retiredAt);
  return {
    anchor: anchorRow && isScorable(anchorRow) ? anchorRow : null,
    ownedIds: new Set(owned.map((i) => i.catalogId).filter((id): id is string => typeof id === 'string')),
    ownedLabels: new Set(owned.map((i) => canon(i.label)).filter(Boolean)),
    goal: gear?.fitGoal, swing: gear?.fitSwing, armComfort: gear?.fitArmComfort, grip: gear?.fitGrip,
    format: gear?.playFormat ?? 'both',
    budgetMaxCad: typeof gear?.budgetMaxCad === 'number' ? gear.budgetMaxCad : undefined,
    level: profile ? fitLevel(profile) : null,
    hasRatings: ratings.length > 0,
    techniqueCeiling: profile ? fitTechniqueCeiling(profile) : undefined,
  };
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`fit-preview:${ip}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await ensureCatalogSeeded();
    await ensureContainer('playerGear', '/memberId');
    await ensureContainer('assessments', '/memberId');
    const { resources: catalogRows } = await getContainer('equipmentCatalog').items
      .query({ query: 'SELECT * FROM c WHERE c.category = @category', parameters: [{ name: '@category', value: 'racket' }] })
      .fetchAll();
    const catalog = (catalogRows as CatalogItem[]).filter((r) => r.category === 'racket');

    const latestRatings = async (memberId: string): Promise<Rating[]> => {
      const { resources } = await getContainer('assessments').items
        .query({ query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c WHERE c.memberId = @memberId', parameters: [{ name: '@memberId', value: memberId }] })
        .fetchAll();
      const latest = (resources as { memberId?: string; takenAt?: string; ratings?: Rating[] }[])
        .filter((a) => a.memberId === memberId && typeof a.takenAt === 'string')
        .sort((a, b) => (a.takenAt! < b.takenAt! ? 1 : -1))[0];
      return latest?.ratings ?? [];
    };

    const memberId = new URL(req.url).searchParams.get('memberId')?.trim().slice(0, 80) ?? '';
    if (memberId) {
      let gear: PlayerGear | null = null;
      try {
        const { resource } = await getContainer('playerGear').item(`gear-${memberId}`, memberId).read();
        gear = (resource as PlayerGear | undefined) ?? null;
      } catch (err) {
        const code = (err as { code?: number | string })?.code;
        if (code !== 404 && code !== '404') throw err;
      }
      const ratings = await latestRatings(memberId);
      const fit = recommendFit(toInput(gear, ratings, catalog), catalog);
      return NextResponse.json({
        memberId, engineVersion: FIT_ENGINE_VERSION, fitState: fit.fitState,
        top3: fit.top ? [fit.top.item.id, ...fit.alternatives.map((a) => a.item.id)] : [],
      });
    }

    // Skeletons: every member with a gear doc or a check-in, anonymised.
    const { resources: gearDocs } = await getContainer('playerGear').items.query({ query: 'SELECT * FROM c' }).fetchAll();
    const { resources: assessed } = await getContainer('assessments').items.query({ query: 'SELECT c.memberId FROM c' }).fetchAll();
    const memberIds = [...new Set([
      ...(gearDocs as PlayerGear[]).map((g) => g.memberId),
      ...(assessed as { memberId?: string }[]).map((a) => a.memberId).filter((id): id is string => typeof id === 'string'),
    ])].sort();
    const cases = [];
    let n = 0;
    for (const id of memberIds) {
      const gear = (gearDocs as PlayerGear[]).find((g) => g.memberId === id) ?? null;
      const ratings = await latestRatings(id);
      const items = rackets(gear).map((i) => ({ catalogId: i.catalogId, category: 'racket', label: i.catalogId ? undefined : i.label }));
      const active = activeRacket(gear);
      n += 1;
      cases.push({
        id: `g${String(n).padStart(2, '0')}`,
        note: '',
        ratedBy: '',
        ratedAt: '',
        gear: {
          items,
          activeCatalogId: active?.catalogId ?? undefined,
          playFormat: gear?.playFormat, budgetMaxCad: gear?.budgetMaxCad,
          fitGoal: gear?.fitGoal, fitSwing: gear?.fitSwing, fitArmComfort: gear?.fitArmComfort, fitGrip: gear?.fitGrip,
        },
        ratings,
        acceptable: [],
        unacceptable: [],
      });
    }
    return NextResponse.json({ engineVersion: FIT_ENGINE_VERSION, catalog: 'scripts/data/equipment-catalog.json', cases });
  } catch (error) {
    console.error('GET admin/fit-preview error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
}
