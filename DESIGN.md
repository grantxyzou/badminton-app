# Design System — Badminton Sign-Up App

This document describes the UI/UX design system for the Next.js badminton sign-up application. All details are derived directly from the source files (`globals.css`, `layout.tsx`, and the component files).

---

## 1. Visual Language

### Color Palette

| Token | Value | Usage |
|---|---|---|
| `--court-green` | `#4ade80` | Primary accent, icons, labels, focus rings |
| `--forest-900` | `#050f07` | Deepest forest shade (select option backgrounds) |
| `--forest-800` | `#0a1f0e` | Dark forest shade (select option backgrounds) |
| Primary background | `#100F0F` | Page and `.court-bg` base |
| Body text | `#e2e8f0` | Default text color |
| Muted text | `rgba(255,255,255,0.35)` | Inactive nav labels, placeholders, secondary copy |

### Accent Colors Used in Components

| Color | Hex | Usage |
|---|---|---|
| Court green | `#4ade80` | Active nav items, headings, icons, focus state, status banners |
| Blue | `#60a5fa` | Event/date icon (`event` Material Icon) |
| Purple | `#a78bfa` | Courts icon (`sports_tennis` Material Icon) |
| Orange-400 | `#fb923c` | "Session Full" count and text |
| Orange-300 | `#fdba74` | "Session Full" banner heading |
| Red-400 | `#f87171` | Error messages, PIN icon, cancel button |
| Gray-500 | `rgba(255,255,255,0.35)` approx | Timestamps, muted labels |

### Aesthetic

The app uses a **glass morphism** aesthetic throughout: frosted-glass cards and navbars with `backdrop-filter: blur()` and translucent gradient backgrounds layered over an animated aurora background and a faint badminton court SVG outline.

---

## 2. CSS Class Reference

All custom classes are defined in `app/globals.css`.

### `.court-bg`

The full-screen fixed background container that holds the aurora blobs and court SVG.

- `position: fixed; inset: 0; z-index: -1`
- `background: #100F0F`
- `overflow: hidden`

The child SVG is absolutely positioned, fills 100% of the container, and is scaled up by `transform: scale(1.7)` on mobile (below 768 px). At `min-width: 768px` the scale transform is removed.

### `.aurora-blob-1`

- `150vw` wide, `800px` tall, offset left by `-25vw`, top at `280px`
- `opacity: 0.5`
- `background: linear-gradient(180deg, #8FA2B0 0%, #1B324D 56%)`
- `filter: blur(100px)`
- Animated by `breathe-gentle` (6 s, ease-in-out, infinite)

### `.aurora-blob-2`

- `150vw` wide, `700px` tall, offset left by `-25vw`, top at `340px`
- `mix-blend-mode: darken`
- `background: linear-gradient(180deg, #BEB293 0%, black 67%)`
- `filter: blur(100px)`
- Animated by `exhale-drift` (7 s, ease-in-out, infinite)

### `.aurora-blob-3`

- `500px` wide, `900px` tall, left at `40%`, top at `380px`
- `transform: rotate(-58deg); transform-origin: top left`
- `opacity: 0.6; mix-blend-mode: hard-light`
- `background: linear-gradient(180deg, #8FA2B0 0%, #1B324D 56%)`
- `filter: blur(100px)`
- Animated by `inhale-pulse` (5.5 s, ease-in-out, infinite)

### `.glass-card`

The primary surface container. Used for hero cards, info cards, sign-up forms, admin forms, and player lists.

- `background: linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)`
- `backdrop-filter: blur(40px) saturate(180%)`
- `border: 1px solid rgba(255,255,255,0.16)`
- `border-radius: 24px`
- Box shadows: inner highlight `inset 0 1px 0 rgba(255,255,255,0.16)`, outer depth `0 8px 40px rgba(0,0,0,0.3)`, secondary `0 2px 8px rgba(0,0,0,0.15)`

### `.btn-primary`

The primary call-to-action button. Used for Sign Up, Save Session, Post to Home, and the admin PIN Enter button.

- `background: linear-gradient(160deg, rgba(74,222,128,0.55) 0%, rgba(22,163,74,0.4) 100%)`
- `backdrop-filter: blur(20px) saturate(150%)`
- `border: 1px solid rgba(74,222,128,0.45)`
- `border-radius: 14px`
- Box shadows: inner highlight, green glow `0 4px 20px rgba(22,163,74,0.2)`, base shadow
- Text: `color: #fff; font-weight: 600; font-size: 0.875rem`
- Padding: `11px 20px`
- States: hover fades to `opacity: 0.9`; active scales to `0.97`; disabled drops to `opacity: 0.4`

