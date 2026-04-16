# C1 — i18n Framework + Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `next-intl` v4 cookie-based localization on the Home tab with 10 canary strings in English + Simplified Chinese that exercise every mechanism C2 will need.

**Architecture:** Server-first locale resolution via `NEXT_LOCALE` cookie (middleware sets on first visit from `Accept-Language`). Messages bundled from `messages/{locale}.json`. Deep-merge over `en.json` guarantees English fallback for any missing key. Inline `EN | 中文` segment on Home triggers `router.refresh()` after flipping the cookie. Zero impact on API routes, Cosmos, or the A1 cold-start splash.

**Tech Stack:** `next-intl@^4`, `@formatjs/intl-localematcher`, Next.js 16 App Router, React 18, Vitest 4, @testing-library/react 16.

---

## Spec reference
Design: `docs/superpowers/specs/2026-04-13-i18n-c1-framework-design.md`

## Project conventions to follow
- Vitest default env is `node`. Component tests require `// @vitest-environment jsdom` docblock at top of file.
- Vitest globals are NOT configured — import `describe`, `it`, `expect`, `afterEach` from `vitest` explicitly.
- Component tests must call `afterEach(cleanup)` manually.
- Commit style: `type: short description` (no scope, lowercase type — `feat`, `fix`, `test`, `docs`, `chore`). Include Co-Authored-By footer per CLAUDE.md.
- Run all tests between tasks: `npm test`.

---

### Task 1: Install next-intl and wrap next.config.js

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `next.config.js` (wrap with `withNextIntl`)

- [ ] **Step 1: Install dependency**

Run:
```bash
npm install next-intl@^4 @formatjs/intl-localematcher
```

Expected: added to `dependencies` in `package.json`, no peer warnings.

- [ ] **Step 2: Wrap next.config.js**

Replace the final `module.exports = nextConfig;` line at the bottom of `next.config.js` with:

```js
const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

module.exports = withNextIntl(nextConfig);
```

Leave the `nextConfig` object itself unchanged (keep `basePath`, `output`, `headers`).

- [ ] **Step 3: Verify nothing breaks yet**

