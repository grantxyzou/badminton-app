# Admin Tab Redesign + Style/Motion Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the admin tab from a 4-tab segment control into a dashboard + drill-down architecture, fix style guide violations, add liquid glass motion, and fix bottom tab bar overlap.

**Architecture:** Three phases executed sequentially. Phase 1 adds global CSS foundations (motion tokens, safe-area, tap targets). Phase 2 fixes component-level style violations (DatePicker, dropdowns, bottom sheets). Phase 3 decomposes the 2,000-line AdminTab into 10 focused components with a dashboard layout and drill-down navigation.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, CSS custom properties, CSS transitions/animations

---

## Phase 1: Global Foundations

### Task 1: Add motion tokens and animation keyframes to globals.css

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add motion tokens to `:root`**

In `app/globals.css`, inside the `:root` block (after line 15 `--color-scheme: dark;`), add:

```css
  /* ── Motion ── */
  --ease-glass: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
```

- [ ] **Step 2: Add keyframe animations**

After the existing `@keyframes shimmer` block (around line 622), add:

```css
/* ── View transitions ── */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(40px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scaleY(0.95); }
  to { opacity: 1; transform: scaleY(1); }
}

.animate-fadeIn {
  animation: fadeIn var(--duration-normal) var(--ease-glass) both;
}

.animate-slideUp {
  animation: slideUp var(--duration-slow) var(--ease-spring) both;
}

.animate-slideInRight {
  animation: slideInRight var(--duration-normal) var(--ease-glass) both;
}

.animate-scaleIn {
  animation: scaleIn var(--duration-fast) var(--ease-glass) both;
  transform-origin: top;
}
```

- [ ] **Step 3: Add segment control transition**

Find the `.segment-control` rule (around line 692) and add transition to its children. After the `.segment-tab-inactive` rule, add:

```css
.segment-control button {
  transition: background var(--duration-fast) var(--ease-glass),
              color var(--duration-fast) var(--ease-glass);
}
```

- [ ] **Step 4: Fix button tap targets**

Change `.btn-primary` padding (line 409) from `padding: 11px 20px;` to:
```css
  padding: 12px 20px;
```

Change `.btn-ghost` padding (line 443) from `padding: 10px 16px;` to:
```css
  padding: 12px 16px;
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat: add motion tokens, keyframes, and fix button tap targets"
```

---

### Task 2: Fix BottomNav safe-area and tab content padding

**Files:**
- Modify: `components/BottomNav.tsx:20-21`
- Modify: `app/globals.css` (add bottom-nav safe-area class)

- [ ] **Step 1: Add safe-area class to globals.css**

After the `.nav-tab-active` rule (around line 482), add:

```css
/* ── Safe area bottom padding for nav ── */
.nav-safe-area {
  padding-bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
}
```

- [ ] **Step 2: Update BottomNav to use safe-area class**

In `components/BottomNav.tsx`, change line 21 from:
```tsx
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-5">
```
to:
```tsx
    <nav className="fixed bottom-0 left-0 right-0 z-50 nav-safe-area">
```

- [ ] **Step 3: Add active:scale to nav tabs**

In `components/BottomNav.tsx`, on line 32, add `active:scale-95` to the button className:
```tsx
className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all active:scale-95 rounded-xl ${active ? 'nav-tab-active' : ''}`}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add components/BottomNav.tsx app/globals.css
git commit -m "fix: add safe-area-inset-bottom to nav and tab tap feedback"
```

---

### Task 3: Add tab content fade-in animation

**Files:**
- Modify: `app/page.tsx:60-64`

- [ ] **Step 1: Wrap each tab render in an animated div**

In `app/page.tsx`, change lines 60-64 from:
```tsx
        {activeTab === 'home' && <HomeTab onTabChange={setActiveTab} onTitleTap={handleTitleTap} />}
        {activeTab === 'players' && <PlayersTab />}
        {activeTab === 'skills' && <SkillsTab isAdmin={showAdmin} />}
        {activeTab === 'admin' && showAdmin && <AdminTab />}
```
to:
```tsx
        {activeTab === 'home' && <div key="home" className="animate-fadeIn"><HomeTab onTabChange={setActiveTab} onTitleTap={handleTitleTap} /></div>}
        {activeTab === 'players' && <div key="players" className="animate-fadeIn"><PlayersTab /></div>}
        {activeTab === 'skills' && <div key="skills" className="animate-fadeIn"><SkillsTab isAdmin={showAdmin} /></div>}
        {activeTab === 'admin' && showAdmin && <div key="admin" className="animate-fadeIn"><AdminTab /></div>}
