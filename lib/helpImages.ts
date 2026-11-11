/**
 * The guides' screenshots and their pixel sizes, per locale (written by
 * `node scripts/help-screenshots.mjs`, which takes them from the OFFLINE mock
 * store and crops each to the one card it explains — never production, so no
 * real name, address or amount is in any of them; Grant, 2026-11-09).
 *
 * The sizes are here so a guide page sets `width` / `height` on every image
 * and nothing below it jumps when it loads. `__tests__/legal-pages.test.ts`
 * fails on a guide naming an image that has no file in a locale.
 */
export const HELP_IMAGES: Record<string, Record<string, { w: number; h: number }>> = {
  "en": {
    "signup-card": {
      "w": 716,
      "h": 422
    },
    "balance-card": {
      "w": 716,
      "h": 924
    },
    "stringing-request": {
      "w": 716,
      "h": 344
    },
    "stats-tiles": {
      "w": 716,
      "h": 218
    },
    "profile-app": {
      "w": 716,
      "h": 294
    },
    "account-balance": {
      "w": 716,
      "h": 748
    },
    "admin-session": {
      "w": 716,
      "h": 856
    }
  },
  "zh-CN": {
    "signup-card": {
      "w": 716,
      "h": 422
    },
    "balance-card": {
      "w": 716,
      "h": 924
    },
    "stringing-request": {
      "w": 716,
      "h": 344
    },
    "stats-tiles": {
      "w": 716,
      "h": 186
    },
    "profile-app": {
      "w": 716,
      "h": 294
    },
    "account-balance": {
      "w": 716,
      "h": 748
    },
    "admin-session": {
      "w": 716,
      "h": 856
    }
  }
};
