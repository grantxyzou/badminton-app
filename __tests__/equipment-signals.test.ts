import { describe, it, expect } from 'vitest';
import { computeEquipmentSignals, pickEquipmentSignal, SKILL_SPEC_CONFLICTS } from '../lib/equipmentSignals';
import { SKILLS } from '../lib/assessment';
import type { CatalogItem } from '../lib/types';
import type { StoredAssessment } from '../lib/assessment';

function racket(id: string, attrs: Record<string, string>, skillRange: [number, number] = [1, 6]): CatalogItem {
  return { id, category: 'racket', brand: 'B', model: id, skillRange, attributes: attrs };
}

/** A snapshot where `weakKey` sits at the bottom. Other skills rated high. */
function snap(takenAt: string, weakKey: string): StoredAssessment {
  // Real SKILLS keys from lib/assessment.ts — bottomKeys() filters ratings
  // against that list, so abbreviated/wrong keys here would silently drop
  // and manufacture spurious ties among whatever real keys happened to match.
  const keys = ['serves_returns', 'net_play', 'clears_lifts', 'drops', 'drives', 'smashes', 'grip_deception', 'footwork_split_step', 'court_coverage', 'speed_stamina', 'game_reading', 'consistency', 'rules_strategy', 'training_mindset'];
  return {
    takenAt,
    overall: 3,
    ratings: keys.map((k) => ({ skillKey: k, value: k === weakKey ? 1 : 4 })),
  };
}

const CATALOG: CatalogItem[] = [
  racket('racket-heavy-power', { balance: 'Head-heavy', flex: 'Extra Stiff', weight: '3U' }, [4, 6]),
  racket('racket-light-touch', { balance: 'Head-light', flex: 'Medium', weight: '4U' }, [2, 5]),
  racket('racket-entry', { balance: 'Even', flex: 'Flexible', weight: '4U/5U' }, [1, 3]),
];