```

The `key` prop ensures React unmounts/remounts when switching tabs, re-triggering the animation.

- [ ] **Step 2: Verify in browser**

Run: `npm run dev` → switch between tabs
Expected: Each tab fades in with a subtle upward slide over 250ms

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add fade-in animation on tab switching"
```

---

## Phase 2: Component Style Fixes

### Task 4: Fix DatePicker hardcoded colors

**Files:**
- Modify: `components/DatePicker.tsx`

- [ ] **Step 1: Read the full DatePicker file**

Read `components/DatePicker.tsx` to understand the full component structure before making changes.

- [ ] **Step 2: Replace portal container inline styles with CSS variables**

Find the portal container div (around line 108-118). Replace all hardcoded color values:

Change the container `style` from hardcoded dark values to:
```tsx
style={{
  position: 'fixed',
  top: calPos.top,
  left: calPos.left,
  width: calPos.width,
  zIndex: 9999,
  background: 'var(--glass-bg)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  backdropFilter: 'blur(40px) saturate(180%)',
  border: '1px solid var(--glass-border)',
  borderRadius: 20,
  padding: '16px 12px',
  boxShadow: 'var(--glass-shadow)',
}}
```

- [ ] **Step 3: Replace calendar day selection colors**

Find the selected day styling (around lines 164-167). Replace hardcoded `rgba(74,222,128,...)` with CSS variable references:

For selected day background: `background: 'var(--inner-card-green-bg)'`
For selected day border: `border: '1px solid var(--inner-card-green-border)'`
For selected day text: `color: 'var(--accent)'`
For today indicator: `color: 'var(--accent)'`
For default day text: `color: 'var(--text-primary)'`
For other-month days: `color: 'var(--text-muted)'`

- [ ] **Step 4: Replace chevron and header colors**

Find chevron buttons (around lines 124-131). Replace:
- Chevron color: `color: 'var(--text-muted)'` 
- Month/year header: `color: 'var(--text-primary)'`
- Day-of-week headers: `color: 'var(--text-muted)'`

- [ ] **Step 5: Replace trigger button styling**

Find the trigger button/input styling (around lines 196-203). Replace hardcoded focus/open states with CSS variables:
- Open state background: `var(--input-bg)`
- Open state border: `var(--input-focus-border)`
- Open state ring: `var(--input-focus-ring)`

- [ ] **Step 6: Add entrance animation to calendar portal**

Add `className="animate-scaleIn"` to the portal's inner content div.

- [ ] **Step 7: Verify in both themes**

Run: `npm run dev` → open date picker in dark mode AND light mode
Expected: Calendar uses theme colors in both modes, smooth scale-in animation on open

- [ ] **Step 8: Commit**

```bash
git add components/DatePicker.tsx
git commit -m "fix: DatePicker uses CSS variables for theme compliance"
```

---

### Task 5: Fix suggestion dropdown styling and animation

**Files:**
- Modify: `components/HomeTab.tsx`

- [ ] **Step 1: Update both suggestion dropdown instances**

In `components/HomeTab.tsx`, find both suggestion dropdowns (around lines 435-449 and 480-493). There are two identical blocks — one for the waitlist form, one for the regular signup form.

For each `<ul>` element, change:
```tsx
<ul className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl overflow-hidden border border-white/10"
    style={{ background: 'var(--dropdown-bg)', backdropFilter: 'blur(12px)' }}>
```
to:
```tsx
<ul className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl overflow-hidden animate-scaleIn"
    style={{
      background: 'var(--dropdown-bg)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid var(--glass-border)',
    }}>
```

For each suggestion button inside, change `text-white` to use the CSS variable:
```tsx
className="w-full text-left px-4 py-2.5 text-sm transition-colors"
style={{ color: 'var(--text-primary)' }}
```

Add hover style inline:
```tsx
onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(var(--glass-tint), 0.08)'}
onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
```

- [ ] **Step 2: Verify in both themes**

Run: `npm run dev` → type in signup form → verify dropdown appears with animation, correct colors in dark and light

- [ ] **Step 3: Commit**

```bash
git add components/HomeTab.tsx
git commit -m "fix: suggestion dropdown uses glass styling with scale-in animation"
```

---

### Task 6: Fix SkillsRadar bottom sheet styling and animation

**Files:**
- Modify: `components/SkillsRadar.tsx`

