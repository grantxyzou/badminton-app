# P1 Skills Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Skills tab to the bottom nav with a "Progress together?" placeholder screen, and land the ACE Skills Matrix as a structured data file for future use.

**Architecture:** Extend the existing `Tab` type and `BottomNav` to include a 4th tab. The tab uses stacked text instead of an icon. A new `SkillsTab` component renders centered placeholder text. The ACE matrix data is stored as a typed constant in `lib/skills-data.ts`.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, CSS custom properties (theme system)

---

### Task 1: Add ACE Skills Matrix data file

**Files:**
- Create: `lib/skills-data.ts`

- [ ] **Step 1: Create `lib/skills-data.ts` with typed data**

```typescript
export interface SkillLevel {
  level: number;
  name: string;
}

export interface SkillDimension {
  id: string;
  name: string;
  description: string;
  levels: Record<number, string>;
}

export const SKILL_LEVELS: SkillLevel[] = [
  { level: 1, name: 'Beginner' },
  { level: 2, name: 'Recreational' },
  { level: 3, name: 'Intramural' },
  { level: 4, name: 'Varsity' },
  { level: 5, name: 'Provincial Team' },
];

export const SKILL_DIMENSIONS: SkillDimension[] = [
  {
    id: 'grip-stroke',
    name: 'Grip & Stroke',
    description: 'Ability to use appropriate grip per shot and to perform strokes that achieve the intended shot, and provide the player with maximum options. Also includes the ability to use deception.',
    levels: {
      1: "Fixed grip, often 'frying pan' or backhand only. May emulate grip from other racquet sports.",
      2: 'Usually self-taught. Grip is fixed in one or two positions and overly firm. Mostly uses elbow, shoulder and body to generate power. Backhand very weak and inconsistent.',
      3: 'Starting to use wrist to generate power, but still relies on elbow and shoulder for power. Can switch grip given enough time. Backhand stronger, but inconsistent and still using hinged wrist/elbow.',
      4: 'Primarily uses wrist rotation for power and precision. Backhand may still be significantly weaker, but can return shots consistently and with reasonable depth and precision. Deception more practiced and used more effectively, but still only for a few shots and somewhat inconsistent.',
      5: 'Uses wrist and fingers to generate power and maximize deception and shot-making options. Advanced-level use of a variety of deception techniques, used consistently.',
    },
  },
  {
    id: 'movement',
    name: 'Movement',
    description: 'Both individual movement technique, speed, efficiency, and stamina, as well as understanding the appropriate positioning and movement for singles, doubles, and mixed doubles.',
    levels: {
      1: "Usually moves too slow or too fast, frequently unable to reach shuttle. Difficulty anticipating opponents' shot trajectory.",
      2: 'Can reach the shuttle most of the time, but movement not efficient. No split step or scissor kick. Frequently forgets proper doubles positioning / rotation.',
      3: "Movement becoming more efficient. Scissor kick used when time permits. Still no consistent split step. Understands doubles rotation and 'returning to base' for singles. Struggles with Mixed positioning.",
      4: 'Simple (1-2 step) movement patterns now practiced and becoming more efficient. Split step is used 25-50% of the time. Starting to understand when to adjust position when opponents\' shots are predictable or limited.',
      5: "Movement is very fast and efficient. Split step is used 80-90% of the time. Positioning optimized to take advantage of any weakness in opponents' shots, and to defend against deception. Can move/rotate effectively in all events, but specializes in 1-2.",
    },
  },
  {
    id: 'serve-return',
    name: 'Serve & Return',
    description: 'Skill in initiating rallies with quality and consistent serves and returns with the intent of gaining and maintaining an advantage of opponents.',
    levels: {
      1: 'Inconsistent (less than 50%). Unable to control height or angle. Focused on keeping shots in the court.',
      2: 'Serve is becoming more consistent (50-70%). Short serve is high, long/flick serve is short. Serve return predictable based on serve trajectory.',
      3: 'Short serve (60-80%) is tighter when not under pressure, but still predictable. Long serve (70-80%) deeper, harder to attack. Starting to add some variety to serve return, getting occasional winner.',
      4: 'Short and long serve are both 90%+, though many still get attacked regularly. Moves to intercept serve to maximize shot options, and varies return based on opponents\' positioning and weaknesses.',
      5: 'Serve consistency very high (98%+) and is very difficult to attack. Able to add some deception and variety to serve when applicable. Serve return is always aggressive to maintain pressure on opponent(s).',
    },
  },
  {
    id: 'offense',
    name: 'Offense',
    description: "Ability to gain and maintain offense with appropriate use of attack-clears, drops, drives, smashes and variations on these.",
    levels: {
      1: 'Mostly focused on keeping shot in the court. May attack whenever possible, even if not in position.',
      2: 'May have developed power, but not much consistency. Unforced errors are very common. Attacks are flat and only one speed depending on attacking position.',
      3: 'Has distinct clear, smash, and drop now, but always executed with the same power and angle (depending on attacking position). Starting to consistently direct shots to weaker opponent in doubles, or opponent\'s backhand in singles.',
      4: 'When in position, lifts/clears are consistently high and deep, other shots consistently tight to the net. Starting to consciously vary both power and angle of shots to test opponents\' defense and avoid predictability.',
      5: 'Able to consistently maintain offense through deception, speed, positioning, and grip adjustment. Generally few unforced errors unless under high pressure. Varies attack speed and angle to keep opponents off balance.',
    },
  },
  {
    id: 'defense',
    name: 'Defense',
    description: 'Ability to defend against offensive shots using clears, lifts, blocks, drives, net-play and variations on these.',
    levels: {
      1: "Unable to consistently read opponent's shots. Unable to defend against shots with pace.",
      2: "Has developed some defense against certain shots. Unexpected attack angles / speeds generate errors.",
      3: 'Becoming able to anticipate attacks and defend against them. Not yet able to predictably convert defense into offense. Still gets caught by unexpected shots, and awkward angles.',
      4: 'Now able to defend against quality attacks and take advantage of weak attacks such as drive/drop return of smash or executing tight net returns. Able to redirect on defense when in position.',
      5: 'Intercepts shuttle as soon as possible to maximize defensive angles. Able to consistently use deception when receiving weak offensive shots.',
    },
  },
  {
    id: 'strategy',
    name: 'Strategy',
    description: "The ability to construct rallies and series of rallies that capitalize on player's (and partner's) own strengths / opponents' weaknesses.",
    levels: {
      1: 'No strategy per se, other than keeping shots in the court.',
      2: "May try to keep the rally going, or may try to attack everything. May be starting to use openings in opponents' defense when obvious.",
      3: 'Tries to pull opponents out of position to create openings, but only using single shots and not able to execute consistently.',
      4: 'Starting to think in terms of shot and movement patterns, stringing 2-3 shots in a row to achieve an advantage. Able to adjust strategy based on opponents, and based on own level of fatigue.',
      5: "Analyses opponents strengths and weaknesses to optimize strategy based on own skills. Advanced understanding of movement and shot patterns, and when to use them.",
    },
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    description: 'Understanding of the sport, including the Laws of Badminton, and competitive-level court and club etiquette.',
    levels: {
      1: 'May or may not understand scoring and lines. Difficulty remembering score. No sense of sport-specific etiquette.',
      2: 'Understands line calls and scoring. May not know service rules, tournament formats, etc. Etiquette depends on background.',
      3: 'Understands the sport rules. Has played at multiple clubs, and understands etiquette, though may not apply it.',
      4: 'Understands the sport rules, etiquette and tournament formats. Can reasonably assess level of play relative to own.',
      5: 'Complete understanding of sport up to the provincial or national level of competition.',
    },
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit lib/skills-data.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/skills-data.ts
git commit -m "feat: add ACE Skills Matrix data file (7 dimensions, 5 levels)"
```