### `.btn-ghost`

A secondary/outline-style button. Used for "View Sign Up List" and "Polish with AI".

- `background: linear-gradient(160deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)`
- `backdrop-filter: blur(20px) saturate(150%)`
- `border: 1px solid rgba(255,255,255,0.14)`
- `border-radius: 14px`
- Text: `color: rgba(255,255,255,0.85); font-weight: 500; font-size: 0.875rem`
- Padding: `10px 16px`
- States: hover brightens gradient slightly; active scales to `0.97`; disabled drops to `opacity: 0.35`

### `.nav-glass`

The fixed bottom navigation bar.

- `background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(16,15,15,0.75) 100%)`
- `backdrop-filter: blur(40px) saturate(180%)`
- `border-top: 1px solid rgba(255,255,255,0.12)`
- Box shadows: inner top highlight `inset 0 1px 0 rgba(255,255,255,0.10)`, outer lift `0 -4px 24px rgba(0,0,0,0.2)`

### `.nav-tab-active`

Applied to the active tab button inside `.nav-glass`.

- `background: linear-gradient(160deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%)`
- `border-radius: 12px`
- Box shadows: inner highlight `inset 0 1px 0 rgba(255,255,255,0.18)`, depth `0 2px 8px rgba(0,0,0,0.15)`
- Active tab icon and label color: `#4ade80` (set via inline style in BottomNav)
- Inactive tab color: `rgba(255,255,255,0.35)` (set via inline style)

### `.status-banner-green`

The "You're in!" confirmation banner shown in HomeTab after a player signs up.

- `background: rgba(74,222,128,0.08)`
- `border: 1px solid rgba(74,222,128,0.2)`
- `border-radius: 16px`
- `padding: 16px`
- `display: flex; align-items: center; gap: 12px`

### `.status-banner-orange`

The "Session Full" banner shown in HomeTab when all spots are taken.

- `background: rgba(251,146,60,0.08)`
- `border: 1px solid rgba(251,146,60,0.2)`
- `border-radius: 16px`
- `padding: 16px`
- `display: flex; align-items: center; gap: 12px`

### `.animate-spin`

Loading spinner utility applied to a Material Icon (`refresh`).

- `animation: spin 1s linear infinite`

### Icon Size Utilities

| Class | `font-size` | Notes |
|---|---|---|
| `.icon-spin-lg` | `32px` | Large loading spinner |
| `.icon-pin` | `16px` | Small pin/info row icons; `color: #ef4444` |
| `.icon-pin-lg` | `20px` | Hero card icons; `color: #ef4444` (overridden inline in components) |
| `.icon-sm` | `16px` | Small inline icons (e.g. campaign icon in announcements) |
| `.icon-status` | `22px` | Status banner icons (check_circle, lock) |

### `.material-icons` (global override)

- `font-size: inherit`
- `vertical-align: middle`
- `line-height: 1`

---

## 3. Background System

The full-page background is rendered in `layout.tsx` inside a `<div className="court-bg" aria-hidden="true">` and consists of three layers in z-order:

1. **Base fill** — the `.court-bg` element itself paints `#100F0F` (z-index: -1).
2. **Aurora blobs** — three absolutely positioned, heavily blurred gradient divs (`.aurora-blob-1`, `.aurora-blob-2`, `.aurora-blob-3`) that animate continuously. They are stacked without explicit z-index within the container, so they render in DOM order beneath the SVG.
3. **Court SVG** — a `<svg viewBox="0 0 390 844">` using `preserveAspectRatio="xMidYMid slice"` is positioned absolutely at `z-index: 1` within `.court-bg`. It draws:
   - Outer boundary rectangle
   - Singles sidelines
   - Long service lines (doubles)
   - Short service lines
   - Center service-box lines
   - A dashed net line at y=422
   - All court lines use `stroke="rgba(255,255,255,0.22)" strokeWidth="1.2"`; the net uses `rgba(255,255,255,0.35)` and `strokeDasharray="7 5"`

On mobile the SVG is scaled up 1.7x (`transform: scale(1.7)`) to fill the narrow viewport. At 768 px and wider the scale is removed.

