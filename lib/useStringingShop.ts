'use client';

import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Is the stringing shop open? `true` / `false` from the shop doc, `null` while
 * unknown — a throttled or failed probe included.
 *
 * Every caller renders the MODEST thing on `null`: Home's card keeps "Coming
 * soon", and a door into the request sheet does not appear. Offering a button
 * on a guess would have someone tap into a 409.
 */
export function useStringingShop(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/shop`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setOpen(d && typeof d.open === 'boolean' ? d.open : null);
      })
      .catch(() => {
        /* stays null — unknown */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return open;
}
