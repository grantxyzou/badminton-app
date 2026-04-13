import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { match } from '@formatjs/intl-localematcher';

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

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

type MessageTree = { [key: string]: string | MessageTree };

function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const k of Object.keys(override)) {
    const ov = override[k];
    const bv = out[k];
    if (
      ov !== null &&
      typeof ov === 'object' &&
      bv !== null &&
      typeof bv === 'object'
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

  return { locale, messages };
});
