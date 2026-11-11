# November audit: what was left, who it waits on

**Track:** none, and deliberately so. This is the tail of the 2026-11-05 audit
(performance, load speed, bugs, cost accuracy; grantxyzou/badminton-app#801),
the same posture as `docs/plans/infra-baseline.md`: making shipped work correct
and observable, not adding a surface.
**Status:** in-flight
**Review on:** 2026-11-19 — are the "Waits on Grant" rows below done or consciously dropped, and has a push arrived in Chinese on a real phone?

## Problem

Grant, 2026-11-05: "Anything else we didn't fix", then "Document these items
and then fix anything that's not requiring me, then update the document."

An audit's findings are a promise, and a finding that is only remembered is a
note. The eight sections of #801 fixed what code could fix; this file keeps
the rest in one place, split by who can do it.

## Kill criterion

This file has failed if, on its review date, a row in "Waits on Grant" is
neither done nor marked dropped with a reason. A list nobody reads back is the
same as no list.

## Non-goals

- Re-auditing. New findings get their own plan.
- Restating how anything works. The how lives in `CLAUDE.md`,
  `docs/azure.md` and the plans linked from each row.

## Fixed in this round (no action needed)

| Item | What was wrong | What changed |
|---|---|---|
| Rejoin race | A cancelled member rejoining while someone else signed up could both get the last spot. New sign-ups already checked for this after writing; a rejoin did not. | The rejoin runs the same after-write check (`reconcileCapacity` in `app/api/players/route.ts`) and puts the row back exactly as it was if it lost. `__tests__/signup-capacity-race.test.ts` reproduced the overfill first. |
| Pushes in English only | Every member push was English, and the session time in it used the server's clock zone (UTC on Azure), so 8 PM Thursday read as 4 AM Friday. | Each device remembers its language (`PushSubscriptionDoc.locale`, stamped at subscribe, updated when the language toggle is tapped). Member pushes are worded per language from `messages/*.json` → `push`, with times in Vancouver time. Admin-only pushes stay English, as the admin screens do. `__tests__/push-locale.test.ts`. |
| Inline scripts allowed | The page's Content-Security-Policy had `script-src 'self' 'unsafe-inline'`, so an injected `<script>` would have run. | `proxy.ts` mints a fresh nonce per page request and sends the policy with it (`lib/csp.ts`); Next stamps the nonce on its own scripts and `app/layout.tsx` on the launch screen's. Verified on a production standalone build: every page dynamic, 17 of 17 scripts nonced, no violations in Chromium through sign-in and a tab switch. `__tests__/csp-nonce.test.ts`. |
| Proxy skipped the home page | The proxy's matcher compiled to `^/bpm/…` under the base path, so `/bpm` itself, the app's one page, never ran it (no locale cookie; with the policy moved there, it would have had no policy at all). | `'/'` is listed in the matcher. Pinned in `__tests__/csp-nonce.test.ts`. |
| Language switch spoke English | The language button's spoken name and tooltip were hard-coded English. | `a11y.switchLanguage` / `a11y.languageOffline` in both languages. |
| Notifications page in the first download (2026-11-06) | Grant: "Notification should load after, then render the red dot." The page's code rode in every first load, though the bell reads the list on its own. | The page's code is fetched in the background once the first screen has settled, with the other tabs, and rendered directly on a tap (`HomeShell`). The dot never waited for it. A tap that beats the download, or a phone on save-data, shows the page's own first frame (`NotificationsFallback`). Pinned in `__tests__/bundle-split-canary.test.ts`. |
| `npm audit`: 8 moderate (2026-11-06) | One advisory (GHSA-g3hv-75wg-m249) in `minimatch` below 11.0.1, pulled in by the TypeScript lint plugin, which still asks for 10 in its newest release. `npm audit fix --force` would have downgraded the lint config to Next 15. | An `overrides` entry gives `@typescript-eslint/typescript-estree` `minimatch` 11.0.5. It calls one function, which 11 keeps. `npm audit`: 0. Lint runs clean on it. Remove the override once the plugin asks for 11 itself. |

### Left as a known edge

- **The crash page (`/_global-error`) is prerendered** and so carries no
  nonce. It does not use the root layout and was prerendered before this change
  too. If production ever serves that static copy, its inline scripts are
  blocked and its "Try again" button will not hydrate; the page still renders
  its text. Worth one look the first time a root-layout crash is seen in the
  logs.

## Waits on Grant

Each is a setting, a device, or a decision; none can be done from a pull
request.

| # | Item | Why it matters | Where |
|---|---|---|---|
| 1 | Merge #801 (mark ready, check `verify` is green, merge) | Nothing above is live until it is. | GitHub |
| 2 | Re-paste the Gmail Apps Script | Copies older than 2026-11-05 send no `To`, so the check that a payment notice was addressed to the club is skipped for them. | `public/payments/apps-script.gs`, `docs/plans/payments.md` |
| 3 | Check one real Interac email's `To` | Confirms the addressed-to-the-club rule matches what Interac actually sends to your inbox. | Gmail, "Show original" |
| 4 | Set `OPERATOR_MEMBER_IDS` in App Settings | Until set, "the operator" is any BPM admin; once BPM has several admins that is a club's power, not a person's. | Azure → App Service → Configuration; `lib/operator.ts` |
| 5 | Three Azure alerts and the health check path | Nothing watches the running app today; a database outage is learned from a player. | `docs/plans/infra-baseline.md` |
| 6 | Defender for App Service: keep or drop | It is the larger charge on the plan; the alerts in #5 are the cheaper watch. Vulnerabilities in dependencies are watched by Dependabot either way. | Azure → Defender for Cloud |
| 7 | Turn on GitHub secret push protection | Push protection refuses a commit carrying a key before it lands. CodeQL is already on: it ran on this PR's head (2026-11-05), so it needs nothing. | GitHub → Settings → Code security |
| 8 | Cosmos: confirm the account's throughput cap stays inside the free 1000 RU/s | The free tier covers the first 1000 RU/s; a container or database set above it starts billing. | Azure → Cosmos → Cost management; `docs/azure.md` §9 |
| 9 | Restore drill | A backup nobody has restored is a claim. One point-in-time restore into a scratch account proves it. | `docs/plans/infra-baseline.md` |
| 10 | Next store builds (iPhone and Android) | The migration-link confirm, the widget pass staying on its phone, and the push locale for the native app reach phones only with a new build. | `native/README.md` |
| 11 | Say what happened in the stuck sign-in | Grant, 2026-11-06: yes, someone got stuck. Which app (store app, home-screen web app, browser), Google or Apple, and what they saw decide the fix. | `docs/plans/oauth-handoff-gaps.md` |

## Deliberately left, with the reason

| Item | Why not now |
|---|---|
| Split the Chinese translations further | Grant, 2026-11-06: "Translation stays on account level": one language loaded per person, not per screen. English is bundled and Chinese loads only for Chinese readers (#650). |
| Admin screens in English (DatePicker included) | For now. Grant, 2026-11-06: "Admin eventually gets to Chinese." About 600 strings to key; not started. |
| Times pinned to Vancouver | Every club is in BC. A per-club time zone is needed before the first club that is not; the trigger is that club, not a date. |
| In-memory rate limiter | Grant, 2026-11-06: "look into it later." One instance, Always On. `__tests__/single-instance-registry.test.ts` is the migration list for the day there are two. |
| Sign-in cookie carries the account name | Grant, 2026-11-06: "look into it later." Nothing decides anything from it since the same-name fix, so changing it now is risk without benefit. |

## Decisions

- **The policy moved from `next.config.js` to `proxy.ts`.** A nonce has to be
  new on every request, and a header in `next.config.js` is fixed at build
  time. `'unsafe-inline'` stays beside the nonce: every browser that
  understands nonces ignores it, and an older one keeps working instead of
  going blank.
- **Push language is per DEVICE, not per member.** The language a person reads
  is a cookie on each device, and one person can read Chinese on one phone and
  English on another. The device row was already the unit a push goes to.
- **Admin pushes stay English**, matching the admin screens.

## Shape

| Piece | File |
|---|---|
| Rejoin after-write check | `app/api/players/route.ts` (`reconcileCapacity`) |
| Per-language push words | `lib/pushMessages.ts`, `messages/*.json` → `push` |
| Per-language send | `lib/push.ts` (`PushContent`, `payloadFor`) |
| Device language | `app/api/push/subscribe/route.ts` (POST stamps, PATCH updates), `components/LanguageToggle.tsx` |
| Policy and nonce | `lib/csp.ts`, `proxy.ts`, `app/layout.tsx` |
