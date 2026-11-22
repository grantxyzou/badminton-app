import { cameraUsable } from './nativeCamera';

/**
 * THE CAMERA, READING BARCODES (docs/plans/string-barcode-stocktake.md).
 *
 * `@zxing/browser` reads the live video in the page: EAN/UPC (a packet's and
 * a reel's retail code — Yonex's are EAN-13 on the colour sticker), ITF-14
 * (an outer box) and Code 128. Loaded only when scanning starts, so nobody
 * downloads it to open the app. The
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
 * The part of each frame that is read: the middle of the picture, a little
 * larger than the dashed box the sheet draws (`.stocktake-camera::after`), so
 * a barcode the person aims at is always inside it and the clutter around it
 * (a whole shelf, a hand) is not. Reading less is faster and misreads less.
 */
const READ_W = 0.84;
const READ_H = 0.6;

/**
 * What to read. `retail`: the stocktake's packet and reel codes. `qr`: a
 * club's QR poster (docs/plans/sign-in-redesign.md, "Join a club" scans first).
 * A QR code reads at any angle, so it is read upright only, from a square in
 * the middle of the picture.
 */
export type ScanKind = 'retail' | 'qr';

/** Read every this many ms: about seven reads a second, each upright or turned. */
const READ_EVERY_MS = 140;

/**
 * Start reading into `video`. `onCode` is called for EVERY read, many times a
 * second while a code is in view; the caller's gate decides what counts.
 * Rejects when the camera is refused or missing (`NotAllowedError`,
 * `NotFoundError`), so the sheet can say so and offer the hand count.
 *
 * Frames are read here rather than by the library's own loop for two reasons
 * found on real stock (Grant's photos, 2026-11-16): a 1D barcode reads only
 * when its bars cross the reading line, and a reel's sticker sits any way
 * round — so alternate frames are read upright and turned a quarter; and a
 * barcode read out of a whole cluttered frame did not read at all, where the
 * same sticker cropped to the box did.
 */
export async function startBarcodeScanner(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  kind: ScanKind = 'retail',
): Promise<ScannerControls> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(
    DecodeHintType.POSSIBLE_FORMATS,
    kind === 'qr'
      ? [BarcodeFormat.QR_CODE]
      : [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.ITF, BarcodeFormat.CODE_128,
        ],
  );
  const reader = new BrowserMultiFormatReader(hints);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // The back camera where there is one; a laptop's only camera otherwise.
    // A sharper picture than the default 640 wide: a sticker's bars are thin.
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    // Only if the picture is still this scan's: a second start on the same
    // video (React runs a mount effect twice in development) owns it now, and
    // clearing it interrupted that one's play().
    if (video.srcObject === stream) video.srcObject = null;
  };
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    stop();
    throw err;
  }

  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  let turned = false;
  const tick = () => {
    if (stopped) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (g && vw > 0 && vh > 0) {
      const side = Math.min(vw, vh) * 0.8;
      const sw = Math.round(kind === 'qr' ? side : vw * READ_W);
      const sh = Math.round(kind === 'qr' ? side : vh * READ_H);
      const sx = Math.round((vw - sw) / 2);
      const sy = Math.round((vh - sh) / 2);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (turned) {
        canvas.width = sh;
        canvas.height = sw;
        g.translate(sh, 0);
        g.rotate(Math.PI / 2);
      } else {
        canvas.width = sw;
        canvas.height = sh;
      }
      g.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
      try {
        onCode(reader.decodeFromCanvas(canvas).getText());
      } catch {
        /* nothing readable in this frame: the usual case */
      }
      turned = kind === 'qr' ? false : !turned;
    }
    timer = setTimeout(tick, READ_EVERY_MS);
  };
  tick();
  return { stop };
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
