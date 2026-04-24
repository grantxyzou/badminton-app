# BPM Badminton — Design System

A mobile-first, glass-morphism design system for **BPM Badminton**, a Next.js 16 app that manages a casual weekly badminton club: sign-ups, waitlist, payment tracking, ACE Skills Matrix, and AI-polished announcements.

## Source

This system was extracted from the live codebase:

- **Repo**: `grantxyzou/badminton-app` (default branch `main`)
- **Live**: `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm`
- **Anchor files**:
  - `app/globals.css` — all CSS custom properties, glass-card, buttons, nav, banners, animations
  - `app/layout.tsx` — root shell (aurora background + cold-start splash)
  - `app/page.tsx` — tab container
  - `tailwind.config.js` — brand colors + the text-size accessibility bump
  - `DESIGN.md` — design principles (mobile-first, thumb zone, materials simplify inward, glass > flat)
  - `components/HomeTab.tsx`, `BottomNav.tsx`, `PlayersTab.tsx`, `SkillsTab.tsx`, `ShuttleLoader.tsx`
  - `messages/en.json` — copy voice + exact strings

## Product surfaces

There is **one product**, a mobile-first PWA with 4 tabs:

| Tab | What it is |
|-----|-----------|
| **Home** | Location + date tile row, cost card, announcement, 7-state sign-up card, previous-session payment reminder |
| **Sign-Ups** | Active player list (numbered, "(you)" self-highlight, self-cancel) + waitlist card |
| **Learn / Skills** | Admin: ACE Skills Matrix radar chart (7 dimensions × 6 levels). Public: "Progress together?" placeholder |
| **Admin** | PIN-gated (HTTP-only cookie). Hidden by default; revealed via member role or 5-tap easter-egg on the title |

All views render inside a `max-w-lg` column, centered on wider screens, over a breathing aurora background with three blurred gradient blobs.

---

## Index

```
README.md                     ← this file
SKILL.md                      ← Agent-Skills compatible manifest
colors_and_type.css           ← all CSS custom properties (dark + light)

assets/
  bpm-logo.svg                ← "BPM" wordmark + shuttlecock glyph
  shuttlecock.svg             ← brand glyph, standalone
  aurora-bg.css-snippet       ← the three blurred blobs

preview/
  01-colors-primary.html      ← Design System tab cards (all tagged "Colors", "Type",
  02-colors-semantic.html       "Spacing", "Components", "Brand")
  03-colors-glass-dark.html
  04-colors-glass-light.html
  05-type-scale.html
  06-type-specimen.html
  07-type-section-label.html
  08-radii.html
  09-shadows.html
  10-spacing.html
  11-motion.html
  12-button-primary.html
  13-button-ghost.html
  14-glass-card.html
  15-status-banners.html
  16-pills.html
  17-inputs.html
  18-segment-control.html
  19-bottom-nav.html
  20-shuttle-loader.html
  21-logo.html
  22-aurora-bg.html
  23-material-icons.html

ui_kits/
  bpm-app/
    README.md                 ← kit overview + file list
    index.html                ← interactive click-thru prototype
    components.jsx            ← shared cosmetic components (GlassCard, BottomNav, etc.)
    home.jsx                  ← Home tab
    signups.jsx               ← Sign-Ups tab + Learn tab
```

---

## Content fundamentals

The voice is **friendly, direct, and pragmatic** — the same tone a neighborhood organizer uses when they know most of the people in the group by name.

- **Sentence case** everywhere. No Title Case buttons. "Sign Up", "Join Waitlist", "View Sign Up List" are the only two-word Title Case exceptions, and both are verb-noun CTAs.
- **Second person, low-stakes.** Copy says "your share", "your name", "you're on the waitlist" — never "users", "participants", "members" in customer-facing copy.
- **First person for the player's voice.** The invite error reads "We don't have \"{name}\" on our invite list" — the app speaks as the organizer, not an abstract system.
- **Low-stakes em-dashes instead of colons.** "Sign-ups closed", "Session Full", "Last session (Thursday, April 9) · $8.50/person" — a center dot separates paired facts rather than making a list.
- **Times are long and explicit.** "Thursday, April 18" not "Apr 18". Weekday first, then month and day. (`DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' }`)
- **Money shows a tilde when estimated.** `~$8.50` — admin edits change it live, so it never pretends to be exact.
- **Emoji is allowed but scoped to the Welcome card.** 📅 🎟️ 💵 sit next to one-liners for first-time visitors. That's it. No emoji in buttons, nav, announcements, errors, or elsewhere.
- **Ellipses live inside quotes.** "Signing up…", "Joining…", "…" on a disabled button.
- **Errors are human.** "Enter your name to sign up" not "Name is required". "Network error. Please try again." not "Fetch failed with code 0".
- **Copy examples from the live app:**
  - Heading: "Sign up"
  - Primary CTA: "Sign Up" / "Join Waitlist"
  - Status banner (signed up): "{name}, thank you for signing up!" → "See you soon!"
  - Status banner (full): "All 12 spots are taken."
  - Section label: "UPCOMING SESSION", "WAITLIST", "ADD PLAYER" (uppercase tracking-widest)
  - Payment reminder: "Last session (Thursday, April 9) · $8.50/person"
  - Release-notes terminal: `$ bpm --changelog`, `▸ 0.4.0 · Apr 16, 2026`

