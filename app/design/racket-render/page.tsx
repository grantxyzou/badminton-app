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
 * '_default') and resolves a WebP data URL.
 */

const RENDER_W = 240;
const RENDER_H = 624;

declare global {
  interface Window {
    __renderRacket?: (id: string) => Promise<string>;
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
      stage.resize(RENDER_W, RENDER_H);
      cleanup = () => stage.dispose();
      window.__racketIds = Object.keys(RACKET_LOOKS);
      window.__renderRacket = async (id: string) => {
        const look = id === '_default' ? DEFAULT_LOOK : RACKET_LOOKS[id];
        if (!look) throw new Error(`no look for ${id}`);
        const racket = buildRacket(look, { shape: look.shape, pattern: look.pattern });
        // Nearly face-on with a slight turn, so the frame's depth and the
        // grommet channel read, and the whole racket fills a tall tile.
        stage.setObject(racket, { direction: [0.3, 0.06, 1], framing: 1.02 });
        stage.renderOnce();
        const url = canvas.toDataURL('image/webp', 0.86);
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
