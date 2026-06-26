// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isStandalone, isIOS } from '@/lib/standalone';

afterEach(() => {
  vi.restoreAllMocks();
  // Reset the iOS-detection navigator overrides between cases.
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
});

// jsdom doesn't implement matchMedia, so assign a stub (can't spyOn undefined).
function stubMatchMedia(matches: boolean) {
  (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = vi
    .fn()
    .mockReturnValue({ matches } as MediaQueryList);
}

describe('isStandalone', () => {
  it('true when display-mode: standalone matches', () => {
    stubMatchMedia(true);
    expect(isStandalone()).toBe(true);
  });

  it('true when navigator.standalone (iOS) is set', () => {
    stubMatchMedia(false);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
  });

  it('false in a normal browser tab', () => {
    stubMatchMedia(false);
    expect(isStandalone()).toBe(false);
  });
});

describe('isIOS', () => {
  it('true for an iPhone UA', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    );
    expect(isIOS()).toBe(true);
  });

  it('false for an Android UA', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120',
    );
    expect(isIOS()).toBe(false);
  });
});
