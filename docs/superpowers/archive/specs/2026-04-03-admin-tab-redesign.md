# Admin Tab Redesign — Dashboard + Drill-Down Architecture

## Problem

The admin tab has grown to 2,000+ lines with 4 segment-controlled sections. The Session section alone is 800px of forms on mobile. Every-session actions (toggle payments, add players) are buried behind the same UI as setup-once config (venue name, aliases). No visual hierarchy between "do this now" and "set this up once."

## Solution: Dashboard + Drill-Down

Replace the 4-tab segment control with a single-screen **dashboard** showing read-only session info and live controls. Configuration lives behind **drill-down views** accessed via edit icons or buttons, each with a back button.

## Dashboard (Home State)

The admin lands here. Everything visible without scrolling on a 667px screen (iPhone SE).

### Layout (top to bottom):

1. **Header bar**
   - "Admin" title (left)
   - "Sign out" link (right)

2. **Session context bar** (green-tinted inner card)
   - "Editing" label + session date/time (e.g., "Apr 5, 2026 · 7:00 PM")
   - Edit icon (✎) → opens Date & Time editor
   - This answers question 5: "which session am I editing?"

3. **Venue summary card** (read-only, one line)
   - Venue name
   - "2 courts · 12 max · $25/ct · Signups open"
   - Edit icon (✎) → opens Session Details editor

4. **Players card** (live, interactive)
   - Header: "8 Players · 4 spots left" + "+ Add" button
   - Player rows: number, name, paid/pending toggle
   - Show first ~5, then "View all →" link to expand or navigate
   - Waitlist section below (if any)
   - Session history navigator (prev/next arrows) at bottom of card

5. **Announcements card** (live, interactive)
   - Header: "Announcements" + "+ New" button
   - Latest announcement text
   - Inline compose (textarea + AI polish + post)

6. **Quick-access buttons** (flex row)
   - "Members (14)" → opens Members drill-down
   - "Birds (6 tubes)" → opens Birds drill-down

7. **Advance button** (full-width primary)
   - "Next Week →" → opens Advance Session form

## Drill-Down Views

Each opens as a full-screen view within the admin tab (not a modal/sheet). Back button returns to dashboard. State is preserved.

### Session Details Editor (✎ on venue)
- Session badge: "Apr 5, 2026" (read-only, reminds which session)
- Venue name (text input)
- Address (text input)
- Courts / Max Players / $/Court (3-column grid)
- Bird tubes used / Show cost toggle (2-column grid)
- Sign-ups open/closed toggle
- Save button → returns to dashboard

### Date & Time Editor (✎ on session bar)
- Session date + time
- Deadline date + time
- End date + time
- Save button → returns to dashboard

### Members & Invites
- Add member form (input + button)
- Member list (name, session count, admin shield toggle, remove)
- E-transfer aliases section below
  - Add alias form
  - Alias list (app name → e-transfer name, edit, delete)
- No save button needed (each action is immediate)

### Bird Inventory
- Stock indicator (X tubes remaining, green/amber)
- Add purchase form (shuttle name, tubes, total $, speed, date, rating 1-5, notes)
- Purchase history list (name, date, tubes, cost/tube, speed, rating, notes, delete)

### Advance to Next Week
- Session date + time
- Deadline date + time  
- End date + time
- Courts / Max Players (2-column grid)
- "Create Next Session →" button
- Helper text: "Creates a new session. Current session will be archived."

### Player List (full view, if "View all" is tapped)
- Same as dashboard player card but full list
- Includes removed players (collapsible)
- Export CSV button
- Clear/purge actions in more menu

## Component Decomposition

The current AdminTab.tsx is 2,000+ lines. Break it into focused files:

```
components/
  admin/
    AdminDashboard.tsx      — dashboard layout, drill-down routing
    SessionContextBar.tsx   — green session bar with edit icon
    VenueSummary.tsx         — read-only venue card with edit icon
    PlayersList.tsx          — player rows, payment toggles, add form
    AnnouncementsCard.tsx    — announcements with compose
    SessionDetailsEditor.tsx — venue/courts/cost form
    DateTimeEditor.tsx       — session/deadline/end dates form
    MembersView.tsx          — members + aliases (existing MembersPanel + AliasesPanel)
    BirdInventoryView.tsx    — bird inventory (existing BirdInventorySheet, adapted)
    AdvanceSessionForm.tsx   — next week creation form
  AdminTab.tsx               — PIN gate + renders AdminDashboard
```

## Navigation State

Use a local state variable in AdminDashboard:
```typescript
type AdminView = 'dashboard' | 'session-details' | 'date-time' | 'members' | 'birds' | 'advance' | 'players-full';
const [view, setView] = useState<AdminView>('dashboard');
```

