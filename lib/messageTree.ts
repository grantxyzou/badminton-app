/**
 * The pure half of the message pipeline: overlay a locale on English, then
 * substitute the brand. No server imports, so the SAME code builds the tree
 * on the server (`i18n/request.ts`, for server components) and in the browser
 * (`components/intl/IntlProvider.tsx`, which carries the client's copy in a
 * cached script instead of in every page's HTML).
 */
import { applyBrand } from './brand';

export type MessageNode = string | MessageNode[] | MessageTree;
export type MessageTree = { [key: string]: MessageNode };

/**
 * Overlay a locale's messages on English so a missing key falls back to the
 * English string instead of throwing.
 *
 * ARRAYS REPLACE, THEY DO NOT MERGE. The legal pages keep their copy as
 * arrays (`legal.*.sections`, read with `t.raw`), and spreading an array into
 * `{ ...base }` turns it into an index-keyed OBJECT — `.map` then throws on
 * the Chinese page while the English one renders fine. A locale authors an
 * array whole; if it is absent the English one is used, and if it is present
 * it wins outright.
 */
export function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const k of Object.keys(override)) {
    const ov = override[k];
    const bv = out[k];
    if (
      ov !== null &&
      typeof ov === 'object' &&
      !Array.isArray(ov) &&
      bv !== null &&
      typeof bv === 'object' &&
      !Array.isArray(bv)
    ) {
      out[k] = deepMerge(bv as MessageTree, ov as MessageTree);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

/**
 * Substitute the brand sentinels through a whole message tree.
 *
 * Runs AFTER `deepMerge`, so a Chinese string and the English one it falls back
 * to are branded by the same pass and cannot disagree about the app's name.
 *
 * ARRAYS ARE WALKED, NOT SPREAD — the same trap `deepMerge` documents above.
 * The legal pages hold their copy as arrays read with `t.raw`, and the brand
 * appears inside those arrays, so an implementation that treated an array as a
 * plain object would turn it into an index-keyed map and `.map()` would throw
 * on the page rather than on any test.
 *
 * Only strings are rewritten, and only by `applyBrand`. Nothing here parses or
 * re-serialises JSON: `messages/*.json` contains DUPLICATE SIBLING KEYS, and a
 * round trip through `JSON.parse`/`stringify` silently drops one of each pair.
 * The tree arrives already parsed by the bundler's `import`, and this walks the
 * object it was handed.
 */
export function brandMessages(tree: MessageTree): MessageTree {
  const walk = (node: MessageNode): MessageNode => {
    if (typeof node === 'string') return applyBrand(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: MessageTree = {};
      for (const k of Object.keys(node)) out[k] = walk(node[k]);
      return out;
    }
    return node;
  };
  return walk(tree) as MessageTree;
}
