# BPM Badminton — UI kit

Click-thru prototype replica of the BPM Badminton app (4-tab mobile PWA).

## Files
- `index.html` — click-thru host. Loads React 18, Babel, Material Icons, then the JSX files. Lets you switch tabs and play a fake sign-up flow.
- `components.jsx` — shared cosmetic components (GlassCard, SectionLabel, StatusBanner, Pill, BottomNav, PageHeader, MaterialIcon).
- `home.jsx` — Home tab (tile row, cost card, announcement, 7-state sign-up card).
- `signups.jsx` — Sign-Ups tab (active list + waitlist).
- `skills.jsx` — Learn tab (non-admin "Progress together?" state; admin empty-state placeholder).

Design anchor: `grantxyzou/badminton-app` → `components/HomeTab.tsx`, `BottomNav.tsx`, `PlayersTab.tsx`, `SkillsTab.tsx`. These are cosmetic recreations — no real API, no routing. Opens in dark mode by default; toggle top-right.
