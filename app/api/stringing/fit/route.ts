/**
 * GET /api/stringing/fit?id=<catalog string id> — "Based on your racket and
 * skill" on a string's page (docs/plans/stringing-canvas-redesign.md, Decision 9).
 * GET /api/stringing/fit?ids=<id>,<id>… — the map's glow (the canvas,
 * 2026-11-12: "this AI personalized analysis … should be top level visible"):
 * `{ racket, fits: { [id]: verdict } }` for up to 40 strings, verdicts only.
 *
 * How ONE string suits the caller's OWN racket, by the same pairing engine as
 * the Stats string card (`pairString`), run over a list of one. It is a read
 * the browser cannot do for itself: the engine needs the server-built skill
 * profile, and the frame is resolved here from the caller's own gear, never
 * from the query string — a parameter naming a FRAME would let anyone pair
 * any frame (the same reason `/api/recommend` resolves it server-side).
 *
 * `&racket=<bag item id>` (docs/plans/map-racket-choice.md) chooses WHICH of
 * the caller's own rackets, on either form. It names a row in the gear doc
 * the member cookie points at, so nothing from the query ever reaches the
 * catalog read; a value the bag does not hold (another member's, a removed or
 * typed-in racket, a catalog id) answers for the racket in play, exactly as
 * with no parameter. The `ids` answer adds `racketId` (the racket it
 * answered for) and `rackets` (the caller's rackets it can pair), which is
 * what the map's "Change" sheet lists.
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
import { activeRacket, pairableRackets } from '@/lib/activeRacket';
import { pairString } from '@/lib/stringPair';
import type { CatalogItem, FitRacketChoice, FitVerdict, StringFit } from '@/lib/types';
import type { Rating } from '@/lib/assessment';

export const dynamic = 'force-dynamic';

const ID_RE = /^[a-z0-9-]{1,80}$/;
/** A shelf is a handful of strings; the cap keeps one read bounded. */
const MAX_IDS = 40;
/** A bag is a few rackets; the cap bounds the catalog reads behind the list. */
const MAX_RACKETS = 8;

function range(item: CatalogItem): [number, number] | null {
  const lo = item.attributes?.tensionMinLbs;
  const hi = item.attributes?.tensionMaxLbs;
  return typeof lo === 'number' && typeof hi === 'number' ? [lo, hi] : null;
}

async function catalogItem(id: string, category: 'string' | 'racket'): Promise<CatalogItem | null> {
  // A POINT READ (the container's key is `/category`): it was a query over every
  // partition for one known row (audit, 2026-11-05).
  const { resource } = await getContainer('equipmentCatalog').item(id, category).read<CatalogItem>();
  return resource && resource.id === id && resource.category === category ? resource : null;
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

  const params = new URL(req.url).searchParams;
  // `ids` is the map's question: which strings on the shelf suit my racket?
  // One answer for the whole shelf, the verdicts only, never a reason each.
  const many = params.has('ids');
  const ids = many ? (params.get('ids') ?? '').split(',').filter(Boolean) : [params.get('id') ?? ''];
  if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((x) => ID_RE.test(x))) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const id = ids[0];

  try {
    await ensureCatalogSeeded();
    const string = many ? null : await catalogItem(id, 'string');
    if (!many && !string) return NextResponse.json({ error: 'not_found' }, { status: 404 });

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
    if (!profile) return NextResponse.json(many ? { fits: null, reason: 'needs_check_in' } : { fit: null, reason: 'needs_check_in' });

    // The OWNED frame only. `/api/recommend` falls back to a recommended frame
    // for its card; here the section is titled "your racket", so a frame the
    // player does not own would be a claim about a racket that is not theirs.
    //
    // The member's choice of racket is matched against THEIR OWN bag, by the
    // bag item's id: the query never names a frame. No match is no choice.
    const choices = pairableRackets(gear).slice(0, MAX_RACKETS);
    const asked = params.get('racket');
    const chosen = asked ? choices.find((i) => i.id === asked) ?? null : null;
    const inPlay = activeRacket(gear);
    const delta = comfortTensionDeltaLb(effectiveArmComfort(gear));

    if (many) {
      // Every racket the sheet can offer, named by the catalog. A row the
      // catalog has lost is left out rather than offered and then refused.
      const frames = await Promise.all(choices.map((i) => catalogItem(i.catalogId!, 'racket')));
      const known = choices.flatMap((item, n) => (frames[n] ? [{ item, frame: frames[n]! }] : []));
      const picked = chosen ? known.find((k) => k.item.id === chosen.id) ?? null : null;
      // With no choice (or one that did not resolve): the racket in play, as
      // before. It is read on its own only if the cap above left it out.
      const fallback = picked ? null
        : known.find((k) => k.frame.id === profile.currentRacketId)
          ?? (profile.currentRacketId && inPlay
            ? await catalogItem(profile.currentRacketId, 'racket').then((f) => (f ? { item: inPlay, frame: f } : null))
            : null);
      const use = picked ?? fallback;
      if (!use) return NextResponse.json({ fits: null, reason: 'no_frame' });
      const frame = use.frame;
      const rackets: FitRacketChoice[] = known.map((k) => ({
        id: k.item.id,
        name: `${k.frame.brand} ${k.frame.model}`,
        inPlay: k.item.id === inPlay?.id,
      }));
      // The same engine and the same rule for the verdict as one string's
      // page, so the map's glow and the page cannot disagree.
      const fits: Record<string, FitVerdict> = {};
      const strings = await Promise.all(ids.map((x) => catalogItem(x, 'string')));
      for (const s of strings) {
        if (!s) continue;
        const p = pairString(frame, [s], profile, delta, gear?.fitSwing);
        fits[s.id] = !p ? 'not_for_frame' : p.warnings.length > 0 ? 'worth_a_look' : 'good_match';
      }
      return NextResponse.json({ racket: `${frame.brand} ${frame.model}`, racketId: use.item.id, rackets, fits });
    }

    const frame = (chosen ? await catalogItem(chosen.catalogId!, 'racket') : null)
      ?? (profile.currentRacketId ? await catalogItem(profile.currentRacketId, 'racket') : null);
    if (!frame) return NextResponse.json({ fit: null, reason: 'no_frame' });

    // The same comfort delta and swing the Stats card scores with, so the two
    // cannot disagree about the same frame and string.
    const pairing = pairString(frame, [string!], profile, delta, gear?.fitSwing);
    const verdict: FitVerdict = !pairing ? 'not_for_frame' : pairing.warnings.length > 0 ? 'worth_a_look' : 'good_match';
    const level = typeof string!.attributes?.skillLevel === 'string' ? string!.attributes.skillLevel : null;

    const fit: StringFit = {
      racket: `${frame.brand} ${frame.model}`,
      verdict,
      reason: pairing?.reasons[0] ?? null,
      frameTension: range(frame),
      stringTension: range(string!),
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
