import { describe, it, expect, afterEach } from 'vitest';
import { isNative, nativePlatform, hasNativePlugin } from '../lib/native';

/**
 * `isNative()` is the seam every native branch hangs off. Its contract is
 * `lib/standalone.ts`'s: false when unknown, true only when Capacitor says so,
 * and it must never throw — a throwing detector would take the whole page
 * down on the web for a question that only matters in the shell.
 */
type Cap = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
};
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

/**
 * `hasNativePlugin` answers "is this plugin in the binary the person is
 * actually running?" — the question version skew creates. The shell loads the
 * LIVE web bundle, so the JS always knows about plugins the installed binary
 * may predate.
 *
 * It is TRI-STATE on purpose, and that is the whole point of the helper.
 * Returning a plain boolean would make "I can't tell" indistinguishable from
 * "definitely absent", and callers disable UI on absent — so a Capacitor
 * version without `isPluginAvailable` would silently disable a button that
 * works perfectly. Same rule as `isNative()`'s and `lib/standalone.ts`'s:
 * unknown is not a confirmed negative (CLAUDE.md).
 */
describe('hasNativePlugin', () => {
  it('is null on the web — the question is meaningless off-shell', () => {
    delete g.window;
    expect(hasNativePlugin('Browser')).toBeNull();
    g.window = { Capacitor: { isNativePlatform: () => false } };
    expect(hasNativePlugin('Browser')).toBeNull();
  });

  it('is null when the bridge cannot answer, NOT false', () => {
    // An older binary whose Capacitor predates isPluginAvailable. Answering
    // `false` here would disable a working sign-in button.
    g.window = { Capacitor: { isNativePlatform: () => true } };
    expect(hasNativePlugin('Browser')).toBeNull();
  });

  it('is true when the binary reports the plugin', () => {
    g.window = {
      Capacitor: { isNativePlatform: () => true, isPluginAvailable: (n: string) => n === 'Browser' },
    };
    expect(hasNativePlugin('Browser')).toBe(true);
  });

  it('is false only when the binary explicitly denies the plugin', () => {
    g.window = {
      Capacitor: { isNativePlatform: () => true, isPluginAvailable: (n: string) => n === 'Browser' },
    };
    expect(hasNativePlugin('FirebaseMessaging')).toBe(false);
  });

  it('is null when the bridge throws', () => {
    g.window = {
      Capacitor: {
        isNativePlatform: () => true,
        isPluginAvailable: () => {
          throw new Error('bridge broken');
        },
      },
    };
    expect(hasNativePlugin('Browser')).toBeNull();
  });
});
