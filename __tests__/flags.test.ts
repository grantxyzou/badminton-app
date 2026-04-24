import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isFlagOn, getEnv, isPreviewEnv } from '../lib/flags';

const originalEnv = { ...process.env };

describe('feature flags', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_DEMO;
    delete process.env.NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV;
    delete process.env.NEXT_PUBLIC_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns false when flag is unset', () => {
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DEMO')).toBe(false);
  });

  it('returns false when flag is explicitly "false"', () => {
    process.env.NEXT_PUBLIC_FLAG_DEMO = 'false';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DEMO')).toBe(false);
  });

  it('returns true only when flag is exactly "true"', () => {
    process.env.NEXT_PUBLIC_FLAG_DEMO = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DEMO')).toBe(true);
  });

  it('treats non-"true" truthy-looking values as off (prevents accidental enablement)', () => {
    process.env.NEXT_PUBLIC_FLAG_DEMO = '1';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DEMO')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_DEMO = 'yes';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DEMO')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_DEMO = 'TRUE';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DEMO')).toBe(false);
  });

  it('each flag is read independently', () => {
    process.env.NEXT_PUBLIC_FLAG_DEMO = 'true';
    process.env.NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV = 'false';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_DEMO')).toBe(true);
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV')).toBe(false);
  });

  it('recognizes NEXT_PUBLIC_FLAG_STATS_ATTENDANCE', () => {
    delete process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE;
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE = 'true';
    expect(isFlagOn('NEXT_PUBLIC_FLAG_STATS_ATTENDANCE')).toBe(true);
    delete process.env.NEXT_PUBLIC_FLAG_STATS_ATTENDANCE;
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
