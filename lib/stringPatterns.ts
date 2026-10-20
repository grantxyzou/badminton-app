import type { CatalogItem } from './types';

/**
 * Stringing patterns, and the grommet hole count each one implies
 * (`docs/plans/grommet-holes.md`, Phase 1).
 *
 * A racket row names its pattern (`attributes.stringPattern`); the hole count
 * lives HERE, on the pattern, never on the row. Yonex's own stringing sheet
 * says which models share a pattern, and the same instructions through the
 * same holes means the same holes — so one count serves every model the
 * maker lists, and two rows that share a pattern cannot disagree about it.
 *
 * That is not series-sibling inference. The Nanoflare 800 Pro, Tour and Game
 * share family 5 (78 holes); the 800 Play is in family 2 (76). A family is
 * whatever the maker's sheet says it is, model code by model code.
 *
 * Every count says how we know it:
 * - `maker`     — the maker's own product page states the number for that model
 *                 (Victor's "SEVEN SIX 76" grommet mark).
 * - `pattern`   — an earlier edition of the maker's instructions, with text
 *                 identical to this family's, labels the pattern with its count.
 * - `retailers` — two or more independent retailers agree.
 * - `counted`   — the club's stringer counted a frame of this pattern.
 * A single retailer's figure is not stored at all: in the 2026-10-20 sample
 * the one retailer covering most frames was wrong on 2 of 12.
 */

export type HolesSource = 'maker' | 'pattern' | 'retailers' | 'counted';

export interface StringPattern {
  brand: string;
  /** The maker's sheet that groups these models, when there is one. */
  sheetUrl?: string;
  /** The audit trail for a row's mapping: the model codes a sheet lists,
   *  verbatim, or for Victor the product-page slugs that were read. */
  codes: string[];
  /** Null when no source we trust states it. */
  holes: number | null;
  holesSource?: HolesSource;
  holesUrls?: string[];
}

const YONEX_SHEET = 'https://us.yonex.com/pages/stringing-instructions';
// An earlier edition of the same instructions, reproduced by a retailer, which
// labels each pattern with its hole count. Families 1, 2 and 6 match its
// Types 1, 2 and 3 word for word (main start, skips, tie-offs, cross start).
const YONEX_EARLIER_EDITION = 'https://www.badmintonbay.com/yonex-stringing-method.html';