- [ ] **Step 1: Update backdrop to fade in**

In `components/SkillsRadar.tsx`, find the backdrop div (around line 313-317). Update:
```tsx
<div
  className="fixed inset-0 z-40 animate-fadeIn"
  style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
  onClick={onClose}
/>
```

- [ ] **Step 2: Update sheet panel to use glass styling and slide-up animation**

Find the sheet container (around lines 320-335). Update the inner content div:
```tsx
<div
  className="rounded-t-2xl overflow-hidden animate-slideUp"
  style={{
    background: 'var(--glass-bg)',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
    border: '1px solid var(--glass-border)',
    borderBottom: 'none',
    boxShadow: 'var(--glass-shadow)',
  }}
>
```

- [ ] **Step 3: Add safe-area padding to sheet content**

Find the scrollable content area (around line 342). Add safe-area padding:
```tsx
<div className="px-5 pb-8 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 80px)', paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
```

- [ ] **Step 4: Verify**

Run: `npm run dev` → open Skills tab as admin → tap a category card
Expected: Backdrop fades in, sheet slides up with spring easing, glass blur visible on sheet

- [ ] **Step 5: Commit**

```bash
git add components/SkillsRadar.tsx
git commit -m "fix: bottom sheet glass styling, slide-up animation, safe-area padding"
```

---

## Phase 3: Admin Tab Decomposition

### Task 7: Create admin component directory and shared types

**Files:**
- Create: `components/admin/types.ts`

- [ ] **Step 1: Create shared types file**

```typescript
export type AdminView =
  | 'dashboard'
  | 'session-details'
  | 'date-time'
  | 'members'
  | 'birds'
  | 'advance'
  | 'players-full';

export interface AdminNavProps {
  onBack: () => void;
  title: string;
  sessionLabel?: string;
}
```

- [ ] **Step 2: Create the directory**

Run: `mkdir -p components/admin`

- [ ] **Step 3: Commit**

```bash
git add components/admin/types.ts
git commit -m "feat: add admin component types and directory"
```

---

### Task 8: Extract AdminBackHeader component

**Files:**
- Create: `components/admin/AdminBackHeader.tsx`

- [ ] **Step 1: Create the back header component**

```tsx
'use client';

import type { AdminNavProps } from './types';

export default function AdminBackHeader({ onBack, title, sessionLabel }: AdminNavProps) {
  return (
    <div className="animate-fadeIn">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm font-medium mb-3 transition-colors active:scale-95"
        style={{ color: 'var(--accent)', minHeight: 44 }}
      >
        <span className="material-icons" style={{ fontSize: 18 }}>chevron_left</span>
        Admin
      </button>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {sessionLabel && (
          <span
            className="text-[10px] font-semibold px-2 py-1 rounded-full"
            style={{
              background: 'var(--inner-card-green-bg)',
              color: 'var(--accent)',
              border: '1px solid var(--inner-card-green-border)',
            }}
          >
            {sessionLabel}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/AdminBackHeader.tsx
git commit -m "feat: add AdminBackHeader component"
```

---

### Task 9: Extract SessionContextBar and VenueSummary

**Files:**
- Create: `components/admin/SessionContextBar.tsx`
- Create: `components/admin/VenueSummary.tsx`

- [ ] **Step 1: Create SessionContextBar**

```tsx
'use client';

import type { Session } from '@/lib/types';

interface Props {
  session: Session | null;
  onEditDates: () => void;
}

function fmtSessionDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    }) + ' · ' + new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function SessionContextBar({ session, onEditDates }: Props) {
  return (
    <button
      onClick={onEditDates}
      className="w-full inner-card-green p-3 flex items-center justify-between transition-all active:scale-[0.98]"
      style={{ minHeight: 44 }}
    >
      <div className="text-left">
        <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Editing</p>
        <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
          {session?.datetime ? fmtSessionDate(session.datetime) : 'No session'}
        </p>
      </div>
      <span className="material-icons" style={{ fontSize: 16, color: 'var(--text-muted)' }}>edit</span>
    </button>
  );
}
```

- [ ] **Step 2: Create VenueSummary**

