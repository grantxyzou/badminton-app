import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isFlagOn, getEnv, isPreviewEnv, FLAGS } from '../lib/flags';

const originalEnv = { ...process.env };

describe('feature flags', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
    delete process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER;
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS;
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
    delete process.env.NEXT_PUBLIC_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns false when flag is unset', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
  });

  it('returns false when flag is explicitly "false"', () => {
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'false';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
  });

  it('returns true only when flag is exactly "true"', () => {
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(true);
  });

  it('treats non-"true" truthy-looking values as off (prevents accidental enablement)', () => {
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'yes';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'TRUE';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
  });

  it('recognizes NEXT_PUBLIC_FLAG_COMMAND_CENTER', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_COMMAND_CENTER')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_COMMAND_CENTER')).toBe(true);
    process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_COMMAND_CENTER')).toBe(false);
  });

  it('recognizes NEXT_PUBLIC_FLAG_DESIGN_PREVIEW', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(true);
  });

  it('recognizes NEXT_PUBLIC_FLAG_LEDGER', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_LEDGER')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_LEDGER = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_LEDGER')).toBe(true);
    process.env.NEXT_PUBLIC_FLAG_LEDGER = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_LEDGER')).toBe(false);
  });

  it('recognizes NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')).toBe(true);
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')).toBe(false);
  });

  it('recognizes NEXT_PUBLIC_FLAG_SKILL_ASSESS', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')).toBe(true);
    process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')).toBe(false);
  });

  it('recognizes NEXT_PUBLIC_FLAG_INSIGHT_CARDS', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS')).toBe(true);
    process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS')).toBe(false);
    delete process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS;
  });

  // Sets and deletes explicitly rather than relying on the `beforeEach` reset,
  // which only clears 5 of the registered flags — env otherwise leaks between
  // cases in this file.

  describe('NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER', () => {
    it('is on only for the literal string "true"', () => {
      process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
      expect(isFlagOn('NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER')).toBe(true);
      for (const v of ['1', 'yes', 'TRUE', 'false', '']) {
        process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = v;
        expect(isFlagOn('NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER')).toBe(false);
      }
    });
  });
});

describe('environment detection', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to "dev" when NEXT_PUBLIC_ENV is unset', () => {
    expect(getEnv()).toBe('dev');
    expect(isPreviewEnv()).toBe(false);
  });

  it('returns "stable" on stable deployments', () => {
    process.env.NEXT_PUBLIC_ENV = 'stable';
    expect(getEnv()).toBe('stable');
    expect(isPreviewEnv()).toBe(false);
  });

  it('returns "next" on preview deployments', () => {
    process.env.NEXT_PUBLIC_ENV = 'next';
    expect(getEnv()).toBe('next');
    expect(isPreviewEnv()).toBe(true);
  });

  it('falls back to "dev" for unrecognized values', () => {
    process.env.NEXT_PUBLIC_ENV = 'prod';
    expect(getEnv()).toBe('dev');
  });
});

/**
 * THE FIELD MUST HOLD A DATE.
 *
 * Eleven flags used to say "after X is promoted to stable + lived-in for 2
 * weeks". That condition became impossible on 2026-08-25, when the second
 * deployment was deleted and there stopped being a promotion event — so those
 * flags were un-retireable by construction, and sat that way for up to three
 * months. Nobody notices a sentence quietly becoming false; anybody notices a
 * date in the past.
 *
 * This does NOT fail on an overdue flag. Being late is a backlog, not a broken
 * build, and a red suite for it would just get muted. `check-flag-sync.mjs`
 * reports overdue ones when someone edits the registry, which is the moment it
 * can actually be acted on.
 */
describe('plannedRemoval is a date, not a promise', () => {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;

  /** The only flags allowed to be dateless, each with a stated reason. */
  const DATELESS: Record<string, string> = {
    NEXT_PUBLIC_FLAG_DESIGN_PREVIEW:
      'gates a dev-only preview route — tooling, not a staged feature, so there is no ship date to count from',
  };

  it('every flag has an ISO date or a documented exemption', () => {
    const bad = Object.entries(FLAGS)
      .filter(([name, meta]) => !ISO.test(meta.plannedRemoval) && !(name in DATELESS))
      .map(([name, meta]) => `${name}: ${meta.plannedRemoval.slice(0, 60)}`);
    expect(
      bad,
      'Use YYYY-MM-DD (ship date + 2 weeks). A condition in prose cannot be ' +
        'checked, and this is exactly how eleven flags became permanent. Put ' +
        'anything a date cannot carry in `note`.',
    ).toEqual([]);
  });

  it('every exemption states why', () => {
    for (const [name, reason] of Object.entries(DATELESS)) {
      expect(reason.length, `${name} needs a real reason`).toBeGreaterThan(20);
      expect(FLAGS[name as keyof typeof FLAGS]).toBeDefined();
    }
  });

  it('every dated flag parses to a real calendar date', () => {
    // '2026-06-31' matches the regex and is not a day.
    for (const [name, meta] of Object.entries(FLAGS)) {
      if (!ISO.test(meta.plannedRemoval)) continue;
      const d = new Date(`${meta.plannedRemoval}T00:00:00Z`);
      expect(Number.isNaN(d.getTime()), `${name} has an unparseable date`).toBe(false);
      expect(d.toISOString().slice(0, 10), `${name} is not a real day`).toBe(meta.plannedRemoval);
    }
  });
});
