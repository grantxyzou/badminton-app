/**
 * Browser-side Web Push helpers. Pure functions — no React, no side effects —
 * so they can be unit-tested without a DOM.
 */

/**
 * VAPID keys are transmitted as base64url but `pushManager.subscribe` wants raw
 * bytes. Standard conversion; the padding/URL-alphabet fixups are required.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Allocate the ArrayBuffer explicitly: a bare `new Uint8Array(n)` is typed
  // over ArrayBufferLike, which doesn't satisfy the BufferSource that
  // `pushManager.subscribe({ applicationServerKey })` expects.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Read as a LITERAL member expression — Next only inlines `process.env.NEXT_PUBLIC_*`
 * when accessed literally, so `process.env[name]` would be undefined in the
 * browser bundle.
 */
export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
}

export function hasVapidPublicKey(): boolean {
  return getVapidPublicKey().length > 0;
}
