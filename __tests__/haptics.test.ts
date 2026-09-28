// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The sign-up tap must be silent anywhere it cannot be felt, and above all in
 * a native shell built before the Haptics plugin existed: the web code ships
 * with a deploy, the native half only with the next app build.
 */
const impact = vi.fn(async () => {});
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact }, ImpactStyle: { Light: 'LIGHT' } }));

type Win = Window & { Capacitor?: unknown };

function shell(opts: { plugin: boolean }) {
  (window as Win).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: (name: string) => opts.plugin && name === 'Haptics',
  };
}

afterEach(() => {
  delete (window as Win).Capacitor;
  impact.mockClear();
});

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('tapSuccess', () => {
  it('does nothing on the web', async () => {
    const { tapSuccess } = await import('@/lib/haptics');
    tapSuccess();
    await settle();
    expect(impact).not.toHaveBeenCalled();
  });

  it('does nothing in a shell built without the plugin', async () => {
    shell({ plugin: false });
    const { tapSuccess } = await import('@/lib/haptics');
    expect(() => tapSuccess()).not.toThrow();
    await settle();
    expect(impact).not.toHaveBeenCalled();
  });

  it('taps once, lightly, in a shell that has it', async () => {
    shell({ plugin: true });
    const { tapSuccess } = await import('@/lib/haptics');
    tapSuccess();
    await settle();
    expect(impact).toHaveBeenCalledOnce();
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('priming never taps, and never throws off the shell', async () => {
    const { primeHaptics } = await import('@/lib/haptics');
    expect(() => primeHaptics()).not.toThrow();
    shell({ plugin: false });
    expect(() => primeHaptics()).not.toThrow();
    shell({ plugin: true });
    primeHaptics();
    await settle();
    expect(impact).not.toHaveBeenCalled();
  });

  it('a primed tap still taps exactly once', async () => {
    shell({ plugin: true });
    const { primeHaptics, tapSuccess } = await import('@/lib/haptics');
    primeHaptics();
    tapSuccess();
    await settle();
    expect(impact).toHaveBeenCalledOnce();
  });

  it('swallows a plugin failure rather than rejecting', async () => {
    shell({ plugin: true });
    impact.mockRejectedValueOnce(new Error('unimplemented'));
    const { tapSuccess } = await import('@/lib/haptics');
    tapSuccess();
    await settle();
    expect(impact).toHaveBeenCalledOnce();
  });
});
