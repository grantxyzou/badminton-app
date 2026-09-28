'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { burstDurationMs, burstPieces } from '@/lib/shuttleBurst';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Viewport point the burst radiates from, and a key so a second sign-up replays it. */
export interface BurstOrigin {
  x: number;
  y: number;
  key: number;
}

interface Props {
  origin: BurstOrigin | null;
  /** The last piece has landed; the owner sets `origin` back to null. */
  onDone: () => void;
}

/**
 * The sign-up shuttle burst (docs/plans/signup-shuttle-burst.md): fourteen
 * brand shuttlecocks flying off the button in random directions at random
 * sizes, once, when the server has confirmed a sign-up.
 *
 * A FIXED layer portaled to <body>: the card the button sits in carries a
 * backdrop-filter, which would make it the containing block for anything
 * fixed inside it (the documented trap), and the origin is a viewport point
 * from `getBoundingClientRect` in any case. `pointer-events: none` on the
 * layer — a shuttle must never swallow a tap.
 *
 * Reduced motion renders NOTHING. The global rule would collapse the flight
 * to its end frame (opacity 0) on its own, but fourteen images fetched for a
 * frame nobody sees is waste, and the banner already says what happened.
 */
export default function ShuttleBurst({ origin, onDone }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const pieces = useMemo(() => (origin ? burstPieces() : []), [origin]);

  useEffect(() => {
    if (!origin) return;
    const t = window.setTimeout(onDone, burstDurationMs(pieces));
    return () => window.clearTimeout(t);
  }, [origin, pieces, onDone]);

  if (!origin || !mounted || prefersReducedMotion()) return null;

  return createPortal(
    <div className="shuttle-burst" aria-hidden="true" data-testid="shuttle-burst">
      {pieces.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${origin.key}-${p.id}`}
          src={`${BASE}/brand/baddicon-${p.icon}.svg`}
          alt=""
          className="shuttle-burst__piece"
          width={p.size}
          style={{
            left: origin.x,
            top: origin.y,
            width: p.size,
            height: Math.round((p.size * 22) / 24),
            '--burst-dx': `${p.dx}px`,
            '--burst-dy': `${p.dy}px`,
            '--burst-rot': `${p.rot}deg`,
            '--burst-dur': `${p.dur}ms`,
            '--burst-delay': `${p.delay}ms`,
          } as CSSProperties}
        />
      ))}
    </div>,
    document.body,
  );
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // jsdom and very old engines: no matchMedia means no stated preference.
    return false;
  }
}
