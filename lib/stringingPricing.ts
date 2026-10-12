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
import { MAX_SERVICES, MAX_LABEL_LEN, MAX_PRICE_CENTS, MAX_PRICING_NOTE_LEN, type ServicePrice } from './stringingRateCard';

export interface PricingDoc {
  id: string;
  /**
   * The old per-service rate card. Since docs/plans/bench-redesign.md (PR 2)
   * a string's own restring price is the price, so nothing edits or shows
   * this any more; it stays stored so a rollback still has its menu.
   */
  services: ServicePrice[];
  /** A restring with the player's OWN string, in cents; `null` = "Ask". ADDITIVE. */
  ownStringCents?: number | null;
  /** A line players read under the prices ("Prices are new this month"). ADDITIVE. */
  note?: string;
  updatedAt: string;
  updatedBy: string | null;
}

export const MAX_NOTE_LEN = MAX_PRICING_NOTE_LEN;

export interface PricingRead {
  services: ServicePrice[];
  ownStringCents: number | null;
  note: string;
}

/** The whole pricing doc, defaults filled; `null` if it could not be read. */
export async function readPricingDoc(groupId: string): Promise<PricingRead | null> {
  try {
    await ensureClubSettings();
    const resource = await groupScope(groupId).read<PricingDoc>('clubSettings', pricingDocId(groupId));
    const own = resource?.ownStringCents;
    return {
      services: Array.isArray(resource?.services) ? resource!.services : [],
      ownStringCents: typeof own === 'number' && Number.isInteger(own) && own >= 0 && own <= MAX_PRICE_CENTS ? own : null,
      note: typeof resource?.note === 'string' ? resource.note : '',
    };
  } catch (err) {
    console.error('readPricingDoc failed:', err);
    return null;
  }
}

/** A submitted own-string price: whole cents in range, or null ("Ask"). `undefined` = invalid. */
export function normaliseOwnStringCents(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PRICE_CENTS) return value;
  return undefined;
}

/** A submitted note, trimmed; `undefined` = invalid (not a string, or too long). */
export function normaliseNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length <= MAX_NOTE_LEN ? t : undefined;
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
