# C1 — i18n Framework + Canary (Design Spec)

**Date:** 2026-04-13
**Roadmap item:** P1.5 Session C1 (precedes C2 content sweep)
**Status:** Design approved; awaiting plan

---

## 1. Purpose

Stand up a localization pipeline so that UI strings can be rendered in English or Simplified Chinese (`zh-CN`), driven by a user-controlled toggle with first-visit auto-detection. Prove the pipeline end-to-end on the Home tab with ~10 canary strings that exercise every mechanism C2 will need (static, interpolation, plural, date formatting, rich text).

C1 does **not** translate the whole app. It delivers the framework and a small, representative slice of translated content. C2 will extract remaining strings and complete zh-CN, then add zh-TW.

## 2. Goals

- Chinese-primary players land on the app in Chinese on first visit (via `Accept-Language`).
- Any user can switch language inline on Home in one tap and have the change persist across visits.
- Locale swap preserves client state (in-progress form fields, active tab, scroll position).
- The pipeline exercises plurals, interpolation, date formatting, and rich text — so C2 is purely content-add, not framework-add.
- All existing 97 tests stay green; 6 new test files prove the canary.

## 3. Non-goals

- Translating admin tab, sign-ups roster, skills tab, or error responses from API routes (all deferred to C2).
- Translating admin-authored announcement content (separate session, uses `/api/claude`).
- URL-based locale routing (`/bpm/zh-CN/...`). App is a single-page private tool; bookmarkable locale URLs add file-restructure cost without user benefit.
- Traditional Chinese (`zh-TW`) — mechanical follow-up in C2.
- Date/time formatting beyond what next-intl provides out of the box (already locale-aware).

## 4. Locked decisions (from brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Library | `next-intl` v4 | Built for Next.js App Router; ICU MessageFormat (plurals, dates, rich text) covers C2 needs without custom glue. Growth ceiling exceeds anything we'd realistically build custom. |
| Routing mode | No URL routing (cookie-based) | Single-page app; no SEO/share-link need. Saves file restructure. |
| Toggle placement | Inline `EN \| 中文` segment on Home tab | Option self-visible in its own script (accessibility for Chinese-primary users). One-tap, reuses existing `.segment-control` CSS. |
| Canary bundle | Mixed (10 strings): static + interpolation + plural + date + rich text | De-risks every mechanism C2 will use; failure mode is obvious at the canary stage, not during bulk extraction. |

## 5. Architecture

```
Request time (Server)
  ├─ middleware.ts
  │    • If NEXT_LOCALE cookie absent, detect from Accept-Language,
  │      set cookie (path=/bpm, max-age=1yr, SameSite=Lax, Secure in prod)
  │
  └─ i18n/request.ts (getRequestConfig)
       • Read NEXT_LOCALE cookie
       • Validate against SUPPORTED_LOCALES = ['en', 'zh-CN']; coerce invalid → 'en'
       • Import messages/{locale}.json
       • Merge with messages/en.json as base → English fallback for missing keys
       • Return { locale, messages }

Provider (Root)
  └─ app/layout.tsx
       • getLocale() + getMessages() (server)
       • <NextIntlClientProvider locale={...} messages={...}>

Consumers (Client components)
  ├─ HomeTab, CostCard, PrevPaymentReminder
  │    • const t = useTranslations('home'); t('signup.button')
  │
  └─ LanguageToggle (new)
       • Reads current locale via useLocale()
       • onClick → document.cookie = "NEXT_LOCALE={next}; path=/bpm; ..."
       • router.refresh() — re-render server components with new cookie
```

**Principles:**

- **Server-first locale resolution.** Initial HTML arrives translated; no flash of English.
- **Cookie is the single source of truth.** Server reads, client writes. No localStorage for locale (would create SSR/CSR drift).
- **Messages are bundled, not fetched.** Small files, simple imports, no runtime fetch.
- **API routes untouched.** i18n is a UI concern; API returns error codes that the UI maps to translated strings.
- **No impact on `badminton_identity` or `badminton_theme`.** Those stay in localStorage.

## 6. File structure

