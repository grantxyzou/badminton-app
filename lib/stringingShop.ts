/**
 * The shop sign, server-side.
 *
 * Extracted so the request route and the shop route cannot disagree about what
 * "open" means. A player-facing write MUST check this on the server: the Home
 * card decides whether to offer the button from the same value, but a client
 * flag protects nothing — anyone can POST directly.
 */
import { getContainer, ensureContainer } from './cosmos';

export const SHOP_DOC_ID = 'stringing';

export interface ShopDoc {
  id: string;
  open: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

let ready: Promise<void> | null = null;
export function ensureClubSettings(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('clubSettings', '/id').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/**
 * Is the shop taking rackets?
 *
 * Returns `null` for UNKNOWN — a read that failed, which is not the same as
 * closed. Callers decide what to do with that, and they decide differently:
 * the Home card renders "Coming soon" (harmless), while a write refuses
 * (safe). Collapsing the two into a boolean would force one of those to be
 * wrong.
 */
export async function readShopOpen(): Promise<boolean | null> {
  try {
    await ensureClubSettings();
    const { resource } = await getContainer('clubSettings')
      .item(SHOP_DOC_ID, SHOP_DOC_ID)
      .read<ShopDoc>();
    // A missing document is a real answer: nobody has opened the shop, so it
    // is closed. Only a THROWN read is unknown.
    return resource?.open === true;
  } catch (err) {
    console.error('readShopOpen failed:', err);
    return null;
  }
}
