'use client';

import { use, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { brandMessages, deepMerge, type MessageTree } from '@/lib/messageTree';
import type { Locale } from '@/i18n/request';

/**
 * The browser's messages, carried in script chunks instead of in the page.
 *
 * WHY. The root layout used to hand the whole merged tree to
 * `NextIntlClientProvider` as `messages`, and a server component's props are
 * serialized into the page: ~110 KB of strings (37 KB compressed) rode in the
 * HTML of every page, signed out or in. That HTML is `no-store`, so every
 * visit and every app launch downloaded it again. Imported here, the strings
 * sit in hashed `/_next/static` chunks served `immutable` for a year: a phone
 * downloads them once per change to the wording, not once per visit
 * (performance audit, 2026-10-19).
 *
 * ONE READER, ONE LANGUAGE. English is imported statically (the default, and
 * every other locale's fallback). Chinese is a dynamic `import()`, so its
 * chunk is fetched only when the page is in Chinese. Two providers chosen in
 * the layout were tried first: a server component lists every client module
 * it can render, so every page loaded BOTH files, and the wording changes
 * often enough (13 of the last 30 days) that paying for both on each change
 * ate most of the saving.
 *
 * `use()` waits for the Chinese chunk: on the server before the page is sent,
 * so a Chinese page still arrives fully rendered; in the browser before it
 * hydrates. A language switch is a `router.refresh()` transition, during which
 * React keeps the old screen up until the new language has loaded.
 *
 * Built by the same `deepMerge` + `brandMessages` as the server's tree
 * (`i18n/request.ts`); `__tests__/i18n/client-messages.test.ts` pins them equal.
 */
export const EN_MESSAGES = brandMessages(en as unknown as MessageTree);

let zhMessages: Promise<MessageTree> | null = null;

/** The Chinese tree (zh-CN over English), loaded once per page lifetime. */
export function loadZhMessages(): Promise<MessageTree> {
  zhMessages ??= import('@/messages/zh-CN.json').then((m) =>
    brandMessages(deepMerge(en as unknown as MessageTree, m.default as unknown as MessageTree)),
  );
  return zhMessages;
}

export default function IntlProvider({
  locale,
  timeZone,
  children,
}: {
  locale: Locale;
  timeZone: string;
  children: ReactNode;
}) {
  const messages = locale === 'zh-CN' ? use(loadZhMessages()) : EN_MESSAGES;
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