```
/
├── i18n/
│   └── request.ts              [NEW]
├── messages/
│   ├── en.json                 [NEW]  source of truth, ~10 keys for canary
│   └── zh-CN.json              [NEW]  canary keys only; TRANSLATION_TBD comments
├── middleware.ts               [NEW]  first-visit Accept-Language → cookie
├── next.config.js              [MODIFIED]  wrap with createNextIntlPlugin()
├── app/
│   ├── layout.tsx              [MODIFIED]  + <NextIntlClientProvider>
│   │                                        (preserve the A1 cold-start splash —
│   │                                         pure HTML in server body, unaffected
│   │                                         by wrapping children in provider)
│   └── page.tsx                [unchanged]
├── components/
│   ├── LanguageToggle.tsx      [NEW]  inline EN | 中文 segment
│   ├── HomeTab.tsx             [MODIFIED]  render <LanguageToggle />; wire ~8 strings
│   ├── CostCard.tsx            [MODIFIED]  1 string via useTranslations()
│   └── PrevPaymentReminder.tsx [MODIFIED]  1 interpolation string
└── __tests__/
    ├── components/
    │   └── LanguageToggle.test.tsx   [NEW]
    └── i18n/
        ├── request-config.test.ts    [NEW]
        ├── fallback.test.tsx         [NEW]
        ├── canary-strings.test.tsx   [NEW]
        ├── plural.test.tsx           [NEW]
        └── middleware.test.ts        [NEW]
```

### New dependencies
- `next-intl` (latest v4)
- `@formatjs/intl-localematcher` (used by middleware for Accept-Language matching; pulled in transitively by next-intl but pinning explicit)

## 7. Data flow

### First visit (no cookie)
1. Browser → `GET /bpm`
2. `middleware.ts` runs: no `NEXT_LOCALE` cookie → reads `Accept-Language` → matches against `['en', 'zh-CN']` via `@formatjs/intl-localematcher` → `Set-Cookie: NEXT_LOCALE=zh-CN; path=/bpm; max-age=31536000; SameSite=Lax`
3. `i18n/request.ts` reads cookie → `'zh-CN'` → imports `messages/zh-CN.json` merged over `messages/en.json`
4. `app/layout.tsx` wraps children in `<NextIntlClientProvider>`
5. Initial HTML arrives in Chinese. No client flash.

### Return visit (cookie present)
1. Middleware sees cookie → no-op.
2. Same path through `i18n/request.ts`.

### User taps language toggle
1. `LanguageToggle` writes new cookie on `document.cookie` with same attributes.
2. Calls `router.refresh()` → Next re-runs server components with new cookie.
3. New messages stream down → React reconciles → strings swap.
4. Client state (active tab, form inputs, scroll) preserved — `router.refresh()` does not remount client components.

### Cookie attributes
- `Name:` `NEXT_LOCALE`
- `Path:` `/bpm` (must match `basePath`; not `/`, which would leak to co-tenants on the Azure host)
- `Max-Age:` `31536000` (1 year)
- `SameSite:` `Lax`
- `Secure:` set only when `process.env.NODE_ENV === 'production'` (localhost dev is HTTP)

## 8. Canary strings (10 total)

All keys live under the `home.` namespace. Chinese translations are first-pass, marked `// TRANSLATION_TBD` for native-speaker review before C2.

| # | Key | Mechanism | English | zh-CN (first pass) | Consumer component |
|---|---|---|---|---|---|
| 1 | `home.signup.button` | Static | `Sign Up` | `报名` | HomeTab |
| 2 | `home.signup.waitlist` | Static | `Join Waitlist` | `加入候补` | HomeTab |
| 3 | `home.signup.full` | Static | `Session Full` | `名额已满` | HomeTab |
| 4 | `home.cost.label` | Static | `Cost per person` | `每人费用` | CostCard |
| 5 | `home.session.date` | Static | `Session date` | `活动日期` | HomeTab |
| 6 | `home.signup.confirmed` | Interpolation | `Signed up as {name}` | `已报名：{name}` | HomeTab |
| 7 | `home.roster.count` | Plural (ICU) | `{count, plural, =0 {No players yet} one {# player signed up} other {# players signed up}}` | `{count, plural, other {# 人已报名}}` | HomeTab |
| 8 | `home.session.when` | Date formatting | `Session on {date, date, long}` | `活动时间：{date, date, long}` | HomeTab |
| 9 | `home.cost.emphasis` | Rich text (`<Trans>`-style tag) | `Cost this week: <amount>{value}</amount>` | `本周费用：<amount>{value}</amount>` | CostCard |
| 10 | `home.payment.reminder` | Multi-var interpolation | `You owe {amount} from {date}` | `您还欠 {amount}（{date}）` | PrevPaymentReminder |

