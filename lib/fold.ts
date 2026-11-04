'use client';

import { useEffect, useState } from 'react';
import { hasNativePlugin, isNative } from './native';

/**
 * Where the fold is, and whether the phone is folded (docs/plans/foldable-layout.md,
 * step 3). ONE owner for three sources, in this order:
 *
 *  1. The store app's `BpmFold` plugin — iOS reads the WebView's division
 *     reserved region (`UIView.reservedRegions(kind: .division)`, iPhone Duo);
 *     Android reads Jetpack WindowManager's `FoldingFeature` (Galaxy Z Fold).
 *  2. The web's Device Posture API (`navigator.devicePosture`, `folded` /
 *     `continuous`) and Viewport Segments API (`window.viewport.segments`):
 *     Chrome on Android foldables today, Safari 27.1 behind a feature flag.
 *  3. Nothing. `posture` is null — UNKNOWN, not "flat" — and a caller that
 *     needs a split takes the screen's centre, which is where every fold is
 *     (the same rule steps 1 and 2 lean on in CSS).
 *
 * The fold rect is in CSS pixels of the page's viewport. `posture` is the
 * Device Posture API's two values, which are also exactly what Apple's region
 * reports: a division is active only while the device is partly open.
 *
 * IMPORTS NOTHING FROM `@capacitor/*` at the top: the plugin is a dynamic
 * `import()` inside an `isNative()` branch (`__tests__/native-imports.test.ts`).
 */

export type Posture = 'folded' | 'flat';
export type FoldAxis = 'vertical' | 'horizontal';

export interface FoldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FoldInfo {
  /** null = unknown (no source could say). */
  posture: Posture | null;
  /** The fold's rectangle while the device is folded; null when flat or unknown. */
  fold: FoldRect | null;
  /** The way the fold RUNS: vertical = book pose (panes side by side), horizontal = laptop pose (one above the other). */
  axis: FoldAxis | null;
  source: 'native' | 'web' | 'none';
}

export const UNKNOWN_FOLD: FoldInfo = { posture: null, fold: null, axis: null, source: 'none' };

interface SegmentLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function axisOf(fold: FoldRect): FoldAxis {
  return fold.height >= fold.width ? 'vertical' : 'horizontal';
}

/**
 * The fold between two viewport segments. Two segments side by side (same
 * top, different left) leave a vertical fold between them; two stacked leave
 * a horizontal one. One segment, or any other count, is no fold.
 */
export function foldFromSegments(segments: readonly SegmentLike[] | null | undefined): FoldRect | null {
  if (!segments || segments.length !== 2) return null;
  const [p, q] = [...segments].sort((s, t) => s.left - t.left || s.top - t.top);
  if (![p.left, p.top, p.right, p.bottom, q.left, q.top, q.right, q.bottom].every(finite)) return null;
  if (q.left >= p.right && Math.abs(q.top - p.top) < 1) {
    return { x: p.right, y: Math.min(p.top, q.top), width: q.left - p.right, height: Math.max(p.bottom, q.bottom) - Math.min(p.top, q.top) };
  }
  if (q.top >= p.bottom && Math.abs(q.left - p.left) < 1) {
    return { x: Math.min(p.left, q.left), y: p.bottom, width: Math.max(p.right, q.right) - Math.min(p.left, q.left), height: q.top - p.bottom };
  }
  return null;
}

/**
 * What the native plugin answers, checked field by field: a plugin on an
 * older binary, or a bridge that drops a key, must never become a fold at
 * NaN. `posture: 'unknown'` (iOS below 27) reads as unknown.
 */
export function foldFromNative(raw: unknown): FoldInfo {
  if (!raw || typeof raw !== 'object') return UNKNOWN_FOLD;
  const r = raw as { posture?: unknown; fold?: unknown };
  const posture: Posture | null = r.posture === 'folded' ? 'folded' : r.posture === 'flat' ? 'flat' : null;
  if (posture === null) return UNKNOWN_FOLD;
  let fold: FoldRect | null = null;
  if (r.fold && typeof r.fold === 'object') {
    const f = r.fold as Record<string, unknown>;
    if (finite(f.x) && finite(f.y) && finite(f.width) && finite(f.height) && f.width >= 0 && f.height >= 0) {
      fold = { x: f.x, y: f.y, width: f.width, height: f.height };
    }
  }
  // A folded device with no rect is still folded; a flat one never has a rect.
  return { posture, fold: posture === 'folded' ? fold : null, axis: fold && posture === 'folded' ? axisOf(fold) : null, source: 'native' };
}

interface DevicePostureLike {
  type?: string;
  addEventListener?: (type: 'change', cb: () => void) => void;
  removeEventListener?: (type: 'change', cb: () => void) => void;
}

function devicePosture(): DevicePostureLike | null {
  if (typeof navigator === 'undefined') return null;
  const p = (navigator as Navigator & { devicePosture?: DevicePostureLike }).devicePosture;
  return p && typeof p === 'object' ? p : null;
}