---

### Task 2: Extend Tab type and add Skills tab to BottomNav

**Files:**
- Modify: `app/page.tsx:14` (Tab type)
- Modify: `components/BottomNav.tsx:11-15` (TABS array), `components/BottomNav.tsx:23-39` (render logic)

- [ ] **Step 1: Update Tab type in `app/page.tsx`**

Change line 14 from:
```typescript
export type Tab = 'home' | 'players' | 'admin';
```
to:
```typescript
export type Tab = 'home' | 'players' | 'skills' | 'admin';
```

- [ ] **Step 2: Update TABS array in `components/BottomNav.tsx`**

Change the TABS array to support an optional `textOnly` flag and add the skills entry between Sign-Ups and Admin:

```typescript
const TABS: { id: Tab; label: string; icon?: string; textLines?: string[] }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'players', label: 'Sign-Ups', icon: 'group' },
  { id: 'skills', label: 'Coming Soon', textLines: ['Coming', 'Soon'] },
  { id: 'admin', label: 'Admin', icon: 'admin_panel_settings' },
];
```

- [ ] **Step 3: Update BottomNav render to handle text-only tabs**

Replace the button content inside the `.map()` to conditionally render icon or stacked text:

```tsx
<button
  key={tab.id}
  onClick={() => onTabChange(tab.id)}
  aria-label={tab.label}
  aria-current={active ? 'page' : undefined}
  className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-all rounded-xl ${active ? 'nav-tab-active' : ''}`}
  style={{ color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)' }}
>
  {tab.icon ? (
    <>
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 24 }}>
        {tab.icon}
      </span>
      <span className="text-xs font-medium" aria-hidden="true">{tab.label}</span>
    </>
  ) : (
    <span className="text-[10px] font-medium leading-tight text-center" aria-hidden="true">
      {tab.textLines?.map((line, i) => (
        <span key={i} className="block">{line}</span>
      ))}
    </span>
  )}
