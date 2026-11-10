/**
 * A club's Wealthsimple handle, the second way to pay printed under the
 * e-transfer address on a shared receipt (`ETransferRecipient.wealthsimple`,
 * 2026-11-10, receipt design F4).
 *
 * A handle is what Wealthsimple shows as a "$cashtag": letters, digits, dots,
 * dashes and underscores, up to 30 of them. It is stored WITH its leading `$`
 * so the receipt prints exactly what the payer types. Pure: shared by the two
 * routes that validate a recipient and the admin's editor.
 */
const HANDLE = /^\$[A-Za-z0-9._-]{1,30}$/;

/** "grantxyzou", " $grantxyzou " → "$grantxyzou"; anything that is not a handle → null. */
export function normalizeWealthsimpleHandle(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withSign = t.startsWith('$') ? t : `$${t}`;
  return HANDLE.test(withSign) ? withSign : null;
}

/** A stored value is valid only in its normalized form. */
export function isWealthsimpleHandle(value: unknown): value is string {
  return typeof value === 'string' && HANDLE.test(value);
}
