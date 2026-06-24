# Figma → Code Integration Rules (MCP)

> Rules for translating Figma designs into this codebase via the Figma MCP.
> The golden rule: **this app already has a complete, opinionated design
> system. Map Figma output onto it — never introduce raw hex/px or hand-rolled
> markup.** Generated code that uses literal colors or radii will fail the
> ESLint token guardrail (see §8).
>
> Authoritative sources (in priority order):
> 1. `app/globals.css` — the **single source of truth** for all design tokens.
> 2. `components/primitives/` — the canonical building blocks.
> 3. `CLAUDE.md` → "Design System" + "Inner-content reference" sections — the prose spec.
> 4. `docs/design-system/` — frozen reference bundle (specimens, never imported).

---

## 1. Token Definitions

**Where:** `app/globals.css`, in the `:root { … }` block (dark mode, the
default) with a parallel `[data-theme="light"] { … }` override block. Tailwind's
config does **not** hold the tokens — only a tiny `colors`/`fontSize` extend
(`tailwind.config.js`). Treat CSS custom properties as the token layer.

**Format:** plain CSS custom properties. No Style Dictionary / token-transform
pipeline — the `:root` block *is* the compiled output. Theming is runtime via
`data-theme` on `<html>`.

### The scales (use these names, never raw values)

| Scale | Token | Values | Figma maps from |
|---|---|---|---|
| **Type size** | `--fs-2xs … --fs-lg` | 10 / 11 / 12 / 13 / 14 / 16 px | font size |
| **Line height** | `--lh-tight/snug/normal` | 1.25 / 1.35 / 1.5 | line height |
| **Spacing (inline)** | `--space-1 … --space-6` | 4 / 6 / 8 / 12 / 16 / 20 px | padding / gap |
| **Radius** | `--radius-xs … -xl`, `--radius-pill` | 6 / 8 / 10 / 12 / 16 / **100** px | corner radius |
| **Severity text** | `--sev-crit/high/med/low/good-text` | semantic reds→greens | status colors |

**Hard rule — radius ladder:** rectangular surfaces cap at **16px**
(`--radius-xl`). Only pills use `--radius-pill` (100). A Figma corner radius of
e.g. 20px must be snapped down to 16, not honored literally.

### Color & surface tokens

```css
/* app/globals.css :root */
--page-bg: #100F0F;
--text-primary:   #e2e8f0;            /* primary copy */
--text-secondary: rgba(255,255,255,0.7);
--text-muted:     rgba(255,255,255,0.55);  /* helper / muted lines */
--accent: #4ade80;                    /* brand green — the ONE accent */
--accent-amber: #fbbf24;
/* Glass surface (the brand aesthetic) */
--glass-bg / --glass-border / --glass-shadow / --glass-blur (10px)
```

### How generated code references tokens

```tsx
// ✅ inline style → var()
<p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)' }}>…</p>
// ✅ or the size-only utility class
<p className="fs-sm">…</p>
// ✅ radius
<div style={{ borderRadius: 'var(--radius-lg)' }} />
// ❌ NEVER  fontSize: 14 / color: '#9ca3af' / borderRadius: 12
```

Font-family tokens resolve through `next/font` CSS vars:
`--font-display` (Space Grotesk) · `--font-sans` (IBM Plex Sans, the body
default on `<body>`) · `--font-mono` (JetBrains Mono, for data: PINs, $, time).

---

## 2. Component Library

**Where:** `components/` (flat, feature components) + four subfolders:
`primitives/`, `stats/`, `admin/`, `home/`, plus `BottomSheet/`.

**Architecture:** React function components, **PascalCase file = default
export**. No class components. Composition is built on a small set of
**primitives** that bake the spec in so it can't drift — *prefer these over
hand-rolling layout when translating a Figma frame:*

| Primitive (`components/primitives/`) | What it is — the Figma element it absorbs |
|---|---|
| `CardHeader` | icon(22/accent) + `bpm-h3` title + `--fs-sm` subtitle + trailing badge/action row atop a `.glass-card` |
| `StatusBadge` | the uppercase pill (Live / Beta / "Coming soon" / phase) |
| `ListRow` | structural row (renders a `cc-mini-card` button when `onClick` set) |
| `ErrorState` / `EmptyState` | the legible-fail surfaces (keep distinct — a loaded-empty card must not look like a failure) |
| `PageHeader` / `TopBar` | page title + scroll-condense behavior (`useScrollCondensed`) |
| `StatusBanner` / `ConfirmInline` | inline banners + inline confirm |
| `BottomSheet/` | the canonical sheet/drawer (portal, scroll-lock, focus-trap, Esc, 180ms anim) |