The entire background layer sits at `z-index: -1` relative to the page content. Page content (tabs, nav) renders on top.

---

## 4. Typography

### Font Stack

System sans-serif, defined on `body`:

```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
```

### Icon Font

Google Material Icons, loaded via a `<link>` in `<head>`:

```
https://fonts.googleapis.com/icon?family=Material+Icons
```

Used pervasively for navigation icons (`home`, `group`, `admin_panel_settings`), status icons (`check_circle`, `lock`), info row icons (`location_on`, `event`, `sports_tennis`, `payments`), and utility icons (`campaign`, `auto_fix_high`, `logout`, `refresh`).

### Text Color Conventions

| Context | Color |
|---|---|
| Primary headings | `text-white` (`#ffffff`) |
| Body / card text | `text-gray-200` (`#e2e8f0` approx) |
| Muted / secondary | `text-gray-400` / `text-gray-500` |
| Accent labels, section headers | `text-green-400` (`#4ade80`) |
| Error messages | `text-red-400` (`#f87171`) |
| "Session Full" count | `text-orange-400` (`#fb923c`) |
| Inactive nav items | `rgba(255,255,255,0.35)` (inline style) |
| Placeholder text | `rgba(255,255,255,0.3)` |

### Type Scale Conventions

- Page titles: `text-2xl font-bold`
- Card section headings: `text-xl font-bold`
- Section label caps: `text-xs font-bold tracking-widest` (e.g., "ANNOUNCEMENTS", "GAME 1", "3 PLAYERS SIGNED UP")
- Body text in cards: `text-sm`
- Sub-labels / timestamps: `text-xs`
- Spot counter: `text-2xl font-bold leading-none`

---

## 5. Animations

All `@keyframes` are defined in `globals.css`.

### `breathe-gentle`

Applied to `.aurora-blob-1` at 6 s ease-in-out infinite.

- **0% / 100%**: no translate, scale 1, opacity 0.45, blur 95px, hue-rotate 0deg
- **50%**: translate(-25px, 40px), scale 1.08, opacity 0.65, blur 110px, hue-rotate 15deg

Produces a slow pulsing drift — the blob subtly expands, shifts down-left, brightens slightly, and hue-shifts toward warmer tones at mid-cycle.

### `exhale-drift`

Applied to `.aurora-blob-2` at 7 s ease-in-out infinite.

- **0% / 100%**: no transform, opacity 0.95, blur 95px, hue-rotate 0deg
- **50%**: translate(-35px, -20px), rotate 1.5deg, scale 1.05, opacity 0.85, blur 105px, hue-rotate -10deg

A slower drift with a slight rotation and counter-clockwise hue shift, giving the sense of the blob exhaling upward.

### `inhale-pulse`

Applied to `.aurora-blob-3` at 5.5 s ease-in-out infinite.

- **0% / 100%**: rotate(-58deg) at origin, scale 1, opacity 0.55, blur 95px, hue-rotate 0deg
- **50%**: rotate(-55deg), translate(30px, -40px), scale 1.12, opacity 0.75, blur 115px, hue-rotate 20deg

The angled blob expands more aggressively (1.12 scale) and shifts toward warmer hues, mimicking an inhale.

### `spin`

Applied via `.animate-spin` to loading spinners.

- **to**: `transform: rotate(360deg)`
- Duration: 1 s linear infinite (set in the utility class)

Used on the `refresh` Material Icon during data-load states in HomeTab, PlayersTab, and AdminTab.

---

## 6. Component Visual Map

### HomeTab (`components/HomeTab.tsx`)

| Element | CSS Classes / Styles |
|---|---|
| Loading spinner | `flex items-center justify-center h-48` + `material-icons icon-spin-lg animate-spin text-green-400` |
| Welcome card | `glass-card p-5` — "WELCOME TO" label + "BPM Badminton" heading |
| Location card | `glass-card p-5 space-y-1.5` — location name + Maps link |
| Date & Time card | `glass-card p-5 space-y-3` — calendar icon (blue) + schedule icon (purple) |
| Announcement card | `glass-card p-5 space-y-2` — shown only when an announcement exists; `text-xs font-bold tracking-widest text-green-400` heading |
| Sign-up card | `glass-card p-5` |
| "You're in" banner | `status-banner-green` + `material-icons icon-status text-green-400` |
| "View Sign Up List" button | `btn-ghost w-full` — navigates to Players tab (replaces old "Cancel My Spot") |
| "Session Full" banner | `status-banner-orange` + `material-icons icon-status text-orange-400` |
| Sign-up input | Global `input` styles |
| Sign-up submit | `btn-primary w-full` |
| Error text | `text-red-400 text-xs` |
| Spots counter (open) | `text-2xl font-bold text-white leading-none` |
| Spots counter (full) | `text-2xl font-bold text-orange-400 leading-none` |

