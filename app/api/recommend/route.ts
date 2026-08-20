import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isAdminAuthed, verifyMemberAuth } from '@/lib/auth';
import { recommendRacket } from '@/lib/recommend';
import { buildProfile } from '@/lib/racketProfile';
import { recommendRackets } from '@/lib/racketRecommend';
import { getCanonicalLevel, type LevelSubject } from '@/lib/levelStore';
import { drillPicksFor, type DrillPick } from '@/lib/drills';
import { buildPickReasons } from '@/lib/pickReasons';
import { tallyClubGear, type ClubGearEntry } from '@/lib/clubGear';
import type { CatalogItem, EquipmentCategory, PlayerGear } from '@/lib/types';
import type { Rating } from '@/lib/assessment';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES: EquipmentCategory[] = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];
/** Categories with a scoring engine. Everything else is a valid ask we cannot
 *  answer yet — distinct from an invalid ask, which is a 400. */
const ENGINE_CATEGORIES: EquipmentCategory[] = ['racket'];

// Shared with /api/equipment/catalog: creates the container AND fills it from
// the curated seed. Without this the container is empty in real Cosmos and
// there is simply nothing to recommend.

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
        // Must match resolveMemberId in app/api/equipment/gear/route.ts exactly
        // (same active=true filter) — gear is WRITTEN at gear-<resolveMemberId>
        // and READ here at gear-<subject.memberId>. A rename that leaves a
        // stale inactive row with the same name would otherwise let this
        // query pick a different id than the write path, 404 the gear read,
        // and silently drop the player's format/budget/currentRacketId.
        query: 'SELECT * FROM c WHERE LOWER(c.name) = @name AND c.active = true',
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