**Canonical pattern** (`components/primitives/CardHeader.tsx`) — note: icon via
`.material-icons`, title via `.bpm-h3`, subtitle via `.fs-sm` + `--text-muted`:

```tsx
<CardHeader icon="trending_up" title="Your Attendance" subtitle="Sessions played" badge={<StatusBadge variant="accent">Beta</StatusBadge>} />
```

**No Storybook.** The live, drift-proof preview is the flag-gated route
**`/bpm/design`** (7 sub-pages; `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`), backed by
`app/design/`. Static specimens live in `docs/design-system/` (reference only —
**never import them**; importing `colors_and_type.css` shadows the live tokens).

---

## 3. Frameworks & Libraries

- **Framework:** Next.js 16 (App Router) with **Turbopack**. React 18. TypeScript.
- **The app is a single browser route** — `app/page.tsx` (async server
  component) → `<HomeShell>` (the `'use client'` boundary owning tabs/identity).
  New UI is a tab/card inside this shell, not a new route.
- **Styling:** Tailwind CSS 3 + named classes in `globals.css`. See §6.
- **i18n:** `next-intl`, cookie-based (`NEXT_LOCALE`). All user-facing strings
  go through `useTranslations()` and live in `messages/en.json` + `messages/zh-CN.json`.
  **Figma copy must become an i18n key, not a hardcoded string.**
- **Charts:** `recharts` (loaded via `dynamic(… { ssr:false })` — needs `window`).
- **Build:** `next build`; tests `vitest run`; lint `eslint .`.

---

## 4. Asset Management

- **Static assets:** `public/` (served at `/bpm/...` via `basePath`).
- **Fonts:** self-hosted WOFF2 subsets in `app/fonts/`, loaded with
  `next/font/local` in `app/layout.tsx` (Space Grotesk, IBM Plex Sans);
  JetBrains Mono via `next/font/google`. **No third-party font CDN at first
  paint.** `preload: false` on all three (avoids Turbopack HMR preload-desync).
- **No image CDN.** Next's standalone output drops `public/` — new asset dirs
  need a `cp -r` in both deploy workflows (see CLAUDE.md gotcha). Prefer
  inline SVG components (`ShuttleIcon.tsx`, `BpmWordmark.tsx`) over raster.
- Social/OG images are generated: `app/opengraph-image.tsx`, `app/icon.png`.

---

## 5. Icon System

- **Source:** Material Symbols Rounded, **subsetted** to the ~80 glyphs in use,
  loaded via a single `<link>` in `app/layout.tsx` with an explicit
  `&icon_names=add,arrow_back,…` query (≈15–20 KB vs ~100 KB full font).
- **Usage:** `<span className="material-icons" aria-hidden="true">glyph_name</span>`
  (the `.material-icons` class is aliased to Material Symbols Rounded in CSS).
- **Naming:** the literal Material Symbols glyph name (snake_case, e.g.
  `sports_tennis`, `trending_up`, `auto_fix_high`).
- **⚠️ Figma rule:** if a design uses an icon **not** in the `icon_names=` list,
  you MUST add the glyph to that URL in `layout.tsx` — otherwise it renders as
  raw text (e.g. `EXPAND_LESS`) instead of failing loud. Map Figma icons to the
  nearest existing glyph first; only extend the subset when there's no match.

---

## 6. Styling Approach

- **Methodology:** Tailwind utility classes **+** named component classes in
  `globals.css`. **No CSS Modules, no styled-components, no CSS-in-JS lib.**
  Shared/repeated patterns become a named class in `globals.css`; one-offs use
  Tailwind or inline `style` with `var(--token)`.
- **Key shared classes:** `.glass-card` (16px radius surface), `.cc-btn` family
  (`-primary/-secondary/-ghost/-danger`, `+ -lg`), `.cc-tile` / `.cc-mini-card`
  (stat tiles/rows), `.segment-control` (segmented tabs), `.section-label`
  (uppercase eyebrow), `.bpm-h1/h2/h3` (headlines, Space Grotesk), `.fs-*`
  (size-only utilities).