function viewportSegments(): SegmentLike[] | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { viewport?: { segments?: SegmentLike[] } };
  const segs = w.viewport?.segments ?? (window.visualViewport as (VisualViewport & { segments?: SegmentLike[] }) | null)?.segments;
  return Array.isArray(segs) ? segs : null;
}

/** The web's own answer, read now. */
export function readWebFold(): FoldInfo {
  const type = devicePosture()?.type;
  const posture: Posture | null = type === 'folded' ? 'folded' : type === 'continuous' ? 'flat' : null;
  const fold = posture === 'folded' ? foldFromSegments(viewportSegments()) : null;
  if (posture === null && !fold) return UNKNOWN_FOLD;
  return { posture: posture ?? 'folded', fold, axis: fold ? axisOf(fold) : null, source: 'web' };
}

/**
 * The two panes a split screen gets: `first` is the half that faces away
 * (the top in laptop pose, the left in book pose), `second` the half the
 * person holds or taps. With no fold known, the centre of the viewport —
 * across in portrait, down the middle in landscape — with a `gap` of nothing.
 */
export interface SplitPanes {
  axis: FoldAxis;
  /** Size of the first pane along the split axis, CSS px. */
  first: number;
  /** The fold itself, CSS px (0 when unknown). */
  gap: number;
  /** Size of the second pane. */
  second: number;
}

export function splitForFold(info: FoldInfo, viewportWidth: number, viewportHeight: number): SplitPanes {
  const f = info.fold;
  if (f && info.axis === 'horizontal' && f.y > 0 && f.y + f.height < viewportHeight) {
    return { axis: 'horizontal', first: f.y, gap: f.height, second: viewportHeight - f.y - f.height };
  }
  if (f && info.axis === 'vertical' && f.x > 0 && f.x + f.width < viewportWidth) {
    return { axis: 'vertical', first: f.x, gap: f.width, second: viewportWidth - f.x - f.width };
  }
  if (viewportWidth > viewportHeight) {
    const half = Math.floor(viewportWidth / 2);
    return { axis: 'vertical', first: half, gap: 0, second: viewportWidth - half };
  }
  const half = Math.floor(viewportHeight / 2);
  return { axis: 'horizontal', first: half, gap: 0, second: viewportHeight - half };
}

interface BpmFoldPlugin {
  getFold(): Promise<unknown>;
  addListener(event: 'foldChanged', cb: (data: unknown) => void): Promise<{ remove: () => Promise<void> }>;
}

/** Boxed, for the same reason as `lib/widgetBridge.ts`: a plugin proxy answers `then`. */
let plugin: Promise<{ fold: BpmFoldPlugin }> | null = null;

function bpmFold(): Promise<{ fold: BpmFoldPlugin }> {
  if (!plugin) {
    plugin = import('@capacitor/core').then(({ registerPlugin }) => ({
      fold: registerPlugin<BpmFoldPlugin>('BpmFold'),
    }));
  }
  return plugin;
}

/**
 * iOS has no event for the division region changing: UIKit re-runs a view's
 * `updateConstraints()` when the regions it read change, which a WebView
 * never calls for us. So while someone is subscribed — only the courtside
 * scoreboard, only while it is open — the plugin is asked again this often.
 * One bridge call a second, with no I/O behind it.
 */
export const NATIVE_FOLD_POLL_MS = 1000;

/**
 * Subscribe to the fold. Calls `cb` with the current answer as soon as one
 * source has it, then on every change. Returns the unsubscribe.
 */
export function subscribeFold(cb: (info: FoldInfo) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  if (isNative() && hasNativePlugin('BpmFold') !== false) {
    let stopped = false;
    let remove: (() => Promise<void>) | null = null;
    let last = '';
    const emit = (raw: unknown) => {
      if (stopped) return;
      const info = foldFromNative(raw);
      const key = JSON.stringify(info);
      if (key === last) return;
      last = key;
      cb(info);
    };
    const ask = () => {
      bpmFold()
        .then(({ fold }) => fold.getFold())
        .then(emit)
        .catch(() => {
          /* an older binary without the plugin: stay unknown */
        });
    };
    ask();
    bpmFold()
      .then(({ fold }) => fold.addListener('foldChanged', emit))
      .then((h) => {
        if (stopped) void h.remove();
        else remove = h.remove;
      })
      .catch(() => {});
    const timer = window.setInterval(ask, NATIVE_FOLD_POLL_MS);
    window.addEventListener('resize', ask);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('resize', ask);
      if (remove) void remove();
    };
  }

  const read = () => cb(readWebFold());
  read();
  const posture = devicePosture();
  posture?.addEventListener?.('change', read);
  window.addEventListener('resize', read);
  return () => {
    posture?.removeEventListener?.('change', read);
    window.removeEventListener('resize', read);
  };
}

/** The fold, live, for a component that lays itself out around it. */
export function useFold(): FoldInfo {
  const [info, setInfo] = useState<FoldInfo>(UNKNOWN_FOLD);
  useEffect(() => subscribeFold(setInfo), []);
  return info;
}
