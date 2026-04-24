# Translation files

- `en.json` — source of truth. All keys must exist here.
- `zh-CN.json` — Simplified Chinese. Missing keys fall back to English at runtime via `i18n/request.ts`'s deep-merge.

## Status

Content sweep complete: **C1 canary** (PR foundation, 2026-04-13) → **C2 content sweep** (PR #10, 2026-04-17) → **C3 date localization** (PR #11, 2026-04-17).

All player-facing surfaces (BottomNav, HomeTab, PlayersTab, banners, section labels, 7 sign-up states) are localized. Dates and times render via `next-intl`'s `useFormatter` with `timeZone: 'America/Vancouver'` configured on both server and client.

## Remaining work

Native-speaker review pass on register and idiomatic phrasing:

- Register (formal vs. conversational) appropriate for a Chinese-Canadian recreational badminton group
- Measure words / numeric formatting match local convention
- Punctuation follows zh-CN norms (full-width `：` instead of `:`, etc.)
- Check that longer zh-CN strings don't overflow in the BottomNav pill (28px-min tab width)

## Adding a new locale

1. Create `messages/<locale>.json` with the same key tree as `en.json`
2. Add the locale to `i18n/request.ts`'s `locales` allowlist
3. Update the `<LanguageToggle />` if the locale needs a visible switcher button
4. Run `npm test` — the i18n parity test will flag any missing keys