</button>
```

- [ ] **Step 4: Verify the app compiles**

Run: `npm run dev` and check for compile errors in terminal. The skills tab should appear in the nav but clicking it shows nothing yet (no SkillsTab component rendered).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/BottomNav.tsx
git commit -m "feat: add Skills tab to bottom nav with stacked 'Coming Soon' text"
```

---

### Task 3: Create SkillsTab component and wire it up

**Files:**
- Create: `components/SkillsTab.tsx`
- Modify: `app/page.tsx:6,60-62` (import + render)

- [ ] **Step 1: Create `components/SkillsTab.tsx`**

```tsx
'use client';

export default function SkillsTab() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 12rem)' }}>
      <p className="text-2xl font-semibold text-center" style={{ color: 'var(--text-muted)' }}>
        Progress together?
      </p>
    </div>
  );
}
```

Notes for the implementer:
- `min-height: calc(100vh - 12rem)` accounts for top padding (`pt-6`) and bottom nav + safe area (`pb-32`). This centers the text in the visible area.
- `var(--text-muted)` is `rgba(255,255,255,0.35)` in dark mode and the light-mode equivalent — already defined in `globals.css`.
- No `'use client'` directive is technically needed (no hooks/state), but include it for consistency with other tab components.

- [ ] **Step 2: Wire SkillsTab into `app/page.tsx`**

Add import after line 7:
```typescript
import SkillsTab from '@/components/SkillsTab';
```

Add render line after the players tab render (after line 61):
```tsx
{activeTab === 'skills' && <SkillsTab />}
```

The render block should now look like:
```tsx
{activeTab === 'home' && <HomeTab onTabChange={setActiveTab} onTitleTap={handleTitleTap} />}
{activeTab === 'players' && <PlayersTab />}
{activeTab === 'skills' && <SkillsTab />}
{activeTab === 'admin' && showAdmin && <AdminTab />}
```

- [ ] **Step 3: Verify in browser**

Run: `npm run dev` → open `http://localhost:3000/bpm`
Expected:
- Bottom nav shows 4 tabs: Home, Sign-Ups, Coming Soon (stacked text), Admin
- "Coming Soon" tab has no icon, just two lines of text, same width as other tabs
- Clicking "Coming Soon" tab shows "Progress together?" centered on screen in muted text
- Text is visible in both dark and light themes (toggle with theme button)
- Admin tab still hidden/shown based on role (existing behavior unchanged)

- [ ] **Step 4: Commit**

```bash
git add components/SkillsTab.tsx app/page.tsx
git commit -m "feat: add SkillsTab placeholder with 'Progress together?' centered text"
```

---

### Task 4: Update Member stage field comment

**Files:**
- Modify: `lib/types.ts:36`

- [ ] **Step 1: Update the stage comment to reflect 5 levels**

Change line 36 from:
```typescript
  stage?: number;        // 1-4 skill stage (P1)
```
to:
```typescript
  stage?: number;        // 1-5 ACE skill level
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "fix: update Member.stage comment to match ACE 5-level scale"
```
