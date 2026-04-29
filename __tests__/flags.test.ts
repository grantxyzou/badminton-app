import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isFlagOn, getEnv, isPreviewEnv } from '../lib/flags';

const originalEnv = { ...process.env };

describe('feature flags', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE;
    delete process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
    delete process.env.NEXT_PUBLIC_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns false when flag is unset', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(false);
  });

  it('returns false when flag is explicitly "false"', () => {
    process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE = 'false';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(false);
  });

  it('returns true only when flag is exactly "true"', () => {
    process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(true);
  });

  it('treats non-"true" truthy-looking values as off (prevents accidental enablement)', () => {
    process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE = 'yes';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE = 'TRUE';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(false);
  });

  it('each flag is read independently', () => {
    process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE = 'true';
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'false';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(true);
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
  });

  it('recognizes NEXT_PUBLIC_FLAG_DESIGN_PREVIEW', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW')).toBe(true);
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
