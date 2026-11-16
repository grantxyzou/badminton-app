/**
 * A phone photo, made small enough to send (docs/plans/string-photo-stocktake.md).
 *
 * Every API body is held to 256 KB at the proxy (`proxy.ts`), and a phone
 * photo is several megabytes. This draws it onto a canvas no wider than
 * `maxEdge` and saves it as JPEG, stepping the quality — then the size — down
 * until the base64 fits `maxChars`. Packet labels stay legible at ~1600 px.
 * Browser-only; nothing is uploaded or kept anywhere but the request.
 */
export async function photoToJpegBase64(file: Blob, maxChars: number, maxEdge = 1600): Promise<string> {
  const bitmap = await loadBitmap(file);
  try {
    let edge = maxEdge;
    for (let round = 0; round < 6; round++) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const quality of [0.8, 0.7, 0.6, 0.5]) {
        const b64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
        if (b64 && b64.length <= maxChars) return b64;
      }
      edge = Math.round(edge * 0.75);
    }
    throw new Error('photo too large');
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/** The photo the right way up: `createImageBitmap` honours the camera's rotation where it can. */
async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older Safari: fall through to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