```tsx
'use client';

import type { Session } from '@/lib/types';

interface Props {
  session: Session | null;
  onEdit: () => void;
}

export default function VenueSummary({ session, onEdit }: Props) {
  if (!session) return null;

  const details = [
    session.courts && `${session.courts} courts`,
    session.maxPlayers && `${session.maxPlayers} max`,
    session.costPerCourt && `$${session.costPerCourt}/ct`,
    session.signupOpen !== false ? 'Signups open' : 'Signups closed',
  ].filter(Boolean).join(' · ');

  return (
    <button
      onClick={onEdit}
      className="w-full glass-card p-3 flex items-start justify-between transition-all active:scale-[0.98] text-left"
      style={{ minHeight: 44 }}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {session.locationName || 'No venue set'}
        </p>
        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
          {details}
        </p>
      </div>
      <span className="material-icons ml-2 shrink-0" style={{ fontSize: 16, color: 'var(--text-muted)' }}>edit</span>
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/SessionContextBar.tsx components/admin/VenueSummary.tsx
git commit -m "feat: add SessionContextBar and VenueSummary components"
```

---

### Task 10: Extract SessionDetailsEditor

**Files:**
- Create: `components/admin/SessionDetailsEditor.tsx`

- [ ] **Step 1: Create the editor**

This extracts the "Badminton Details" card from the current SessionEditor. It's a focused form for venue, courts, max players, cost, bird tubes, sign-ups, and show cost toggle.

Read the current SessionEditor in `components/AdminTab.tsx` (around lines 155-555) to understand the exact form fields, state management, and save logic. Then create `components/admin/SessionDetailsEditor.tsx` that:

- Accepts `onBack: () => void` prop
- Fetches session data on mount from `GET /api/session`
- Renders `AdminBackHeader` with title "Session Details" and session date badge
- Shows the venue name, address, courts/max/cost grid, bird tubes/show cost grid, and signups toggle
- Save calls `PUT /api/session` with the form data (same logic as existing)
- Uses the same `Label` helper pattern from AdminTab
- Save button returns to dashboard via `onBack()`

The component should be self-contained — own state, own fetch, own save. No prop drilling from dashboard.

