'use client';

import { useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import type { ModelLook, ModelTweaks } from '@/lib/racketModel';

export interface Racket3DProps {
  look: ModelLook;
  tweaks: ModelTweaks;
  /** Shown while three.js loads, and instead of it when WebGL is unavailable. */
  fallbackSrc: string;
  /** Accessible description of what the model shows. */
  label: string;
}

type Stage = import('@/lib/racketStage').RacketStage;

/**
 * The live, rotatable 3D racket (Grant's model, `lib/racketModel.ts`), for the
 * big views only — lists use images pre-rendered from the same model.
 *
 * three.js arrives through a dynamic `import()`, so nothing here reaches the
 * main bundle. No WebGL, or a failed load, leaves the pre-rendered image in
 * place: the racket is still shown, just not turnable.
 *
 * Colour changes repaint the built model in place (`applyLook`), so the
 * viewer's orbit survives a swatch tap; a head-shape or paint-pattern change is
 * new geometry and rebuilds with the camera kept.
 */
export default function Racket3D({ look, tweaks, fallbackSrc, label }: Racket3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const racketRef = useRef<Group | null>(null);
  const modelRef = useRef<typeof import('@/lib/racketModel') | null>(null);
  const builtKeyRef = useRef('');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const geometryKey = `${tweaks.shape ?? 'isometric'}|${tweaks.pattern ?? 'shoulder'}`;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('no webgl');
      const [model, { createRacketStage }] = await Promise.all([import('@/lib/racketModel'), import('@/lib/racketStage')]);
      const canvas = canvasRef.current;
      const host = hostRef.current;
      if (disposed || !canvas || !host) return;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const stage = createRacketStage(canvas, { interactive: true, autorotate: !reduceMotion, ground: true });
      stageRef.current = stage;
      modelRef.current = model;
      const fit = () => stage.resize(host.clientWidth || 1, host.clientHeight || 1);
      fit();
      observer = new ResizeObserver(fit);
      observer.observe(host);
      stage.start();
      setReady(true);
    })().catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true;
      observer?.disconnect();
      if (racketRef.current && modelRef.current) modelRef.current.disposeRacket(racketRef.current);
      stageRef.current?.dispose();
      stageRef.current = null;
      racketRef.current = null;
      builtKeyRef.current = '';
    };
  }, []);

  // Build once the stage is up, rebuild on new geometry, repaint otherwise.
  useEffect(() => {
    const stage = stageRef.current;
    const model = modelRef.current;
    if (!ready || !stage || !model) return;
    if (racketRef.current && builtKeyRef.current === geometryKey) {
      model.applyLook(racketRef.current, look, tweaks);
      return;
    }
    const keepCamera = !!racketRef.current;
    if (racketRef.current) model.disposeRacket(racketRef.current);
    const racket = model.buildRacket(look, tweaks);
    racketRef.current = racket;
    builtKeyRef.current = geometryKey;
    // Closer than the design viewer's 1.35: in a phone-width stage the racket
    // is the whole point, not a thing in a room.
    stage.setObject(racket, { keepCamera, framing: 0.92 });
  }, [ready, geometryKey, look, tweaks]);

  return (
    <div ref={hostRef} className="racket-3d" role="img" aria-label={label}>
      {!failed && <canvas ref={canvasRef} className="racket-3d-canvas" data-ready={ready || undefined} />}
      {(!ready || failed) && (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin pre-render standing in for the model; next/image adds nothing here.
        <img src={fallbackSrc} alt="" className="racket-3d-fallback" />
      )}
    </div>
  );
}