export const STRING_PATTERNS: Record<string, StringPattern> = {
  // Mains skip A7, A9 & A11; crosses skip A12 & A10.
  'yonex-1': {
    brand: 'Yonex', sheetUrl: YONEX_SHEET,
    codes: ['ARC11-P', 'ARC11-T', 'ARC11-PL', 'ARC7-P', 'ARC7-T', 'AX100ZZ', 'AX100T', '3AX88S-P', '3AX88S-T', '3AX88S-G', '3AX88D-P', '3AX88D-T', '3AX88D-G', '3AX88-PL', 'AX77-P', 'AX70', 'NF-70', 'NF-555', 'DUO-ZS'],
    holes: 76, holesSource: 'pattern', holesUrls: [YONEX_EARLIER_EDITION],
  },
  // Mains skip A8 & A10; crosses skip A11 & A9.
  'yonex-2': {
    brand: 'Yonex', sheetUrl: YONEX_SHEET,
    codes: ['ARC7-PL', 'ARC2A', 'ARC2C', 'ARC2F', 'AX100G', 'AX77-T', 'AX77-PL', 'AX22RX', 'AX22F', 'AX22LT', 'AX7DG', 'AX3DGHF', 'AX3DGST', 'AX1DG', 'AX01A', 'AX01C', 'AX01F', 'NF-1000Z', 'NF-1000T', 'NF-1000G', 'NF-1000P', 'NF-800PL', '2NF-700P', '2NF-700T', '2NF-700G', '2NF700PL', 'NF-NT', 'NF-JR'],
    holes: 76, holesSource: 'pattern', holesUrls: [YONEX_EARLIER_EDITION],
  },
  // The 2021 Astrox 99 line (AX99-*): its own pattern, count unconfirmed.
  // The 2025 line is 3AX99-* and is not on the May 2025 sheet.
  'yonex-3': {
    brand: 'Yonex', sheetUrl: YONEX_SHEET,
    codes: ['AX99-P', 'AX99-T', 'AX99-G', 'AX99-PL'],
    holes: null,
  },
  // Astrox Nextage alone; count unconfirmed.
  'yonex-4': {
    brand: 'Yonex', sheetUrl: YONEX_SHEET,
    codes: ['AXNT'],
    holes: null,
  },
  // The "78 Grommets System": one extra cross, 22 × 22.
  'yonex-5': {
    brand: 'Yonex', sheetUrl: YONEX_SHEET,
    codes: ['NF-800P', 'NF-800T', 'NF-800G'],
    holes: 78, holesSource: 'retailers',
    holesUrls: [
      'https://badmintonbay.com/Yonex-nanoflare-800-pro-deep-green-4ug5.html',
      'https://www.badmintonbay.com/Yonex-nanoflare-800-game-deep-green-4ug5.html',
      'https://www.decathlon.ie/p/355466-269512-badminton-racket-nanoflare-800-tour-unstrung.html',
    ],
  },
  // Trainers and entry frames: no skipped holes.
  'yonex-6': {
    brand: 'Yonex', sheetUrl: YONEX_SHEET,
    codes: ['AX02A', 'AX02C', 'AX02F', 'AXE13', 'NF-002A', 'NF002C', 'NF002F', 'NF-001A', 'NF-001C', 'NF-001F', 'NF-E13', 'ISO-TR1', 'ISO-TR0', 'ISOL3', 'MP8LT', 'MP5LT', 'MP2', 'MP1', 'MP2JR', 'B7000MDM', 'B4000'],
    holes: 72, holesSource: 'pattern', holesUrls: [YONEX_EARLIER_EDITION],
  },
  // Victor publishes no pattern sheet. Each of these frames' own page on
  // ca.victorsport.com (https://ca.victorsport.com/product/<code>) carries
  // Victor's "SEVEN SIX 76" grommet mark, read 2026-10-20. A page WITHOUT the
  // mark proves nothing — colourway pages of one frame disagree on showing it —
  // so a frame with no marked page of its own is left blank, never inferred.
  'victor-seven-six-76': {
    brand: 'Victor',
    codes: ['thruster-ryuga-ii-j', 'thruster-f-c', 'auraspeed-90k-h', 'js-12ii-r', 'drivex-9x-b', 'thruster-f', 'ars-80x-c', 'hypernano-x-900x', 'jetspeed-s-12-m', 'thruster-ryuga-d', 'auraspeed-hypersonic-b', 'auraspeed-100x-ultra-c', 'auraspeed-90f-m', 'auraspeed-90k-metallic-r', 'auraspeed-hs-plus-c', 'auraspeed-90s-j', 'auraspeed-fantme-f-ac', 'drivex-3h-r', 'thruster-f--ultra-c', 'legend', 'thruster-raptor-c', 'thruster-ryuga-muse-f', 'thruster-k-280-ex'],
    holes: 76, holesSource: 'maker',
    holesUrls: ['https://dkjulgymkya8y.cloudfront.net/victor/ca/tech-tech_mark_81.webp'],
  },
  // Victor's own page for the base Ryuga II Pro does not show the mark.
  'victor-76-retailers': {
    brand: 'Victor',
    codes: ['TK-RYUGA II PRO'],
    holes: 76, holesSource: 'retailers',
    holesUrls: [
      'https://badminton-shop.com/product/victor-thruster-ryuga-ii-pro',
      'https://www.badmintonalley.com/Victor_Thruster_Ryuga_2_Pro_Badminton_Racket_p/racket-victor-tk-ryuga2pro-b.htm',
    ],
  },
};

/** A racket's grommet hole count, or null when its pattern is unknown or uncounted. */
export function grommetHoles(item: CatalogItem): number | null {
  const id = item.attributes?.stringPattern;
  if (typeof id !== 'string') return null;
  return STRING_PATTERNS[id]?.holes ?? null;
}
