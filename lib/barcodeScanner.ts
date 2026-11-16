import { cameraUsable } from './nativeCamera';

/**
 * THE CAMERA, READING BARCODES (docs/plans/string-barcode-stocktake.md).
 *
 * `@zxing/browser` reads the live video in the page: EAN/UPC (a packet's
 * retail code), ITF-14 (an outer box) and Code 128 (a reel's label). Loaded
 * only when scanning starts, so nobody downloads it to open the app. The
 * browser's own `BarcodeDetector` exists in Chrome on Android and not in
 * Safari, so the library is the one path for every phone.
 *
 * The page may use the camera because `Permissions-Policy` says
 * `camera=(self)` (next.config.js); the browser still asks the person.
 */

export interface ScannerControls { stop: () => void }

/**
 * Can this phone scan? A camera API, and — in the store iPhone app — a build
 * that declares the camera, or iOS ends the app (`lib/nativeCamera.ts`).
 */
export async function canScan(): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') return false;
  return cameraUsable();
}

/**
 * Start reading into `video`. `onCode` is called for EVERY read, many times a
 * second while a code is in view; the caller's gate decides what counts.
 * Rejects when the camera is refused or missing (`NotAllowedError`,
 * `NotFoundError`), so the sheet can say so and offer the hand count.
 */
export async function startBarcodeScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<ScannerControls> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.ITF, BarcodeFormat.CODE_128,
  ]);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
  const controls = await reader.decodeFromConstraints(
    // The back camera where there is one; a laptop's only camera otherwise.
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    video,
    (result) => {
      if (result) onCode(result.getText());
    },
  );
  return { stop: () => controls.stop() };
}

/** Why the camera did not start, in the sheet's terms. */
export function cameraFailure(err: unknown): 'denied' | 'missing' | 'failed' {
  const name = (err as { name?: unknown })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'failed';
}

let audio: AudioContext | null = null;

/** Make the beep ready; call from the tap that starts scanning (iOS only plays sound after one). */
export function primeBeep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audio && Ctx) audio = new Ctx();
    void audio?.resume();
  } catch {
    audio = null;
  }
}

/** A short beep and a buzz where the phone has one: the till's "got it". Never throws. */
export function scanFeedback(): void {
  try {
    if (audio) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 1760;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.07);
    }
    navigator.vibrate?.(30);
  } catch {
    /* no beep; the row still changes on screen */
  }
}

export function stopBeep(): void {
  try {
    void audio?.close();
  } catch {
    /* already closed */
  }
  audio = null;
}