**Why these ten:** each mechanism that C2 will need is proven by one key. If the canary is green in both locales, C2 is pure content-add with zero framework changes.

**Out-of-scope for C1:**
- Admin tab (Kevin is bilingual per research)
- Sign-Ups tab, Skills tab
- Error messages from `app/api/*` responses
- Announcement body (admin-authored)

## 9. Error handling & edge cases

| Case | Behavior |
|---|---|
| Missing key in active locale | English fallback via merged-messages object. No throw. Dev logs a warning. |
| Invalid cookie value (e.g., `fr`) | `i18n/request.ts` coerces to `'en'`; middleware overwrites cookie on next response. |
| `Accept-Language: fr-FR` on first visit | Matcher returns default `'en'`. Cookie set to `'en'`. |
| JS-disabled client | Cookie is set by middleware; server renders correct locale. Toggle is non-functional but content is readable. Acceptable for a private invite app. |
| Hydration mismatch risk | Server and client read from the same cookie; no `navigator.language` used client-side. |
| `router.refresh()` during form input | Client component state preserved (refresh contract). Sign-up form survives. |
| Cookie write blocked (private browsing) | Silent failure; next request re-detects from `Accept-Language`. Identical UX. |
| Malformed `messages/*.json` | Build fails. Preferred over silent runtime breakage. |
| Cookie `path` mismatch | Explicitly `/bpm` everywhere (middleware, toggle) to match `basePath`. |

## 10. Testing

Six new test files, ~15 cases total. All use the in-memory mock store; i18n does not touch Cosmos.

- **`__tests__/components/LanguageToggle.test.tsx`** — renders both tabs; click flips cookie + calls `router.refresh()`; survives cookie-write failure.
- **`__tests__/i18n/request-config.test.ts`** — cookie round-trip, invalid-value coercion, Accept-Language detection, unknown-locale fallback.
- **`__tests__/i18n/fallback.test.tsx`** — deleted zh-CN key renders English fallback.
- **`__tests__/i18n/canary-strings.test.tsx`** — all 10 keys render in both locales; parametrized.
- **`__tests__/i18n/plural.test.tsx`** — English `count={0,1,5}` vs. Chinese `count={1,5}` ensures ICU rules are per-locale, not shared.
- **`__tests__/i18n/middleware.test.ts`** — first-visit cookie set; return-visit no-op.

**Not tested (deliberate):**
- Translation quality itself — machine can't evaluate; deferred to native-speaker review before C2.
- Toggle visual styling — covered by existing `.segment-control` CSS.
- Exhaustive browser-matching behavior — `@formatjs/intl-localematcher` has its own test suite.

**Test count:** main `97` → post-C1 `~112`.

## 11. Rollout

C1 is a single PR. No feature flag.

- Merge triggers deploy via existing GitHub Actions → Azure B1 OIDC pipeline.
- First user with `Accept-Language: zh-CN` on next visit lands in Chinese.
- Everyone else lands in English (no visible change from today).
- If a string shows `home.signup.button` instead of `Sign Up` after deploy, the fallback is broken — revert PR; no data migration to undo.

## 12. Out-of-scope / follow-up (C2 and beyond)

- **C2 — content sweep:** extract remaining ~110 strings from all tabs, finalize zh-CN, add zh-TW as mechanical follow-up.
- **Announcement translation (future):** admin-authored English announcements auto-translated to Chinese via `/api/claude`. Separate session.
- **Admin locale-preference override:** admin-set default locale for new users (currently relies on `Accept-Language`). Not needed until user demand appears.
- **Locale-aware number/currency formatting beyond ICU defaults:** cost values stay `$X.XX` for both locales unless research surfaces a need.
