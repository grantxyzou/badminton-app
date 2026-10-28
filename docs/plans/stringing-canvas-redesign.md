# Stringing tab — the canvas redesign

**Track:** North Star pillar 4 (equipment service), the same track as [`stringing-tabs.md`](stringing-tabs.md) and [`stringing-audit-fixes.md`](stringing-audit-fixes.md): this redraws the player half and the bench of the one paid thing the app sells.
**Status:** in-flight (implemented on `claude/confident-davinci-rmk8rt`, awaiting Grant's review)
**Review on:** 2026-11-25 — From `stringingJobs`, in the four weeks after ship: what share of player-origin requests were sent from the new two-step sheet without an admin re-pricing them, and how many "Review the change" answers were Cancel against Confirm? Before ship, unanswered changes were the norm.

## Problem

Grant reviewed every Stringing screen on the Design canvas ("Page 5", 2026-10-26 to 2026-10-28) and left about sixty comments. These are the ones that change behaviour, in his words:

- On the service card, about the request link: "This is not Request anymore. Its the next action." And on the collapsed card: "Does not need collapseing", "this and the bottom card is redudant".
- On the request sheet: "this and the back arrow and the sheet title is redundant eh?" and "this is also redundant with the car below. Also no clear CTA".
- On the price band: "why hide?", then "dont hide". This reverses the price wall that [`stringing-admin-controls.md`](stringing-admin-controls.md) listed as a non-goal to reopen.
- On the confirm sheet, which renamed both buttons: "Confirm" and "Cancel this request". Also "Why doesnt the button on previous screen update?" (the stale-sheet 409 bug).
- On the strings map: "How do we handel large list of maps? they overlapp", then "show me", then "how clicking here should zoom in to the chart allow back butoom".
- On a string's page: "is this data point from Yonex? If so sub text should call out.", "are we missing metrics from the data?" and "We need to have a section 'Based on usrs assignment'", which he then renamed "Based on your racket and skill".
- On stock: "Does user care about stock here?" and "In stock, Low on stock, Out of stock".
- On the bench: "Align the design with the card above for stringer", "clean up this card".
- On the intake: "if search is there why list name out?"

The canvas is the spec. The frame-by-frame text is in the session scratchpad. The decisions below are what a frame cannot show.

## Kill criterion

This failed if, within four weeks of ship:

- a player reports being charged a price they did not see, or a bill differs from the quoted figure without a confirmed change; or
- the bench takes longer to work than before, meaning Grant asks for the old per-job rows back.

Either one means reverting the part responsible: the exact quote, or the single bench card.

## Non-goals

- **No new job statuses.** No new stored fields on `StringingJob` either, beyond what is listed under Decisions.
- **No player-side cancellation of a job.** "Cancel this request" declines the stringer's proposed change; it does not delete the restring (see Decisions).
- **No push-body money.** The lock-screen rule in CLAUDE.md stands: a push still carries no price.
- **Admin job detail, set-up and shelf sheets are not redrawn.** The canvas's `StrJobDetail`, `StrJobWaiting`, `StrJobChange`, `StrSetup` and `StrShelfSheet` frames record the screens as they are today.
- **No admin i18n.** The admin surfaces stay English-only by decision.

## Decisions

1. **The price wall comes down for the player's own job.** `toPlayerJob` sends the exact quote, `quote: number | null` in dollars, in place of `priceRange`. `amountDue` stays as it is: the bill once the job is billable.
   - The card says "Quoted $30" before the job is billable, "Not priced yet" with no quote, and "$30" on the Ready banner.
   - `PlayerNotice.priceRange` (`lib/stringingNotify.ts`, read by `composeEmail`) is renamed the same way, so the stringing email says `Quote: $30`. The push still carries no money.
   - The intake's "The player sees" line shows the exact figure.
   - `priceBand` / `formatPriceBand` / `PRICE_BAND_CENTS` are deleted along with their tests.
   - The response field is renamed rather than kept beside the new one. `PlayerStringingJob` is a response shape, not a stored one, and its only reader is this app's bundle, which deploys with the route (the widget, `ios/` and `android/` read no stringing money). Leaving the band in the payload would let one stale reader keep showing "$28–32" beside "$30".
   - The docs that state the wall are corrected in the same change: CLAUDE.md's "A quote is a range; a bill is a number", the `PlayerStringingJob` and `ConfirmChangeSheet` docblocks, and `stringing-admin-controls.md`'s non-goal.
2. **"Cancel this request" is the existing `decline`.** In the frame, the request is the STRINGER's proposed change, and the racket is already on the bench. A player cancelling the whole job would need a new destructive route and a policy for a racket physically in someone's hands. That is out of scope. Decline (`accept/route.ts`) clears `pendingEdit`, stamps `pendingEditDeclinedAt`, and the old spec and bill stand; the bench reads "declined", not "cancelled". The WORDING is the open question for Grant: a player may read "Cancel this request" as cancelling the restring.
3. **The 409 "gone" answer refreshes the card.** `ConfirmChangeSheet` calls `onAnswered()` on a 409 and hides the diff and both buttons. Only the "no longer waiting" line and Close remain, so the card behind it loses the stale banner. This supersedes frame `StrConfirmGone`, which still draws the diff and buttons under Close.
4. **Money is whole dollars when whole, through ONE helper.** `fmtMoney` (integer → `$30`, otherwise `$30.50`) already exists as a private copy in `StringingCard`, `UnpaidSessionsCard`, `PaymentsCard` and `PlayerProfileSheet`. It is hoisted into `lib/fmt.ts` and the stringing surfaces use it: the confirm diff (today `toFixed(2)`), the quote, the Ready banner, and on the bench "Still owes $28" and the delete copy. A `$34.50` quote must never round to `$35`. The admin job detail keeps its `$26.00` input format (not redrawn); the other three copies are a later sweep.
5. **One card per racket, no fold.** `StringingCard` splits in two:
   - **The service card**: the shop state, the restring line, the rackets error, a full-width "Submit a request" in the tinted `cc-btn-primary` (the canvas draws the tint, and `.btn-primary`'s filled gradient stays the sign-up's, the app's one filled CTA) and the "See pricing details" row.
   - **A progress card per open job**, in server order. Header: racket, then `J-0001 · BG80 · White · 26 lb`, then the four-step strip.
   - **The stage row**: "Waiting for your racket" / "With the stringer · Quoted $30" / "Being strung · Quoted $30".
   - **Ready replaces the stage row** with a green banner ("Your racket is ready / Grab it at the next session.", the amount inside it).
   - **A pending change is an amber banner on THAT racket's card**: "$34 → $38" and a solid amber "Review the change".
   - The single lead strip and the collapse go.
6. **The request sheet is two steps.**
   - **Step 1** (racket, string, colour) and **step 2** (tension, summary, send) share the one sheet. The title reads `1 of 2` / `2 of 2`, and step 2 has a back chevron.
   - **Step 1** keeps today's racket picker and string rows: gauge chip, shelf name, `0.68mm · repulsion`, price, and a stock word only when low or out. Out of stock can't be picked. The custom-string free text is gone, EXCEPT when the shelf is empty or cannot be read: then step 1 keeps today's free-text field and its explanation, because the own-string row alone would leave a new club no way to ask for a club string. The own-string row ("I have my own / Labour for stringing only / Ask") takes free text when picked.
   - **Step 2** has one "Main + Cross" stepper. "Separate tension requests for Main and Cross" reveals Mains/Crosses steppers, the unusual-pair hint and "Back to the usual". Separating the tension no longer swaps the string section for free text, which was the bug.
   - **Sending shows the Sent screen**: "Drop off your racket", a segmented progress strip at its first segment, "Turn on notifications" through `usePush().enable()` (hidden when push is on or unavailable), and "Got it".
7. **Stock words are "In stock" / "Low on stock" / "Out of stock" everywhere.** The keys `stock_in|low|out` keep their names. Players see a stock word only where it changes a decision: the request rows and the map's selected card show low or out only, the list shows none, and the string page shows all three.
8. **Pricing details is one card, "Strings in stock".**
   - The subtitle names the view, and an icon button in the header switches it (`map` ⇄ `format_list_bulleted`).
   - The map defaults to List with more than 8 strings. A remembered choice still wins.
   - **On the map:**
     - "Compare by" Power/Control/Feel, with the axis titles outside the plot (the rotated "More power →", "Lasts longer →").
     - "Tap a string to see more" in the corner, and no stock legend.
     - Strings with identical scores share one counted dot. Labels are placed without overlap, and the selected label is always a pill.
     - Tapping a counted dot zooms in. Its strings fan out on a ring, "‹ All strings" appears, and so does "N strings at Power 8 · Durability 7".
   - **The selected card** shows the shelf name and price, the source line ("…as rated by <brand>" when `ratingSource` is `'Brand published'` (33 strings), "…community estimates" when it is `'Consensus estimate'` (13); the field never names the maker, so the brand comes from `item.brand`), and 2×2 meters (Power / Control / Durability, plus a Feel marker), with "See how it plays" below them.
   - **List rows**: the shelf name, `Power 10 · Control 8 · Durability 6`, the price and a chevron.
   - "Bring your own string" leaves this card; the own-string price lives on the request row. The stringer's note stays, under either view. Strings the map cannot plot (no ratings) keep today's "Not on the map" line under the map.
9. **A string's page** (`StringDetailSheet`):
   - **The hero card**: the name, the In stock pill, "Power · Hard feel", the gauge line, then the price over "Restring price", 2×2 meters (with Sound when the catalog has `hittingSound`) and the source line ("Rated by Yonex, out of 10", by the same `ratingSource` rule as the map card).
   - **Below the hero**: the description, then the tension and level chips.
   - **"Based on your racket and skill"**: the player's main racket from Gear, the pairing engine's verdict and reason, and Tension and Level checks.
   - **The verdict needs a new read.** `pairString` needs the server-built `PlayerProfile` and the member's in-play frame, which `/api/recommend` resolves server-side on purpose, so it cannot run in the browser. `GET /api/stringing/fit?id=<catalogId>` (member-gated, classified in `members-only-coverage`) resolves the frame the way `/api/recommend` does (owned frame only — a recommended frame is not "your racket") and returns `pairString(frame, [thatString], …)`: `Good match` with no warnings, `Worth a look` with any, `Not for this frame` when the tension gate rejects it; the first reason; the frame's and the string's tension windows; the level line. No check-in, or no owned catalog frame → the section is absent, never guessed.
   - **Then**: Colours with "The maker's colours. Ask the stringer which are on the reel.", and "Restring with this string".
   - **That button opens the request sheet on Submit request with the string picked.** It goes through the stringing intent, now JSON `{ lbs?, string? }`; the bare `'open'` (the app shortcut) and a bare number (Stats) still parse.
   - The "What this means" and Specs sections go. The page now answers both.
10. **The bench is one card.** "Stringing jobs · 5 open · 1 late" holds an inner card per job:
    - **Each inner card**:
      - The racket, then the J-number, the status pill and ⋮.
      - Then `Exbolt 63 · 27/29 lb · for Kento`.
      - Then the due line: muted, amber "Tomorrow", red "3 days late". "Ready · unpaid" replaces it on a ready job that is unpaid — on the bench only. `StringerJob` carries no `paidAt`, and today every Ready job on a stringer's queue reads "Ready · unpaid" whatever was paid (`StringerJobsCard` passes `paidAt: null`). The shared card takes `paid: boolean | null`; `null` (the stringer) never says "unpaid".
      - Then a full-width next-step button: Requested → Mark received, Received → Mark strung, Strung → Mark ready, Ready → Mark picked up.
    - Tapping the card body still opens the job, and swipe pin/archive stays.
    - The stringer's queue card is the same inner card (`JobCard`), with no money on it.
    - The ⋮ and Delete sheets are titled with the racket and `J-0003 · for Viktor`. The delete copy says the exact amount owed. **Delete stays archive-only**: today's rule (`StringingPage`, pinned by `StringingBench.test`) makes the archive the undo step, so frame `StrJobDelete` (Delete on a live Ready job) is superseded and named in the report.
    - **The archive** is a "Picked up · N jobs · M still owe" card of the same inner cards, with "Still owes $28" and "Mark paid" on billable ones.
11. **The intake shows search plus three "Recent" chips**, the members on the three most recent jobs. `StringingPage` already holds the bench list and hands it in; the intake's own per-member read still runs after a pick. A name list only appears once something is typed.
12. **The closed shop says "Closed"**, not "Coming soon" (the `soon` value changes in both locales).
13. **One PR, three commits, in dependency order**, each passing the full gate alone so any one can be reverted alone:
    - **A, the money path**: the exact quote, the confirm sheet, the service and progress cards.
    - **B, the request flow**: two steps, Sent, the string page and its fit read.
    - **C, the shelf and the bench**: map clusters and zoom, `JobCard`, the archive and the intake.

    Fable's review proposed three PRs; one report to Grant before one merge is what was asked for.

## Shape

| Piece | File |
| --- | --- |
| Exact quote, band removal | `app/api/stringing/jobs/route.ts`, `lib/types.ts`, `lib/stringing.ts`, `lib/stringingNotify.ts`, `lib/stringingNotifyEmail.ts`, `components/admin/CommandCenter/StringingIntake.tsx` |
| Service card + progress cards | `components/stringing/StringingCard.tsx`, new `components/stringing/RacketProgressCard.tsx` |
| Two-step request + Sent | `components/stringing/RequestStringingSheet.tsx` |
| Confirm sheet | `components/stringing/ConfirmChangeSheet.tsx` |
| Pricing details, map clusters + zoom | `components/stringing/StringsWeOfferCard.tsx`, `components/stringing/StringMap.tsx`, `lib/stringMap.ts` |
| String page + fit read | `components/stringing/StringDetailSheet.tsx`, new `app/api/stringing/fit/route.ts`, `lib/stringingIntent.ts` |
| Money format | `lib/fmt.ts` (`fmtMoney`) |
| Docs made true | `CLAUDE.md`, `docs/plans/stringing-admin-controls.md`, `lib/types.ts` docblocks |
| Bench, archive, sheets | `components/admin/CommandCenter/StringingPage.tsx`, new shared `components/stringing/JobCard.tsx`, `components/stringing/StringerJobsCard.tsx` |
| Intake Recent | `components/admin/CommandCenter/StringingIntake.tsx` |
| Copy | `messages/en.json`, `messages/zh-CN.json` |
| Glyphs | `lib/iconNames.ts` + `node scripts/fetch-icon-font.mjs` |

## Checks after implementing

- **Time.** Due lines stay the bench's `dueFor(job, todayIso())`, unchanged: `todayIso()` is the VIEWER's local date and `readyBy` a UTC-midnight day, compared day to day; there is no club zone. "Strung N weeks ago" stays `restringDueWeeks`.
- **Data.** Ratings come from the catalog attributes (`repulsion` = power, `control`, `durability`, `hittingSound`, `feelScale`), never re-derived. Cluster counts sum to the plotted strings.
- **Correction to the plan review.** A stringer's queue already hid "Ready · unpaid" (`StringerJobsCard` skipped that key). The real gap was that a Ready job there showed no date at all. `JobCard` now treats an unknown payment as paid for the due line only, so the date shows.
- **Cost.**
  - The quote is `priceCents / 100` unrounded.
  - The confirm diff's figures are exactly `priceFrom` / `priceTo`.
  - The Ready figure is `amountDue`.
  - Delete copy is `isBillable` × price.
  - Nothing on the balance path changes.
- **Design system.** Spacing, design, loading and sheet-size canaries. No raw px/hex. Inner cards at 12/12 (the bench's at 16/16 is a named exception per the canvas).
- **Motion** (reviewed 2026-10-28; every recipe is from the motion system, and no keyframe is new):
  - **Appear** (`.motion-fade`, keyed):
    - the request sheet's step change and the Sent screen;
    - the swap between one tension stepper and two — a crossfade rather than the planned `<Collapse>`, because the sheet's column is a grid with a gap, which a collapsing child cannot animate (the gap snaps);
    - the map's zoom in and out — a crossfade rather than the planned transform, because the marks on each side are different marks (a cluster dot against its strings);
    - the confirm sheet's "no longer waiting".
  - **Fill**: rating meters travel to a new value (`.bpm-meter-fill`, `--duration-normal`) and the feel marker slides, so switching strings on the map moves the bars rather than snapping them.
  - **Press**: a job card scales to 0.98 under a finger (`.bpm-job-card`), and next-step and Review buttons are `cc-btn`.
  - **Open**: sheets keep `<BottomSheet>`'s 180 ms. "Restring with this string" waits that long for the string page to close before the request sheet rises.
  - **Unchanged**: status banners keep their slide-in on mount, the selection ring still jumps (no transition, which is also what reduced motion asks for), and reduced motion drops every width, left and transform transition through the global rule, keeping opacity.
