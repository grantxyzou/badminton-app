import { describe, it, expect } from 'vitest';
import { pairString, pairTension } from '../lib/stringPair';
import type { PlayerProfile } from '../lib/racketProfile';
import type { CatalogItem } from '../lib/types';

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    serves: 3, net_play: 3, clears: 3, drops: 3, drives: 3, smashes: 3, grip: 3,
    footwork: 3, court_coverage: 3, stamina: 3,
    game_reading: 3, consistency: 3, rules: 3, mindset: 3,
    format: 'both', ...over,
  };
}

function racket(id: string, attrs: Record<string, string | number> = {}): CatalogItem {
  return {
    id, category: 'racket', brand: 'Test', model: id, msrp: 150, skillRange: [2, 5],
    attributes: {
      balance: 'Even', flex: 'Medium', playStyle: 'All-round', weightMaxG: 85,
      tier: 'Mid-range', tensionMinLbs: 20, tensionMaxLbs: 28, ...attrs,
    },
  };
}

function str(id: string, attrs: Record<string, string | number> = {}): CatalogItem {
  return {
    id, category: 'string', brand: 'Test', model: id, msrp: 15, skillRange: [1, 5],
    attributes: {
      stringType: 'All-round', gaugeMm: 0.66, repulsion: 7, durability: 6,
      control: 7, feel: 'Medium', feelScale: 3, skillLevel: 'Intermediate',
      ratingSource: 'Brand published', priceSetUsdMin: 12, priceSetUsdMax: 14,
      tensionMinLbs: 20, tensionMaxLbs: 26, ...attrs,
    },
  };
}

describe('pairString — hard gate', () => {
  it('rejects a string whose tension window cannot overlap the racket', () => {
    // Racket tops out at 22 lb; this string needs 24 lb minimum. No stringer can
    // satisfy both, so the pair is not a bad pick — it is not a pick at all.
    const frame = racket('low-ceiling', { tensionMinLbs: 18, tensionMaxLbs: 22 });
    const impossible = str('needs-24', { tensionMinLbs: 24, tensionMaxLbs: 30 });

    expect(pairString(frame, [impossible], profile())).toBeNull();
  });

  it('still pairs when at least one string overlaps', () => {
    const frame = racket('low-ceiling', { tensionMinLbs: 18, tensionMaxLbs: 22 });
    const impossible = str('needs-24', { tensionMinLbs: 24, tensionMaxLbs: 30 });
    const fits = str('fits', { tensionMinLbs: 19, tensionMaxLbs: 24 });

    expect(pairString(frame, [impossible, fits], profile())?.item.id).toBe('fits');
  });
});

describe('pairString — system power compensates for the frame', () => {
  const repulsion = str('lively', { stringType: 'Repulsion', gaugeMm: 0.61, repulsion: 9, durability: 4 });
  const durable = str('solid', { stringType: 'Durability', gaugeMm: 0.7, repulsion: 5, durability: 10 });

  it('gives a head-heavy power frame the string that gives back control, not more power', () => {
    const powerFrame = racket('hh', { balance: 'Head-heavy', playStyle: 'Power', weightMaxG: 88 });
    expect(pairString(powerFrame, [repulsion, durable], profile())?.item.id).toBe('solid');
  });

  it('gives a head-light speed frame the string that gives back repulsion', () => {
    const speedFrame = racket('hl', { balance: 'Head-light', playStyle: 'Speed', weightMaxG: 83 });
    expect(pairString(speedFrame, [repulsion, durable], profile())?.item.id).toBe('lively');
  });
});

describe('pairString — feel balance', () => {
  it('warns when a stiff shaft meets a hard string', () => {
    const stiff = racket('stiff', { flex: 'Extra Stiff' });
    const hard = str('hard', { feelScale: 5, feel: 'Hard' });
    const soft = str('soft', { feelScale: 2, feel: 'Soft' });

    const out = pairString(stiff, [hard, soft], profile());
    expect(out?.item.id).toBe('soft');

    const harsh = pairString(stiff, [hard], profile());
    expect(harsh?.warnings.join(' ')).toMatch(/harsh|elbow/i);
  });

  it('does not crash on a string with no published feel', () => {
    // The reference reads `s.get('feel').lower()` unguarded — the one field in
    // it with no fallback, against its own stated philosophy. Ours degrades.
    const frame = racket('f');
    const noFeel = str('mystery', {});
    delete noFeel.attributes!.feel;

    expect(() => pairString(frame, [noFeel], profile())).not.toThrow();
    expect(pairString(frame, [noFeel], profile())?.item.id).toBe('mystery');
  });
});

