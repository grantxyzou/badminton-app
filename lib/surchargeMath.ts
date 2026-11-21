/**
 * The card fee's arithmetic (`docs/plans/card-surcharge.md`). Pure: no
 * Stripe, no store, so the routes and the tests compute the same cents.
 *
 * A surcharge in Canada is at most 2.4% and on credit cards only. Every
 * figure here rounds DOWN, so a rounding can never put the club over the cap.
 */

/** 2.4%, in basis points. The highest rate the toggle accepts. */
export const SURCHARGE_MAX_BPS = 240;

/** What a club starts at when it first turns the fee on. */
export const SURCHARGE_DEFAULT_BPS = 240;

/**
 * The card brands a fee may go on: Visa and Mastercard, whose Canadian rules
 * (the 2022 class settlement) the club gave notice under. American Express
 * and every other brand pay no fee until the club has checked that brand's
 * own rules and given whatever notice it asks for (docs/plans/card-surcharge.md).
 */
export const SURCHARGE_BRANDS: readonly string[] = ['visa', 'mastercard'];

/** A card that may carry the fee: a Visa or Mastercard CREDIT card, never debit or prepaid. */
export function surchargeableCard(funding: string | null | undefined, brand: string | null | undefined): boolean {
  return funding === 'credit' && SURCHARGE_BRANDS.includes((brand ?? '').toLowerCase());
}

/** A rate the toggle accepts: a whole number of basis points, 1 to 240. */
export function validSurchargeBps(bps: unknown): bps is number {
  return typeof bps === 'number' && Number.isInteger(bps) && bps >= 1 && bps <= SURCHARGE_MAX_BPS;
}

/**
 * The fee on `baseCents` at `bps`, never above `maximumCents` when Stripe
 * gives one for this card (its own technical ceiling), and never negative.
 */
export function surchargeCents(baseCents: number, bps: number, maximumCents?: number | null): number {
  if (!Number.isInteger(baseCents) || baseCents <= 0 || !validSurchargeBps(bps)) return 0;
  const fee = Math.floor((baseCents * bps) / 10_000);
  const capped = typeof maximumCents === 'number' && maximumCents >= 0 ? Math.min(fee, maximumCents) : fee;
  return Math.max(0, capped);
}

/** The highest fee the rules allow on `baseCents` (2.4%, rounded down). Used to check a charge that comes back. */
export function maxAllowedSurcharge(baseCents: number): number {
  return Math.floor((baseCents * SURCHARGE_MAX_BPS) / 10_000);
}

/**
 * The share of a refund that refunds the LINES, when the charge carried a fee.
 * A refund returns its prorated part of the fee with it (card network rule),
 * so of `refundedCents` against a charge of `baseCents + feeCents`, the lines'
 * part is `refunded × base / (base + fee)`, to the nearest cent.
 */
export function linesPartOfRefund(refundedCents: number, baseCents: number, feeCents: number): number {
  if (feeCents <= 0 || baseCents <= 0) return refundedCents;
  return Math.round((refundedCents * baseCents) / (baseCents + feeCents));
}

/** The fee that goes back with refunding `linesCents` of a charge that carried one, rounded down. */
export function feeShareOf(linesCents: number, baseCents: number, feeCents: number): number {
  if (feeCents <= 0 || baseCents <= 0) return 0;
  return Math.floor((linesCents * feeCents) / baseCents);
}