### AdminTab (`components/AdminTab.tsx`)

| Element | CSS Classes / Styles |
|---|---|
| Loading spinner (auth check) | `flex items-center justify-center min-h-[60vh]` + `material-icons animate-spin text-green-400` |
| PIN gate wrapper | `flex items-center justify-center min-h-[60vh]` |
| PIN gate card | `glass-card p-6 w-full max-w-xs space-y-5` |
| Lock icon | `material-icons text-green-400` at `fontSize: 40` |
| "Admin Access" heading | `text-lg font-bold text-green-400` |
| PIN input | Global `input` styles; `type="password"` |
| PIN submit | `btn-primary w-full` |
| PIN error | `text-xs text-red-400` |
| Admin panel heading + sign-out | `flex items-center justify-between px-1`; heading `font-semibold text-green-400` |
| Segment control wrapper | `flex w-full rounded-lg p-1 gap-1 overflow-hidden`; inline bg + green border |
| Active segment button | `flex-1 min-w-0 py-2 text-sm font-medium rounded-md truncate`; inline `background: rgba(74,222,128,0.15); color: #4ade80` |
| Inactive segment button | Same; inline `color: rgba(255,255,255,0.4)` |
| Session editor — Card 1 | `glass-card p-5 space-y-3` — SESSION INFO label, Title, Establishment Name, Address, Courts + Max Players |
| Session editor — Card 2 | `glass-card p-5 space-y-3` — DATE & TIME label, Date & Time row, Sign-up Deadline row |
| Date/Time row | `flex gap-2` with two `flex-1` children — DatePicker + `<input type="time" style={{ height: '42px' }}>` |
| Save button | `btn-primary w-full` (below both cards, outside them) |
| Field labels | `text-xs text-gray-400` |
| Announcements compose card | `glass-card p-5 space-y-3` |
| NEW ANNOUNCEMENT heading | `text-xs font-bold tracking-widest text-green-400` |
| Textarea | Global `textarea` styles; `maxLength={500}`; live `X/500` counter below |
| "Polish with AI" button | `btn-ghost w-full` + `material-icons` at 16px |
| AI result container | `rounded-lg p-3`; inline `background: rgba(74,222,128,0.06); border: 1px solid rgba(74,222,128,0.15)` |
| "Post to Home" button | `btn-primary w-full` |
| Posted announcements card | `glass-card p-5 space-y-3` |
| POSTED heading | `text-xs font-bold tracking-widest text-gray-500` |
| Individual posted item | `rounded-lg p-3`; inline faint white bg + border |

### PlayersTab (`components/PlayersTab.tsx`)

Single flat list — no game grouping. Header shows the actual game date fetched from the session.

| Element | CSS Classes / Styles |
|---|---|
| Loading spinner | `flex items-center justify-center h-48` + `material-icons animate-spin text-green-400` at 32px |
| Empty state card | `glass-card p-10 text-center text-gray-500` + `material-icons block mb-2 opacity-30` at 40px |
| Player count label | `text-xs font-bold tracking-widest text-green-400` |
| Single list card | `glass-card overflow-hidden` |
| Game date header | `px-4 py-2 text-xs font-bold tracking-widest`; inline `background: rgba(74,222,128,0.06); color: rgba(74,222,128,0.65); borderBottom: 1px solid rgba(74,222,128,0.1)` — shows e.g. "Sunday, March 30" or "UPCOMING SESSION" |
| Player list divider | `divide-y`; inline `borderColor: rgba(255,255,255,0.05)` |
| Player row | `flex items-center px-4 py-3 gap-3`; current user highlighted with inline `background: rgba(74,222,128,0.07)` |
| Player number | `text-xs text-gray-500 w-5 text-right font-mono tabular-nums` |
| Player name | `flex-1 text-sm text-gray-200 font-medium` |
| "(you)" label | `ml-1.5 text-xs text-green-400 font-normal` |
| Cancel button | `text-xs text-red-400 hover:text-red-300 transition-colors ml-1` — requires deleteToken in localStorage |

