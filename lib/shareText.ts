import { markExternalExcursion } from './excursion';
import { isNative } from './native';

/**
 * Share a line of text with a link, or copy it — the sibling of
 * `shareImage.ts` for text. One path for the sign-up link so the PWA, the
 * browser and the native shell cannot drift.
 *
 * Returns an outcome rather than throwing, so the caller can obey the
 * legible-fail rule: `copied` wants a "Copied" flash, `error` wants a message,
 * `dismissed` wants silence.
 */
export type ShareTextOutcome = 'shared' | 'copied' | 'dismissed' | 'error';

export interface ShareTextInput {
  title: string;
  text: string;
  url: string;
}

/** Capacitor reports a dismissed sheet as an error whose message says so. */
function isCancel(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /cancel/i.test(err.message));
}

export async function shareTextOrCopy(input: ShareTextInput): Promise<ShareTextOutcome> {
  // The Capacitor WebView has no `navigator.share` on Android and an
  // unreliable one on iOS; the plugin is the real share sheet on both.
  if (isNative()) {
    markExternalExcursion();
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: input.title, text: input.text, url: input.url, dialogTitle: input.title });
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'dismissed';
      // Fall through to the clipboard: a failed native sheet should still
      // leave the person holding the link.
    }
  } else {
    const nav = navigator as Navigator & {
      share?: (d: { title?: string; text: string; url: string }) => Promise<void>;
    };
    if (nav.share) {
      // Mark BEFORE the hand-off: iOS can evict the PWA while the sheet is open.
      markExternalExcursion();
      try {
        await nav.share({ title: input.title, text: input.text, url: input.url });
        return 'shared';
      } catch (err) {
        if (isCancel(err)) return 'dismissed';
      }
    }
  }

  try {
    await navigator.clipboard.writeText(input.text);
    return 'copied';
  } catch {
    return 'error';
  }
}
