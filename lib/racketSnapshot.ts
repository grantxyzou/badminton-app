'use client';

import type { ModelLook, ModelTweaks } from './racketModel';

/**
 * One still of the 3D racket in the member's own colours — for the share card,
 * which leaves the app as an image and so cannot carry a live model. The same
 * model, studio and framing as the pre-rendered list images, rendered on demand
 * because a member's string and wrap are not in any pre-render.
 *
 * Resolves null when WebGL or three.js is unavailable; the caller then uses the
 * pre-rendered catalog image.
 */
export async function racketSnapshot(look: ModelLook, tweaks: ModelTweaks, width = 240, height = 624): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) return null;
    const fresh = document.createElement('canvas');
    const [{ buildRacket, disposeRacket }, { createRacketStage }] = await Promise.all([import('./racketModel'), import('./racketStage')]);
    const stage = createRacketStage(fresh, { ground: false });
    try {
      stage.resize(width, height);
      const racket = buildRacket(look, tweaks);
      stage.setObject(racket, { direction: [0.3, 0.06, 1], framing: 1.02 });
      stage.renderOnce();
      const url = fresh.toDataURL('image/png');
      disposeRacket(racket);
      return url;
    } finally {
      stage.dispose();
    }
  } catch {
    return null;
  }
}
