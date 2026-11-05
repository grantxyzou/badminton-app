'use client';

import { useEffect, useRef, useState } from 'react';
import { stringPackSrc } from '@/lib/stringPackSrc';

/**
 * A catalog string's packet picture (`docs/plans/string-packets.md`): the
 * pre-rendered `public/strings/<id>.webp`, or nothing when the string has none
 * (the caller keeps whatever it showed before). Decorative — the row or page
 * beside it names the string.
 *
 * `coil` repaints the string seen through the packet in THAT colour
 * (Grant, 2026-11-05: "make sure the colour matches too"): on the Equipment
 * card the packet sits beside the member's racket, and its string should be
 * the colour the racket is strung in, not the colour the maker photographed.
 * The packet is then drawn here from its spec, which loads the packet table —
 * a dynamic `import()`, so only a screen that asks for a colour pays for it.
 * The pre-rendered picture shows until the drawing is ready, at the same size.
 */
export default function StringPackImage({ catalogId, size, coil }: {
  catalogId: string | null | undefined;
  size: 'row' | 'hero' | 'line';
  coil?: string | null;
}) {
  const src = stringPackSrc(catalogId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);

  useEffect(() => {
    if (!src || !coil || !catalogId) return;
    let live = true;
    void Promise.all([import('@/lib/stringPacks'), import('@/lib/stringPack')]).then(([{ STRING_PACKS }, { drawStringPack }]) => {
      const pack = STRING_PACKS[catalogId];
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!live || !pack?.coil || !canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStringPack(ctx, { ...pack, coil: { ...pack.coil, colour: coil } }, canvas.width, canvas.height);
      setDrawn(`${catalogId}:${coil}`);
    }).catch(() => { /* the photographed packet stays */ });
    return () => { live = false; };
  }, [src, catalogId, coil]);

  if (!src) return null;
  const painted = !!coil && drawn === `${catalogId}:${coil}`;
  const cls = `string-pack-img string-pack-${size}`;
  return (
    <>
      {/* Twice the picture's size, so the drawing stays crisp on a phone. */}
      {coil && <canvas ref={canvasRef} width={480} height={672} aria-hidden="true" className={cls} hidden={!painted} />}
      {!painted && (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin pre-rendered WebP; next/image adds nothing here.
        <img src={src} alt="" width={240} height={336} loading="lazy" decoding="async" className={cls} />
      )}
    </>
  );
}
