# Roster import — bring your list

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). This is step B of `docs/plans/six-feathers-onboarding.md`. A club with 35 members cannot start on BPM until it can bring its list in one go.
**Status:** in-flight
**Review on:** 2026-12-02 — has any club imported a list, and how many names did the admin fix by hand afterwards? None imported = park C (claiming a name) along with this; many fixes = the parser guessed wrong, so narrow it to the formats that worked.

## Problem

- **Grant's ask (2026-10-29):** "Allocate a way for excel or simple list migration". Asked which input to support, he answered "1,2": a paste box AND a `.csv` file.
- **What a club's list looks like:** Six Feathers keeps its list as a numbered WhatsApp post: names, blank numbers for open spots, a "Waiting list" heading, and guests written "Jenny (Josh)". Other clubs keep a spreadsheet. Neither has a way into BPM today.
- **What adding people costs today:** an admin types each name into the Roster page's add sheet, one save at a time. For 35 people that is 35 sheets. The other route, one-time invites, makes each person sign up themselves, at 30 invites an hour per IP. Either way, the first week on BPM is data entry.

Nobody at Six Feathers has asked for this. Ian has not been asked about BPM yet (`six-feathers-onboarding.md`, Decisions). This is Grant's ask, made for the day Ian says yes.

## Kill criterion

- No club has imported a list by 2026-12-02, which is `six-feathers-onboarding.md`'s kill date. Then the tool waits along with the club, and C is not built on top of it.
- Or the first real import needs more than a handful of rows fixed by hand afterwards. Then the auto-detection is doing harm: cut it down to the one format that worked, and make the admin pick the format.

## Non-goals

- **No `.xlsx`.** Reading Excel's own file format needs a library, and an import tool used a few times a year does not justify one. The sheet says "Save it as CSV, or copy the cells and paste them here". Pasted cells arrive as tab-separated text, so that route already works.
- **Names only.** Phone, email and e-transfer columns are not stored; the preview names the columns it ignored. Rule 10 treats e-transfer names as sensitive payment data, and a roster doesn't need a phone number.
- **No message to the people imported.** The import adds names to the roster and tells nobody. How an imported person gets in is step C (claiming a name), planned on its own.
- **No edits to existing people** beyond member vs drop-in (Q1). An import never renames anyone, changes a role, or removes anybody missing from the list.
- **Guests are not imported.** "Jenny (Josh)" is a plus-one, and plus-ones have their own home since #751 (`docs/plans/plus-one.md`).

## Decisions

- **Re-importing updates member vs drop-in, and nothing else** (Q1, Grant 2026-10-29: "yes to all three"). A name already on the roster is re-marked when the paste marks it differently. Its name, role and everything else stay as they are. BPM Core can mark its regulars from one paste.
- **A chat list's defaults come from the "Waiting list" heading** (Q2, yes). Names above the heading are members and names below are drop-ins. The admin can flip any row in the preview, so a wrong guess costs one tap.
- **`Membership.regular` is stored in this step** (Q3, yes). The Roster page reads it in the same change: a "Drop-in" label on the row, "Members" and "Drop-ins" filter chips (shown only once anyone is marked), and an "In this club" choice in the person's sheet. The sheet is how one person gets re-marked without pasting a list again. The plan had not listed it, but without it the mark could only be fixed by re-importing.
- **The mark lives only on the membership.** Unlike `canGift` it has no `Member` copy: with groups off there is no club to say "member of", so the field is ignored, and the preview hides the toggle for people already on the roster (`marksStored: false`).
- **The add sheet and the import share one function** (`addRosterName`). Groups off, its `members` scan now answers "exists" when ANY active Member holds the name. The old route reactivated an inactive same-name Member even when an active one existed, which made two live people with one name.
- **Every row can be unticked,** not only the `similar` ones the plan named, so a misread line ("Saturday badminton") costs one tap instead of a wrong person on the roster.
- **A date or time header needs a digit beside the month or weekday word.** May, Jun and Sun are people's names too, and a plain list of them must not be skipped.

## Shape

### The parser: one pure function, three inputs

`parseRosterText(text)` in a new `lib/rosterImport.ts`. It returns one row per name with `{ name, regular, line }`, plus `{ ignoredColumns, skipped }`. It never throws.

It detects the format in this order and goes with the first one that fits:

1. **Tab-separated** (cells copied from Excel or Sheets): any line that contains a tab.
2. **CSV** (the file picker, or a pasted export): commas with RFC 4180 quoting, so `"Lee, Chris"` stays one name. The CSV route is the only one that needs quote handling.
3. **Numbered or plain list** (a WhatsApp post, or one name per line):
   - Leading numbering is stripped: `1. Name`, `1) Name`, `12 - Name`.
   - A number with nothing after it is an open spot and is skipped.
   - A line that matches `Waiting list` / `Waitlist` / `候补` switches the default to drop-in.
   - A header line, such as the chat's date line, is skipped when it carries a date or a time.
   - A line written `Name (Host)` is a guest: it is skipped and listed under "Guests, not imported".

For the two table formats:
- **Columns.** A header row is recognised by a cell named `name` (in any case), so the name column can sit anywhere. A second column whose values read as member or drop-in (`member` / `regular` / `yes` / `y` against `drop-in` / `dropin` / `guest` / `no` / `n`) fills `regular`. Every other column is reported as ignored, never stored.
- **With no header,** the first column is the name.

