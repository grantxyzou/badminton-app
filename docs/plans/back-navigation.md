# Back returns to the page you came from

**Track:** admin cost-automation (North Star pillar 3) — the organiser's console is where a club is run, and a Back that loses the admin's place costs taps on every visit. Also the native shell's back-button policy (`docs/plans/native-shell.md`), which store reviewers test.
**Status:** shipped 2026-11-05
**Review on:** 2026-12-03 — has anyone reported a Back (on screen or Android's button) landing somewhere other than the page they came from?

## Problem

Grant, 2026-11-05: *"Audit each page and UI's navigation path. Some are out of order, ie: forward to a page then back takes me to a page before in admin."*

The app has no router: the admin console, Profile's sub-screens and the Stats pages render their pages in place. Admin kept only the CURRENT page, and every page's Back went to the console, so any page opened from another page skipped its parent on the way back.

## Kill criterion

A Back, on screen or Android's button, that lands anywhere but the page the person came from, found after this ships. Each one is a missing push onto a trail, not a reason to add a router.

## Non-goals

- **A URL per page or browser history.** The tab is deliberately not in the URL (CLAUDE.md, "Active tab persists in sessionStorage"), and pages follow it.
- **Changing where any page opens from.** Only where Back goes.

## The audit

Every page that can be opened from another page, walked forward and back on the mock store (`SEED_DEV_SCENARIO=six-feathers` with BPM Core beside it), 2026-11-05.

| Path | Back should go to | Back went to | Fix |
|---|---|---|---|
| Console → How your club runs → Late cancellations | How your club runs | the console | admin trail |
| Console → Sign-in readiness → a member (Roster) | Sign-in readiness | the console | admin trail |
| Console → Ledger → Past sessions → a session (Payments) | Past sessions, then Ledger | correct (hand-wired `goBackTo`) | the trail replaces the hand wiring |
| Console → Ledger → a session (Payments) | Ledger | correct (hand-wired) | the trail replaces the hand wiring |
| Bench → Archive → a job | Archive | the bench | bench trail |
| Bench → a job → Add a hole count (Set-up) | the job | the bench | bench trail |
| Any admin page, **Android back button** | the page before it | Home | page stack |
| Admin console, **Android back button** | Profile (where Admin opens from, and where its own back arrow goes) | Home | page stack |
| Profile → Stats & privacy or Your clubs, **Android back** | Profile | Home | page stack |
| Stats → Your fit → a racket's page, **Android back** | Your fit | Home | page stack |
| Stats → Play → All your kudos, **Android back** | Play | Home | page stack |
| The same Stats and Profile paths, **on-screen Back** | the page before | correct (Stats already kept a stack; Profile is one level) | none |
| A reload on an admin page two deep | that page, then its parent | the page, then the console | the trail is what's kept across a reload |

The Stringing tab's Racket / Strings / Bench switch is a segmented control, not a page stack, and was left as it is.

## Decisions

- **Admin keeps a TRAIL, not a page.** `AdminDashboard` holds the pages above the console; opening one pushes it, Back pops one. The Ledger's hand-wired `paymentsFrom` / `goBackTo` went with it. Pull-to-refresh and a reload keep the trail as far as each page can be restored (Payments needs the session it was opened for, so the trail stops below it). An old single-view entry in `sessionStorage` still restores.
- **The bench keeps its own trail** for its job, Archive, intake and Set-up pages.
- **The rules are one pure helper** (`lib/viewTrail.ts`), shared by both, so they are tested without rendering a console.
- **Android's back button asks the pages before the tabs** (`lib/pageStack.ts`, the twin of `lib/sheetStack.ts`): a sheet closes first, then the innermost open page goes back one, then a non-Home tab goes Home. A screen registers its Back only while its tab is on screen, so a kept tab behind another never answers. Pages nested inside a page (the bench's inside the admin trail) register one level deeper, so the innermost wins whatever order the effects ran in.
- **The admin console answers Android's back by returning to Profile**, as its own back arrow does, rather than jumping Home.

## Shape

| piece | file |
|---|---|
| Trail rules (push, pop, top) | `lib/viewTrail.ts` |
| The page stack the back button reads | `lib/pageStack.ts` (`usePageBack`) |
| The back-button policy | `components/NativeBridge.tsx` |
| Admin's trail, and its restore across a reload | `components/admin/AdminDashboard.tsx` |
| The console back to Profile | `components/AdminTab.tsx` |
| The bench's trail | `components/admin/CommandCenter/StringingPage.tsx` |
| Profile, Stats register pages, All your kudos | `components/ProfileTab.tsx`, `components/stats/GearRegister.tsx`, `components/SkillsTab.tsx` |

Tests: `__tests__/back-navigation.test.ts` (the trail's push and pop, the Ledger → Past sessions → Payments trail, depth order for the back button). The admin paths above were walked in Playwright after the change; the Android button cannot be pressed in a browser, so its order is held by the unit test.
