// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shareOrSaveImage } from '@/lib/shareImage';

/**
 * Regression coverage for #238 ("tapped save and nothing happens", iOS 18.7).
 *
 * The whole point of `shareOrSaveImage` is that no path completes invisibly, so
 * these tests assert the OUTCOME of each branch — especially the iOS ones,
 * where the old code fired an `a.click()` that WebKit dropped silently.
 */

const PNG = new Blob(['fake-png-bytes'], { type: 'image/png' });

/** Minimal canvas stub — jsdom has no real 2d/PNG encoder. */
function makeCanvas(blob: Blob | null = PNG): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.toBlob = ((cb: BlobCallback) => cb(blob)) as HTMLCanvasElement['toBlob'];
  return canvas;
}

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  // isIOS() treats a touch-capable "Macintosh" as iPadOS, so pin this too.
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: ua === IOS_UA ? 5 : 0,
    configurable: true,
  });
}

function setShare(canShare: boolean, share?: () => Promise<void>) {
  Object.defineProperty(window.navigator, 'canShare', { value: () => canShare, configurable: true });
  Object.defineProperty(window.navigator, 'share', {
    value: share ?? (() => Promise.resolve()),
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  // jsdom implements neither.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shareOrSaveImage', () => {
  it('reports an error instead of doing nothing when the canvas is missing', async () => {
    expect(await shareOrSaveImage(null)).toEqual({
      kind: 'error',
      message: 'Couldn’t generate the image — try again.',
    });
  });

  it('reports an error when the canvas yields no blob', async () => {
    const out = await shareOrSaveImage(makeCanvas(null));
    expect(out.kind).toBe('error');
  });

  it('uses the native share sheet when files are shareable', async () => {
    setUserAgent(IOS_UA);
    const share = vi.fn(() => Promise.resolve());
    setShare(true, share);

    expect(await shareOrSaveImage(makeCanvas())).toEqual({ kind: 'shared' });
    expect(share).toHaveBeenCalledOnce();
  });

  it('marks the excursion BEFORE handing off, so an iOS eviction still restores the tab', async () => {
    setUserAgent(IOS_UA);
    let markedAtShareTime: string | null = null;
    setShare(true, () => {
      markedAtShareTime = window.localStorage.getItem('badminton_excursion_at');
      return Promise.resolve();
    });

    await shareOrSaveImage(makeCanvas());
    expect(markedAtShareTime).not.toBeNull();
  });

  it('treats a dismissed share sheet as a completed interaction, not an error', async () => {
    setUserAgent(IOS_UA);
    const abort = Object.assign(new Error('share canceled'), { name: 'AbortError' });
    setShare(true, () => Promise.reject(abort));

    expect(await shareOrSaveImage(makeCanvas())).toEqual({ kind: 'dismissed' });
  });

  it('asks the user to long-press when iOS share fails for a real reason', async () => {
    // The regression in #238: the old code fell through to a.click() here,
    // which no-ops because the awaited share() already consumed the activation.
    setUserAgent(IOS_UA);
    const denied = Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
    setShare(true, () => Promise.reject(denied));

    expect(await shareOrSaveImage(makeCanvas())).toEqual({ kind: 'manual-save' });
  });

  it('never attempts a silent download on iOS when there is no native share', async () => {
    setUserAgent(IOS_UA);
    setShare(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    expect(await shareOrSaveImage(makeCanvas())).toEqual({ kind: 'manual-save' });
    expect(click).not.toHaveBeenCalled();
  });

  it('downloads on desktop when native file share is unavailable', async () => {
    setUserAgent(DESKTOP_UA);
    setShare(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    expect(await shareOrSaveImage(makeCanvas())).toEqual({ kind: 'downloaded' });
    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(PNG);
  });

  it('attaches the anchor to the document before clicking it', async () => {
    // Some WebKit builds ignore a click on a detached anchor.
    setUserAgent(DESKTOP_UA);
    setShare(false);
    let connectedAtClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      connectedAtClick = this.isConnected;
    });

    await shareOrSaveImage(makeCanvas());
    expect(connectedAtClick).toBe(true);
  });

  it('cleans the anchor up and revokes the object URL afterwards', async () => {
    vi.useFakeTimers();
    setUserAgent(DESKTOP_UA);
    setShare(false);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await shareOrSaveImage(makeCanvas());
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);

    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // not immediately — that races the hand-off
    vi.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('uses the requested filename', async () => {
    setUserAgent(DESKTOP_UA);
    setShare(false);
    let downloadAttr = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadAttr = this.download;
    });

    await shareOrSaveImage(makeCanvas(), 'session-cost.png');
    expect(downloadAttr).toBe('session-cost.png');
  });
});
