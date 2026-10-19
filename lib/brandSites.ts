/**
 * The maker's own site for a catalog brand, for the "Racket to try next"
 * price row (Grant, 2026-10-19: "Can we link it to the official site?").
 *
 * The catalog carries no per-model web address, so this is the brand's home
 * page, not the racket's. Only addresses checked against the maker are listed:
 * Victor's Canadian site matches the CAD price beside it. A brand missing here
 * shows its price with no link — a guessed address could land a member on a
 * reseller or a dead page, which is worse than no link.
 */
const BRAND_SITES: Record<string, string> = {
  victor: 'https://ca.victorsport.com/',
  yonex: 'https://www.yonex.com/',
};

export function brandSite(brand: string | null | undefined): string | null {
  if (!brand) return null;
  return BRAND_SITES[brand.trim().toLowerCase()] ?? null;
}