Run: `npm test`
Expected: all 97 existing tests pass. (`./i18n/request.ts` doesn't exist yet but next-intl plugin only errors at runtime, not at config parse.)

Run: `npm run build`
Expected: build will fail because `i18n/request.ts` is referenced but missing. **That is OK for now** — we create it in Task 3. Do not run `build` again until Task 3 is done.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json next.config.js
git commit -m "$(cat <<'EOF'
chore: install next-intl and wrap next.config with plugin

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create canary message files

**Files:**
- Create: `messages/en.json`
- Create: `messages/zh-CN.json`
- Create: `messages/README.md`

- [ ] **Step 1: Create `messages/en.json`**

```json
{
  "home": {
    "signup": {
      "button": "Sign Up",
      "waitlist": "Join Waitlist",
      "full": "Session Full",
      "confirmed": "Signed up as {name}"
    },
    "cost": {
      "label": "Cost per person",
      "emphasis": "Cost this week: <amount>{value}</amount>"
    },
    "session": {
      "date": "Session date",
      "when": "Session on {date, date, long}"
    },
    "roster": {
      "count": "{count, plural, =0 {No players yet} one {# player signed up} other {# players signed up}}"
    },
    "payment": {
      "reminder": "You owe {amount} from {date}"
    }
  }
}
```

- [ ] **Step 2: Create `messages/zh-CN.json`**

```json
{
  "home": {
    "signup": {
      "button": "报名",
      "waitlist": "加入候补",
      "full": "名额已满",
      "confirmed": "已报名：{name}"
    },
    "cost": {
      "label": "每人费用",
      "emphasis": "本周费用：<amount>{value}</amount>"
    },
    "session": {
      "date": "活动日期",
      "when": "活动时间：{date, date, long}"
    },
    "roster": {
      "count": "{count, plural, other {# 人已报名}}"
    },
    "payment": {
      "reminder": "您还欠 {amount}（{date}）"
    }
  }
}
```

- [ ] **Step 3: Create `messages/README.md`**

```markdown
# Translation files

- `en.json` — source of truth. All keys must exist here.
- `zh-CN.json` — Simplified Chinese. Missing keys fall back to English at runtime.

## Canary translation status (C1)

The 10 keys in this directory are **first-pass Chinese translations** generated during C1 to prove the pipeline. They must be reviewed by a native Mandarin speaker before C2 content sweep ships.

Review checklist:
- Register (formal vs. conversational) appropriate for a community badminton group
- Measure words / numeric formatting match local convention
- Punctuation follows zh-CN norms (full-width `：` instead of `:`, etc.)
```

- [ ] **Step 4: Commit**

```bash
git add messages/
git commit -m "$(cat <<'EOF'
feat: add canary message files for en and zh-CN

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create i18n/request.ts with testable resolveLocale helper (TDD)

**Files:**
- Create: `i18n/request.ts`
- Create: `__tests__/i18n/request-config.test.ts`

- [ ] **Step 1: Write failing test `__tests__/i18n/request-config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../../i18n/request';

describe('resolveLocale', () => {
  it('returns the cookie value when it is supported', () => {
    expect(resolveLocale('zh-CN', undefined)).toBe('zh-CN');
    expect(resolveLocale('en', undefined)).toBe('en');
  });

  it('coerces unsupported cookie values to the default locale', () => {
    expect(resolveLocale('fr', undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('', undefined)).toBe(DEFAULT_LOCALE);
  });

  it('falls back to Accept-Language when cookie is absent', () => {
    expect(resolveLocale(undefined, 'zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-CN');
    expect(resolveLocale(undefined, 'en-US,en;q=0.9')).toBe('en');
  });

  it('downgrades unknown accept-language to the default locale', () => {
    expect(resolveLocale(undefined, 'fr-FR,fr;q=0.9')).toBe(DEFAULT_LOCALE);
  });

  it('returns the default locale when both inputs are absent', () => {
    expect(resolveLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
  });

  it('exposes a frozen list of supported locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'zh-CN']);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run __tests__/i18n/request-config.test.ts`
Expected: FAIL — `Cannot find module '../../i18n/request'`.

- [ ] **Step 3: Implement `i18n/request.ts`**

```ts
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
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `npx vitest run __tests__/i18n/request-config.test.ts`
Expected: PASS, 6 tests.

Run: `npm test`
Expected: all prior tests still pass (98 now, including the new file).

- [ ] **Step 5: Commit**

```bash
git add i18n/request.ts __tests__/i18n/request-config.test.ts
git commit -m "$(cat <<'EOF'
feat: add i18n request config with testable locale resolver

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add middleware.ts for first-visit cookie set (TDD)

**Files:**
- Create: `middleware.ts`
- Create: `__tests__/i18n/middleware.test.ts`

- [ ] **Step 1: Write failing test `__tests__/i18n/middleware.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

function makeReq(opts: { cookie?: string; acceptLanguage?: string }) {
  const url = 'http://localhost:3000/';
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.acceptLanguage) headers.set('accept-language', opts.acceptLanguage);
  return new NextRequest(url, { headers });
}

describe('middleware', () => {
  it('sets NEXT_LOCALE cookie from Accept-Language on first visit', () => {
    const res = middleware(makeReq({ acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8' }));
    const cookie = res.cookies.get('NEXT_LOCALE');
    expect(cookie?.value).toBe('zh-CN');
    expect(cookie?.path).toBe('/bpm');
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 365);
  });

  it('defaults to en when Accept-Language has no supported match', () => {
    const res = middleware(makeReq({ acceptLanguage: 'fr-FR' }));
    expect(res.cookies.get('NEXT_LOCALE')?.value).toBe('en');
  });

  it('defaults to en when no Accept-Language header is present', () => {
    const res = middleware(makeReq({}));
    expect(res.cookies.get('NEXT_LOCALE')?.value).toBe('en');
  });

  it('is a no-op when NEXT_LOCALE cookie is already present', () => {
    const res = middleware(
      makeReq({ cookie: 'NEXT_LOCALE=zh-CN', acceptLanguage: 'en-US' }),
    );
    expect(res.cookies.get('NEXT_LOCALE')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run __tests__/i18n/middleware.test.ts`
Expected: FAIL — `Cannot find module '../../middleware'`.

- [ ] **Step 3: Implement `middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { match } from '@formatjs/intl-localematcher';

const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
const DEFAULT_LOCALE = 'en';
const COOKIE_NAME = 'NEXT_LOCALE';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function middleware(req: NextRequest): NextResponse {
  if (req.cookies.get(COOKIE_NAME)) {
    return NextResponse.next();
  }

  const accept = req.headers.get('accept-language') ?? '';
  let locale: string = DEFAULT_LOCALE;
  try {
    const preferred = accept
      .split(',')
      .map((s) => s.split(';')[0]!.trim())
      .filter(Boolean);
    if (preferred.length > 0) {
      locale = match(preferred, SUPPORTED_LOCALES as unknown as string[], DEFAULT_LOCALE);
    }
  } catch {
    locale = DEFAULT_LOCALE;
  }

  const res = NextResponse.next();
  res.cookies.set({
    name: COOKIE_NAME,
    value: locale,
    path: '/bpm',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

// Run on all user-visible paths; skip API routes, Next internals, and static files.
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `npx vitest run __tests__/i18n/middleware.test.ts`
Expected: PASS, 4 tests.

Run: `npm test`
Expected: all tests pass (102 total).

- [ ] **Step 5: Commit**

```bash
git add middleware.ts __tests__/i18n/middleware.test.ts
git commit -m "$(cat <<'EOF'
feat: add middleware to set NEXT_LOCALE cookie on first visit

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wrap app/layout.tsx with NextIntlClientProvider

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Read current layout**

Open `app/layout.tsx` and locate the `RootLayout` component. It currently renders the pre-hydration splash as pure HTML before `{children}`. **Do not move or remove the splash markup.**

- [ ] **Step 2: Modify layout**

At the top of the file, add these imports:

```tsx
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
```

Make the `RootLayout` function `async` and wrap only `{children}` (NOT the splash) in the provider. The structure should become:

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        {/* existing splash markup — DO NOT MOVE */}
        <div className="splash" aria-hidden="true">
          {/* ... keep existing splash children as-is ... */}
        </div>

        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

Key edits:
- Add `async` to the function signature.
- Replace `<html lang="en">` with `<html lang={locale}>` (splash will still render before hydration using the server-resolved locale).
- Wrap `{children}` — and only `{children}` — in `<NextIntlClientProvider>`.

- [ ] **Step 3: Build and run tests**

Run: `npm run build`
Expected: build succeeds. If it fails with "Module not found: i18n/request", re-check Task 1 Step 2.

Run: `npm test`
Expected: all 102 tests still pass. Existing component tests do not consume translations yet, so they are unaffected.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`
Visit `http://localhost:3000/bpm` and confirm the app still loads and the A1 cold-start splash is still visible during hard refresh. Check browser devtools → Application → Cookies: `NEXT_LOCALE` should appear, value `en` or `zh-CN`. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "$(cat <<'EOF'
feat: wrap layout with NextIntlClientProvider, preserve splash

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create LanguageToggle component (TDD)

**Files:**
- Create: `components/LanguageToggle.tsx`
- Create: `__tests__/components/LanguageToggle.test.tsx`

- [ ] **Step 1: Write failing test `__tests__/components/LanguageToggle.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import LanguageToggle from '../../components/LanguageToggle';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function renderWithLocale(locale: 'en' | 'zh-CN') {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <LanguageToggle />
    </NextIntlClientProvider>,
  );
}

describe('LanguageToggle', () => {
  afterEach(() => {
    cleanup();
    refreshMock.mockClear();
    document.cookie = 'NEXT_LOCALE=; path=/bpm; max-age=0';
  });

  it('renders both language options', () => {
    renderWithLocale('en');
    expect(screen.getByRole('radio', { name: 'EN' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '中文' })).toBeTruthy();
  });

  it('marks the current locale as active', () => {
    renderWithLocale('zh-CN');
    const zh = screen.getByRole('radio', { name: '中文' });
    const en = screen.getByRole('radio', { name: 'EN' });
    expect(zh.getAttribute('aria-checked')).toBe('true');
    expect(en.getAttribute('aria-checked')).toBe('false');
    expect(zh.className).toContain('segment-tab-active');
    expect(en.className).toContain('segment-tab-inactive');
  });

  it('writes the cookie and calls router.refresh when a different locale is clicked', () => {
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('radio', { name: '中文' }));
    expect(document.cookie).toContain('NEXT_LOCALE=zh-CN');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the active locale is re-clicked', () => {
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run __tests__/components/LanguageToggle.test.tsx`
Expected: FAIL — component module not found.

- [ ] **Step 3: Implement `components/LanguageToggle.tsx`**

```tsx
'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'zh-CN', label: '中文' },
] as const;

export default function LanguageToggle() {
  const current = useLocale();
  const router = useRouter();

  function setLocale(next: string) {
    if (next === current) return;
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';
    document.cookie = `NEXT_LOCALE=${next}; path=/bpm; max-age=31536000; SameSite=Lax${secure}`;
    router.refresh();
  }

  return (
    <div className="segment-control" role="radiogroup" aria-label="Language">
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={code === current}
          className={code === current ? 'segment-tab-active' : 'segment-tab-inactive'}
          onClick={() => setLocale(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `npx vitest run __tests__/components/LanguageToggle.test.tsx`
Expected: PASS, 4 tests.

Run: `npm test`
Expected: all tests pass (106 total).

- [ ] **Step 5: Commit**

```bash
git add components/LanguageToggle.tsx __tests__/components/LanguageToggle.test.tsx
git commit -m "$(cat <<'EOF'
feat: add LanguageToggle component with EN|中文 segment

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire CostCard to use translations (TDD for canary keys #4 and #9)

**Files:**
- Modify: `components/CostCard.tsx`
- Modify: `__tests__/components/CostCard.test.tsx`

- [ ] **Step 1: Locate existing CostCard test and identity**

Read `__tests__/components/CostCard.test.tsx` and `components/CostCard.tsx` to understand current props and render structure. The component currently renders a hardcoded English label for cost per person. Identify the exact hardcoded string (likely `"Cost per person"` or similar).

- [ ] **Step 2: Update existing CostCard test to wrap in provider**

Wrap every `render(<CostCard ... />)` call in the existing test file with `<NextIntlClientProvider locale="en" messages={enMessages}>`. Add at the top of `__tests__/components/CostCard.test.tsx`:

```tsx
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
```

Replace each `render(<CostCard ... />)` with:

```tsx
render(
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <CostCard ... />
  </NextIntlClientProvider>,
);
```

The test assertions on visible text (e.g., `screen.getByText('Cost per person')`) continue to pass because `en.json` defines the same label.

- [ ] **Step 3: Add new test for zh-CN rendering**

Append to the existing `describe` block in `__tests__/components/CostCard.test.tsx`:

```tsx
import zhMessages from '../../messages/zh-CN.json';

it('renders the zh-CN cost label when locale is zh-CN', () => {
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
      <CostCard perPersonCost={10} totalCost={40} playerCount={4} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText('每人费用')).toBeTruthy();
});
```

(Adjust the `CostCard` props to match the real component's signature from Step 1.)

- [ ] **Step 4: Run to confirm the zh-CN test fails**

Run: `npx vitest run __tests__/components/CostCard.test.tsx`
Expected: FAIL — component still renders hardcoded English `"Cost per person"`.

- [ ] **Step 5: Modify `components/CostCard.tsx`**

Add at the top:

```tsx
import { useTranslations } from 'next-intl';
```

Inside the component function body, before the return, add:

```tsx
const t = useTranslations('home.cost');
```

Replace the hardcoded label (e.g., `"Cost per person"`) with `{t('label')}`.

If the component currently renders something like "Cost this week: $X" with emphasis styling, replace it with the rich-text canary (key `home.cost.emphasis`). Use next-intl's rich text pattern:

```tsx
import { useTranslations } from 'next-intl';
// ...
const t = useTranslations('home.cost');
// ...
{t.rich('emphasis', {
  value: perPersonCost.toFixed(2),
  amount: (chunks) => <strong>{chunks}</strong>,
})}
```

If CostCard does NOT currently render an emphasis string, skip the rich-text wiring here — that key will still be validated by Task 10's canary-strings test rendering against a scratch component.

- [ ] **Step 6: Run tests**

Run: `npx vitest run __tests__/components/CostCard.test.tsx`
Expected: all CostCard tests pass, including the new zh-CN case.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/CostCard.tsx __tests__/components/CostCard.test.tsx
git commit -m "$(cat <<'EOF'
feat: wire CostCard label to useTranslations

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire PrevPaymentReminder to use translations (TDD for canary key #10)

**Files:**
- Modify: `components/PrevPaymentReminder.tsx`
- Modify: `__tests__/components/PrevPaymentReminder.test.tsx`

- [ ] **Step 1: Understand current component**

Read `components/PrevPaymentReminder.tsx` and the existing test. Note current props (likely `amount`, `date`) and the hardcoded reminder string.

- [ ] **Step 2: Wrap existing tests in provider**

As in Task 7, wrap every existing `render(<PrevPaymentReminder ... />)` in the test file with `<NextIntlClientProvider locale="en" messages={enMessages}>`. Add the imports at the top of the test file.

- [ ] **Step 3: Add zh-CN test**

Append to the existing `describe` block:

```tsx
import zhMessages from '../../messages/zh-CN.json';

it('renders the zh-CN payment reminder with interpolated values', () => {
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
      <PrevPaymentReminder amount="$10.00" date="Apr 6" />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText('您还欠 $10.00（Apr 6）')).toBeTruthy();
});
```

(Adjust props to match the real component signature.)

- [ ] **Step 4: Run to confirm failure**

Run: `npx vitest run __tests__/components/PrevPaymentReminder.test.tsx`
Expected: FAIL on the new zh-CN test.

- [ ] **Step 5: Modify `components/PrevPaymentReminder.tsx`**

Replace the hardcoded reminder string with:

```tsx
import { useTranslations } from 'next-intl';
// ...
const t = useTranslations('home.payment');
// ...
{t('reminder', { amount, date })}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run __tests__/components/PrevPaymentReminder.test.tsx`
Expected: all tests pass.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/PrevPaymentReminder.tsx __tests__/components/PrevPaymentReminder.test.tsx
git commit -m "$(cat <<'EOF'
feat: wire PrevPaymentReminder to useTranslations

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire HomeTab + render LanguageToggle inline

**Files:**
- Modify: `components/HomeTab.tsx`

No new test file — this task is integration; all string assertions are handled by Task 10's parametric canary test, and the inline render of `<LanguageToggle />` is exercised by the existing `LanguageToggle.test.tsx`.

- [ ] **Step 1: Identify the canary sites in HomeTab**

Read `components/HomeTab.tsx` to find these hardcoded strings (from spec Section 8):

- `"Sign Up"` (button) → `home.signup.button`
- `"Join Waitlist"` or similar → `home.signup.waitlist`
- `"Session Full"` or similar → `home.signup.full`
- `"Signed up as {name}"` or similar → `home.signup.confirmed`
- `"Session date"` or similar label → `home.session.date`
- Session datetime display → `home.session.when` (using `{date, date, long}` ICU formatter)
- Roster count display → `home.roster.count` (using plural ICU rules)

If any of these strings don't currently exist as-is in HomeTab, keep the closest existing rendering and translate it. Do not invent new UI.

- [ ] **Step 2: Add imports and render the toggle**

At the top of `components/HomeTab.tsx`:

```tsx
import { useTranslations, useLocale } from 'next-intl';
import LanguageToggle from './LanguageToggle';
```

Add inside the component function body (before the return):

```tsx
const t = useTranslations('home');
const locale = useLocale();
```

Render `<LanguageToggle />` immediately below the BPM title tile row and above the CostCard (per the card-order gotcha in CLAUDE.md: `tile row → LanguageToggle → CostCard → Announcement → Sign-Up → PrevPaymentReminder`):

```tsx
<div className="flex justify-center mb-3">
  <LanguageToggle />
</div>
```

- [ ] **Step 3: Replace hardcoded strings**

For each canary site identified in Step 1:

- Sign-Up button text → `{t('signup.button')}`
- Waitlist CTA → `{t('signup.waitlist')}`
- Session-full banner → `{t('signup.full')}`
- Signed-up confirmation → `{t('signup.confirmed', { name: identity?.name ?? '' })}`
- Session date label → `{t('session.date')}`
- Session datetime display → `{t('session.when', { date: new Date(session.datetime) })}`
- Roster count display → `{t('roster.count', { count: activeCount })}`

If the existing HomeTab rendering has additional decorations around these strings (icons, classes, conditionals), preserve them — swap only the text content.

- [ ] **Step 4: Run tests and smoke-check**

Run: `npm test`
Expected: all tests pass.

Run: `npm run dev` and visit `http://localhost:3000/bpm`. Confirm:
- The `EN | 中文` segment appears inline on Home.
- Tapping `中文` changes all canary strings to Chinese without a full page reload.
- Tapping `EN` reverts. Cookie persists across refresh.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add components/HomeTab.tsx
git commit -m "$(cat <<'EOF'
feat: wire HomeTab canary strings and render LanguageToggle inline

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Parametric canary-strings test (all 10 keys × both locales)

**Files:**
- Create: `__tests__/i18n/canary-strings.test.tsx`

- [ ] **Step 1: Write the parametric test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

const CANARY_KEYS = [
  'home.signup.button',
  'home.signup.waitlist',
  'home.signup.full',
  'home.signup.confirmed',
  'home.cost.label',
  'home.cost.emphasis',
  'home.session.date',
  'home.session.when',
  'home.roster.count',
  'home.payment.reminder',
] as const;

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

describe('canary messages — all 10 keys exist in both locales', () => {
  it.each(CANARY_KEYS)('en.json defines %s', (key) => {
    expect(typeof getByPath(enMessages, key)).toBe('string');
  });

  it.each(CANARY_KEYS)('zh-CN.json defines %s', (key) => {
    expect(typeof getByPath(zhMessages, key)).toBe('string');
  });

  it('zh-CN strings differ from English (proves the pipe is swapping content)', () => {
    for (const key of CANARY_KEYS) {
      const en = getByPath(enMessages, key);
      const zh = getByPath(zhMessages, key);
      expect(zh, `key ${key}`).not.toBe(en);
    }
  });
});

// Render a minimal scratch consumer to prove useTranslations returns the right
// strings under both locales.
function Scratch({ k }: { k: string }) {
  const parts = k.split('.');
  const namespace = parts.slice(0, -1).join('.');
  const leaf = parts[parts.length - 1]!;
  const t = useTranslations(namespace);
  // Use default-safe args so interpolated keys still render non-empty text.
  const text = t(leaf, { name: 'Kevin', count: 3, amount: '$10.00', date: new Date('2026-04-13'), value: '40.00' });
  return <span data-testid="out">{text}</span>;
}

describe('canary render in both locales', () => {
  afterEach(cleanup);

  it.each(CANARY_KEYS.filter((k) => k !== 'home.cost.emphasis'))(
    'renders %s in en',
    (key) => {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Scratch k={key} />
        </NextIntlClientProvider>,
      );
      const text = screen.getByTestId('out').textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
    },
  );

  it.each(CANARY_KEYS.filter((k) => k !== 'home.cost.emphasis'))(
    'renders %s in zh-CN',
    (key) => {
      render(
        <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
          <Scratch k={key} />
        </NextIntlClientProvider>,
      );
      const text = screen.getByTestId('out').textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
    },
  );
});
```

Note: `home.cost.emphasis` is excluded from the render pass because it uses `t.rich` (JSX interpolation), which requires a different call signature. It is covered in Task 10 Step 2 below.

- [ ] **Step 2: Add a rich-text case for cost.emphasis**

Append to the same file:

```tsx
function ScratchRich() {
  const t = useTranslations('home.cost');
  return (
    <span data-testid="rich">
      {t.rich('emphasis', {
        value: '40.00',
        amount: (chunks) => <strong>{chunks}</strong>,
      })}
    </span>
  );
}

describe('canary rich text (home.cost.emphasis)', () => {
  afterEach(cleanup);

  it('renders <amount> as a <strong> in en', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ScratchRich />
      </NextIntlClientProvider>,
    );
    const strong = screen.getByTestId('rich').querySelector('strong');
    expect(strong?.textContent).toBe('40.00');
  });

  it('renders <amount> as a <strong> in zh-CN', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <ScratchRich />
      </NextIntlClientProvider>,
    );
    const strong = screen.getByTestId('rich').querySelector('strong');
    expect(strong?.textContent).toBe('40.00');
  });
});
```

- [ ] **Step 3: Run**

Run: `npx vitest run __tests__/i18n/canary-strings.test.tsx`
Expected: all tests pass (~24 assertions).

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add __tests__/i18n/canary-strings.test.tsx
git commit -m "$(cat <<'EOF'
test: add parametric canary-strings test across all 10 keys

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Plural test (canary key #7)

**Files:**
- Create: `__tests__/i18n/plural.test.tsx`

- [ ] **Step 1: Write the plural test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

function Roster({ count }: { count: number }) {
  const t = useTranslations('home.roster');
  return <span data-testid="roster">{t('count', { count })}</span>;
}

describe('home.roster.count — plural rules per locale', () => {
  afterEach(cleanup);

  it.each([
    [0, 'No players yet'],
    [1, '1 player signed up'],
    [5, '5 players signed up'],
  ])('en count=%i renders "%s"', (count, expected) => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Roster count={count} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('roster').textContent).toBe(expected);
  });

  it.each([
    [1, '1 人已报名'],
    [5, '5 人已报名'],
  ])('zh-CN count=%i renders "%s" (no plural variation)', (count, expected) => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <Roster count={count} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('roster').textContent).toBe(expected);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run __tests__/i18n/plural.test.tsx`
Expected: 5 tests pass.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/i18n/plural.test.tsx
git commit -m "$(cat <<'EOF'
test: add plural-rules test for home.roster.count

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Fallback test (English backup for missing zh-CN keys)

**Files:**
- Create: `__tests__/i18n/fallback.test.tsx`

- [ ] **Step 1: Write the fallback test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

// Simulate the deep-merge behavior that i18n/request.ts applies server-side:
// zh-CN messages override English, but missing keys fall through to English.
function mergedZh() {
  const base = JSON.parse(JSON.stringify(enMessages));
  // Delete a key from the zh-CN branch to simulate a missing translation.
  const partialZh = JSON.parse(JSON.stringify(zhMessages));
  delete (partialZh as { home: { signup: { button?: string } } }).home.signup.button;
  function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...a };
    for (const k of Object.keys(b)) {
      const av = out[k];
      const bv = b[k];
      if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(bv)) {
        out[k] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>);
      } else {
        out[k] = bv;
      }
    }
    return out;
  }
  return deepMerge(base, partialZh);
}

function SignupLabel() {
  const t = useTranslations('home.signup');
  return <span data-testid="label">{t('button')}</span>;
}

describe('locale fallback — missing zh-CN key falls back to English', () => {
  afterEach(cleanup);

  it('renders the English string when zh-CN key is absent', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={mergedZh()}>
        <SignupLabel />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('Sign Up');
  });

  it('renders the zh-CN string when present (sanity check)', () => {
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <SignupLabel />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('报名');
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run __tests__/i18n/fallback.test.tsx`
Expected: 2 tests pass.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/i18n/fallback.test.tsx
git commit -m "$(cat <<'EOF'
test: add English fallback test for missing zh-CN keys

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Update CLAUDE.md with i18n gotchas

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append i18n gotchas**

In `CLAUDE.md` under the `## Gotchas` section, add these bullets at the bottom of the list:

```markdown
- **i18n is cookie-based, not URL-based**: `NEXT_LOCALE` cookie drives the locale. `middleware.ts` sets it on first visit from `Accept-Language`; `LanguageToggle` writes it on tap. Cookie `path` must be `/bpm` (matches `basePath`) — not `/`.
- **Server reads cookie, client writes cookie**: never use `navigator.language` or `localStorage` for locale — it will desync server and client and cause hydration mismatches. Always go through `useLocale()` on client and `getLocale()` on server.
- **Missing translation keys fall back to English**: `i18n/request.ts` deep-merges `messages/en.json` under the active locale, so a missing `zh-CN` key renders the English string rather than throwing. Do not rely on throwing behavior for "missing translation" detection — use the `canary-strings.test.tsx` assertion pattern.
- **Rich-text strings use `t.rich`, not `t`**: any message containing `<tag>...</tag>` must be rendered via `t.rich('key', { tag: (chunks) => <Component>{chunks}</Component> })`. Using plain `t()` on a rich-text key prints the raw `<tag>` characters.
- **Component tests need a provider wrapper**: components that call `useTranslations()` must be rendered inside `<NextIntlClientProvider locale="en" messages={enMessages}>` in tests, or they throw "No intl context found". See `__tests__/components/CostCard.test.tsx` for the pattern.
```

- [ ] **Step 2: Run the full suite one last time**

Run: `npm test`
Expected: all tests pass. Record the total count for the commit message (should be ~115).

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: add i18n gotchas to CLAUDE.md for C1 architecture

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan checklist (before PR)

- [ ] All 13 tasks committed.
- [ ] `npm test` green (~115 tests).
- [ ] `npm run build` succeeds locally.
- [ ] Manual smoke: visit `/bpm`, tap `中文`, verify strings swap, verify cookie persists across refresh, verify A1 splash still shows on hard reload.
- [ ] `messages/README.md` notes that zh-CN is a first-pass translation pending native-speaker review.
- [ ] Open PR titled `feat: add i18n framework + zh-CN canary (C1)` with spec + plan linked in body.
