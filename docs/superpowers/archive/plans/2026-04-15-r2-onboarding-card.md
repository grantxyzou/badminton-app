# R2 — First-Time Onboarding Card + 403 Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show first-time visitors a dismissable welcome card explaining BPM's invite-only model, and rewrite the invite-list 403 error with actionable guidance — both bilingual from day one.

**Architecture:** New `WelcomeCard` presentational component rendered at top of HomeTab when user has no identity and hasn't dismissed. API returns machine-readable error code; client maps it to a translated string. 8 new i18n keys in `messages/{en,zh-CN}.json`. No Cosmos or auth changes.

**Tech Stack:** Next.js 16, React 18, next-intl v4, Vitest 4, @testing-library/react.

---

## Spec reference
Design: `docs/superpowers/specs/2026-04-15-r2-onboarding-card-design.md`

## Project conventions to follow
- Vitest default env is `node`. Component tests require `// @vitest-environment jsdom` docblock.
- Vitest globals NOT configured — import `describe`, `it`, `expect`, `afterEach` from `vitest` explicitly.
- Component tests call `afterEach(cleanup)` manually.
- Components using `useTranslations()` must be wrapped in `<NextIntlClientProvider>` in tests.
- Commit style: `type: short description` (lowercase type — `feat`, `fix`, `test`, `docs`). Include Co-Authored-By footer.
- Run `npm test` between tasks to verify no regressions.

---

### Task 1: Add i18n keys for welcome card + invite error

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

- [ ] **Step 1: Add keys to `messages/en.json`**

Add `welcome` and update `signup` sections. The file currently has this structure under `"home"`:

```json
{
  "home": {
    "signup": {
      "heading": "Sign up",
      "button": "Sign Up",
      "waitlist": "Join Waitlist",
      "full": "Session Full",
      "confirmed": "Signed up as {name}"
    },
    ...existing keys...
  }
}
```

Add these new keys inside `"signup"`:

```json
"inviteError": "We don't have \"{name}\" on our invite list. Check the spelling, or ask the friend who shared this app with you to add you.",
"networkError": "Network error. Please try again."
```

Add a new `"welcome"` section as a sibling of `"signup"` inside `"home"`:

```json
"welcome": {
  "title": "Welcome to BPM Badminton",
  "schedule": "📅 Weekly sessions on Thursdays",
  "invite": "🎟️ Invite-only — your name needs to be added",
  "payment": "💵 Pay your share via e-transfer after the session",
  "help": "Ask the player who shared this with you for help.",
  "dismiss": "Got it"
}
```

- [ ] **Step 2: Add matching keys to `messages/zh-CN.json`**

Same structure. Add inside `"signup"`:

```json
"inviteError": "邀请名单上没有\"{name}\"。请检查拼写，或联系分享此应用的朋友将您添加。",
"networkError": "网络错误，请重试。"
```

Add `"welcome"` section:

```json
"welcome": {
  "title": "欢迎来到 BPM 羽毛球",
  "schedule": "📅 每周四活动",
  "invite": "🎟️ 仅限邀请 — 需要先添加您的名字",
  "payment": "💵 活动后通过 e-transfer 支付您的费用",
  "help": "请联系分享此应用给您的朋友获取帮助。",
  "dismiss": "知道了"
}
```

- [ ] **Step 3: Verify JSON parses**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8')); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "$(cat <<'EOF'
feat: add i18n keys for welcome card and invite-list error (R2)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create WelcomeCard component (TDD)

**Files:**
- Create: `components/WelcomeCard.tsx`
- Create: `__tests__/components/WelcomeCard.test.tsx`

