/**
 * The app's one size factor (docs/plans/ui-scale.md; Grant, 2026-11-12: "no
 * zoom, card should scale" — by the phone's text size AND the screen, "Both").
 *
 * `--ui-scale` on <html> multiplies the root font size (app/globals.css), and
 * every design token is rem, so a card grows whole. It is written BEFORE first
 * paint by the inline script in app/layout.tsx (the string below), and again on
 * resize and on coming back to the app, because a text-size change in Settings
 * happens while the app is in the background.
 *
 * Exactly 1 on a phone at the default text size: phones look as they did.
 */

/** iOS's Dynamic Type body size at the default setting ("Large"). */
export const APPLE_BODY_DEFAULT_PX = 17;
/** Larger Text's xxxL is 23/17 ≈ 1.35; the accessibility sizes past it stop
 *  here so a card still fits a phone. Below the default the app stays at its
 *  designed size: its smallest text is already 10px. */
export const TEXT_SCALE_MIN = 1;
export const TEXT_SCALE_MAX = 1.5;
/** A page (one half of an open foldable, else the screen) up to 480px — every
 *  phone, and a page of an open Z Fold (442) or Duo (475) — stays 1; it rises
 *  to SCREEN_SCALE_MAX at a tablet's width. */
export const SCREEN_FROM_PX = 480;
export const SCREEN_TO_PX = 768;
export const SCREEN_SCALE_MAX = 1.12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The phone's text size as a factor, from the measured `-apple-system-body`
 *  size; `null` (not an Apple device) is 1 — an Android browser or WebView
 *  already applies the system font size to every font size, the root's too. */
export function textScaleOf(appleBodyPx: number | null): number {
  if (appleBodyPx === null || !(appleBodyPx > 0)) return 1;
  return clamp(appleBodyPx / APPLE_BODY_DEFAULT_PX, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
}

/** The screen's part, from the width of ONE page. */
export function screenScaleOf(pageWidthPx: number): number {
  const t = clamp((pageWidthPx - SCREEN_FROM_PX) / (SCREEN_TO_PX - SCREEN_FROM_PX), 0, 1);
  return 1 + (SCREEN_SCALE_MAX - 1) * t;
}

/** The factor itself, rounded so a tiny resize does not restyle the page. */
export function uiScaleOf(appleBodyPx: number | null, pageWidthPx: number): number {
  return Math.round(textScaleOf(appleBodyPx) * screenScaleOf(pageWidthPx) * 1000) / 1000;
}

/**
 * The same rule as plain ES5 for the pre-paint script (no imports there). The
 * page is HALF the screen while the two-page query matches (lib/paneMode.ts's
 * PANE_QUERY, passed in), so a foldable's pages scale like a phone. The Apple
 * body size is measured off a probe span; a browser that does not know the
 * `-apple-system-body` keyword leaves the style empty and reads as not Apple.
 * `__tests__/ui-scale.test.ts` runs this string against `uiScaleOf`.
 */
export function uiScalePrepaint(paneQuery: string): string {
  return `var us;function uiS(){var b=null;try{var p=document.createElement('span');p.style.font='-apple-system-body';if(p.style.font){p.style.position='absolute';p.style.visibility='hidden';d.appendChild(p);b=parseFloat(getComputedStyle(p).fontSize)||null;d.removeChild(p)}}catch(e){}var w=innerWidth;try{if(matchMedia(${JSON.stringify(paneQuery)}).matches)w=w/2}catch(e){}var t=b&&b>0?Math.min(${TEXT_SCALE_MAX},Math.max(${TEXT_SCALE_MIN},b/${APPLE_BODY_DEFAULT_PX})):1;var r=Math.min(1,Math.max(0,(w-${SCREEN_FROM_PX})/(${SCREEN_TO_PX - SCREEN_FROM_PX})));var s=Math.round(t*(1+${(SCREEN_SCALE_MAX - 1).toFixed(2)}*r)*1000)/1000;if(s>0&&s!==us){us=s;d.style.setProperty('--ui-scale',String(s))}}uiS();addEventListener('resize',uiS);document.addEventListener('visibilitychange',function(){if(!document.hidden)uiS()});`;
}