### DatePicker (`components/DatePicker.tsx`)

Custom calendar picker used in the AdminTab session editor for date fields.

| Element | CSS / Behavior |
|---|---|
| Trigger button | Matches global `input` height (`42px`), glass bg, green focus ring |
| Calendar dropdown | Rendered via `createPortal` at `document.body` — escapes all `backdrop-filter` stacking contexts |
| Positioning | `position: fixed` computed from `getBoundingClientRect()` on the trigger; repositions on scroll |
| z-index | `9999` — floats above Save button, bottom nav, and all cards |
| Selected day | Green gradient background, `color: #4ade80`, bold |
| Today (unselected) | Green border outline `rgba(74,222,128,0.4)` |
| Calendar background | Near-black with heavy blur: `rgba(22,22,26,0.97)` + `backdrop-filter: blur(40px)` |

### BottomNav (`components/BottomNav.tsx`)

| Element | CSS Classes / Styles |
|---|---|
| Nav wrapper | `nav-glass fixed bottom-0 left-0 right-0 z-50` |
| Inner container | `max-w-lg mx-auto flex px-2 py-1.5` |
| Active tab button | `flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-all rounded-xl nav-tab-active`; inline `color: #4ade80` |
| Inactive tab button | Same classes without `nav-tab-active`; inline `color: rgba(255,255,255,0.35)` |
| Tab icon | `material-icons` at `fontSize: 24` |
| Tab label | `text-xs font-medium` |

---

## 7. Form Input System

Form controls (`input`, `select`, `textarea`) share a unified global style that matches the glass aesthetic:

- `background: linear-gradient(160deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)`
- `backdrop-filter: blur(20px)`
- `border: 1px solid rgba(255,255,255,0.14)`
- `border-radius: 14px`
- `color: #e2e8f0; font-size: 0.875rem; padding: 11px 14px`
- Inner top highlight: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.10)`
- **Focus state**: `border-color: rgba(74,222,128,0.45)` + outer glow `0 0 0 3px rgba(74,222,128,0.10)`
- Placeholder: `rgba(255,255,255,0.3)`
- `select option` backgrounds use `--forest-800` (`#0a1f0e`) to keep the dropdown dark
- `textarea` is vertically resizable only (`resize: vertical`)

### Scrollbar

A minimal custom scrollbar is applied globally:

- Width: `4px`
- Track: transparent
- Thumb: `rgba(74,222,128,0.3)` with `border-radius: 2px`

---

## 8. Design Principles

**Mobile-first, single-column layout.** All tab content renders in a single scrollable column with `space-y` gaps. The `max-w-lg` constraint on BottomNav centers content naturally on wider screens while remaining full-bleed on mobile.

**Bottom navigation for thumb reach.** The four-tab nav (`Home`, `Players`, `Teams`, `Admin`) is pinned to the bottom of the viewport (`fixed bottom-0`) so primary actions are reachable with a thumb. The nav is constrained to `max-w-lg` and centered.

**High-contrast green on dark for accessibility.** The court-green accent (`#4ade80`) is used for all interactive feedback — active tab, focus rings, status banners, section headings, and the current-user highlight row — against a near-black background (`#100F0F`), providing strong luminance contrast.

**Glass morphism, not flat.** Every card and interactive surface uses `backdrop-filter: blur()` + translucent gradients rather than opaque flat fills, keeping the animated background visible and giving the UI depth without heavy chrome.

**Minimal chrome, content-forward.** Padding and border-radius values are generous (`24px` on cards, `14px` on buttons and inputs) for a spacious feel. Section labels use `tracking-widest` all-caps micro-text to separate content areas without heavy dividers.

**Semantic icon usage.** Material Icons carry meaning alongside text (e.g. `check_circle` for success, `lock` for full/restricted, `campaign` for announcements) and are colored contextually — green for success states, red for errors/location pins, blue for dates, purple for courts.

**Consistent state feedback.** Every async operation disables relevant buttons and shows inline text feedback ("Signing up…", "Saving…", "Polishing…"), preventing duplicate submissions. Errors surface as `text-red-400 text-xs` immediately below the relevant input or action.
