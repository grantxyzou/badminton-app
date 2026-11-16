import { z } from 'zod';
import { labelKey } from './stringStockMath';
import { FULLNESS_ORDER, type Fullness } from './stringStocktakeMath';

/**
 * Reading a shelf photo (docs/plans/string-photo-stocktake.md): the prompt, the
 * reply's shape, and the check every reply goes through. No SDK here — the
 * route makes the one call (`__tests__/anthropic-callers-canary.test.ts`).
 *
 * The photo PROPOSES. Every item comes back to the counter, who confirms or
 * corrects each line before anything is saved; a string the model names that
 * is not on this club's shelf is returned as "not sure", never guessed onto
 * one that is. The photo is never stored.
 */

export const MAX_PHOTO_BASE64 = 240_000;
export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/webp', 'image/png'] as const;
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];

/** What the model must answer: a list of what it can see, nothing else. */
export const ScanReplySchema = z.object({
  items: z.array(
    z.object({
      /** Exactly one of the shelf labels it was given, or null when it cannot tell. */
      label: z.string().nullable(),
      kind: z.enum(['reel', 'packet']),
      /** How many of this exact string, kind and colour. */
      count: z.number().int(),
      /** A reel's fullness; null for a packet. */
      fullness: z.enum(['full', 'three_quarters', 'half', 'quarter']).nullable(),
      /** The colour as printed or seen, in English, or null. */
      colour: z.string().nullable(),
    }),
  ),
});
export type ScanReply = z.infer<typeof ScanReplySchema>;

export interface ShelfStringForScan {
  label: string;
  /** "Yonex BG80", when the shelf string is linked to the catalog. */
  catalogName?: string;
  /** Colours this club stocks it in, in English. */
  colours: string[];
}

export function buildScanPrompt(shelf: readonly ShelfStringForScan[]): string {
  const list = shelf
    .map((s) => `- "${s.label}"${s.catalogName ? ` (${s.catalogName})` : ''}${s.colours.length ? ` — colours: ${s.colours.join(', ')}` : ''}`)
    .join('\n');
  return [
    'This photo shows badminton string stock laid out to be counted for a club\'s stocktake.',
    'Two kinds of item: a REEL (a spool of string, usually 200 m) and a PACKET (one set of string in its own packaging).',
    '',
    'The strings this club stocks, by the label it uses:',
    list,
    '',
    'For every item you can actually see, report one entry per distinct (string, kind, colour):',
    '- label: copy one label from the list above exactly, matched by the brand and model printed on the item. If you cannot read it or it is not on the list, use null. Never guess.',
    '- kind: "reel" or "packet".',
    '- count: how many of that exact string, kind and colour are visible.',
    '- fullness: for a reel, how full the spool looks compared with a new one: "full", "three_quarters", "half" or "quarter". For a packet, null.',
    '- colour: the string\'s colour in English as seen or printed (e.g. "White", "Yellow", "Red / White"), or null.',
    '',
    'Count only what is in the photo. Do not include anything you cannot see. An item partly hidden counts if you can tell what it is.',
  ].join('\n');
}

export interface ScanItem {
  /** A shelf label exactly as offered, or null ("not sure"). */
  label: string | null;
  kind: 'reel' | 'packet';
  count: number;
  fullness: Fullness | null;
  colour: string | null;
}

/**
 * The reply, checked: a label not on THIS shelf becomes null (the counter
 * picks), a count is held to 1–50, a reel with no fullness reads "full" (the
 * counter sees it and can change it), a packet carries none.
 */
export function checkScanReply(reply: ScanReply, offered: readonly string[]): ScanItem[] {
  const byKey = new Map(offered.map((l) => [labelKey(l), l]));
  return reply.items.slice(0, 60).map((i) => {
    const count = Math.min(50, Math.max(1, Math.round(Number.isFinite(i.count) ? i.count : 1)));
    const label = i.label ? byKey.get(labelKey(i.label)) ?? null : null;
    const fullness = i.kind === 'reel' ? (i.fullness && FULLNESS_ORDER.includes(i.fullness) ? i.fullness : 'full') : null;
    const colour = typeof i.colour === 'string' && i.colour.trim() ? i.colour.trim().slice(0, 40) : null;
    return { label, kind: i.kind, count, fullness, colour };
  });
}
