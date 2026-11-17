// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The outer-screen probe (docs/plans/outer-screen-scoreboard.md, step 1): the
 * store app's BpmFold plugin answers whether the phone can show a second view
 * on its outer screen. These hold the page's half: the answer is checked, and
 * there is none (null, never a guess) outside the store app or on a build that
 * predates the probe.
 */
const getDualScreenNative = vi.fn();
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ getDualScreen: getDualScreenNative }),
}));

import { dualScreenFromNative, getDualScreen } from '../lib/fold';

type CapWindow = Window & { Capacitor?: unknown };
function storeApp(pluginAvailable = true) {
  (window as CapWindow).Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => pluginAvailable && name === 'BpmFold',
  };
}

describe('dualScreenFromNative', () => {
  it('reads the plugin answer', () => {
    expect(dualScreenFromNative({ outerScreen: true, dualScreen: 'available', rearDisplay: 'unavailable' })).toEqual({
      outerScreen: true,
      dualScreen: 'available',
      rearDisplay: 'unavailable',
    });
  });

  it('an unknown status word reads as unknown, never as a status it is not', () => {
    expect(dualScreenFromNative({ outerScreen: true, dualScreen: 'ready', rearDisplay: 5 })).toEqual({
      outerScreen: true,
      dualScreen: 'unknown',
      rearDisplay: 'unknown',
    });
  });

  it('anything that is not an answer is null', () => {
    expect(dualScreenFromNative(null)).toBeNull();
    expect(dualScreenFromNative('available')).toBeNull();
    expect(dualScreenFromNative({ dualScreen: 'available' })).toBeNull();
  });
});

describe('getDualScreen', () => {
  afterEach(() => {
    delete (window as CapWindow).Capacitor;
    getDualScreenNative.mockReset();
  });

  it('in a browser there is no answer, and the plugin is never asked', async () => {
    expect(await getDualScreen()).toBeNull();
    expect(getDualScreenNative).not.toHaveBeenCalled();
  });

  it('in the store app it asks the plugin', async () => {
    storeApp();
    getDualScreenNative.mockResolvedValue({ outerScreen: true, dualScreen: 'unsupported', rearDisplay: 'available' });
    expect(await getDualScreen()).toEqual({ outerScreen: true, dualScreen: 'unsupported', rearDisplay: 'available' });
  });

  it('a build without the probe (the call rejects) is null, not unsupported', async () => {
    storeApp();
    getDualScreenNative.mockRejectedValue(new Error('"BpmFold.getDualScreen()" is not implemented on ios'));
    expect(await getDualScreen()).toBeNull();
  });

  it('a build without the fold plugin at all is null', async () => {
    storeApp(false);
    expect(await getDualScreen()).toBeNull();
    expect(getDualScreenNative).not.toHaveBeenCalled();
  });
});
