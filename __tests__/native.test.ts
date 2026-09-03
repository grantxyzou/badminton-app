import { describe, it, expect, afterEach } from 'vitest';
import { isNative, nativePlatform } from '../lib/native';

/**
 * `isNative()` is the seam every native branch hangs off. Its contract is
 * `lib/standalone.ts`'s: false when unknown, true only when Capacitor says so,
 * and it must never throw — a throwing detector would take the whole page
 * down on the web for a question that only matters in the shell.
 */
type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string };
const g = globalThis as { window?: { Capacitor?: Cap } };
const savedWindow = g.window;

afterEach(() => {
  if (savedWindow === undefined) delete g.window;
  else g.window = savedWindow;
});

describe('isNative', () => {
  it('is false with no window (SSR)', () => {
    delete g.window;
    expect(isNative()).toBe(false);
    expect(nativePlatform()).toBeNull();
  });

  it('is false when window.Capacitor is absent (browser, PWA)', () => {
    g.window = {};
    expect(isNative()).toBe(false);
  });

  it('is false when Capacitor is present but reports the web platform', () => {
    // Capacitor's web shim exists in a plain browser once a plugin is loaded;
    // it must not count as native.
    g.window = { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } };
    expect(isNative()).toBe(false);
    expect(nativePlatform()).toBeNull();
  });

  it('is true only when isNativePlatform() returns exactly true', () => {
    g.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } };
    expect(isNative()).toBe(true);
    expect(nativePlatform()).toBe('ios');
    g.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
    expect(nativePlatform()).toBe('android');
  });

  it('never throws, even when the bridge does', () => {
    g.window = {
      Capacitor: {
        isNativePlatform: () => {
          throw new Error('bridge broken');
        },
      },
    };
    expect(isNative()).toBe(false);
    expect(nativePlatform()).toBeNull();
  });
});
