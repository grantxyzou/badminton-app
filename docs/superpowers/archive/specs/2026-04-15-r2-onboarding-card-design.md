# R2 — First-Time Onboarding Card + 403 Fix (Design Spec)

**Date:** 2026-04-15
**Roadmap item:** P1.6 R2 (Research finding #4 — first-time onboarding)
**Status:** Design approved; awaiting plan

---

## 1. Purpose

New users (Amy, Emily, Uncle Chen) arrive at BPM with no context — they don't know it's invite-only, don't understand the sign-up flow, and hit a cryptic 403 ("hmmmm... please use the name we know you by") that causes abandonment. This spec addresses both sides:

- **Proactive:** a dismissable welcome card on first visit that explains what BPM is, the invite requirement, and payment expectations.
- **Reactive:** a rewritten 403 error that explains what "not on the invite list" means and what to do about it.

Both surfaces ship bilingual (EN + zh-CN) on day one, since the primary affected users (Uncle Chen, Amy) are Chinese-primary.

## 2. Goals

- First-time visitors understand BPM's purpose, invite-list model, and payment expectation within 10 seconds of landing.
- Players who hit the invite-list 403 get actionable guidance (check spelling, contact inviter) instead of a cryptic message.
- Existing players (Priya, Marcus, Kevin) see zero change — the card never renders for them.
- All new text is bilingual from day one.

## 3. Non-goals

- Admin-configurable contact info (phone/WeChat/email). Current scope uses generic "ask the friend who shared this with you" phrasing. Specific admin contact is a future enhancement.
- Onboarding flow for other tabs (Sign-Ups, Skills, Admin) — Home only.
- Animated dismiss transitions.
- Tutorial/coachmarks beyond a single card.

## 4. Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Scope | Both proactive welcome card + reactive 403 fix |
| Form factor | Inline dismissable glass-card at top of HomeTab |
| Content style | Three-bullet with emoji (📅🎟️💵) |
| Persistence | localStorage `badminton_onboarding_dismissed`; dismissed via X or auto on signup |
| Migration | Existing users silently flagged on mount if `hasIdentity` is true |
| 403 wording | Echoes typed name, explains invite list, names the action |
| Bilingual | EN + zh-CN on first ship |

## 5. Architecture

Two independent surfaces, both client-side, no Cosmos or auth changes.

### Surface A: Welcome card

```
HomeTab mount
  ├─ hasIdentity? (from localStorage)
  │   ├─ true → onboardingDismissed flag? set silently if missing (B1 migration)
  │   └─ false → onboardingDismissed flag?
  │       ├─ true → don't render card
  │       └─ false → render <WelcomeCard onDismiss={handler} />
  │
  └─ WelcomeCard renders:
      ┌───────────────────────────────────────┐
      │ Welcome to BPM Badminton          [X] │
      │ 📅 Weekly sessions on Thursdays       │
      │ 🎟️ Invite-only — your name needs ...  │
      │ 💵 Pay your share via e-transfer ...   │
      │                                       │
      │ Ask the player who shared this ...     │
      └───────────────────────────────────────┘
```

- Component: `components/WelcomeCard.tsx` (new, ~30 lines)
- Props: `{ onDismiss: () => void }`
- Translations: `useTranslations('home.welcome')`
- Styling: `glass-card p-5 space-y-3` with dismiss button `absolute top-3 right-3`
- Position in HomeTab: first child of `<div className="space-y-5">`, above "BPM Badminton" title

### Surface B: 403 error fix

```
User types name → POST /api/players
  ├─ 200 → success (existing flow)
  ├─ 403 { error: 'invite_list_not_found', name: 'Xyz' }
  │   └─ HomeTab maps: t('signup.inviteError', { name: 'Xyz' })
  │      → "We don't have "Xyz" on our invite list. Check the spelling, ..."
  └─ other errors → existing fallback
```

- API change: `app/api/players/route.ts` returns machine-readable code `invite_list_not_found` + `name` field (was hardcoded English string)
- Client change: `HomeTab` detects this code in the error handler and renders via `t('signup.inviteError', { name })` instead of displaying the raw API string
- Other 403s (`sign-ups not open`, `deadline passed`) remain unchanged (they're already clear)

## 6. File changes

```
components/
  WelcomeCard.tsx              [NEW]   ~30 lines
  HomeTab.tsx                  [MODIFY] render WelcomeCard, migration, error-code mapping
messages/
  en.json                      [MODIFY] +8 keys
  zh-CN.json                   [MODIFY] +8 keys
app/api/players/route.ts       [MODIFY] 1-line error response change
__tests__/
  components/
    WelcomeCard.test.tsx       [NEW]   ~4 tests
  (existing player API tests)  [MODIFY] assert new error code shape
```

## 7. i18n keys (+8)

All keys nested under `home.welcome.*` and `home.signup.*`.

| Key | EN | zh-CN |
|---|---|---|
| `home.welcome.title` | `Welcome to BPM Badminton` | `欢迎来到 BPM 羽毛球` |
| `home.welcome.schedule` | `📅 Weekly sessions on Thursdays` | `📅 每周四活动` |
| `home.welcome.invite` | `🎟️ Invite-only — your name needs to be added` | `🎟️ 仅限邀请 — 需要先添加您的名字` |
| `home.welcome.payment` | `💵 Pay your share via e-transfer after the session` | `💵 活动后通过 e-transfer 支付您的费用` |
| `home.welcome.help` | `Ask the player who shared this with you for help.` | `请联系分享此应用给您的朋友获取帮助。` |
| `home.welcome.dismiss` | `Got it` | `知道了` |
| `home.signup.inviteError` | `We don't have "{name}" on our invite list. Check the spelling, or ask the friend who shared this app with you to add you.` | `邀请名单上没有"{name}"。请检查拼写，或联系分享此应用的朋友将您添加。` |
| `home.signup.networkError` | `Network error. Please try again.` | `网络错误，请重试。` |

zh-CN translations are first-pass, subject to native-speaker review.

Total canary count after R2: 14 (existing) + 8 (new) = **22 keys**.

## 8. Dismiss + migration logic

```typescript
// In HomeTab, on mount:
const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
  if (typeof window === 'undefined') return true; // SSR: hide card
  return localStorage.getItem('badminton_onboarding_dismissed') === 'true';
});

// B1 migration: existing users silently flagged
useEffect(() => {
  if (hasIdentity && !onboardingDismissed) {
    localStorage.setItem('badminton_onboarding_dismissed', 'true');
    setOnboardingDismissed(true);
  }
}, [hasIdentity, onboardingDismissed]);

// Dismiss handler passed to WelcomeCard
function dismissOnboarding() {
  localStorage.setItem('badminton_onboarding_dismissed', 'true');
  setOnboardingDismissed(true);
}

// Render condition:
{!hasIdentity && !onboardingDismissed && (
  <WelcomeCard onDismiss={dismissOnboarding} />
)}
```

## 9. Error-code mapping in HomeTab

```typescript
// In the sign-up error handler (existing setError flow):
if (!res.ok) {
  if (data.error === 'invite_list_not_found') {
    setError(t('signup.inviteError', { name: name.trim() }));
  } else {
    setError(data.error ?? t('signup.fallbackError'));
  }
}
```

Same pattern for the waitlist join handler.

## 10. Testing

### New: `__tests__/components/WelcomeCard.test.tsx` (~4 tests, jsdom)

1. Renders title + 3 bullets + help text in EN
2. Renders zh-CN content when locale is zh-CN
3. Calls `onDismiss` callback when dismiss button clicked
4. Dismiss button has accessible aria-label

### Modified: existing player API tests

- Assert invite-list 403 returns `{ error: 'invite_list_not_found', name: '<typed-name>' }` instead of the old hardcoded string.

### Not tested (deliberate)

- localStorage migration (B1) — 3 lines of if/set, low ROI to mock
- Visual positioning of the card within HomeTab card stack

## 11. Rollout

Single commit or small PR. No feature flag. No Cosmos migration.

- New users: see the welcome card on first visit; see improved 403 if they type a non-invite name.
- Existing users: see nothing (silent migration flags them as dismissed on first mount).
- If something goes wrong: revert the commit; no data to migrate back.

## 12. Out of scope / follow-up

- Admin-configurable contact info (specific name/phone/WeChat for "who to contact")
- Onboarding for non-Home tabs
- Animated card dismiss transition
- "Don't show again" checkbox (unnecessary — X dismiss is permanent)
- Translating remaining HomeTab error strings beyond the 403 (deferred to C2)