describe('pairString — durability, value, skill gate', () => {
  it('warns about breakage without claiming how often the player plays', () => {
    // V4: hours_per_week has no source in this app, so the reference's
    // "about X weeks at your play rate" clause would state a fabricated fact.
    const powerFrame = racket('hh', { balance: 'Extra head-heavy', playStyle: 'Power', weightMaxG: 90 });
    const fragile = str('thin', { gaugeMm: 0.61, durability: 2, stringType: 'Repulsion' });
    const hitter = profile({ smashes: 5, drives: 5 });

    const out = pairString(powerFrame, [fragile], hitter);
    const warned = out!.warnings.join(' ');
    expect(warned).toMatch(/hours per restring/i);
    expect(warned).not.toMatch(/week|play rate/i);
  });

  it('warns when a cheap string undersells a premium frame', () => {
    const flagship = racket('flag', { tier: 'Premium' });
    const cheap = str('budget', { priceSetUsdMin: 6, priceSetUsdMax: 7 });

    expect(pairString(flagship, [cheap], profile())?.warnings.join(' '))
      .toMatch(/under-strung|flattens/i);
  });

  it('will not hand a beginner an advanced-only string on the other scorers', () => {
    const frame = racket('f');
    const advancedOnly = str('pro', { skillLevel: 'Advanced' });
    const forAnyone = str('club', { skillLevel: 'Beginner' });
    const beginner = profile({
      serves: 1, net_play: 1, clears: 1, drops: 1, drives: 1, smashes: 1, grip: 1,
      footwork: 1, court_coverage: 1, stamina: 1,
      game_reading: 1, consistency: 1, rules: 1, mindset: 1,
    });

    const out = pairString(frame, [advancedOnly, forAnyone], beginner);
    expect(out?.item.id).toBe('club');
    expect(pairString(frame, [advancedOnly], beginner)?.warnings.join(' '))
      .toMatch(/advanced/i);
  });
});

describe('pairTension — placement inside the overlap window', () => {
  const frame = racket('f', { tensionMinLbs: 20, tensionMaxLbs: 28 });
  const s = str('s', { tensionMinLbs: 22, tensionMaxLbs: 26 });

  it('never lands outside what both the frame and the string allow', () => {
    const lbs = pairTension(frame, s, profile())!;
    expect(lbs).toBeGreaterThanOrEqual(22);
    expect(lbs).toBeLessThanOrEqual(26);
  });

  it('places a more consistent striker higher in the window', () => {
    // High tension shrinks the sweet spot, so consistency of contact — grip
    // plus movement — is what earns it.
    const loose = pairTension(frame, s, profile({ grip: 1, footwork: 1, court_coverage: 1 }))!;
    const tight = pairTension(frame, s, profile({ grip: 5, footwork: 5, court_coverage: 5 }))!;
    expect(tight).toBeGreaterThan(loose);
  });

  it('returns null when the frame has no published ceiling', () => {
    const noCeiling = racket('nc');
    delete noCeiling.attributes!.tensionMaxLbs;
    expect(pairTension(noCeiling, s, profile())).toBeNull();
  });
});

/* ── Regressions from the 2026-08-21 code review ──────────────────────────
   Six divergences from docs/superpowers/reference/pair_racket_string.py that
   the original port introduced and the spec's V1-V6 list did not document. */

describe('pairString — tension reaches the power scorer (review #1)', () => {
  // The scorer's whole tension branch was dead: it always ran at the 24.0 lb
  // default. The observable consequence is that two players who would string
  // the SAME string on the SAME frame at different tensions used to get an
  // identical system-power figure.
  // Read off `systemPower`, not off the reason copy. The figure used to be
  // interpolated into a "System power 6.2/10 sits on target 6.4" reason; that
  // line was retired for reading as the engine narrating itself, and the
  // number moved onto the pairing as data so this regression stays observable.
  const systemPowerOf = (pairing: { systemPower: { value: number } }) => pairing.systemPower.value;

  const frame = racket('wide', { tensionMinLbs: 20, tensionMaxLbs: 28 });
  const s = str('one', { tensionMinLbs: 20, tensionMaxLbs: 26 });

  it('places a high-consistency and a low-consistency player at different tensions', () => {
    const high = pairTension(frame, s, profile({ grip: 5, footwork: 5, court_coverage: 5 }));
    const low = pairTension(frame, s, profile({ grip: 1, footwork: 1, court_coverage: 1 }));
    expect(high).not.toBe(low);
  });

  it('reports a different system power for those two players', () => {
    const high = pairString(frame, [s], profile({ grip: 5, footwork: 5, court_coverage: 5 }));
    const low = pairString(frame, [s], profile({ grip: 1, footwork: 1, court_coverage: 1 }));
    const hp = systemPowerOf(high!);
    const lp = systemPowerOf(low!);
    // Both must actually be reported, else this asserts nothing.
    expect(typeof hp).toBe('number');
    expect(typeof lp).toBe('number');
    expect(hp).not.toBe(lp);
  });

  it('still pairs a frame with no published ceiling, where tension is unknowable', () => {
    const noCeiling = racket('no-ceiling', { tensionMinLbs: 20 });
    delete noCeiling.attributes!.tensionMaxLbs;
    expect(pairTension(noCeiling, s, profile())).toBeNull();
    expect(pairString(noCeiling, [s], profile())).not.toBeNull();
  });
});

