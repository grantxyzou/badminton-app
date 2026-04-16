# P1 Skills Tab — Design Spec

## Overview

Add a Skills tab to the bottom nav as a placeholder for the upcoming ACE Badminton Skills Framework. This is stage 1 of a 3-stage rollout:

1. **Coming Soon** (this spec) — tab + placeholder screen
2. **Teaser** — preview of dimensions, sample radar silhouette, hints at the framework
3. **Read-only** — full ACE matrix explainer with AI agent for Q&A

## Scope

### Nav Tab

- Add `'skills'` to the `Tab` union type in `app/page.tsx`
- Add a new entry to the `TABS` array in `BottomNav.tsx`
- **No icon** — the tab displays "Coming Soon" as stacked two-line text
- Same height and width as other tabs — visually equal weight
- Tab appears for all users (no admin gating)
- Position: between Sign-Ups and Admin

### Skills Screen

- New component: `components/SkillsTab.tsx`
- Renders a single line of styled text: **"Progress together?"**
- Text treatment: all muted white (`rgba(255,255,255,0.25)` in dark, equivalent in light)
- Position: vertically and horizontally centered
- No cards, no sections, no other content
- Must respect light/dark theme

### ACE Skills Data File

- New file: `lib/skills-data.ts`
- Contains the full ACE Badminton Club Skills Matrix as structured TypeScript data
- Source: https://www.acesports.ca/skills-matrix
- **7 dimensions**: Grip & Stroke, Movement, Serve & Return, Offense, Defense, Strategy, Knowledge
- **5 levels**: Beginner (1), Recreational (2), Intramural (3), Varsity (4), Provincial Team (5)
- Level 6 (National Team) excluded — not relevant for BPM
- Each dimension has: name, description, and per-level criteria text
- Exported as typed constants for use by future UI and AI agent
- No API route yet — data is static, consumed at build time in later stages

## What's NOT in scope

- No API routes for skills
- No database collection for skills
- No admin controls or editing
- No skill assessment or self-rating (P2)
- No AI agent or Q&A (stage 3)
- No radar/spider chart (P2)
- No per-session URL (deferred)

## Technical Details

### Tab Type Change

```typescript
// app/page.tsx
type Tab = 'home' | 'players' | 'skills' | 'admin';
```

### BottomNav Modification

The Skills tab breaks the icon + label pattern intentionally. The `TABS` array entry needs a way to signal "text-only, stacked" rendering. Options:
- Add an optional `textOnly` flag to the tab config
- Or render conditionally based on `tab.id === 'skills'`

The tab must maintain equal flex sizing (`flex: 1`) with the others.

### SkillsTab Component

Minimal client component. No data fetching, no state, no effects. Just styled text centered on screen.

### Skills Data Shape

```typescript
interface SkillDimension {
  id: string;
  name: string;
  description: string;
  levels: Record<number, string>; // level 1-5 -> criteria text
}

// Export: SKILL_DIMENSIONS: SkillDimension[]
// Export: SKILL_LEVELS: { level: number; name: string }[]
```

## Theme Considerations

- "Progress together?" text uses CSS custom properties for dark/light support
- Nav tab "Coming Soon" text inherits `--nav-active-color` / `--nav-inactive-color` like other tabs

## Staged Rollout Context

| Stage | Tab Label | Screen Content | Data Source |
|-------|-----------|----------------|-------------|
| 1 (this) | "Coming Soon" | "Progress together?" | `lib/skills-data.ts` (landed but unused) |
| 2 | TBD | Teaser preview of framework | Same file, rendered partially |
| 3 | TBD | Full read-only matrix + AI agent | Same file + API route + Anthropic SDK |