- [ ] **Step 1: Write failing test `__tests__/components/WelcomeCard.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import WelcomeCard from '../../components/WelcomeCard';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

function renderWithLocale(locale: 'en' | 'zh-CN', onDismiss = vi.fn()) {
  const messages = locale === 'en' ? enMessages : zhMessages;
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <WelcomeCard onDismiss={onDismiss} />
    </NextIntlClientProvider>,
  );
  return onDismiss;
}

describe('WelcomeCard', () => {
  afterEach(cleanup);

  it('renders title and three bullet items in EN', () => {
    renderWithLocale('en');
    expect(screen.getByText('Welcome to BPM Badminton')).toBeTruthy();
    expect(screen.getByText(/Weekly sessions on Thursdays/)).toBeTruthy();
    expect(screen.getByText(/Invite-only/)).toBeTruthy();
    expect(screen.getByText(/Pay your share/)).toBeTruthy();
    expect(screen.getByText(/Ask the player who shared/)).toBeTruthy();
  });

  it('renders zh-CN content', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByText('欢迎来到 BPM 羽毛球')).toBeTruthy();
    expect(screen.getByText(/每周四活动/)).toBeTruthy();
    expect(screen.getByText(/仅限邀请/)).toBeTruthy();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = renderWithLocale('en');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismiss button has accessible label', () => {
    renderWithLocale('en');
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run __tests__/components/WelcomeCard.test.tsx`
Expected: FAIL — `Cannot find module '../../components/WelcomeCard'`.

- [ ] **Step 3: Implement `components/WelcomeCard.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';

interface WelcomeCardProps {
  onDismiss: () => void;
}

export default function WelcomeCard({ onDismiss }: WelcomeCardProps) {
  const t = useTranslations('home.welcome');

  return (
    <div className="glass-card p-5 space-y-3 relative">
      <button
        type="button"
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-200 transition-colors"
        onClick={onDismiss}
        aria-label={t('dismiss')}
      >
        <span className="material-icons" style={{ fontSize: '18px' }}>close</span>
      </button>
      <p className="text-lg font-bold text-gray-200">{t('title')}</p>
      <ul className="space-y-1.5 text-sm text-gray-300">
        <li>{t('schedule')}</li>
        <li>{t('invite')}</li>
        <li>{t('payment')}</li>
      </ul>
      <p className="text-xs text-gray-400">{t('help')}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `npx vitest run __tests__/components/WelcomeCard.test.tsx`
Expected: PASS, 4 tests.

Run: `npm test`
Expected: all prior tests still pass + 4 new.

- [ ] **Step 5: Commit**

```bash
git add components/WelcomeCard.tsx __tests__/components/WelcomeCard.test.tsx
git commit -m "$(cat <<'EOF'
feat: add WelcomeCard component for first-time visitors (R2)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update API error response for invite-list 403 (TDD)

**Files:**
- Modify: `app/api/players/route.ts`
- Modify: `__tests__/players.test.ts`

- [ ] **Step 1: Update the test assertion to expect the NEW error shape**

In `__tests__/players.test.ts`, find the test around line 170-177 that currently asserts:

```ts
expect(res.status).toBe(403);
expect(data.error).toContain('please use the name we know you by');
```

Replace with:

```ts
expect(res.status).toBe(403);
expect(data.error).toBe('invite_list_not_found');
expect(data.name).toBe('Stranger');
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run __tests__/players.test.ts`
Expected: FAIL — API still returns the old string.

- [ ] **Step 3: Update `app/api/players/route.ts`**

Find this line (around line 96):

```ts
return NextResponse.json({ error: 'hmmmm... please use the name we know you by' }, { status: 403 });
```

Replace with:

```ts
return NextResponse.json({ error: 'invite_list_not_found', name: trimmedName }, { status: 403 });
```

- [ ] **Step 4: Run to confirm tests pass**

Run: `npx vitest run __tests__/players.test.ts`
Expected: PASS.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/players/route.ts __tests__/players.test.ts
git commit -m "$(cat <<'EOF'
fix: return machine-readable error code for invite-list 403 (R2)

API now returns { error: 'invite_list_not_found', name } instead of a
hardcoded English string. Client maps the code to a locale-aware
translated message.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire HomeTab — render WelcomeCard + dismiss logic + error-code mapping

**Files:**
- Modify: `components/HomeTab.tsx`

- [ ] **Step 1: Read HomeTab.tsx and locate insertion points**

Open `components/HomeTab.tsx`. Identify:
- The imports section (top of file, lines 1-14)
- The state declarations (around lines 45-55)
- The `useEffect` for identity loading (around lines 60-100)
- The `handleSignUp` function (around lines 161-186)
- The `handleJoinWaitlist` function (around lines 189-213)
- The top of the JSX return (around line 224, the `<div className="space-y-5">`)

