# Late cancellation — a warning a player confirms, and a flag the admin sees

**Track:** admin cost-automation (North Star pillar 3) — a late cancel costs the club a court share it already paid for; this gives the admin a record to act on, without moving money.
**Status:** in-flight
**Review on:** 2026-11-15 — has any club turned the policy on, and has any admin used the "Late" tag to charge a fee? If neither, the warning is friction nobody is using.

## Problem

Grant, 2026-10-15: *"introduce the logic of when player wants to cancel, they need to confirm there may be a fee if its done less than 48 hours away. This should be a per group setting for the admin to toggle on"*.

Asked what should happen beyond the warning, he chose **warn and flag** (the cancellation is marked late so the admin sees who and when; any fee is charged by hand, no money moves), and that the window is **set by each group's admin** rather than fixed at 48 hours.

Today a player who cancels the night before looks, in the admin's payments card, exactly like one who cancelled a week out: "cancelled <date>". The admin has no way to tell, and the player has no warning that it might matter.

## Kill criterion

Four weeks after deploy (2026-11-15): if no club has the policy on, or the clubs that do have never acted on a "Late" tag, the warning is friction nobody needs — take it out rather than tune it.

## Non-goals

- Charging the fee. No ledger entry, no change to the cost split or settle. The admin decides, by hand, with the existing tools.
- An up-front warning on the first tap. The server is the only reader of the setting (see Decisions).
- Warning admins, or anyone leaving the waitlist.

## Decisions

- **The server decides lateness, never the phone.** `DELETE /api/players` reads the club's `lateCancelHours` and the session's `datetime` after the row is found and the caller's token or membership is verified — checking earlier would let anyone holding a name probe whether that player's cancel would be late. A late self-cancel without `acknowledgeLateFee: true` answers 409 `late_cancel` with the hours and changes nothing.
- **The flag follows lateness, not the acknowledgement.** Whenever the server finds the cancel late it stamps `lateCancel: true` and `lateCancelHoursBefore` (whole hours, clamped at 0 once the session has started), whether or not the request arrived already acknowledged. A client that sends the acknowledgement up front skips the warning but not the record.
- **Exempt, always:** admins (the route already records their cancels as `cancelledBySelf: false`), waitlisted rows including soft-hold rows (no spot is being given up), a session with no `datetime`, and a policy that is off. An admin who also plays — Grant — cancelling his own spot from Home is therefore neither warned nor flagged. That matches existing behaviour and is written down rather than built around.
- **The warning appears after the first tap, not before it.** Showing it up front would mean reading the group record on every Home load (the session GET is the busiest read in the app); after the tap it costs a read only for someone actually cancelling. Grant did not choose between the two; this is the recommendation he was given.
- **The setting lives on the group record only** (`groups.settings.lateCancelHours`), read whether or not multi-group is on — the same rule as the pay-to address (`lib/payTo.ts`). A new field has no history on the admin's Member doc, so there is no fallback to mirror. Absent means off; the default is off. PATCH accepts whole hours 1–168, or `null` to turn it off (the key is removed explicitly, not left `undefined`); a save with no group record answers 409 `no_group` rather than a 200 that saved nothing.
- **A failed policy read fails OPEN.** If reading the group record or the session throws, the cancel goes through unflagged and the miss is logged: nobody is kept in a spot they are trying to give back because a settings read hiccuped. The same posture as the unpaid soft hold.
- **Rollout is safe in either order.** With the policy off — the default — the route never answers 409, so a player on an old bundle never meets the new response.
- **Copy:** the warning is third person ("Cancelling less than 48 hours before the session may come with a fee"), an ICU plural for the hours, in both locales, on the amber `warn` tone — red on Home means a failure. The dismiss reuses `players.sheetKeep`. Admin screens are English only, by decision (CLAUDE.md).

## Shape

| piece | file |
|---|---|
| The rule, pure | `lib/cancelPolicy.ts` |
| `GroupSettings.lateCancelHours`, `Player.lateCancel` / `lateCancelHoursBefore` (additive, optional) | `lib/types.ts` |
| Read and write the setting | `app/api/admin/settings/route.ts` |
| The 409 handshake and the stamp | `app/api/players/route.ts` (`DELETE`) |
| The warning step in the cancel sheet | `components/HomeTab.tsx`, `messages/{en,zh-CN}.json` (`players.lateCancel*`) |
| The admin page | `components/admin/CommandCenter/LateCancelEditor.tsx`, `components/admin/{types,AdminDashboard}.ts(x)`, `CommandCenter.tsx` |
| The "Late" tag | `components/admin/CommandCenter/PaymentsCard.tsx` |
| Tests | `__tests__/cancel-policy.test.ts`, `__tests__/players-late-cancel.test.ts`, `__tests__/admin-settings-late-cancel.test.ts`, `__tests__/components/{HomeTab.lateCancel,LateCancelEditor,PaymentsCard.lateCancel}.test.tsx` |
