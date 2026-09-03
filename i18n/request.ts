import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { match } from '@formatjs/intl-localematcher';

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

// BPM sessions happen in Vancouver. Render all datetimes in that zone so
// players see the actual clock time of the game, regardless of where they
// (or the server) are.
export const APP_TIME_ZONE = 'America/Vancouver';

export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | undefined,
): Locale {
  if (cookieValue && (SUPPORTED_LOCALES as readonly string[]).includes(cookieValue)) {
    return cookieValue as Locale;
  }

  if (acceptLanguage) {
    try {
      const preferred = acceptLanguage
        .split(',')
        .map((s) => s.split(';')[0]!.trim())
        .filter(Boolean);
      if (preferred.length > 0) {
        const matched = match(
          preferred,
          SUPPORTED_LOCALES as unknown as string[],
          DEFAULT_LOCALE,
        );
        if ((SUPPORTED_LOCALES as readonly string[]).includes(matched)) {
          return matched as Locale;
        }
      }
    } catch {
      // fall through to default
    }
  }

  return DEFAULT_LOCALE;
}

type MessageNode = string | MessageNode[] | MessageTree;
type MessageTree = { [key: string]: MessageNode };

/**
 * Overlay a locale's messages on English so a missing key falls back to the
 * English string instead of throwing.
 *
 * ARRAYS REPLACE, THEY DO NOT MERGE. The legal pages keep their copy as
 * arrays (`legal.*.sections`, read with `t.raw`), and spreading an array into
 * `{ ...base }` turns it into an index-keyed OBJECT — `.map` then throws on
 * the Chinese page while the English one renders fine. A locale authors an
 * array whole; if it is absent the English one is used, and if it is present
 * it wins outright.
 */
export function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const k of Object.keys(override)) {
    const ov = override[k];
    const bv = out[k];
    if (
      ov !== null &&
      typeof ov === 'object' &&
      !Array.isArray(ov) &&
      bv !== null &&
      typeof bv === 'object' &&
      !Array.isArray(bv)
    ) {
      out[k] = deepMerge(bv as MessageTree, ov as MessageTree);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const locale = resolveLocale(
    cookieStore.get('NEXT_LOCALE')?.value,
    headerStore.get('accept-language') ?? undefined,
  );

  const enMessages = (await import('../messages/en.json')).default as MessageTree;
  const localeMessages =
    locale === 'en'
      ? enMessages
      : ((await import(`../messages/${locale}.json`)).default as MessageTree);

  const messages = deepMerge(enMessages, localeMessages);

  return { locale, messages, timeZone: APP_TIME_ZONE };
});
