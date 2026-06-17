import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isFlagOn, getEnv, isPreviewEnv } from '../lib/flags';

const originalEnv = { ...process.env };

describe('feature flags', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
    delete process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER;
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS;
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