Back button always calls `setView('dashboard')`. No URL changes, no router — pure component state.

## What Changes vs. What Stays

### Changes
- Remove 4-section segment control
- Dashboard replaces the Session + Sign Up sections as the default view
- Session config split into two focused editors (details + dates)
- Members and Birds are drill-down views instead of tab section / bottom sheet
- AdminTab.tsx shrinks from ~2,000 lines to ~100 (PIN gate + AdminDashboard import)

### Stays
- All API routes unchanged
- All data models unchanged
- PIN-based auth flow unchanged
- Player CRUD logic (add, remove, restore, promote, toggle paid) unchanged
- Announcement CRUD logic unchanged
- CSV export unchanged
- Session advance logic unchanged

## Style Guide Compliance Fixes (audit findings)

### DatePicker — Critical
- Replace hardcoded dark colors with CSS custom properties (`var(--glass-bg)`, `var(--glass-border)`, etc.)
- Portal must respect `data-theme="light"` — currently renders dark on light backgrounds
- Calendar day selection: use `var(--accent)` instead of hardcoded `rgba(74,222,128,...)`
- Chevron icons: use `var(--text-muted)` instead of hardcoded values

### Dropdown/Autocomplete (HomeTab)
- Replace `border-white/10` with `var(--glass-border)`
- Add `-webkit-backdrop-filter` and `backdrop-filter: blur()` to suggestion list
- Fix text color for light mode: use `var(--text-primary)` instead of `text-white`

### Bottom Sheets (all instances)
- SkillsRadar sheet: use `var(--glass-bg)` with backdrop blur instead of `var(--page-bg)`
- Ensure all sheets have consistent styling: glass bg, glass border, glass shadow
- Add `-webkit-backdrop-filter` prefix everywhere `backdrop-filter` is used

### Buttons — 44px Minimum Tap Targets
- `btn-primary`: increase padding from `11px 20px` to `12px 20px`
- `btn-ghost`: increase padding from `10px 16px` to `12px 16px`
- BottomNav tabs: add `min-h-[44px]`

## Bottom Tab Bar Overlap Fixes

### BottomNav safe area
- Add `env(safe-area-inset-bottom)` to BottomNav padding so the nav doesn't get cut off by iPhone home bar
- Change `pb-5` to `pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]`

### Content padding
- Each tab component (HomeTab, PlayersTab, SkillsTab, AdminTab) must have sufficient bottom padding so content isn't obscured by the fixed nav
- SkillsRadar: increase from `pb-4` to match page wrapper padding
- SkillsRadar bottom sheet: add `paddingBottom: env(safe-area-inset-bottom)` to sheet container

## Motion & Micro-Interactions (Liquid Glass)

All transitions should follow the liquid glass aesthetic: smooth, physics-based easing, subtle depth shifts.

### Global animation tokens (add to globals.css)
```css
:root {
  --ease-glass: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}
```

### Tab content switching
- Fade-in on mount: `opacity: 0 → 1` over `var(--duration-normal)` with `var(--ease-glass)`
- Optional subtle translateY(8px → 0) for depth

### Bottom sheet entrance/exit
- Sheet slides up from bottom: `translateY(100%) → translateY(0)` over `var(--duration-slow)` with `var(--ease-spring)`
- Backdrop fades in: `opacity: 0 → 1` over `var(--duration-normal)`
- Exit: reverse with `var(--ease-glass)` (no spring on exit)

### Segment control
- Add `transition: background var(--duration-fast), color var(--duration-fast)` to segment buttons

### Form input focus
- Add `transition: border-color var(--duration-fast), box-shadow var(--duration-fast)` to all inputs

### Suggestions dropdown
- Fade in + scale: `opacity: 0 → 1`, `scaleY(0.95) → scaleY(1)`, origin top, over `var(--duration-fast)`

### Drill-down view transitions (new for admin redesign)
- Navigate forward: slide in from right (`translateX(100%) → translateX(0)`) over `var(--duration-normal)` with `var(--ease-glass)`
- Navigate back: slide out to right (`translateX(0) → translateX(100%)`) over `var(--duration-normal)` with `var(--ease-glass)`
- Dashboard fades slightly during transition

### Button states
- BottomNav tabs: add `active:scale-95` with `transition-transform duration-100`
- Player list rows: add `hover:bg-white/5` (or `var(--glass-tint)` equivalent) with `transition-colors`
- Interactive cards: `active:scale-[0.98]` already exists on some cards — ensure consistency

### Loading/shimmer
- Already well-implemented (ShuttleLoader, ShimmerLoader) — no changes needed

## What's NOT in Scope
- No new API routes
- No database changes
- No new features — this is purely an IA refactor + style/motion polish