The file picker is `<input type="file" accept=".csv,text/csv">`. It reads the file in the browser (`File.text()`) and feeds the same function, so the server only ever receives names. An `.xlsx` that is picked anyway is refused before parsing, with the "save as CSV" line.

### The preview: what will happen, from the server

`POST /api/members/import` with `{ rows, dryRun: true }`. The preview comes from the server because only the server knows the roster.

The server sorts each row into one of these:

| Kind | Meaning | Default |
|---|---|---|
| `new` | No one on this roster holds the name | add |
| `existing` | An active member holds it | leave as is; update member vs drop-in if Q1 is yes |
| `returning` | A removed member holds it | rejoin (what `adminAddToRoster` already does) |
| `similar` | `looseNameKey` matches someone else on the roster (`Chris L.` vs `chris l`) | skip; the admin can include it |
| `duplicate` | The same `rosterNameKey` appears earlier in this paste | skip |
| `invalid` | Empty, or over 50 characters (the add sheet's own limit) | skip, with the reason |

The `similar` and `duplicate` checks key the way the backfill's `names` report does: `rosterNameKey` for the actual constraint, the looser fold for the advisory. That report learned the hard way that a report about a constraint must be keyed the way the constraint is (CLAUDE.md, the backfill bullet). The `looseNameKey` fold moves from `lib/groupBackfill.ts` into `lib/groups.ts` beside `rosterNameKey`, so both callers share one copy.

The admin sees counts at the top ("32 new · 2 already here · 1 looks like someone"), then the rows. Each row has a member / drop-in toggle and, on the skip-by-default kinds, an include toggle.

### The write: one person at a time, safe to re-run

The same route without `dryRun`.

- **Gate:** `isAdminAuthedWithMember` (rule 3, mutating). A rate limit before it (rule 4). At most 200 rows per call, about five times Six Feathers' roster.
- **Re-classify, then add.** The server sorts every row again rather than trusting the preview, then calls one shared `addRosterName(groupId, name)` per row, sequentially. `addRosterName` is the body of today's `POST /api/members`, moved into `lib/roster.ts` so the import and the add sheet cannot drift. That includes the 409 on a name taken and the lost-race catch.
- **Why sequential:** rows in one paste must not race each other for a reservation, and each new name costs three writes, so 40 names take a few seconds on B1.
- **Result:** one outcome per row (`added` / `rejoined` / `updated` / `unchanged` / `taken` / `skipped`). Partial success is reported row by row, never as a total failure.
- **Re-running** the same paste is a no-op for every row that already landed. If the request dies part-way, the procedure is: paste again.
- **Groups off:** `addRosterName` keeps today's flag-off branch, the members scan, so a rollback reads the same.
- **`regular`:** with Q3 yes, written through a new `setMembershipRegular` in `lib/groups.ts`, the only writer of memberships.

### Where it lives

On the Roster page, an "Import a list" settings row opens one bottom sheet. The sheet has two steps:
1. **Paste or pick a file:** a textarea, plus "Choose a .csv file".
2. **Check and import:** the preview, then "Import N people".

After a successful import, the sheet leaves a top toast ("32 people added") and the roster re-reads. It is English only, like every admin screen (CLAUDE.md, Q10). The sheet uses the existing parts: `BottomSheet`, `SettingsList`, `cc-btn`, `.cc-choice`, `segment-control` for the toggle. It needs no new pattern.

| piece | file |
|---|---|
| Parser (pure) | `lib/rosterImport.ts` |
| `addRosterName`, shared with `POST /api/members` | `lib/roster.ts` |
| `looseNameKey` (moved) and `setMembershipRegular` | `lib/groups.ts` |
| `Membership.regular?: boolean` (additive; absent = not marked) | `lib/types.ts` |
| Preview and import | `app/api/members/import/route.ts` |
| Where each row lands (classify, run) | `lib/rosterImportRun.ts` |
| The sheet, plus the label, filter and "In this club" | `components/admin/CommandCenter/RosterImportSheet.tsx`, `components/admin/CommandCenter/RosterPage.tsx` |
| `PATCH /api/members { regular }`, and `regular` on the admin `GET` | `app/api/members/route.ts` |
| Tests | `__tests__/roster-import-parse.test.ts`, `__tests__/group-roster-import.test.ts` |

### Tests

- **Parser:** each of the three formats, using a fixture shaped like the Six Feathers post with famous players' names (the fixture-name rule). Quoted commas. A header in any column. Blank numbers. The waitlist heading. Guests. An `.xlsx` refused.
- **Route:**
  - Each kind in the table above.
  - The dry run and the real run agree.
  - Re-running is a no-op.
  - Two clubs: an import into club X never touches club Y's roster, even when the same name is on both. It joins `__tests__/group-*.test.ts`, which also keeps the new route off the sweep-coverage ratchet.
  - Rows over the cap are refused.
  - A non-admin gets a 401.
- **Members-only canary:** the route has no `GET`, so `__tests__/members-only-coverage.test.ts` has nothing new to classify. It is run anyway.

## After this: C, claiming a name

An imported person is on the roster but has no way to sign in. Until C ships, the admin can still sign them up for a session by name, as admins do today. C was sketched in `six-feathers-onboarding.md` as "PR 2". It covers two things:
- an invite sign-up whose name matches an unclaimed imported member attaches to that member instead of answering `name_taken`;
- the signed-out "I play here already" ask learns which club it is for (multi-group Phase 6's open item).

C gets its own plan once this one is settled. It is the security-sensitive half, because it decides who may become an existing name.
