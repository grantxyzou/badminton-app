/**
 * The app icon for the receipt image's top-right corner (design F4). Loaded
 * once per page and shared by every receipt drawn on it: the Payments sheet,
 * Past sessions and the set-up page's Share.
 *
 * Resolves `null` when the picture cannot load, so the image is drawn without
 * a logo rather than not at all. Same origin, so the canvas stays exportable.
 */
const LOGO_SRC = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/icons/icon-192.png`;

let loading: Promise<HTMLImageElement | null> | null = null;

export function loadReceiptLogo(): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  if (!loading) {
    loading = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { loading = null; resolve(null); };
      img.src = LOGO_SRC;
    });
  }
  return loading;
}