Include a local `Label` component:
```tsx
function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{text}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit components/admin/SessionDetailsEditor.tsx`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add components/admin/SessionDetailsEditor.tsx
git commit -m "feat: add SessionDetailsEditor drill-down component"
```

---

### Task 11: Extract DateTimeEditor

**Files:**
- Create: `components/admin/DateTimeEditor.tsx`

- [ ] **Step 1: Create the date/time editor**

Extracts the "Date & Time" card from current SessionEditor. Accepts `onBack: () => void`. Fetches session, shows 3 date+time pairs (session, deadline, end), save calls PUT.

Uses `DatePicker` component for dates and `<input type="time">` for times. Same `withLocalTz` helper as current SessionEditor.

Include the `withLocalTz` function inline:
```tsx
function withLocalTz(date: string, time: string): string {
  if (!date || !time) return '';
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/DateTimeEditor.tsx
git commit -m "feat: add DateTimeEditor drill-down component"
```

---

### Task 12: Adapt MembersView and BirdInventoryView

**Files:**
- Create: `components/admin/MembersView.tsx`
- Create: `components/admin/BirdInventoryView.tsx`

- [ ] **Step 1: Create MembersView**

Extract `MembersPanel` + `AliasesPanel` from AdminTab.tsx. Wrap with `AdminBackHeader`. Same functionality, just wrapped in a drill-down view instead of a tab section. This is a lift-and-shift — copy the existing code, add the back header, remove the segment control dependency.

- [ ] **Step 2: Create BirdInventoryView**

Convert the existing `BirdInventorySheet` bottom sheet into a full-screen drill-down view. Remove the portal/backdrop/drag-handle. Add `AdminBackHeader`. Same purchase form and list, just not in a modal.

- [ ] **Step 3: Commit**

```bash
git add components/admin/MembersView.tsx components/admin/BirdInventoryView.tsx
git commit -m "feat: add MembersView and BirdInventoryView drill-down components"
```

---

### Task 13: Create AdminDashboard and wire everything together

**Files:**
- Create: `components/admin/AdminDashboard.tsx`
- Modify: `components/AdminTab.tsx`

- [ ] **Step 1: Create AdminDashboard**

This is the main orchestrator. It manages:
- `view` state (`AdminView` type)
- Session data fetch (shared across dashboard components)
- Routing between dashboard and drill-down views

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Player, Announcement } from '@/lib/types';
import type { AdminView } from './types';
import SessionContextBar from './SessionContextBar';
import VenueSummary from './VenueSummary';
import SessionDetailsEditor from './SessionDetailsEditor';
import DateTimeEditor from './DateTimeEditor';
import MembersView from './MembersView';
import BirdInventoryView from './BirdInventoryView';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onLogout: () => void;
}

export default function AdminDashboard({ onLogout }: Props) {
  const [view, setView] = useState<AdminView>('dashboard');
  const [session, setSession] = useState<Session | null>(null);
  // ... players, announcements state
  // ... fetch logic

  const goBack = useCallback(() => setView('dashboard'), []);

  // Drill-down views
  if (view === 'session-details') return <div className="animate-slideInRight"><SessionDetailsEditor onBack={goBack} /></div>;
  if (view === 'date-time') return <div className="animate-slideInRight"><DateTimeEditor onBack={goBack} /></div>;
  if (view === 'members') return <div className="animate-slideInRight"><MembersView onBack={goBack} /></div>;
  if (view === 'birds') return <div className="animate-slideInRight"><BirdInventoryView onBack={goBack} /></div>;
  // ... advance, players-full

  // Dashboard view
  return (
    <div className="space-y-3 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h2 className="font-semibold" style={{ color: 'var(--accent)' }}>Admin</h2>
        <button onClick={onLogout} className="text-xs transition-colors flex items-center gap-1" style={{ color: 'var(--text-muted)', minHeight: 44 }}>
          <span className="material-icons" style={{ fontSize: 16 }}>logout</span>
          Sign out
        </button>
      </div>

      {/* Session context */}
      <SessionContextBar session={session} onEditDates={() => setView('date-time')} />

      {/* Venue summary */}
      <VenueSummary session={session} onEdit={() => setView('session-details')} />

      {/* Players card — inline from existing AdminPlayersPanel logic */}
      {/* ... player list, add form, payment toggles */}

      {/* Announcements card — inline from existing AnnouncementsPanel logic */}
      {/* ... compose + list */}

      {/* Quick access buttons */}
      <div className="flex gap-3">
        <button onClick={() => setView('members')} className="btn-ghost flex-1" style={{ minHeight: 44 }}>
          Members
        </button>
        <button onClick={() => setView('birds')} className="btn-ghost flex-1" style={{ minHeight: 44 }}>
          Birds
        </button>
      </div>

      {/* Advance button */}
      <button onClick={() => setView('advance')} className="btn-primary w-full" style={{ minHeight: 44 }}>
        Next Week →
      </button>
    </div>
  );
}
```

Note: The players card and announcements card should be extracted inline or as sub-components within this file. The full player list (with removed players, CSV export, clear/purge) should be in the `players-full` drill-down view.

- [ ] **Step 2: Update AdminTab.tsx to use AdminDashboard**

Replace the entire `AdminPanel` function body in `components/AdminTab.tsx` with:

```tsx
function AdminPanel({ onLogout }: { onLogout: () => void }) {
  return <AdminDashboard onLogout={onLogout} />;
}
```

Remove all the extracted code (SessionEditor, MembersPanel, AliasesPanel, AdminPlayersPanel, AnnouncementsPanel, BirdInventorySheet, helper components). AdminTab.tsx should only contain the PIN gate logic + AdminPanel wrapper.

- [ ] **Step 3: Verify full app works**

Run: `npm run build`
Run: `npm test`
Expected: Clean build, all tests pass

- [ ] **Step 4: Manual verification**

Run: `npm run dev` → log in as admin
Verify:
- Dashboard shows session bar, venue summary, player list, announcements
- Tapping ✎ on session bar opens date/time editor with slide-in animation
- Tapping ✎ on venue opens session details editor with slide-in animation
- Back button returns to dashboard with fade-in
- Members button opens members drill-down
- Birds button opens inventory drill-down
- "Next Week →" opens advance form
- All existing functionality works (add/remove players, toggle paid, post announcements)
- Works in both dark and light themes

- [ ] **Step 5: Commit**

```bash
git add components/admin/ components/AdminTab.tsx
git commit -m "feat: admin tab dashboard + drill-down architecture"
```

---

### Task 14: Final cleanup and tests

**Files:**
- Modify: `components/AdminTab.tsx` (remove dead code)
- Run: all tests

- [ ] **Step 1: Remove any dead code from AdminTab.tsx**

After extraction, AdminTab.tsx should be ~100-150 lines (PIN gate + AdminPanel wrapper + Label helper if still needed). Remove any leftover functions, imports, or state that's no longer used.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All 52 tests pass. The admin API tests don't test UI components, so they should be unaffected.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add components/AdminTab.tsx
git commit -m "chore: remove dead code from AdminTab after decomposition"
```