- **Theming:** `data-theme` attribute on `<html>` + CSS custom properties.
  Anything color/surface-related must be a token so light mode works for free.
- **Responsive:** **mobile-first**, target width ~**440px**. Hover styles are
  globally gated behind `@media (hover:hover)` (`hoverOnlyWhenSupported` in
  `tailwind.config.js`) — touch feedback uses `:active`, not `:hover`.
- **Backgrounds:** the `.court-bg` element (rendered once in `layout.tsx`) — a
  3-blob aurora by default, swapped to a court pattern on Sign-Ups via
  `html[data-tab="players"]`. Don't add per-component page backgrounds.

### Inner-content style roles (the "one true reference")

| Role | Token / class |
|---|---|
| Card container | `.glass-card`, pad **20px** (`p-5`); compact tiles pad 16px (`p-4`) |
| Card title | `.bpm-h3` (18px) via `<CardHeader>` |
| Card subtitle | `--fs-sm` (12px) |
| Primary body copy | `--fs-md` (14px), `--text-primary` |
| Muted helper | 12px, `--text-muted` |
| Section label | `.section-label` / `--fs-2xs` (10–11px), 700 display |
| Inner rows / tiles | 12px radius (`--radius-lg`) + 12px padding |

---

## 7. Project Structure

```
app/            # Next App Router. SINGLE browser route (page.tsx → HomeShell) +
  api/          #   route handlers (GET/POST/PATCH/DELETE)
  design/       #   /bpm/design preview (flag-gated)
  fonts/        #   self-hosted WOFF2 subsets
  globals.css   #   ★ token source of truth + all shared classes
  layout.tsx    #   fonts, icon subset, court-bg, splash, i18n provider
components/      # PascalCase, default export
  primitives/   #   ★ composition building blocks (use these first)
  stats/ admin/ home/ BottomSheet/
lib/            # camelCase. Server + client helpers (flags.ts, identity.ts, …)
messages/       # en.json, zh-CN.json (i18n — all user-facing copy)
i18n/           # next-intl request config (locale, timezone)
docs/design-system/  # frozen reference bundle (never imported)
```

**Feature organization:** a new UI feature is a card/component under
`components/` (or a subfolder), wired into a tab in `HomeShell`/`SkillsTab`/etc.
Flag-gate unfinished work via `isFlagOn('NEXT_PUBLIC_FLAG_…')` from `lib/flags.ts`.

---

## 8. Figma MCP translation checklist (do this every time)

1. **Tokens, not literals.** Every color → a `--text-*` / `--accent` / `--sev-*`
   token; every size → `--fs-*`; every radius → `--radius-*` (cap 16); every
   pad/gap → `--space-*` or a Tailwind `p-*`/`gap-*`. **The ESLint guardrail
   (`eslint.config.mjs`) errors on bare hex and raw inline `borderRadius`** —
   app-wide `warn`, but `error` in cleared areas like `components/stats`. The
   `var(--accent, #22c55e)` fallback form is allowed (hex is inside `var()`).
2. **Reuse primitives.** A card header → `<CardHeader>`. A status pill →
   `<StatusBadge>`. A row → `<ListRow>`. A sheet → `<BottomSheet>`. An empty/
   error surface → `<EmptyState>`/`<ErrorState>`. Don't regenerate their markup.
3. **Glass aesthetic.** Surfaces are `.glass-card`, not opaque cards. Buttons are
   the `cc-btn` family. Inputs inherit the glass input styles inside `.glass-card`.
4. **Copy → i18n.** Text becomes a key in `messages/en.json` (+ `zh-CN.json`),
   rendered via `useTranslations()`. Rich text uses `t.rich`.
5. **Icons → Material Symbols.** Map to an existing glyph; extend the
   `icon_names=` subset in `layout.tsx` only if there's no match.
6. **Mobile-first ~440px**, light + dark must both work (so: tokens), hover
   gated, `:active` for touch.
7. **New shared pattern?** If a genuinely new pattern is needed, name the
   principle and define it as a class/token in `globals.css` **before** using it
   inline — don't invent ad-hoc values.