---

## Visual foundations

### Color
- **One brand accent, two modes.** `#4ade80` court-green on `#100F0F` near-black (dark), `#16a34a` court-green on `#FAF8F5` warm cream (light). Chosen for luminance contrast against the background, not for decoration.
- **Semantic colors are Tailwind's 400-tier.** `amber-400` (waitlist), `orange-400` (full/warning), `red-400` (errors/PIN), `blue-400` (dates, info). Light-mode overrides push those down to 600-tier for contrast.
- **No third brand color.** Every other surface is glass — translucent white-on-dark or translucent-ink-on-cream.

### Type
- **System font stack.** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`. No web fonts loaded for body copy. Material Icons is the only web font.
- **Accessibility bump.** `text-xs` and `text-sm` are shifted up one step (12→14px, 14→16px) so readers 50+ don't pinch-zoom. Other sizes remain Tailwind defaults.
- **Page title is 30px bold.** `text-3xl font-bold`, left-aligned in the column, with 8px left padding so it visually aligns with the section-labels inside the glass cards.
- **Section labels, not dividers.** Uppercase 14px bold tracking-widest, colored `var(--accent)` for active sections and `var(--text-muted)` for passive. They split content instead of hard `<hr>` rules.
- **Monospace only in the release-notes terminal.** `SF Mono, Menlo, Consolas, 'Roboto Mono'`.

### Spacing
- `space-y-5` between cards in a tab (20px). `p-5` inside cards (20px). `p-4` for tile-row cards (16px). `gap-3` inside 2-column tile rows (12px). `rounded-3xl`-ish (24px) card corners.
- **Tile rows come in pairs.** Location + Date, not a single full-width tile.
- **Actions live at the bottom of their surface.** HomeTab's info-then-action order (Tiles → Cost → Announcement → Sign-Up → Payment reminder) is deliberate for one-handed thumb reach. The `BottomNav` is pinned to the viewport bottom (`fixed bottom-0`) with a safe-area inset for iOS home-indicator.

### Background & atmosphere
- **Aurora blobs, not a flat page.** Three gradient blobs (`aurora-blob-1/2/3`) sit fixed behind all content, each with its own `blur(100px)` and `mix-blend-mode`, each animating on a slightly different `breathe-gentle` / `exhale-drift` / `inhale-pulse` 5.5–7s loop.
- **Light-mode blobs use different blend modes** (`multiply` and `soft-light` instead of `darken` and `hard-light`) so they read as pastel washes rather than muddy darks.
- **No hand-drawn illustrations. No textures. No patterns.** The blobs are the only decoration — everything else is content-forward.

### Materials & surfaces
- **Everything is glass.** `.glass-card` is `backdrop-filter: blur(10px) saturate(140%)` over a `linear-gradient(160deg, 6% → 2%)` white tint, a 1px `rgba(white, 0.14)` border, `24px` radius, and a layered shadow: `inset 0 1px 0 white-14%` for the inner rim + `0 8px 40px black-25%` + `0 2px 8px black-12%` for depth.
- **Materials simplify inward** (see `DESIGN.md` #9). The outermost glass card has the full material; nested inputs flatten to transparent + border only; focus reinstates the full material. Enforced in `globals.css` via `.glass-card input, .glass-card select, .glass-card textarea`.
- **Hover state = lift, not fill.** `hover: translateY(-2px)` + heavier shadow. No color change, no background flash. Gated on `@media (hover: hover)` so it doesn't mis-fire on touch.
- **Active / press state = `scale(0.97)`** with 100ms transition. Buttons only. No color change on press.
- **Focus state = green ring.** `0 0 0 3px rgba(74, 222, 128, 0.10)` inside a slightly stronger `rgba(74, 222, 128, 0.45)` border. Visible — never suppressed.
- **Corner radii ladder:** 6px (tags) · 8px (inner cards, inputs) · 10px (buttons / nav pill) · 12px (banners, menus) · **16px (cards — max, used sparingly)** · pill (100px, segment control + nav-chips). Never exceed 16px on rectangular surfaces.

### Motion
- **Three easings, named for gesture.**
  - `--ease-glass` `cubic-bezier(0.23, 1, 0.32, 1)` — default, for anything glass
  - `--ease-spring` `cubic-bezier(0.34, 1.56, 0.64, 1)` — entries, slide-ups
  - `--ease-sheet` `cubic-bezier(0.16, 1, 0.3, 1)` — bottom-sheet open/close (180ms, matches iOS)
- **Named keyframes.** `breathe-gentle`, `exhale-drift`, `inhale-pulse` (aurora), `wave-smash` (loader), `shimmer`, `fadeIn`, `slideUp`, `slideInRight`, `scaleIn`.
- **`prefers-reduced-motion` kills everything.** Global `*, *::before, *::after` rule drops all animation and transition durations to 0.01ms.

### Transparency & blur
- Glass cards blur **10px (dark)** / **16px (light)** + saturate 140%.
- Bottom-sheet backdrop is `rgba(0, 0, 0, 0.5)` solid — not blurred.
- Dropdown menus are `rgba(30, 40, 30, 0.97)` + `blur(12px)` — almost opaque.
- Aurora blobs use `filter: blur(100px)` for the soft-pastel wash.

### Iconography
- **Google Material Icons — Rounded only.** Loaded once via `?family=Material+Icons+Round`. Soft warm corners match the glass-card radii and the brand's approachable tone. **Do not mix** Filled, Outlined, or Sharp weights into the same surface — it breaks visual rhythm. Use `<span class="material-icons-round">icon_name</span>`.
- **Brand shuttle is a first-class icon.** `assets/shuttlecock.svg` sits at the same visual weight and metrics as the Rounded Material glyphs. Reach for it wherever the UI refers to the sport itself (loaders, empty states, brand chrome) instead of Material's `sports_tennis` racquet.
- **Icons carry semantic color.** `text-green-400` for success, `text-amber-400` for waitlist/pending, `text-orange-400` for full/warning, `text-red-400` for errors, `text-blue-400` for dates, `text-gray-500` for empty/placeholder.
- **Sizing tokens.** `icon-xs` 13px, `icon-sm` 16px, `icon-md` 18px, `icon-lg` 24px, `icon-status` 22px, `icon-xl` 40px.
- **Used in practice** (from the codebase): `home`, `group`, `school`, `admin_panel_settings`, `check_circle`, `schedule`, `lock`, `lock_clock`, `hourglass_top`, `celebration`, `how_to_reg`, `close`, `light_mode`, `dark_mode`. Plus the brand shuttle.
- **No emoji in UI chrome.** Emoji appears only inside the Welcome card's three onboarding bullets. Don't introduce emoji in buttons, nav, banners, or status pills.
- **Buttons are text-only.** Never place an icon inside a button (primary or ghost). Verbs carry the meaning. Icons belong in nav tabs, status banners, section labels — not in CTAs.
- **No hand-drawn SVG in new work.** The shuttlecock glyph and BPM wordmark live in `assets/` — use them rather than redrawing.

---

## Quick usage

```html
<!-- Type pairing (Space Grotesk + JetBrains Mono) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Space Grotesk + IBM Plex Sans are self-hosted via @font-face in colors_and_type.css -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" />
<!-- Import the tokens -->
<link rel="stylesheet" href="colors_and_type.css" />
<!-- Icon font -->
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons&display=swap" />

<div class="court-bg">
  <div class="aurora-blob-1"></div>
  <div class="aurora-blob-2"></div>
  <div class="aurora-blob-3"></div>
</div>

<div class="max-w-lg mx-auto px-4 pt-6 space-y-5">
  <h1 class="bpm-h1">BPM Badminton</h1>
  <div class="glass-card p-5 space-y-2">
    <p class="bpm-section-label">UPCOMING SESSION</p>
    <p class="bpm-body">Thursday, April 18 · 7:00 PM</p>
  </div>
  <button class="btn-primary">
    <span class="material-icons icon-sm">how_to_reg</span>
    Sign Up
  </button>
</div>
```

Set the theme on `<html>`:
```html
<html data-theme="dark">   <!-- or "light" -->
```