describe('computeEquipmentSignals', () => {
  it('returns nothing when the player has no racket — no racket, no diagnosis', () => {
    const out = computeEquipmentSignals({ snapshots: [snap('2026-01-01', 'drops')], canonicalLevel: null, racket: null, catalog: CATALOG });
    expect(out).toEqual([]);
  });

  it('flags a racket built for players ahead of the player', () => {
    const out = computeEquipmentSignals({
      snapshots: [], canonicalLevel: { stage: 2 } as never,
      racket: CATALOG[0], catalog: CATALOG,
    });
    const s = out.find((x) => x.kind === 'phase-mismatch');
    expect(s).toBeTruthy();
    expect(s!.facts.direction).toBe('below');
    expect(s!.suggests).toBeTruthy();
    expect(s!.suggests).not.toBe(CATALOG[0].id);
  });

  it('flags a racket the player has outgrown', () => {
    const out = computeEquipmentSignals({
      snapshots: [], canonicalLevel: { stage: 5 } as never,
      racket: CATALOG[2], catalog: CATALOG,
    });
    const s = out.find((x) => x.kind === 'phase-mismatch');
    expect(s!.facts.direction).toBe('above');
  });

  it('scores a two-phase gap higher than a one-phase gap', () => {
    const near = computeEquipmentSignals({ snapshots: [], canonicalLevel: { stage: 3 } as never, racket: CATALOG[0], catalog: CATALOG })
      .find((x) => x.kind === 'phase-mismatch')!;
    const far = computeEquipmentSignals({ snapshots: [], canonicalLevel: { stage: 1 } as never, racket: CATALOG[0], catalog: CATALOG })
      .find((x) => x.kind === 'phase-mismatch')!;
    expect(far.score).toBeGreaterThan(near.score);
  });

  // The diagnosis: a persistently weak skill that this racket's build makes harder.
  it('flags a weakness the racket fights', () => {
    const snaps = [snap('2026-01-01', 'drops'), snap('2026-01-08', 'drops'), snap('2026-01-15', 'drops')];
    const out = computeEquipmentSignals({ snapshots: snaps, canonicalLevel: null, racket: CATALOG[0], catalog: CATALOG });
    const s = out.find((x) => x.kind === 'weakness-conflict');
    expect(s).toBeTruthy();
    expect(s!.facts.skill).toBe('Drops');
    expect(s!.suggests).toBeTruthy();
  });

  it('does NOT flag a conflict when the racket suits the weak skill', () => {
    const snaps = [snap('2026-01-01', 'drops'), snap('2026-01-08', 'drops')];
    // head-light suits drops, so there is no conflict to report.
    const out = computeEquipmentSignals({ snapshots: snaps, canonicalLevel: null, racket: CATALOG[1], catalog: CATALOG });
    expect(out.find((x) => x.kind === 'weakness-conflict')).toBeUndefined();
  });

  it('needs a repeated weakness — one check-in is not a pattern', () => {
    const out = computeEquipmentSignals({ snapshots: [snap('2026-01-01', 'drops')], canonicalLevel: null, racket: CATALOG[0], catalog: CATALOG });
    expect(out.find((x) => x.kind === 'weakness-conflict')).toBeUndefined();
  });

  // Each of the three normalizations below is isolated to its own racket, with
  // the other two attributes deliberately set to NOT match any rule — so each
  // test is only satisfiable by the one normalization it claims to cover.
  // (Previously all three lived in one racket + a `drops` weakness; because
  // `fights()` is OR, the balance term alone satisfied the assertion and the
  // flex/weight normalizations were never actually load-bearing.)

  it('normalises "Slightly head-heavy" balance to match the head-heavy rule', () => {
    // flex/weight here match nothing in row 1 (drops/net_play), so only the
    // balance normalization can produce this conflict.
    const messy = racket('racket-slightly-heavy', { balance: 'Slightly head-heavy', flex: 'Medium', weight: '4U' }, [1, 6]);
    const snaps = [snap('2026-01-01', 'drops'), snap('2026-01-08', 'drops')];
    const out = computeEquipmentSignals({ snapshots: snaps, canonicalLevel: null, racket: messy, catalog: [...CATALOG, messy] });
    expect(out.find((x) => x.kind === 'weakness-conflict')).toBeTruthy();
  });

  it('normalises a hyphenated "extra-stiff" flex to match the "extra stiff" rule', () => {
    // balance/weight here match nothing in row 1, so only the flex
    // separator-normalization can produce this conflict. Covers the real
    // catalog's one racket recorded as "extra-stiff" rather than "Extra Stiff".
    const messy = racket('racket-hyphen-flex', { balance: 'Even', flex: 'extra-stiff', weight: '4U' }, [1, 6]);
    const snaps = [snap('2026-01-01', 'drops'), snap('2026-01-08', 'drops')];
    const out = computeEquipmentSignals({ snapshots: snaps, canonicalLevel: null, racket: messy, catalog: [...CATALOG, messy] });
    expect(out.find((x) => x.kind === 'weakness-conflict')).toBeTruthy();
  });

  it('normalises a combined "3U/4U" weight class to match the 3U rule', () => {
    // Row 3 (footwork/speed/court_coverage) is the only rule keyed on weight;
    // balance here is deliberately non-head-heavy, so only the weight
    // separator-normalization can produce this conflict.
    const messy = racket('racket-combined-weight', { balance: 'Even', flex: 'Medium', weight: '3U/4U' }, [1, 6]);
    const snaps = [snap('2026-01-01', 'footwork_split_step'), snap('2026-01-08', 'footwork_split_step')];
    const out = computeEquipmentSignals({ snapshots: snaps, canonicalLevel: null, racket: messy, catalog: [...CATALOG, messy] });
    expect(out.find((x) => x.kind === 'weakness-conflict')).toBeTruthy();
  });

  it('handles a racket with all three messy forms at once (defensive, not load-bearing alone)', () => {
    const messy = racket('racket-messy', { balance: 'Slightly head-heavy', flex: 'Extra Stiff', weight: '3U/4U' }, [1, 6]);
    const snaps = [snap('2026-01-01', 'drops'), snap('2026-01-08', 'drops')];
    const out = computeEquipmentSignals({ snapshots: snaps, canonicalLevel: null, racket: messy, catalog: [...CATALOG, messy] });
    expect(out.find((x) => x.kind === 'weakness-conflict')).toBeTruthy();
  });

  it('never suggests the racket the player already owns', () => {
    const snaps = [snap('2026-01-01', 'drops'), snap('2026-01-08', 'drops')];
    for (const owned of CATALOG) {
      const out = computeEquipmentSignals({ snapshots: snaps, canonicalLevel: { stage: 3 } as never, racket: owned, catalog: CATALOG });
      for (const s of out) expect(s.suggests).not.toBe(owned.id);
    }
  });
});

describe('pickEquipmentSignal', () => {
  it('returns the highest-scoring signal', () => {
    const picked = pickEquipmentSignal([
      { kind: 'outgrowing', score: 0.4, facts: {}, hint: 'a' },
      { kind: 'phase-mismatch', score: 0.8, facts: {}, hint: 'b' },
    ]);
    expect(picked!.kind).toBe('phase-mismatch');
  });

  it('returns null when everything is below threshold — silence beats obvious', () => {
    expect(pickEquipmentSignal([{ kind: 'outgrowing', score: 0.2, facts: {}, hint: 'a' }])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickEquipmentSignal([])).toBeNull();
  });
});

describe('SKILL_SPEC_CONFLICTS', () => {
  // This table encodes badminton judgement and is meant to be edited by hand.
  // Pin the skill keys so a typo cannot silently disable a rule. Derived from
  // the real SKILLS export (not restated as a hardcoded literal) — a
  // hardcoded copy here would pass even if it drifted from reality, which is
  // exactly the shape of a defect already caught on this branch (a hardcoded
  // key list was wrong and two of three conflict rules were permanently
  // inert while this test still passed).
  it('references only real skill keys', () => {
    const REAL = new Set(SKILLS.map((s) => s.key));
    for (const row of SKILL_SPEC_CONFLICTS) {
      for (const k of row.skills) expect(REAL.has(k)).toBe(true);
    }
  });
});
