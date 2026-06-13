# Changelog

All notable changes to the BPM Badminton app are tracked here.

This changelog tracks what ships to the **stable** friend-facing deployment. The `bpm-next` preview environment auto-deploys `main` and may contain in-progress work gated behind feature flags; those changes only appear below once promoted to stable via tag.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Tag convention: `bpm-stable-vX.Y`.

---

## v1.0 — Pre-SaaS baseline (2026-04-18)

First tagged baseline of the stable production site, before the SaaS transformation begins.

### Highlights

- **Sign-ups** — invite-list gating, autocomplete, waitlist with admin-promote, soft delete + restore, self-cancel via `deleteToken`
- **Admin** — PIN-gated cookie auth, session editor, date-keyed session advance, paid/unpaid + e-transfer alias mapping, CSV export, session-scoped announcements with AI polish
- **Identity** — persistent `members` container, role-based admin visibility, consolidated `badminton_identity` localStorage
- **UI** — mobile-first 4-tab layout, light/dark theme, cold-start splash, `CostCard`, `PrevPaymentReminder`, `WelcomeCard`, release notes sheet, `BottomSheet` primitive, 30px page headers, 16px min body
- **Skills** — ACE Skills Matrix (7×6), `SkillsRadar` (recharts, solo/overlay), admin-only CRUD
- **i18n** — `next-intl` cookie-based zh-CN sweep (BottomNav, HomeTab, PlayersTab) + date/time localization via `useFormatter`
- **Cost** — multi-source bird usage with 0.5-tube increments, `null` cost-per-court, legacy `birdUsage` read-tolerance
- **Infra** — Azure App Service B1 at `/bpm` via GitHub Actions OIDC, Cosmos DB (7 containers), in-memory mock store for offline dev, security headers, rate limiting, 236 tests

---

## v1.0.1 — Timezone hotfix + two-deployment pipeline (2026-04-22)

Shipped as a hotfix via the new `deploy-stable.yml` manual-dispatch workflow. First end-to-end exercise of the tag-based promotion runbook documented in `docs/deployment-model.md`.

### Fixed

- **Session times rendered in UTC instead of Vancouver time** — the HomeTab WHEN card showed e.g. "Friday, April 24 · 03:00 AM" for a session stored as Apr 23 8:00 PM PDT. `next-intl`'s `useFormatter` defaults to UTC when no `timeZone` is set. Now configured to `America/Vancouver` on both server (`i18n/request.ts`) and client (`NextIntlClientProvider`). All player-facing datetime surfaces (HomeTab, PlayersTab, PrevPaymentReminder) corrected. (#19)

### Added (infrastructure, invisible to stable users)