- [ ] **Step 2: Add import**

At the top of HomeTab.tsx, alongside existing component imports, add:

```tsx
import WelcomeCard from './WelcomeCard';
```

(It's a sibling component — use `./WelcomeCard`, not `@/components/WelcomeCard`.)

Note: HomeTab already imports `useTranslations` from `next-intl` and has `const t = useTranslations('home');` — reuse that. No new i18n import needed.

- [ ] **Step 3: Add onboarding state + migration logic**

After the existing `const [hasIdentity, setHasIdentity] = useState(false);` line (around line 54), add:

```tsx
const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem('badminton_onboarding_dismissed') === 'true';
});
```

After the existing `useEffect` that handles identity loading (around line 100, after the closing `}, []);`), add the B1 migration effect:

```tsx
// B1 migration: silently dismiss onboarding for existing users
useEffect(() => {
  if (hasIdentity && !onboardingDismissed) {
    localStorage.setItem('badminton_onboarding_dismissed', 'true');
    setOnboardingDismissed(true);
  }
}, [hasIdentity, onboardingDismissed]);
```

Add the dismiss handler function alongside the existing `handleSignUp` and `handleJoinWaitlist`:

```tsx
function dismissOnboarding() {
  localStorage.setItem('badminton_onboarding_dismissed', 'true');
  setOnboardingDismissed(true);
}
```

- [ ] **Step 4: Render WelcomeCard at top of card stack**

Inside the JSX, find the `<div className="space-y-5">` (the start of the card stack). Add the WelcomeCard as the FIRST child, before the "BPM Badminton" page title `<h1>`:

```tsx
<div className="space-y-5">
  {/* Onboarding card for first-time visitors */}
  {!hasIdentity && !onboardingDismissed && (
    <WelcomeCard onDismiss={dismissOnboarding} />
  )}

  {/* Page title — pulled out of the LOCATION tile ... */}
  <h1 ...>BPM Badminton</h1>
  ...
```

- [ ] **Step 5: Update error handlers to map invite-list error code**

In `handleSignUp` (around line 173), replace:

```tsx
if (!res.ok) {
  setError(data.error ?? 'Failed to sign up');
  if (res.status === 409) loadData();
}
```

With:

```tsx
if (!res.ok) {
  if (data.error === 'invite_list_not_found') {
    setError(t('signup.inviteError', { name: name.trim() }));
  } else {
    setError(data.error ?? 'Failed to sign up');
  }
  if (res.status === 409) loadData();
}
```

In `handleJoinWaitlist` (around line 201), replace:

```tsx
if (!res.ok) {
  setError(data.error ?? 'Failed to join waitlist');
}
```

With:

```tsx
if (!res.ok) {
  if (data.error === 'invite_list_not_found') {
    setError(t('signup.inviteError', { name: name.trim() }));
  } else {
    setError(data.error ?? 'Failed to join waitlist');
  }
}
```

- [ ] **Step 6: Run tests and smoke-check**

Run: `npm test`
Expected: all tests pass.

Optional manual smoke check:
- `npm run dev` → visit `/bpm`
- In a fresh private/incognito window (no localStorage), the welcome card should appear at top of Home
- Dismiss it via X → it should not reappear on refresh
- Type a random name and sign up → should see the translated invite-list error

- [ ] **Step 7: Commit**

```bash
git add components/HomeTab.tsx
git commit -m "$(cat <<'EOF'
feat: wire WelcomeCard in HomeTab with dismiss + invite error mapping (R2)

Renders WelcomeCard for first-time visitors (no identity + not dismissed).
Existing users silently flagged on mount (B1 migration). Invite-list
403 mapped to locale-aware translated message via t('signup.inviteError').

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan checklist (before push)

- [ ] All 4 tasks committed.
- [ ] `npm test` green (prior count + ~5 new tests).
- [ ] `npm run build` succeeds.
- [ ] Manual smoke: incognito visit shows welcome card; dismiss persists; typed stranger-name shows translated error; existing-user visit (with identity) does NOT show card.
- [ ] Both `messages/en.json` and `messages/zh-CN.json` parse, each with 22 total string-value keys under `home.*`.
- [ ] Push to main or open PR.