describe('pairString — the headline reason is the specific one (review #2)', () => {
  it('does not report the tension window as a reason at all', () => {
    const frame = racket('wide', { tensionMinLbs: 20, tensionMaxLbs: 28 });
    const s = str('one', { tensionMinLbs: 20, tensionMaxLbs: 26 });
    const pairing = pairString(frame, [s], profile())!;

    // The window line was demoted twice: first off the front (it was the
    // headline in 213 of 213 pairings), then out of the list entirely — the
    // sheet prints the same range as a spec row, so as a why-this reason it
    // spent a slot restating what was visible right above it.
    expect(pairing.reasons.length).toBeGreaterThan(0);
    expect(pairing.reasons.some((r) => /tension window/i.test(r))).toBe(false);
  });

  it('grounds its reasons in play rather than in the engine\'s arithmetic', () => {
    const frame = racket('wide', { tensionMinLbs: 20, tensionMaxLbs: 28 });
    const s = str('one', { tensionMinLbs: 20, tensionMaxLbs: 26 });
    const pairing = pairString(frame, [s], profile({ format: 'doubles' }))!;

    const joined = pairing.reasons.join(' ');
    expect(joined).not.toMatch(/system power|\/10 sits on target/i);
    expect(joined).not.toMatch(/hours (of play )?per restring/i);
    expect(joined).toMatch(/doubles|off-centre|hit|shuttle|frame/i);
  });

  /* Demoting the tension reason unconditionally deleted a different one.
     Callers truncate the reason list, so last position means never rendered —
     and "ceiling unpublished" is the only signal that this frame has no
     tension advice at all. Descriptions get demoted; caveats do not. */
  it('keeps the unpublished-ceiling caveat where it will still be rendered', () => {
    const noCeiling = racket('no-ceiling', { tensionMinLbs: 20 });
    delete noCeiling.attributes!.tensionMaxLbs;
    const pairing = pairString(noCeiling, [str('one')], profile())!;

    expect(pairing.reasons[0]).toMatch(/ceiling unpublished/i);
    // Still present after the truncation every caller applies.
    expect(pairing.reasons.slice(0, 3).join(' ')).toMatch(/ceiling unpublished/i);
  });
});

describe('pairString — provenance and unknowns are not fabricated (reviews #4, #5)', () => {
  it('flags community-estimated ratings as not manufacturer-published', () => {
    const frame = racket('wide');
    const s = str('consensus', { ratingSource: 'Consensus estimate' });
    const pairing = pairString(frame, [s], profile())!;
    expect(pairing.provenance).toMatch(/community consensus/i);
    // It must NOT ride in `warnings`: the sheet renders that array inline and
    // uncollapsed as safety copy, and sourcing is not a safety flag.
    expect(pairing.warnings.some((w) => /community consensus/i.test(w))).toBe(false);
  });

  it('stays silent about provenance when the brand published the ratings', () => {
    const frame = racket('wide');
    const pairing = pairString(frame, [str('published')], profile())!;
    expect(pairing.provenance).toBeUndefined();
    expect(pairing.warnings.some((w) => /community consensus/i.test(w))).toBe(false);
  });

  it('never claims a skill rating it does not have', () => {
    const frame = racket('wide');
    const unrated = str('unrated');
    delete unrated.attributes!.skillLevel;
    // Beginner: the assumed intermediate rank sits one step above them, so the
    // step-up warning fires and used to interpolate the absent label.
    const beginner = profile({
      serves: 1, net_play: 1, clears: 1, drops: 1, drives: 1, smashes: 1, grip: 1,
      footwork: 1, court_coverage: 1, stamina: 1,
      game_reading: 1, consistency: 1, rules: 1, mindset: 1,
    });
    const pairing = pairString(frame, [unrated], beginner)!;
    expect(pairing.warnings.join(' ')).not.toMatch(/undefined/);
    expect(pairing.warnings.some((w) => /no published skill rating/i.test(w))).toBe(true);
  });
});

describe('pairString — the same inputs give the same pick (review #6)', () => {
  it('breaks an exact score tie by model, not by catalog order', () => {
    const frame = racket('wide');
    // Identical in every scored attribute; only identity differs.
    const alpha = { ...str('a'), model: 'Alpha' };
    const omega = { ...str('o'), model: 'Omega' };

    const forward = pairString(frame, [alpha, omega], profile());
    const reversed = pairString(frame, [omega, alpha], profile());

    expect(forward!.score).toBe(reversed!.score);
    expect(forward!.item.model).toBe('Alpha');
    expect(reversed!.item.model).toBe('Alpha');
  });
});