- Two-deployment pipeline: `bpm-next` auto-deploys every push to `main`, `bpm-stable` deploys only on manual tag dispatch. Shared Cosmos DB, split workflows. (#13, #14, #15)
- Feature flag system with typed registry and `isFlagOn` helper. (#13)
- Preview banner (orange strip on `bpm-next` only, hidden on stable) showing git SHA and a mailto bug-report link pre-filled with URL + SHA + user agent. (#13, #16, #18)
- Deployment model runbook at `docs/deployment-model.md` with promotion + hotfix + rollback procedures. (#17)

### Notes

All infrastructure items above are behavioral no-ops on stable (PreviewBanner returns `null` when `NEXT_PUBLIC_ENV` is unset; CSS `--banner-offset` var defaults to 0). The only user-visible change for the friend group is the timezone fix.

---

## Unreleased — `bpm-next` only

*Items here live on `main`. They ship to stable when the next tag is cut.*

<!-- Add bullets under the matching subheading as you ship user-facing changes.
     Format: `- **Short title** — one-sentence what + why.` See v1.3 below for examples.
     Empty subheadings are fine; delete a section if you don't end up using it. -->

*(empty — everything below shipped to stable in v1.7.)*

---

## v1.7 — Stable reaches full parity with `bpm-next` (2026-06-13)

This cut flips **every** remaining feature flag on, so stable and `bpm-next` are now feature-identical (only `NEXT_PUBLIC_ENV` differs, keeping the preview banner off on stable). Headline: the **skill-accuracy spine** and **Value-Hub Slice-0** go live for everyone, on top of the full app-code audit remediation, accessibility pass, and security hardening accumulated since v1.6.

### Added

- **Skill self-assessment** *(flag-gated `NEXT_PUBLIC_FLAG_SKILL_ASSESS`, now on for everyone)* — periodic anchor-card check-in across 14 skills, a then-vs-now trend radar, phase placement, and an AI "Your read" that folds in the assessment. *(now live)*
- **Value-Hub Slice-0** *(flag-gated `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`, now on for everyone)* — racket pick → recommendation card, 48h game logger, and partner-frequency Stats card. *(now live)*
- **Accurate skill level** *(flag-gated `NEXT_PUBLIC_FLAG_SKILL_LEVEL` / `…_CALIBRATION` / `…_SMOOTHING`, now on for everyone)* — a private "Your level" card on Stats that folds your check-ins into one 1–5 level, sharpens it against your logged game results (with an opt-in "how your games compare" note), and smooths it so a single check-in can't swing your phase. Feeds the AI "Your read". *(now live)*

### Changed

- **Stats visual polish** — flat cards app-wide (dropped the bottom drop-shadow on every glass-card tier); the AI "Your read" gets a conic-gradient rim that spins while generating, then settles. *(unflagged — rides the next cut)*

### Fixed

- **No more silently-wrong empty states** — a failed data read now shows "couldn't load" instead of confidently showing zero (players, payments, skills, announcements, bird inventory, release notes, and the releases/aliases/cost-suggestion reads).
- **Session edits no longer wipe hidden fields** — editing a session preserves its settled state, invite list, and prior-cost snapshots.
- **Recovery-code errors are honest** — a server hiccup during PIN recovery no longer reads as "wrong code" (which was burning your limited attempts).
- **Cover & remove is atomic** — covering a debt and removing a player happens in one step now, so it can't half-complete.
- **Waitlist sign-up for PIN'd members** — members with a PIN couldn't join a full session's waitlist; fixed.

### Security

- **Admin-auth hardening** — admin actions re-check your role on every request (a demotion takes effect immediately); closed two unauthenticated write paths; first-time PIN claims now require identity proof.
- **Game logging bound to identity** — recording a game result now requires your own trusted-device cookie, so results can't be forged under another member's name; the public session read no longer leaks admin-only payment-recipient or invite-list fields.
- **Session-secret fail-closed + cookie scoping** — session cookies are scoped to the app's `/bpm` path, the app refuses to sign sessions with the built-in dev key outside local dev (so a misconfigured host can't issue forgeable admin cookies), and an optional `TRUSTED_IP_HEADER` lets a non-Azure deployment pin a trusted client-IP source for rate limiting.
- **CI lint gate + dependency bumps** (next 16.2.7, @types/node, dev-deps).

---

## v1.6 — Ledger goes live + Labeled Rail nav + trusted-device sign-up (2026-06-02)

### Added

- **Ledger now actually serves** *(flag `NEXT_PUBLIC_FLAG_LEDGER` flipped on)* — the who-owes-what page shipped dark in v1.5 (the build predated the flag flip); v1.6 is the first stable build that renders it. Backed by `GET /api/admin/ledger`.
- **Trusted-device sign-up** — a member who proves their PIN once on a device stays trusted for 30 days to sign up for future sessions without re-entering it (revoked on sign-out).
- **AI "Your read"** — the Stats hero shows an account-gated, server-cached recap + focus generated from your recent attendance and games.

### Changed

- **Labeled Rail bottom nav** *(flag `NEXT_PUBLIC_FLAG_NAV_RAIL`)* — replaces the floating glass-pill nav with an edge-attached, full-width rail and a triple-signal active state. Same tabs, routing, and i18n.
- **Motion polish pass** — touch-hover gating (hover styles no longer stick after a tap on phones), stronger easing on buttons/cards, plus sign-up-success / spot-counter / list-stagger micro-interactions.

### Security

- **Cleared 4 Dependabot vulnerabilities** + reconciled the lockfile; added a pre-merge PR gate and grouped Dependabot to prevent lockfile drift.

---

## v1.5 — Ledger (who-owes-what) + cover-and-remove (2026-05-30)

### Added

- **Ledger** *(flag-gated `NEXT_PUBLIC_FLAG_LEDGER`)* — a "Ledger" entry in the Command Center opens a who-owes-what page (Collected / Spent / Gap, an honest "$X covered by you" sub-line, By-session / By-player views, and 30-day / 12-week / All-time ranges) so the organizer can answer "did anyone forget to pay me back?" without scrolling session history. Backed by `GET /api/admin/ledger`. (v1.5/B + v1.5/D)
- **Ledger drill-ins** — tap a session row to jump straight into that session's Payments, or a player row to open their profile + history. (v1.5/D)
- **Cover & remove** — removing a player who still owes a settled, unpaid amount now offers "Cover & remove" (you eat the cost, they leave history clean) or "Remove without covering," instead of silently orphaning the debt on the ledger. (v1.5/C)
- **Offline legible-fail** — network-mutating actions disable with a clear app-wide banner when offline (instead of firing and breaking), and the admin subtree is wrapped in an error boundary that auto-reloads on reconnect.
- **Value-Hub Slice-0** *(flag-gated `NEXT_PUBLIC_FLAG_VALUE_HUB`, dormant on stable)* — foundation for the racket-pick → recommendation → game-logger vertical: types, flag, and racket catalog seed.

---

## v1.4 — Command Center + unified Home auth + Send-the-bill (2026-05-16)

### Added

- **`writtenOff` on `PATCH /api/players` + "Cover their $X" action** *(flag-gated `NEXT_PUBLIC_FLAG_LEDGER`)* — admin can cover a player's debt via the existing PaymentsCard per-player action sheet. Sets `Player.writtenOff: true` and clears `paid`. Mutually exclusive with `paid` at the route handler (writtenOff wins if both flags are sent in one body). Friend-voice confirm copy: "I got it." First piece of v1.5; ledger view + remove-after-settle prompt land in subsequent PRs. Ships with `<CoverSheet>` component supporting both `cover-only` and `cover-and-remove` modes (latter wired in v1.5/C).
- **`GET /api/admin/settings`** — auth-gated read of the calling admin's own settings (e-transfer recipient, skip dates). Replaces the previous "scan public `/api/members` for `role:admin`" pattern that leaked admin attributes if the response shape ever loosened.
- **`POST /api/session/dismiss-anomaly`** — atomic per-code append on the active session's `anomaliesDismissed` array. Replaces a client-side read-modify-write-via-PUT that could nuke the session doc if the read step failed.
- **`lib/fmt.ts`** — shared `withLocalTz`, `fmtShortDate`, `fmtSessionLabel`, `fmtFullDate` (extracted from 6+ duplicated callsites).
- **`lib/avatar.ts`** — shared deterministic avatar palette (RosterPage rows + Profile identity card now agree on the same color per name).
- **Admin Command Center** *(flag-gated `NEXT_PUBLIC_FLAG_COMMAND_CENTER`)* — new card-based admin landing surface that replaces the legacy AdminDashboard when enabled. Six cards: Anomaly Feed (settings drift, long break, skip date), Next Session (capacity bar, signup state, deadline countdown), Announcements (inline composer), Payments (paid/pending toggle, group + individual receipt export), Bird Inventory (stock + low-stock warning + burn-rate weeks), Roster Health (invite list, waitlist, recent removals), Recent Sessions strip (last 6 with attendance + paid %), Skip Dates editor.
- **Receipt export** — group format (image + text, 390×520 PNG with design-system fonts) and individual format (text only) shareable via Web Share API or download. Auto-renders cost/players/recipient from current session + admin's e-transfer setting.
- **Player profile sheet** — tap any player name in the Payments card to see lifetime stats + last 12 sessions with paid/missed status. Backed by new `GET /api/members/[id]/history`.
- **Anomaly blocking sheet on advance** — when admin tries to advance to a date on their `members.skipDates` list, a confirmation sheet pops up asking "advance anyway?" Prevents accidental holiday/closure advances.
- **memberId stable identity** — every `players` record now links to a `members` doc via `memberId`. One-shot backfill migration ran on shared production Cosmos (156 records linked, 16 new members auto-created, 0 collisions).
- **Schema additions** *(additive, optional)* — `Session.prevSnapshot` (frozen previous session settings), `Session.anomaliesAtAdvance` / `anomaliesDismissed`, `Session.eTransferRecipient`, `Member.eTransferRecipient`, `Member.skipDates`.
- **New admin APIs** — `GET /api/sessions/recent`, `GET /api/admin/anomalies`, `GET /api/members/[id]/history`, `POST /api/admin/migrate-memberId`, `PATCH /api/admin/settings`.
- **Settle workflow** *(flag-gated `NEXT_PUBLIC_FLAG_SETTLE`)* — admin can lock a session's cost-per-person and per-player owed amount with one action ("Send the bill" on Command Center). Once settled, retro edits to court cost, bird usage, or roster do NOT redefine what already-paid players paid for. ReceiptSheet sources `costPerPerson` / `totalCost` / `playerNames` from the frozen `session.settled` snapshot; PaymentsCard shows per-row `owedAmount` + a "Sent · $X" badge. Recovery affordance is "Edit bill" (not "Unlock") to keep the verb friendly. New endpoints: `POST /api/session/settle` (idempotent, force `signupOpen: false`), `DELETE /api/session/settle` (preserves `paid` checkmarks). Schema: `Session.settled`, `Player.owedAmount` / `settledAt` / `writtenOff` (all additive, optional).
- **Unified Home sign-up form** — adaptive based on `useMemberProbe(name)` (debounced GET `/api/members/me`). Three modes selected automatically by the probe: anonymous (just name + button), sign-in (name + PIN + Forgot link, two-step submit that auto-registers for the session), create-account (name + Create PIN + Confirm PIN). Replaces the separate "Already a player?" sign-in card and the Create Account modal on Home. Button label stays "I'm in this week" through all three modes; PIN inputs appear inline based on context.
- **Shared `<SignInForm>` primitive** — extracted from `RecoverySheet` + ProfileTab's inline anonymous form. Single PIN-aware sign-in form with proper 5xx-vs-4xx error distinction baked in (the regression-guard that prevented Cosmos throttles from being mistaken for "wrong PIN").
- **`useMemberProbe` hook** in `lib/useHasPin.ts` — debounced `/api/members/me` probe returning `{exists, hasPin}`. Drives the adaptive Home form. `useHasPin` kept as a thin shim for backwards compat.
- **`resolveStaleIdentity` helper** in `lib/identity.ts` — pure function that decides what to do with a stored identity when the active session has advanced. PIN members get preserved (token zeroed, sessionId refreshed); anonymous users get cleared as before.

### Changed

- **Advance route** now writes `prevSnapshot` and `anomaliesAtAdvance` (cost_changed, courts_changed, max_players_changed, long_break) at advance time. Existing `prevSessionDate`/`prevCostPerPerson` writes preserved for legacy readers. Advance now ALSO prefers `currentSession.settled.costPerPerson` for the `prevCostPerPerson` snapshot when present, so payment-reminder amounts on Home are frozen from settle, not recomputed.
- **PUT /api/session** now accepts `eTransferRecipient` (per-session override) and `anomaliesDismissed` (live mutable list).
- **Receipt copy** — friend voice replaces accountant voice. The shared text/canvas template now reads "Badminton on Sun May 4 was $15 each." (was "BPM Badminton — Sun May 4 · 8:00 PM / $15 per person"). Bookkeeping moved to a parenthetical at the bottom. Player-names list dropped from the message (the group chat already knows who showed up).
- **Anonymous Profile copy** — "Welcome back" instead of "Profile"; body reads "Sign in with your name and PIN, or set up an account" (was "Account creation is invite only — contact admin for inquiries (beta)" — felt like a gate, not a welcome).
- **CreateAccountSheet errors** — consolidated 7 distinct states (mismatch / too_common / invalid / rate_limited / network / account_exists / invite_only / name_required) down to 4 friendly buckets: pin_problem, try_later, account_exists, invite_only. `name_required` is no longer a server error — disabled-submit-button handles it.
- **Recovery-code path** — single discoverable entry. The "Forgot your PIN?" link inside the inline sign-in surfaces opens `EnterCodeSheet`. ProfileTab's standalone "Have a recovery code from admin?" link removed (was redundant + meaningless if the user didn't know codes existed).
- **Receipt sheet "Lock cost" + "Final · $X"** consolidated into one "Send the bill" action + "Sent · $X each" badge. The previous two-button flow (lock then share) split a single social act ("I told the group what they owe") into bookkeeping steps. The new "Edit bill" affordance (was "Unlock") frames recovery as a typo-fix, not a state-machine reversal.
- **HomeTab spotsRemaining copy** — "{remaining} of {total} spots left" (was "Signed-up: {count} · {remaining} spots left"). Cleaner, matches Figma round-trip.
- **HomeTab sign-up button icon** — `how_to_reg` Material Symbol on the primary CTA (icon was hidden during loading state previously; now consistent).
- **`<SignInForm>` adoption** — `RecoverySheet` is now a thin sheet-wrapper around the shared form (the welcome-back animation + identity write stay here). ProfileTab's anonymous view also consumes the primitive directly. Old `<RecoverySheet>` modal trigger on HomeTab is gone.
- **Button class consistency** — BirdsPage + SetupPage primary CTAs now use `cc-btn cc-btn-primary` (focus ring + a11y). The legacy `.btn-primary` gradient class is retired from Command Center surfaces but still defined for back-compat with non-CC code paths.
- **BirdsPage runway timeline geometry** — extracted to named constants (`TIMELINE_BAR_H`, `TIMELINE_NOW_OVERFLOW`, `TIMELINE_EMPTY_OVERFLOW`). No visual change; future bar-height changes now propagate to marker offsets.
- **RecentSessionsStrip dot indicator** — uses per-card `offsetLeft` instead of `scrollWidth / count` uniform-width proportion. Robust to variable-width cards going forward.
- **AssignUsageSheet** — aligned to the canonical BottomSheet pattern (`max-w-lg mx-auto`, `p-4` header, `p-5 pb-8` body). Was an outlier with no width cap or padding overrides.
- **Sign-up form autocomplete dropdown** — capped at `max-h-60 overflow-y-auto` (was unbounded, growing to fit all member names). Prevents the dropdown from overflowing the sign-up card and ghost-rendering through sibling cards via backdrop-blur.

### Fixed

- **Admin signup auto-creates a member** — closes a write-path gap where admin-bypass signups produced player records with no `memberId` because no matching member existed. Every admin-initiated signup now links to a member, restoring the "every player has a member" invariant the command-center history view depends on.
- **`pinHash` strip-canary enforced on `/api/members`** — POST/PATCH/DELETE/GET-admin all now strip the scrypt hash from responses. Surfaced by the 2026-05-06 audit; admin clients had been receiving the hash on PATCH and full-list GET.
- **Burn-rate denominator/numerator window matched** — Bird tube "weeks left" was previously `totalUsedAcrossAllSessions ÷ recentSessionCount` which inflated burn rate ~12× for groups with 2 years of history. Now uses `recentTubesUsed ÷ recentSessions` (matching 60-day window). API exposes `burnPerSession` so the three callers (Birds page, Profile hero, dashboard tile) all agree.
- **`prevCostPerPerson` advance-time snapshot fixed** — `/api/session/advance` player-count query was missing the `IS_DEFINED` guard, silently undercounting legacy player records and writing a wrong frozen cost.
- **`members/[id]/history` per-session cost now correct** — was reading `session.prevCostPerPerson` (last week's cost frozen at advance), so every history row showed last week's number. Now computes `totalCost / attendanceBySession[sessionId]`.
- **"Lying empty state" eliminated** — the `catch { setX([]) }` pattern across all admin cards was rendering confidently empty UI on fetch failure (replicating the v1.3 Cosmos misconfig disaster). Each card now distinguishes loaded-empty from load-failed and surfaces an explicit error pill.
- **Payment-data integrity (alias writes)** — Roster sheet alias POST/PATCH/DELETE were fire-and-forget; admin saw "saved" but failed alias updates silently desynced receipt routing. Now checks `res.ok` and surfaces specific failure copy.
- **Advance form prefill failure surfaced** — silent default values (2 courts, $0 cost) on a destructive action are now blocked by a red banner.
- **Anomaly dismiss timezone correctness** — `detectSkipDate` was timezone-naive (`.slice(0,10)` of the ISO string), risking a day-off bug for sessions stored with a UTC offset. Now extracts the local calendar date from `withLocalTz` output.
- **`Anomaly` type narrowed to closed `AnomalyCode` union** — typo'd dismissal codes used to silently never match; now caught at compile time. The `(severity:'blocking', dismissable:true)` illegal pair is structurally unrepresentable.
- **AdminConsoleHero CTA uses `cc-btn cc-btn-primary cc-btn-lg`** — was inline-styled, dropping the `:focus-visible` ring (a11y miss).
- **Light-mode overrides** for `.admin-hero` and `.cc-dcard` (both rendered near-invisible on cream theme).
- **`PaymentsCard` divider line removed** + add-player input switched to canonical class — both fix project-rule violations (no hard dividers between list items; inputs inherit the canonical input style).
- **P0 — PIN-protected members were force-logged-out every week on session advance** (#60). HomeTab's `loadData` used to call `clearIdentity()` on any `id.sessionId !== activeSession.id`, which was correct under the old single-tier auth model but silently wrong after the auth taxonomy split. Now probes `/api/members/me` and preserves identity for PIN members (token zeroed, name + new sessionId retained). Anonymous users still clear as before. Logic extracted to `resolveStaleIdentity` for unit-testability.
- **RosterPage FAB clipped behind iOS home indicator** (#61) — `bottom: 96` didn't clear the home-bar inset. Now `bottom: calc(96px + env(safe-area-inset-bottom))`.
- **PaymentsCard toggleError banner didn't auto-dismiss** (#62) — banner stuck around after a successful retry, reading as "still failing." Now clears after 4.5s.
- **HomeTab autocomplete dropdown ghosting** — the suggestion dropdown grew past the sign-up card boundary, and the sibling Sign-in card's backdrop-blur ghost-rendered the overflowing items through it. Fixed by capping `max-h-60 overflow-y-auto` + bumping `z-50`. Same class of bug as DatePicker's portal escape (per CLAUDE.md).

---

## v1.3.1 — Stats polish + AI weekly read + attendance backfill (2026-05-05)

Same-day patch on top of v1.3. Tightens the Stats tab redesign based on smoke feedback (heatmap was too tall at 3M/6M; zoom UI was eating space; copy needed work) and adds two new pieces: a once-per-week AI summary card and a one-shot tool to backfill historical attendance for groups that played before adopting the app.

### Added — Stats tab

- **Weekly AI quick-read card** on Stats — single click generates a 1-2 sentence Claude Haiku summary of your last-year attendance. Cached in localStorage by (name, week) so revisits within the week are zero-token. Self-hides for anonymous viewers.
- **Skill progression disclaimer** with a hyperlink to the [ACE Skills Matrix](https://www.acesports.ca/skills-matrix) so players know where the radar dimensions come from.
- **`Beta` badge** replaces `Live` on the Stats live cards (Your Attendance + Skill progression). Sets accurate expectations while features mature.
- **`Your equipment`** coming-soon card joins Cost and Partner — gestures toward future tracking of rackets, strings, shuttle preferences.

### Added — admin tooling

- **One-shot attendance backfill** — new admin-only `POST /api/admin/backfill-attendance` endpoint + `scripts/backfill-attendance.mjs` import script. Reads a CSV of `date,names` rows and creates the historical session/player records that populate the Stats heatmap. Idempotent. Used to capture pre-app group history dating back to Feb 19 2026.

### Changed — Home tab

- **"Sign up" heading uses `.bpm-h2`** (Space Grotesk display font) instead of an ad-hoc `text-xl font-bold text-green-400` — visually similar but properly on the design system.
- **CTA copy**: "Sign Up" → "I'm in this week" / "本周参加" — friendlier, more committal.
- **"Already a player? Sign in" → "Account sign in"**, relocated from inside the sign-up card to outside it (bottom-left, aligned to the card's inner padding). Cleaner card, no false-CTA noise inside the form.

### Changed — Stats tab

- **Heatmap dropped the 3M / 6M / 1Y zoom selector** — always shows 1Y now. The zoom toggle was eating card real-estate and the small-window cells looked oversized at 3M (21px). Heatmap now scales to fit the card width via viewBox.
- **Skill progression card moved** above the "more coming" grid (was below). Matches user mental model of progression as a primary stat.
- **Coming-soon grid relabeled** to "other metrics in the making" (was "MORE COMING"). Three tiles now: Cost related, Partner and play style, Your equipment.
- **Header subhead** rewritten to "Interesting metrics that you didn't ask for (beta)" — sets a more honest, less-hyped expectation.
- **Live attendance always-on** — `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE` retired across `lib/flags.ts`, both deploy workflows, and docs. Heatmap + streak hero ship to all friends without opt-in.

### Changed — admin

- **AdminTab Sign-out button removed** — single auth surface lives in Profile only. Profile logout already calls `DELETE /api/admin` to clear the cookie; the second button on AdminTab was redundant.
- **Admin tab background** is now flat `var(--page-bg)` with the aurora hidden — admin reads as its own visual register without atmospheric chrome competing for attention.

### Changed — auth

- **Admin cookie TTL bumped 8h → 30 days** in `lib/auth.ts:29`. Eliminates the "I'm signed in as Grant but Admin asks for PIN again" friction that came from cookies expiring while localStorage identity persisted.
- **`IDENTITY_EVENT`** dispatched from `lib/identity.ts` on `setIdentity` / `clearIdentity`. Page-level admin-access check + ProfileTab subscribe so the "Admin tools →" link in Profile appears/disappears reactively on sign-in/out without a page refresh.

### Fixed — auth

- **Recovery code → set new PIN** dead-end fixed. `POST /api/players/recover` code-path now clears `members.pinHash` on success, so the post-recovery `RecoveryPinSheet` renders in 2-field mode (no current-PIN prompt). Without this, users who reset their PIN via admin code couldn't set a new one because the sheet still demanded the old PIN they'd forgotten.

### Fixed — Release Form

- **Auto-fill works post-cut now** — when `## Unreleased` is empty (right after a stable cut), `extract-unreleased.mjs` falls back to the most-recent-published-version's content + version. Previously the form opened blank with the next-bumped version, useless for the "publish notes for what we just shipped" flow.

---

## v1.3 — Stats redesign + design system tier-2 + UI primitives (2026-05-05)

Shipped as `bpm-stable-v1.3`. Stats tab visual overhaul (Tempo Field dot-grid background + refractive glass cards), three new UI primitives sweeping ~25 duplicated bits across the app, the design system's two-tier surface model formalized, dark-mode AA contrast lift, and a 7-tap demo placeholder.

### Added — Stats tab visual overhaul

- **Tempo Field background** on the Stats tab — a 42px dot grid extending the BPM logo's tempo-dot motif, with a soft radial vignette mask so dots fade at the edges. Static (no animation), brand-green dots on dark theme, darker forest dots on cream. Dots-grid replaces the global aurora on Stats only; other tabs keep aurora / court / etc.
- **Refractive glass cards** on Stats — cards now bend the dot field beneath them rather than sitting as tinted overlays. Four independent levers: dispersion (blur radius), fray (chromatic aberration), frost (milkiness), depth (multi-layer box-shadow stack). Cards visibly float above the backdrop instead of laying flat.
- **Contextual identity callouts** — Stats tab adapts its copy and live cards based on whether you're identified, anonymous, or admin-browsing.

### Added — Stats Attendance card UX

- **Anonymous attendance card is now passive copy** — "Sign in or create an account to see personalized stats" replaces the previous Sign up / Sign in CTAs. The Stats tab is now a *consequence* of being signed in, not a gate to it.

### Added — Demo mode placeholder

- **7-tap title gesture opens a Demo overlay** — full-screen placeholder with X close button (also dismissible via Escape). Slot for a future guided product tour.

### Added — UI primitives

- **`<PageHeader>`** primitive — replaces 8 duplicated 30px `<h1>` headers across the app. Consistent typography, optional right-aligned action slot.
- **`<StatusBanner>`** primitive — replaces 7 duplicated success / warning / error banners with a single typed component.
- **`<ConfirmInline>`** primitive — replaces ad-hoc "are you sure?" inline UI in PlayersTab; foundation for the rest of the app.
- **`--ease-sheet` motion token** added (`cubic-bezier(0.16, 1, 0.3, 1)`) and wired through `<BottomSheet>` so all sheets share one slide-up curve. Token was in the design-system doc since v3 but only landed in `globals.css` now.

### Changed — design system: two-tier surface model

- **Surface adoption split**: `docs/design-system/preview/` is the frozen reference bundle (never imported), and `app/design/` is the live drift-proof preview. The runtime `app/globals.css` is the single source of truth for tokens. Documented as a hard rule to prevent the kind of cascade collisions that happened pre-v1.2.
- **Aurora docs synced** to current production values. The two visualizations now match.

### Changed — dark-mode contrast

- **AA contrast lift** on dark theme — text-secondary bumped from `0.6` → `0.7` and text-muted from `0.35` → `0.55` so glass-card content passes WCAG AA on the brightest aurora regions. Light mode untouched (already well-contrasted on cream).
- **Aurora reshape**: blob proportions and spread reworked to reduce the green-on-tan color-mix overlap in the upper-third of the viewport. Vertical wash + horizontal curtain + accent layout per `docs/design-system/preview/02-aurora.html`.

### Changed — Admin tab

- **Admin tab background** is now flat `var(--page-bg)` with the aurora hidden — admin reads as its own visual register without atmospheric chrome competing for attention.

### Fixed — deployment

- **Standalone bundle copies `public/`** — Next.js 16 standalone output drops the public directory by default; deploy workflows now `cp -r public/` into the bundle so brand assets, fonts, and changelog JSON ship to Azure correctly.
- **Brand asset loading** — missing or 404'd brand assets now load reliably across both deployments.
- **Canonical URL** sourced from `NEXT_PUBLIC_BASE_URL` env var (per-deployment) so Open Graph / canonical tags are correct on both bpm-next and bpm-stable.

### Fixed — admin

- **Release form Draft button** — repaired (was no-oping). Added inline explainer for the publish vs. draft distinction.

---

## v1.2 — UX polish: Stats tab + markdown announcements + bird inventory (2026-04-26)

Shipped as `bpm-stable-v1.2`. Bundles content-side polish (markdown announcements, editable release notes), the new Stats tab skeleton (Skills renamed and re-laid-out), and admin bird-inventory upgrades. Live attendance + design-stats preview are also in the cut but flag-gated and dark on stable.

### Added — announcements

- **Minimal markdown in announcements** — admins can now use `**bold**`, `*italic*`, `- list`, and `1. numbered` in the announcement textarea. Home tab renders formatted output via the tiny `lib/miniMarkdown.tsx` parser (JSX-only, no raw-HTML injection). Composer has Write / Preview tabs and 5 formatting buttons (B, I, UL, OL, paragraph break). Character cap raised 500 → 800 to account for markdown overhead.

### Added — release workflow

- **Released notes are editable** — pencil icon on each row in Admin → Releases opens the form pre-filled for that record; `PATCH /api/releases` preserves `publishedAt` / `env` / `publishedBy` and stamps `editedAt`. AI polish stays opt-in on edit (no surprise rewrites of already-shipped copy). Delete icon replaces the old text link.

### Added — Stats tab (Skills → Stats)

- **Bottom nav "Skills" renamed to "Stats"** (`bar_chart` icon; zh-CN: 数据). Existing SkillsRadar content stays available to admins via the bottom-most "Skill progression" live card.
- **Live Attendance card** gated behind `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE`. Shows a GitHub-style heatmap (7 rows × N weeks) with 3M / 6M / 1Y zoom pills. Solid green = session attended, outlined = missed, empty = no session that day. Month labels along the top, Mon/Wed/Fri on the side.
- **Attendance streak hero** above the cards. Hidden when streak is zero. Personal-best flame gradient when `streak >= longestStreak && streak >= 3`, otherwise green tint with "Keep showing up."
- **Identity fallback** — when no `badminton_identity` exists (admin browsing, incognito, first-time visitor), the card shows a "View attendance for:" autocomplete input backed by the members list. Picked name saves to `badminton_stats_preview_name` (separate from real identity so it doesn't muddy self-cancel semantics).
- **Layout rework** — live content (attendance) full-width up top; remaining "Coming soon" cards collapse into a compact 2-column grid at the bottom under a "More coming" label. Admin's live Skill Progression card lands below the grid as its own full-width section.
- **API:** `GET /api/stats/attendance?name=X&weeks=N` — no auth (stats are player-facing). Case-insensitive name match. Excludes waitlisted + removed player rows. Returns `{ attended, streak, longestStreak, history[] }`. Weeks clamped to [1, 260].

### Added — `/design/stats` preview

- **Stats narrative playground** — new 7th sub-page on the `/design` preview route. Three narrative arcs: **Your season so far** (per-person, 7 cards), **The club pulse** (per-group / admin, 6 cards), **Anatomy of Thursday** (per-session recap, 5 cards). All cards mocked with fabricated data + inline SVG viz. Ends with a proposed ship-order section. Flag-gated like the rest of `/design/*`.

### Added — bird inventory

- **Hero card** on Admin → Birds: giant remaining-tubes number, runway weeks (`remaining / avgTubesPerSession`), avg/session, total used, brand count. Color tiers: red at 0, amber below 2 weeks, green at 3+.
- **Per-brand grouping** via `lib/birdBrand.ts::parseBirdName` (first whitespace-delimited token = brand, remainder = model). No schema migration — `BirdPurchase.name` stays a single string.
- **Assign-to-session flow** — `+` button on each purchase row opens `AssignUsageSheet` (BottomSheet primitive). Lists most-recent 10 sessions with current tubes-used for that purchase; admin can set 0.5-tube increments per session; Save batches `PATCH /api/session/bird-usage` calls. Hero runway recalculates on save.
- **API:** `PATCH /api/session/bird-usage` — admin-only. Upserts one purchase's usage into any session's `birdUsages` array (by `sessionId`). Unlike `PUT /api/session` which replaces the whole active-session doc, this targets archived sessions too. `tubes: 0` removes the entry.
- **New helpers in `lib/birdUsages.ts`**: `tubesUsedAcross(sessions)`, `avgTubesPerSession(sessions, window=8)`, `runwayWeeks(remaining, avg)`.

### Added — bug reporting

- **Preview banner bug link** now opens a picker menu (Bug / Feature idea / Private email) instead of the old mailto. Bug and Feature paths deep-link to GitHub Issues with URL + SHA + UA pre-filled via `?template=&url=&sha=&ua=` query string.
- **GitHub issue templates** in `.github/ISSUE_TEMPLATE/`: `bug.yml`, `feature.yml`, `config.yml` (blank issues disabled, private-email contact link). Fully usable once the repo flips to public.

### Infra

- `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE` registered in `lib/flags.ts` (first Arc 1 live card; retires two weeks after full Arc 1 promotion).
- Material Symbols Rounded subset URL gains 17 new glyphs: `bar_chart`, `bolt`, `emoji_events`, `event`, `format_list_bulleted`, `format_list_numbered`, `groups`, `local_fire_department`, `paid`, `payments`, `radio_button_unchecked`, `receipt_long`, `star`, `subdirectory_arrow_left`, `trending_up`, `verified`, `visibility`. (~43 → ~60 glyphs; URL bundle still ~20 KB.)
- i18n: new `stats.{heading,subhead,comingSoon,progression,attendance,cost,partners}.*` keys in both `en.json` and `zh-CN.json`; `nav.skills` value updated ("Coming Soon" → "Stats" / "即将推出" → "数据").

### Fixed

- **`stats.cost.subtitle` rendered with a stray `$`** in the compact "Coming soon" Cost card on the Stats tab. Rewrote the i18n string to drop the `$` glyph (the placeholder cost surface is purely illustrative and the literal currency symbol read as a typo). (#27)

### Tests

- 316 passing, up from 251. New suites: `miniMarkdown`, `announcements`, `releases` PATCH, `birdBrand`, `birdUsages.helpers`, `session-bird-usage`, `stats-attendance`, `StatsPlaceholder`.

---

## v1.1 — Design system v3 + release automation (2026-04-24)

Shipped as `bpm-stable-v1.1`. First promotion to bundle live-surface visual changes (type trio, icons, backgrounds) alongside infra (release automation, env-stamped releases).

### Added — release workflow automation

- **Release form auto-fills from CHANGELOG.md** — `scripts/extract-unreleased.mjs` runs as a `prebuild` hook, parses the `## Unreleased` section, writes `public/changelog-unreleased.json`. The admin Release Form fetches that JSON on mount and pre-fills version (next minor bump from the highest existing tag) + raw notes (verbatim Unreleased bullets). Admin no longer types the raw notes — just reviews, runs AI polish, publishes. A "↻ from CHANGELOG" button next to the raw-notes field re-pulls if needed.
- **Per-environment releases** — `app/api/releases/route.ts` now stamps `env: 'next' | 'stable' | 'dev'` on every record at POST time via `getEnv()`. GET filters by the current env (with legacy-null backcompat, so existing v1.0/v1.0.1 entries stay visible on both). Releases published on `bpm-next` no longer leak to `bpm-stable` through the shared Cosmos DB.

### Added

- **Design system v3 bundle** mirrored at `docs/design-system/` — 43 files (tokens, 28 specimen HTMLs, UI-kit JSX references, 3 self-hosted variable fonts). Single canonical reference.
- **Hidden preview route** at `/bpm/design` — 7 sub-pages (tokens, components, logo, fonts, backgrounds, perf, index). Flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW` (404 on stable, visible on `bpm-next` + dev). Not linked from `BottomNav`.
- **`<BpmWordmark />`** tempo-dot logo component (displayed on `/design/logo` preview).
- **`<ShuttleIcon />`** brand shuttlecock SVG — replaces `sports_tennis` in empty states.

### Changed — visible on live surfaces

- **Type trio adopted live** — Space Grotesk (display / headlines), IBM Plex Sans (body / UI, leads `var(--font-sans)`), JetBrains Mono (data: PINs, costs, timestamps, code). Self-hosted variable TTFs in `app/fonts/` via `next/font/local`; system fonts remain as metric-matched fallbacks so first paint never waits on the network.
- **Icons** — Material Icons → Material Symbols Rounded, subsetted to ~43 glyphs via `icon_names=` query param (~100 KB → ~20 KB). `.material-icons` class aliased so 57 call-sites stay unchanged.
- **Backgrounds** — `02 Aurora` (3-blob slate-blue + court-green + warm-yellow, fast-compositor path) on Home/Skills/Admin; `03 Court` (real badminton-doubles proportions at 100:220 viewBox, aspect-locked via `aspect-ratio` + `background-size: contain`) on Sign-Ups only. Wired via `html[data-tab=...]` attribute from an `activeTab` `useEffect` in `app/page.tsx`.
- **Canonical component alignment** — Status banners radius 12, padding 12×14, new `.status-banner-red`; pills 11px/600/0.04em/line-height 1 bare-class shape; glass-card radius 24→**16** (was violating corner-radii ladder) + saturate 140→**180%**; BottomNav inline-flex pill (not full-width stretch), 20px icons, FILL-axis active glyph, 9.5px labels.

### Perf

- GlassPhysics short-circuits on `(hover:none)` touch devices.
- DatePicker scroll handler RAF-coalesced (one `getBoundingClientRect` per frame, not per scroll event).
- Splash 5.4s CSS-keyframe failsafe + `<HydrationMark />` moved to **root layout** (was only on `/`, leaving non-index routes stuck on the splash).
- `React.memo` on `CostCard`, `PrevPaymentReminder`, `WelcomeCard`, `ReleaseNotesTrigger`, `BpmWordmark`; `useCallback` for HomeTab handlers; `useMemo` for SkillsRadar chartData.
- `prefers-reduced-transparency` kill-switch on aurora animation (iOS Low Power Mode).

### A11y

- All 38 form fields across `/design/components`, SkillsTab, and admin surfaces now have `id` + `name` + `autoComplete` (silences Chrome DevTools "no id/name" warning).
- Touch targets bumped to **44×44 minimum** on DatePicker month chevrons, AdminDashboard logout, AdminDashboard person_remove.
- Light-mode legibility audit — theme-adaptive `--sev-*-text` tokens; pill waitlist/admin/red now have light-mode overrides; `--pill-unpaid-text` alpha 35→72% for AA contrast. **Removed `docs/design-system/colors_and_type.css` import from the design layout** — it was shadowing `globals.css`'s `[data-theme="light"]` overrides via cascade source-order.

### Infra

- `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW` registered in `lib/flags.ts`.
- Tests: 251 passing (added 5 for the preview-route flag + nav isolation).
