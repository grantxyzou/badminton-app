/**
 * The posted rate card — "View pricing" on the Home card.
 *
 * A PUBLISHED PRICE LIST IS NOT A QUOTE, and the difference matters here
 * because this feature goes to some length to keep a stringer's exact figure
 * off the player's screen (`toPlayerJob` bands it). That rule is about what
 * YOUR racket costs, which depends on the string, the request and what the
 * stringer decides. This is what the shop charges in general, which any shop
 * puts in the window.
 *
 * Worth stating plainly rather than discovering later: once a rate card is
 * posted, a player can usually infer their own price from it, so the band
 * protects less than it did. That is an acceptable trade for being upfront
 * about cost — but it is a trade, not a free addition.
 *
 * Stored in `clubSettings` beside the shop sign and the string list, for the
 * same reason: club-wide rather than per-admin, and readable by a player.
 */
import { groupDocId, groupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';

export const PRICING_DOC_ID = 'stringing-pricing';
/** One rate card per club: bare for BPM, `'<groupId>:stringing-pricing'` otherwise. */
export function pricingDocId(groupId: string): string {
  return groupDocId(groupId, PRICING_DOC_ID);
}
export {
  MAX_SERVICES,
  MAX_LABEL_LEN,
  MAX_PRICE_CENTS,
  formatServicePrice,
  type ServicePrice,
} from './stringingRateCard';
import { MAX_SERVICES, MAX_LABEL_LEN, MAX_PRICE_CENTS, type ServicePrice } from './stringingRateCard';

export interface PricingDoc {
  id: string;
  services: ServicePrice[];
  updatedAt: string;
  updatedBy: string | null;
}

/** The rate card, or `null` if it could not be read. `[]` means none posted. */
export async function readPricing(groupId: string): Promise<ServicePrice[] | null> {
  try {
    await ensureClubSettings();
    const resource = await groupScope(groupId).read<PricingDoc>('clubSettings', pricingDocId(groupId));
    if (!resource) return [];
    return Array.isArray(resource.services) ? resource.services : [];
  } catch (err) {
    console.error('readPricing failed:', err);
    return null;
  }
}

/**
 * Clean a submitted rate card.
 *
 * Order is PRESERVED — unlike the string list, this is a menu, and the
 * stringer's ordering is editorial (cheapest first, or most common first).
 * Sorting it for them would be the app having an opinion it has not earned.
 */
export function normalisePricing(value: unknown): ServicePrice[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_SERVICES) return null;
  const out: ServicePrice[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const { label, priceCents } = raw as { label?: unknown; priceCents?: unknown };
    if (typeof label !== 'string') return null;
    const t = label.trim();
    if (!t || t.length > MAX_LABEL_LEN) return null;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (priceCents === null || priceCents === undefined) {
      out.push({ label: t, priceCents: null });
      continue;
    }
    if (
      !Number.isInteger(priceCents) ||
      (priceCents as number) < 0 ||
      (priceCents as number) > MAX_PRICE_CENTS
    ) {
      return null;
    }
    out.push({ label: t, priceCents: priceCents as number });
  }
  return out;
}
