import { markExternalExcursion } from './excursion';
import { isIOS } from './standalone';

/**
 * The one share-or-save path for a rendered canvas image (receipts today).
 *
 * Both `ReceiptSheet` and `SetupPage` grew their own copy of this and drifted:
 * `SetupPage`'s never got the `data:`→Blob fix, never marked the excursion, and
 * swallowed every failure. Worse, both ended in a fire-and-forget
 * `a.click()` that CANNOT report failure — see below — so the iOS "nothing
 * happens" report (#238) had no way to surface.
 *
 * Returns an outcome instead of silently doing nothing, so the caller can obey
 * the legible-fail rule.
 *
 * ## Why this isn't just "click a download link"
 *
 * 1. **`a.click()` on a suppressed download returns normally.** It throws
 *    nothing and reports nothing, so wrapping it in try/catch is theatre — the
 *    catch can never fire for the failure that actually happens. Any code that
 *    treats "click didn't throw" as "file saved" is lying to the user.
 *
 * 2. **User activation expires across an `await`.** `navigator.share()` on iOS
 *    settles only once the user dismisses the system sheet — seconds later. By
 *    then the transient activation that authorises a programmatic download is
 *    gone, so falling through from a rejected share to `a.click()` is a
 *    guaranteed silent no-op. We therefore never chain those two.
 *
 * 3. **iOS ignores the `download` attribute.** It is advisory on WebKit, and in
 *    a home-screen PWA there is no download chrome at all. The honest move is
 *    to tell the user to long-press the preview image (which iOS *does* offer
 *    "Save to Photos" on) rather than fake a save button that does nothing.
 */
export type ShareImageOutcome =
  /** Handed off to the OS share sheet. */
  | { kind: 'shared' }
  /** A real file download was triggered (desktop / Android). */
  | { kind: 'downloaded' }
  /** User opened the share sheet and dismissed it. Not an error — say nothing. */
  | { kind: 'dismissed' }
  /** No reliable programmatic save here; the caller must point at the preview. */
  | { kind: 'manual-save' }
  /** Genuine failure worth surfacing verbatim. */
  | { kind: 'error'; message: string };

/**
 * Encode the canvas and either share it or save it, whichever the platform can
 * actually do. `canvas` must already be drawn.
 */
export async function shareOrSaveImage(
  canvas: HTMLCanvasElement | null,
  filename = 'bpm-receipt.png',
): Promise<ShareImageOutcome> {
  if (!canvas) return { kind: 'error', message: 'Couldn’t generate the image — try again.' };

  // Straight from the bitmap. Round-tripping through `fetch(dataUrl)` to
  // rebuild a Blob is the pattern that produced truncated PNGs in the iOS
  // standalone context (the "can't be displayed" bug, a831157).
  let blob: Blob | null;
  try {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    blob = null;
  }
  if (!blob) return { kind: 'error', message: 'Couldn’t generate the image — try again.' };

  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[] }) => Promise<void>;
  };

  if (nav.canShare?.({ files: [file] }) && nav.share) {
    // Mark BEFORE the hand-off: iOS can evict the PWA while the sheet is open,
    // and the marker has to already be in localStorage if it's to survive that.
    markExternalExcursion();
    try {
      await nav.share({ files: [file] });
      return { kind: 'shared' };
    } catch (err) {
      // AbortError is the user tapping Cancel — a completed interaction, not a
      // failure. Anything else (NotAllowedError, NotSupportedError, a platform
      // fault) is real, and we must NOT fall through to a download: the await
      // above has already consumed the activation, so the click would no-op
      // silently and we'd be right back at "nothing happens".
      if (err instanceof Error && err.name === 'AbortError') return { kind: 'dismissed' };
      console.warn('shareOrSaveImage: native share failed', err);
      return isIOS()
        ? { kind: 'manual-save' }
        : downloadBlob(blob, filename);
    }
  }

  // No native file share. On iOS that leaves no reliable programmatic save, so
  // be honest rather than firing a click that WebKit will drop on the floor.
  if (isIOS()) return { kind: 'manual-save' };

  return downloadBlob(blob, filename);
}

/**
 * Anchor download for platforms where it genuinely works. The anchor is
 * attached to the document before clicking — some WebKit builds ignore a click
 * on a detached anchor — and removed immediately after.
 *
 * Still cannot detect suppression (see the note above), so this is only called
 * on platforms where the download is reliable; iOS never reaches it.
 */
function downloadBlob(blob: Blob, filename: string): ShareImageOutcome {
  let url = '';
  try {
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    markExternalExcursion();
    a.click();
    a.remove();
    // Long enough for the browser to take ownership of the blob before the URL
    // is revoked; a shorter window can race a deferred download hand-off.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { kind: 'downloaded' };
  } catch {
    if (url) URL.revokeObjectURL(url);
    return { kind: 'error', message: 'Couldn’t download — try Copy text instead.' };
  }
}
