'use client';

import { useEffect, useRef, useState } from 'react';
import { RACKET_LOOKS, DEFAULT_LOOK } from '@/lib/racketLook';

/**
 * Author-time only: the page `scripts/render-racket-images.mjs` drives to
 * pre-render one list image per catalog racket from the 3D model. It lives
 * under /design, which is 404 outside dev unless the design-preview flag is on,
 * and it writes nothing — the script reads each image back as a data URL.
 *
 * `window.__renderRacket(id)` renders that racket (or the default look for
 * '_default') and resolves a WebP data URL. `window.__renderRacketHead(id)`
 * renders the same pose larger and returns its HEAD only, on a transparent
 * ground: the Equipment card's close-up (`public/rackets/head/`), which a
 * list image scaled up would draw soft.
 */

const RENDER_W = 240;
const RENDER_H = 624;
/** Drawn at twice the size and scaled down, so the frame edge and the strings
 *  stay crisp at list size instead of stair-stepping. */
const SUPERSAMPLE = 2;
/** The close-up: the head drawn 540 px wide (twice the 270 px the card shows
 *  it at), cut from a render this many times the list size. */
const HEAD_SCALE = 4.5;
const HEAD_OUT_W = 540;
/** How far down the racket the head reaches in this pose (throat included). */
const HEAD_FRACTION = 0.46;

declare global {
  interface Window {
    __renderRacket?: (id: string) => Promise<string>;
    __renderRacketHead?: (id: string) => Promise<string>;
    __racketIds?: string[];
  }
}

export default function RacketRenderPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      const [{ buildRacket, disposeRacket }, { createRacketStage }] = await Promise.all([
        import('@/lib/racketModel'),
        import('@/lib/racketStage'),
      ]);
      const canvas = canvasRef.current;
      if (!canvas || disposed) return;
      const stage = createRacketStage(canvas, { ground: false });
      stage.resize(RENDER_W * SUPERSAMPLE, RENDER_H * SUPERSAMPLE);
      cleanup = () => stage.dispose();
      window.__racketIds = Object.keys(RACKET_LOOKS);
      const pose = (id: string) => {
        const look = id === '_default' ? DEFAULT_LOOK : RACKET_LOOKS[id];
        if (!look) throw new Error(`no look for ${id}`);
        const racket = buildRacket({ ...look, liveryId: id === '_default' ? null : id }, { shape: look.shape, pattern: look.pattern });
        // Nearly face-on with a slight turn, so the frame's depth and the
        // grommet channel read, and the whole racket fills a tall tile.
        stage.setObject(racket, { direction: [0.3, 0.06, 1], framing: 1.02 });
        return racket;
      };
      window.__renderRacketHead = async (id: string) => {
        const w = Math.round(RENDER_W * HEAD_SCALE);
        const h = Math.round(RENDER_H * HEAD_SCALE);
        stage.resize(w, h);
        try {
          const racket = pose(id);
          stage.renderOnce();
          const cropH = Math.round(h * HEAD_FRACTION);
          const out = document.createElement('canvas');
          out.width = HEAD_OUT_W;
          out.height = Math.round(HEAD_OUT_W * (cropH / w));
          const ctx = out.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(canvas, 0, 0, w, cropH, 0, 0, out.width, out.height);
          const url = out.toDataURL('image/webp', 0.86);
          disposeRacket(racket);
          return url;
        } finally {
          stage.resize(RENDER_W * SUPERSAMPLE, RENDER_H * SUPERSAMPLE);
        }
      };
      window.__renderRacket = async (id: string) => {
        const racket = pose(id);
        stage.renderOnce();
        const out = document.createElement('canvas');
        out.width = RENDER_W;
        out.height = RENDER_H;
        const ctx = out.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, RENDER_W, RENDER_H);
        const url = out.toDataURL('image/webp', 0.86);
        disposeRacket(racket);
        return url;
      };
      setStatus('ready');
    })().catch((e) => setStatus(`error: ${String(e)}`));
    return () => { disposed = true; cleanup?.(); };
  }, []);

  return (
    <div style={{ padding: 'var(--space-5)' }}>
      <p data-status={status}>{status}</p>
      <canvas ref={canvasRef} width={RENDER_W} height={RENDER_H} style={{ width: RENDER_W, height: RENDER_H, background: 'transparent' }} />
    </div>
  );
}
