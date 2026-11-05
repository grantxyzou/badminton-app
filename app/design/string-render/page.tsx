'use client';

import { useEffect, useState } from 'react';
import { STRING_PACKS } from '@/lib/stringPacks';
import { drawStringPack } from '@/lib/stringPack';

/**
 * Author-time only: the page `scripts/render-string-images.mjs` drives to
 * pre-render one packet image per catalog string (`docs/plans/string-packets.md`).
 * It lives under /design, which is 404 outside dev unless the design-preview
 * flag is on, and writes nothing — the script reads each image back.
 *
 * `window.__renderString(id)` draws that packet at twice the size, scales it
 * down so its edges stay crisp, and resolves a WebP data URL.
 */

const RENDER_W = 240;
const RENDER_H = 336;
const SUPERSAMPLE = 2;

declare global {
  interface Window {
    __renderString?: (id: string) => Promise<string>;
    __stringIds?: string[];
  }
}

export default function StringRenderPage() {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    window.__stringIds = Object.keys(STRING_PACKS);
    window.__renderString = async (id: string) => {
      const pack = STRING_PACKS[id];
      if (!pack) throw new Error(`no packet for ${id}`);
      const big = document.createElement('canvas');
      big.width = RENDER_W * SUPERSAMPLE;
      big.height = RENDER_H * SUPERSAMPLE;
      const bctx = big.getContext('2d');
      if (!bctx) throw new Error('no 2d context');
      drawStringPack(bctx, pack, big.width, big.height);
      const out = document.createElement('canvas');
      out.width = RENDER_W;
      out.height = RENDER_H;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(big, 0, 0, RENDER_W, RENDER_H);
      return out.toDataURL('image/webp', 0.86);
    };
    setStatus('ready');
  }, []);
  return <p data-status={status} style={{ padding: 'var(--space-5)' }}>{status}</p>;
}
