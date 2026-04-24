/**
 * Splits a combined brand+model string (e.g. "Victor Master No.3") into
 * `{ brand, model }` for display grouping. Heuristic: first whitespace-
 * delimited token is the brand; the rest is the model. Single-word inputs
 * become their own brand with an empty model. Empty input returns empty
 * strings.
 *
 * This is display-only — `BirdPurchase.name` stays as a single string on
 * the Cosmos side, so no migration is needed.
 */
export function parseBirdName(name: string): { brand: string; model: string } {
  if (!name || typeof name !== 'string') return { brand: '', model: '' };
  const trimmed = name.trim();
  if (!trimmed) return { brand: '', model: '' };
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return { brand: trimmed, model: '' };
  return {
    brand: trimmed.slice(0, firstSpace),
    model: trimmed.slice(firstSpace + 1).trim(),
  };
}
