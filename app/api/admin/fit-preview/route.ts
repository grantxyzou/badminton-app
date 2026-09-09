import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { recommendFit, FIT_ENGINE_VERSION } from '@/lib/racketFit';
import { buildFitInput, readGearOrNull } from '@/lib/racketFitInput';
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
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`fit-preview:${ip}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await Promise.all([ensureContainer('playerGear', '/memberId'), ensureContainer('assessments', '/memberId')]);

    // The latest check-in per member, from ONE scan of `assessments`. The
    // skeleton branch used to query per member — one plus M round trips,
    // awaited in series.
    const latestByMember = async (): Promise<Map<string, Rating[]>> => {
      const { resources } = await getContainer('assessments').items
        .query({ query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c' })
        .fetchAll();
      const latest = new Map<string, { takenAt: string; ratings: Rating[] }>();
      for (const a of resources as { memberId?: string; takenAt?: string; ratings?: Rating[] }[]) {
        if (typeof a.memberId !== 'string' || typeof a.takenAt !== 'string') continue;
        const cur = latest.get(a.memberId);
        if (!cur || a.takenAt > cur.takenAt) latest.set(a.memberId, { takenAt: a.takenAt, ratings: a.ratings ?? [] });
      }
      return new Map([...latest].map(([k, v]) => [k, v.ratings]));
    };

    const memberId = new URL(req.url).searchParams.get('memberId')?.trim().slice(0, 80) ?? '';
    if (memberId) {
      // The catalog is read only where it is scored.
      await ensureCatalogSeeded();
      const [gear, ratingsByMember, catalogRes] = await Promise.all([
        readGearOrNull(memberId),
        latestByMember(),
        getContainer('equipmentCatalog').items
          .query({ query: 'SELECT * FROM c WHERE c.category = @category', parameters: [{ name: '@category', value: 'racket' }] })
          .fetchAll(),
      ]);
      const catalog = (catalogRes.resources as CatalogItem[]).filter((r) => r.category === 'racket');
      const ratings = ratingsByMember.get(memberId) ?? [];
      const fit = recommendFit(buildFitInput(gear, ratings, catalog), catalog);
      return NextResponse.json({
        memberId, engineVersion: FIT_ENGINE_VERSION, fitState: fit.fitState,
        top3: fit.top ? [fit.top.item.id, ...fit.alternatives.map((a) => a.item.id)] : [],
      });
    }

    // Skeletons: every member with a gear doc or a check-in, anonymised.
    const [gearRes, ratingsByMember] = await Promise.all([
      getContainer('playerGear').items.query({ query: 'SELECT * FROM c' }).fetchAll(),
      latestByMember(),
    ]);
    const gearDocs = gearRes.resources as PlayerGear[];
    const gearById = new Map(gearDocs.map((g) => [g.memberId, g]));
    const memberIds = [...new Set([...gearById.keys(), ...ratingsByMember.keys()])].sort();
    const cases = [];
    let n = 0;
    for (const id of memberIds) {
      const gear = gearById.get(id) ?? null;
      const ratings = ratingsByMember.get(id) ?? [];
      const items = rackets(gear).map((i) => ({ catalogId: i.catalogId, category: 'racket', label: i.catalogId ? undefined : i.label }));
      const active = activeRacket(gear);
      n += 1;
      cases.push({
        id: `g${String(n).padStart(2, '0')}`,
        // The OPERATOR's key, not the fixture's: the dump script prints it
        // separately and strips it from the cases it emits, so the owner can
        // ask `?memberId=` for the engine's current answer while rating
        // without guessing which member `g04` is. Admin-only endpoint.
        memberId: id,
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
