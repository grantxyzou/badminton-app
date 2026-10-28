/**
 * GET /api/stringing/fit?id=<catalog string id> — "Based on your racket and
 * skill" on a string's page (docs/plans/stringing-canvas-redesign.md, Decision 9).
 *
 * How ONE string suits the caller's OWN racket, by the same pairing engine as
 * the Stats string card (`pairString`), run over a list of one. It is a read
 * the browser cannot do for itself: the engine needs the server-built skill
 * profile, and the frame is resolved here from the caller's own gear, never
 * from the query string — a racketId parameter would let anyone pair any
 * frame (the same reason `/api/recommend` resolves it server-side).
 *
 * The caller only: no `name` parameter and no admin-on-behalf branch. An
 * admin browsing a string page gets their own fit or none.
 *
 * Answers `{ fit: null, reason }` rather than guessing when it cannot say:
 * `needs_check_in` (no skill ratings), `no_frame` (no racket in the bag that
 * the catalog knows). The section is then absent on the page, never filled
 * with a pairing against a racket the player does not own.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { ensureCatalogSeeded } from '@/lib/catalogSeed';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { requireMember, verifyMemberAuth } from '@/lib/auth';
import { buildProfile } from '@/lib/racketProfile';
import { comfortTensionDeltaLb, skillLevel } from '@/lib/racketFit';
import { effectiveArmComfort } from '@/lib/fitProfile';
import { readGearOrNull } from '@/lib/racketFitInput';
import { pairString } from '@/lib/stringPair';
import type { CatalogItem, FitVerdict, StringFit } from '@/lib/types';
import type { Rating } from '@/lib/assessment';

export const dynamic = 'force-dynamic';

const ID_RE = /^[a-z0-9-]{1,80}$/;

function range(item: CatalogItem): [number, number] | null {
  const lo = item.attributes?.tensionMinLbs;
  const hi = item.attributes?.tensionMaxLbs;
  return typeof lo === 'number' && typeof hi === 'number' ? [lo, hi] : null;
}

async function catalogItem(id: string, category: 'string' | 'racket'): Promise<CatalogItem | null> {
  const { resources } = await getContainer('equipmentCatalog').items.query({
    query: 'SELECT * FROM c WHERE c.id = @id AND c.category = @category',
    parameters: [{ name: '@id', value: id }, { name: '@category', value: category }],
  }).fetchAll();
  // Re-checked in JS: the mock store filters by parameter name only.
  return (resources as CatalogItem[]).find((r) => r.id === id && r.category === category) ?? null;
}

export async function GET(req: NextRequest) {
  // Rule 4: rate limit first. A string page is one call per open.
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-fit:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  const member = verifyMemberAuth(req);
  // An admin cookie alone (no member session) has no gear to pair against.
  if (!member) return NextResponse.json({ fit: null, reason: 'no_frame' });

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  try {
    await ensureCatalogSeeded();
    const string = await catalogItem(id, 'string');
    if (!string) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const { resources: assessments } = await getContainer('assessments').items.query({
      query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c WHERE c.memberId = @memberId',
      parameters: [{ name: '@memberId', value: member.memberId }],
    }).fetchAll();
    const latest = (assessments as { memberId?: string; takenAt?: string; ratings?: unknown }[])
      .filter((a) => a && a.memberId === member.memberId && typeof a.takenAt === 'string')
      .sort((a, b) => (a.takenAt! < b.takenAt! ? 1 : -1))[0];

    await ensureContainer('playerGear', '/memberId');
    const gear = await readGearOrNull(member.memberId);
    const profile = buildProfile({ ratings: (latest?.ratings as Rating[]) ?? [], gear });
    if (!profile) return NextResponse.json({ fit: null, reason: 'needs_check_in' });

    // The OWNED frame only. `/api/recommend` falls back to a recommended frame
    // for its card; here the section is titled "your racket", so a frame the
    // player does not own would be a claim about a racket that is not theirs.
    const frame = profile.currentRacketId ? await catalogItem(profile.currentRacketId, 'racket') : null;
    if (!frame) return NextResponse.json({ fit: null, reason: 'no_frame' });

    // The same comfort delta and swing the Stats card scores with, so the two
    // cannot disagree about the same frame and string.
    const pairing = pairString(frame, [string], profile, comfortTensionDeltaLb(effectiveArmComfort(gear)), gear?.fitSwing);
    const verdict: FitVerdict = !pairing ? 'not_for_frame' : pairing.warnings.length > 0 ? 'worth_a_look' : 'good_match';
    const level = typeof string.attributes?.skillLevel === 'string' ? string.attributes.skillLevel : null;

    const fit: StringFit = {
      racket: `${frame.brand} ${frame.model}`,
      verdict,
      reason: pairing?.reasons[0] ?? null,
      frameTension: range(frame),
      stringTension: range(string),
      level: skillLevel(profile),
      stringLevel: level,
    };
    return NextResponse.json({ fit });
  } catch (err) {
    // Never an empty answer on a failure: the page says it could not check.
    console.error('[stringing/fit] read failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
