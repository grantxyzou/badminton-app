/**
 * The client-safe half of `lib/stringingPricing.ts`: limits, the row type and
 * the price formatter, in a module with NO imports.
 *
 * `StringingCard` (Home), `PricingCard` and `StringingIntake` are client
 * components. Importing `formatServicePrice` from `stringingPricing` reached
 * `groupScope` → `cosmos` → Node `crypto`, which bundled `crypto-browserify`
 * for every visitor. `stringingPricing` re-exports all of this, so server code
 * is unchanged. `__tests__/client-server-import-canary.test.ts` holds the line.
 */
export const MAX_SERVICES = 12;
export const MAX_LABEL_LEN = 60;
/** $1000. A rate card, not an invoice — anything above this is a typo. */
export const MAX_PRICE_CENTS = 100000;

export interface ServicePrice {
  label: string;
  /** Null means "ask" — a service that genuinely has no fixed price, such as
   *  a special request. Rendering that as $0.00 would be a lie. */
  priceCents: number | null;
}

/** "$30" whole, "$29.50" when it isn't. A rate card reads badly in cents. */
export function formatServicePrice(cents: number | null): string | null {
  if (cents === null) return null;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