// Lazy container bootstrap for the gear read below — real Cosmos doesn't
// auto-create containers. Mirrors app/api/equipment/gear/route.ts's ensureGear.
let gearReady: Promise<void> | null = null;
function ensureGear(): Promise<void> {
  if (!gearReady) {
    gearReady = ensureContainer('playerGear', '/memberId').catch((err) => {
      gearReady = null;
      throw err;
    });
  }
  return gearReady;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Probes by name — rate-limit like /api/members/me so it can't enumerate members + stages.
  // Rule 4: rate limit stays first, before any auth check, so it can't be bypassed.
  const ip = getClientIp(req);
  if (!checkRateLimit(`recommend:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ item: null, reason: null });
  }
  try {
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';

    // An UNRECOGNIZED category used to be silently ignored (both queries below
    // hardcoded 'racket'). That's a trap for a per-category rail: the plural
    // "shoes" reads naturally but the enum is singular ("shoe"), so a plural
    // typo would previously have returned a racket pick with a 200 and no way
    // to notice. Absent still defaults to racket (existing callers rely on
    // it); wrong is now an error. Checked before the auth gate below so it
    // can't be used to probe auth behavior.
    const rawCategory = new URL(req.url).searchParams.get('category');
    if (rawCategory !== null && !(VALID_CATEGORIES as string[]).includes(rawCategory)) {
      return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
    }
    const category = (rawCategory ?? 'racket') as EquipmentCategory;

    if (isFlagOn('NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER')) {
      // D8 privacy gate: engine reasons quote the player's individual skill
      // ratings ("smash 3/5"), and member names are enumerable via
      // GET /api/members. The flag-off branch below stays public because it
      // returns only a coarse stage-derived pick.
      const member = verifyMemberAuth(req);
      const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
      if (!name || (!ownsName && !isAdminAuthed(req))) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }

      if (!ENGINE_CATEGORIES.includes(category)) {
        // A valid category we cannot score yet. NOT an error: the rail
        // renders its parked card from this, and shoes/shuttles are a
        // data-sourcing problem, not a request-shape problem. Checked before
        // any profile/catalog work so an unsupported category is cheap.
        return NextResponse.json({ item: null, reason: null, unavailable: 'no_engine' });
      }

      await ensureCatalogSeeded();
      const subject = await resolveSubject(name);
      const { resources: assessments } = await getContainer('assessments')
        .items.query({
          query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c WHERE c.memberId = @memberId',
          parameters: [{ name: '@memberId', value: subject.memberId }],
        })
        .fetchAll();
      const latest = (assessments as { memberId?: string; takenAt?: string; ratings?: unknown }[])
        .filter((a) => a && a.memberId === subject.memberId && typeof a.takenAt === 'string')
        .sort((a, b) => (a.takenAt! < b.takenAt! ? 1 : -1))[0];

      await ensureGear();
      // A missing gear doc (real-Cosmos 404) means "no gear yet" and is fine
      // to treat as null. Any OTHER read failure must NOT be swallowed into
      // null — that would silently re-enable the bug this feature fixes
      // (recommending a racket the player already owns) and lose their
      // format/budget, so it falls through to the outer catch's 500 instead
      // (lying-empty-state rule).
      let gear: PlayerGear | null = null;
      try {
        const { resource } = await getContainer('playerGear').item(`gear-${subject.memberId}`, subject.memberId).read();
        gear = (resource as PlayerGear | undefined) ?? null;
      } catch (err) {
        const code = (err as { code?: number | string })?.code;
        if (code !== 404 && code !== '404') throw err;
      }

      const profile = buildProfile({ ratings: (latest?.ratings as Rating[]) ?? [], gear });
      // D5: no ratings -> say so rather than score fourteen 3s and emit a
      // confident, meaningless pick.
      if (!profile) {
        return NextResponse.json({ item: null, reason: null, needsCheckIn: true });
      }

      const { resources: catalogItems } = await getContainer('equipmentCatalog')
        .items.query({
          query: 'SELECT * FROM c WHERE c.category = @category',
          parameters: [{ name: '@category', value: category }],
        })
        .fetchAll();

      if (catalogItems.length === 0) {
        return NextResponse.json({ item: null, reason: null, unavailable: 'no_catalog' });
      }

      const top = recommendRackets(profile, catalogItems as CatalogItem[], 1, category)[0];
      // The mock store ignores @category (see lib/cosmos.ts), so catalogItems
      // above can be non-empty even when nothing of THIS category exists —
      // recommendRackets' internal filter is the one that actually agrees
      // with real Cosmos. Rows present but nothing scorable is still a
      // catalog problem, not a "player has no viable pick" problem, so it
      // gets the same unavailable code as a literally-empty query.
      if (!top) return NextResponse.json({ item: null, reason: null, unavailable: 'no_catalog' });

      // Drill picks for cross-domain grounding. A failure here must NOT take the
      // recommendation down — reasons degrade to equipment-only.
      let drills: DrillPick[] = [];
      try {
        drills = await drillPicksFor(subject);
      } catch {
        drills = [];
      }

      // Club tally, cohort-guarded by tallyClubGear before it ever reaches the
      // reason builder (which re-checks anyway).
      let clubEntries: ClubGearEntry[] = [];
      try {
        const { resources: gearDocs } = await getContainer('playerGear').items
          .query({ query: 'SELECT c.items FROM c' })
          .fetchAll();
        clubEntries = tallyClubGear(gearDocs as Pick<PlayerGear, 'items'>[]);
      } catch {
        clubEntries = [];
      }

      const reasons = buildPickReasons({
        item: top.item,
        engineReasons: top.reasons,
        drills,
        clubEntries,
      });

      return NextResponse.json({
        item: top.item,
        reason: reasons[0] ?? null,
        reasons,
        warnings: top.warnings,
      });
    }

    // The flag-off branch scores RACKETS and nothing else — its catalog query
    // below is literally `@category: 'racket'`. Before the rail existed that
    // was harmless (the only caller never passed a category), but the rail asks
    // per category, so on a deployment with RACKET_RECOMMENDER off (bpm-stable
    // today) `?category=string` would have come back a racket and rendered
    // under the STRINGS card. Same `unavailable: 'no_engine'` contract as the
    // flag-on branch, so the rail's parked card covers both without knowing
    // which branch answered.
    if (category !== 'racket') {
      return NextResponse.json({ item: null, reason: null, unavailable: 'no_engine' });
    }

    await ensureCatalogSeeded();

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
    // An empty catalog is a SOURCING gap, not a failure — tag it so the rail
    // can tell it apart from the one other 200 that carries no item, the
    // rate-limit refusal above, which must render as an error.
    if (!item) return NextResponse.json({ item: null, reason: null, unavailable: 'no_catalog' });
    return NextResponse.json({ item, reason: reasonFor(item, stage) });
  } catch (error) {
    console.error('GET recommend error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
