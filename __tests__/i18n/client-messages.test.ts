import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../messages/en.json';
import zh from '../../messages/zh-CN.json';
import { mergedMessages, _resetMergedMessages, type MessageTree } from '../../i18n/request';
import { EN_MESSAGES, loadZhMessages } from '../../components/intl/IntlProvider';

/**
 * The browser's messages travel in cached script chunks
 * (components/intl/IntlProvider.tsx), not in the page: the root layout used to
 * pass the whole merged tree as a prop, and every no-store page carried ~37 KB
 * of compressed strings on every visit (performance audit, 2026-10-19).
 *
 * Two trees now exist — the server's (`i18n/request.ts`, for server components
 * and `getTranslations`) and the client's — so this pins them EQUAL. A drift
 * would show one string in the server-rendered HTML and another after
 * hydration, or a key path on one side only.
 */

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

beforeEach(() => _resetMergedMessages());

describe('client messages match the server tree', () => {
  it('English', () => {
    expect(EN_MESSAGES).toEqual(mergedMessages('en', en as unknown as MessageTree, en as unknown as MessageTree));
  });

  it('Chinese, with English underneath for any missing key', async () => {
    expect(await loadZhMessages()).toEqual(
      mergedMessages('zh-CN', en as unknown as MessageTree, zh as unknown as MessageTree),
    );
  });

  it('loads the Chinese tree once and reuses it', async () => {
    expect(loadZhMessages()).toBe(loadZhMessages());
  });

  it('carries the brand, not the sentinel', async () => {
    expect(JSON.stringify(EN_MESSAGES)).not.toContain('%APP');
    expect(JSON.stringify(await loadZhMessages())).not.toContain('%APP');
  });
});

describe('the strings stay out of the HTML, and each reader gets one language', () => {
  const layout = read('app/layout.tsx');
  const provider = read('components/intl/IntlProvider.tsx');

  it('the layout passes no messages and reads none', () => {
    expect(layout).not.toMatch(/messages=\{/);
    expect(layout).not.toMatch(/\bgetMessages\b/);
    expect(layout).not.toMatch(/<NextIntlClientProvider\b/);
  });

  it('English is bundled; Chinese is fetched only when the page is in Chinese', () => {
    // A static import of zh-CN.json put it in every reader's chunk.
    expect(provider).not.toMatch(/^import[^;]*zh-CN\.json/m);
    expect(provider).toMatch(/import\(\s*['"]@\/messages\/zh-CN\.json['"]\s*\)/);
    expect(provider).toMatch(/^import en from ['"]@\/messages\/en\.json['"]/m);
  });

  it('is a client module that reaches the server-only config for types alone', () => {
    expect(provider.startsWith("'use client'")).toBe(true);
    // `import type` is erased at build; a value import would pull next/headers
    // into the browser bundle.
    expect(provider).not.toMatch(/^import\s+(?!type\b)[^;]*i18n\/request/m);
  });
});
