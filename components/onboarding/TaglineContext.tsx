'use client';

import { createContext, useContext } from 'react';
import { useTranslations } from 'next-intl';
import { rawList } from '@/lib/rawList';

/**
 * This visit's line under the logo, picked once on the server (`lib/tagline.ts`)
 * and handed to `SignedOutShell`, so every logo the signed-out screens draw —
 * Welcome, the sign-in pages, a club's link page, the foldable cover — names the
 * same line as the splash that faded off them.
 */
export const TaglineContext = createContext<string | null>(null);

/**
 * The line to draw. Outside a provider (a page rendered on its own, as the
 * component tests do), the list's first line.
 */
export function useTagline(): string {
  const picked = useContext(TaglineContext);
  const t = useTranslations('signedOut');
  return picked ?? rawList<string>(t.raw('taglines'))[0] ?? '';
}
