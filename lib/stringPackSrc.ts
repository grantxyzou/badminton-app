/**
 * Which catalog strings have a packet picture, and where it is: the images
 * `scripts/render-string-images.mjs` writes from `lib/stringPacks.ts`. Kept
 * apart from that table so a screen can ask "is there a picture?" without
 * loading every packet's paint. `__tests__/string-pack.test.ts` holds the list
 * equal to the table's keys and to the files on disk.
 */

export const STRING_PACK_IDS: ReadonlyArray<string> = [
  'string-yx-bg65',
  'string-yx-bg65ti',
  'string-yx-bg66',
  'string-yx-bg66um',
  'string-yx-bg66f',
  'string-yx-bg66br',
  'string-yx-bg80',
  'string-yx-bg80p',
  'string-yx-bg85',
  'string-yx-nbg95',
  'string-yx-nbg98',
  'string-yx-nbg99',
  'string-yx-aero',
  'string-yx-abite',
  'string-yx-abiteb',
  'string-yx-ex63',
  'string-yx-ex65',
  'string-yx-ex68',
  'string-yx-sky',
  'string-vc-vbs58n',
  'string-vc-vbs61',
  'string-vc-vbs63',
  'string-vc-vbs66n',
  'string-vc-vbs68',
  'string-vc-vbs68p',
  'string-vc-vbs69n',
  'string-vc-vbs70',
  'string-vc-vbs70p',
  'string-vc-vs850',
  'string-ln-no1',
  'string-ln-no1b',
  'string-ln-no5',
  'string-ln-no7',
  'string-ln-no7b',
  'string-ln-n58',
  'string-ln-n61',
  'string-ln-n65',
  'string-ln-n68',
  'string-ln-n69',
  'string-ln-n70',
  'string-ln-ns30',
  'string-ln-ns50',
  'string-ln-ns70',
  'string-ln-ns95',
  'string-ln-ap70',
];

const HAS = new Set(STRING_PACK_IDS);
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The packet image for a catalog string, or null when it has none. */
export function stringPackSrc(catalogId: string | null | undefined): string | null {
  return catalogId && HAS.has(catalogId) ? `${BASE}/strings/${catalogId}.webp` : null;
}
