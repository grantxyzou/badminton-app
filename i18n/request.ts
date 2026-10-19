import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { match } from '@formatjs/intl-localematcher';
import { deepMerge, brandMessages, type MessageTree } from '../lib/messageTree';

// The pure merge + brand pipeline moved to lib/messageTree.ts so the browser
// can run it too (components/intl/); re-exported for existing importers.
export { deepMerge, brandMessages };
export type { MessageNode, MessageTree } from '../lib/messageTree';

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

  const messages = mergedMessages(locale, enMessages, localeMessages);

  return { locale, messages, timeZone: APP_TIME_ZONE };
});

/**
 * The merged, branded tree per locale, built once per process. Both inputs
 * are bundler imports — the same object on every request — so the walk over
 * ~1,900 strings that `deepMerge` + `brandMessages` do was pure repetition,
 * paid on every server render of every page. Keyed by locale only because
 * that is the only thing that varies.
 */
const merged = new Map<string, MessageTree>();

export function mergedMessages(locale: string, en: MessageTree, local: MessageTree): MessageTree {
  let tree = merged.get(locale);
  if (!tree) {
    tree = brandMessages(deepMerge(en, local));
    merged.set(locale, tree);
  }
  return tree;
}

/** Test seam: forget every merged tree. */
export function _resetMergedMessages() {
  merged.clear();
}
