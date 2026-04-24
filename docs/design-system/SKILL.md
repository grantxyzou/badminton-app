---
name: bpm-badminton-design
description: Use this skill to generate well-branded interfaces and assets for BPM Badminton, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick map
- `README.md` — brand context, content fundamentals, visual foundations, iconography. **Start here.**
- `colors_and_type.css` — drop-in CSS variables for colors, type, motion, glass surfaces, buttons, nav, inputs, banners, pills, radii, shadows, spacing. Also provides utility classes (`.bpm-h1`, `.bpm-body`, `.bpm-mono`, `.bpm-track-widest`).
- `assets/aurora-bg.css` — animated "court aurora" background. Include the three blob divs near the top of `<body>`.
- `assets/bpm-logo.svg`, `assets/shuttlecock.svg` — brand marks. No logotype exists.
- `preview/*.html` — 23 specimen cards (colors, type, components) you can reference.
- `ui_kits/bpm-app/` — JSX recreation of the mobile app. Copy `components.jsx` + CSS into any mock that needs real BPM UI.

## Quick-start boilerplate for a new mock

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Space Grotesk + IBM Plex Sans are self-hosted via @font-face in colors_and_type.css -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" />
<link rel="stylesheet" href="colors_and_type.css" />
<link rel="stylesheet" href="assets/aurora-bg.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons" />
<body>
  <div class="court-bg">
    <div class="aurora-blob-1"></div>
    <div class="aurora-blob-2"></div>
    <div class="aurora-blob-3"></div>
  </div>
  <!-- your content — wrap in .glass-card containers -->
</body>
```

## Rules of thumb
- **Dark-first.** Default to `data-theme="dark"`; light is a toggle, not the hero.
- **Glass over solid.** Cards are translucent, backdrop-blurred, never flat fills.
- **Green is the only accent** (`--bpm-court-green` / `#4ade80`). Amber = waitlist, orange = full, red = errors.
- **Material Icons only.** Outlined weight, 18–24px. No emoji (except unicode 🏸 for external-facing copy — see README).
- **Voice is warm and casual** — lowercase admin messages, em-dashes, "Hey there 👋" greetings.
- **Never invent new visual motifs** — purple gradients, neumorphism, emoji cards, heavy shadows are all out-of-system.
