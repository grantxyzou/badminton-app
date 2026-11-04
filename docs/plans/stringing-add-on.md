# Stringing as an add-on service

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups), and the rule that how a club runs is a SETTING (`lib/clubRun.ts`, `six-feathers-onboarding.md`).
**Status:** intent — parked in the backlog by Grant on 2026-11-04 ("plan it but back log"); nothing built.
**Review on:** 2026-11-25 — the multi-group review: did the second club need the Stringing tab gone, or did it simply never tap it? If a club with no stringer has run a session, this moves to "ready to build".

## Problem

Grant, 2026-11-04: *"Separate out stringing service so it's an add on service. Rather than a mandatory."*

Stringing is on or off for the whole deployment today — `NEXT_PUBLIC_FLAG_STRINGING`, a build-time flag read by the console and the shell — so every club gets the Stringing tab, the bench row, the stringing lines on the balance and the stringing pushes, whether or not anyone on its roster strings. Six Feathers, the first outside club in view, has no stringer. The money switch (`money: 'off'`) is the precedent: off hides the Payments card and every bill, and the club reads exactly as before when the setting is absent.

Nobody outside BPM has reported this yet. It is Grant's read ahead of a second club.

## Kill criterion

- If by the review date no club other than BPM Core exists with a session run, there is nothing to switch off for, and this waits with the multi-group gate rather than being built ahead of it.
- Once built: if the first outside club turns stringing ON within a month of joining, the default was wrong and "off by default" is reverted to "on by default, switchable".

## Non-goals

- A per-member stringing opt-out. The switch is the club's, like money.
- Charging for the add-on, a marketplace, or a stringer directory across clubs. "Add-on" means a club feature the organiser switches on, nothing commercial.
- Retiring `NEXT_PUBLIC_FLAG_STRINGING`. The flag stays as the deployment-wide kill switch; the setting sits under it.
- A new tab in the freed slot. With stringing off the nav has three tabs; what else could take the slot is a separate decision.

## Shape (proposed, not built)

| Piece | Where |
|---|---|
| `stringing: 'on' \| 'off'` on `GroupSettings.run`, filled in by the club's style (`first_come` on, `members_first` off); absent means BPM, so BPM Core reads as before | `lib/clubRun.ts`, `parseClubRun`, `memberVisibleSettings`, `useClubRun()` |
| The switch on "How your club runs", beside money | `components/admin/CommandCenter/ClubRunPage.tsx` |
| Off hides: the Stringing tab (the nav drops to three), the bench row and bench signals in "needs you", the stringing lines on Home's balance and in `computeOwed`, the request and status pushes, the stringing shortcut on the long-press menu | `components/HomeShell.tsx`, `CommandCenter.tsx`, `lib/useAdminNeedsYou.ts`, `lib/owedBalance.ts`, `lib/stringingNotifyDispatch.ts`, `lib/stringingRequestNotify.ts`, `lib/appShortcuts.ts` |
| A club that switches OFF with open jobs keeps them readable on the bench until they are archived — a setting never hides money owed | `lib/stringingBilling.ts` |
| Tests: the two-club gate (`__tests__/group-isolation-*`) gains "stringing off in club B hides nothing in club A" | `__tests__/` |
