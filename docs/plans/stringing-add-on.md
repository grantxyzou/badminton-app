# Stringing as an add-on service

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups), and the rule that how a club runs is a SETTING (`lib/clubRun.ts`, `six-feathers-onboarding.md`).
**Status:** intent — first parked by Grant on 2026-11-04 ("plan it but back log"); widened on 2026-11-13 from an on/off switch to a shop a club can share. Nothing built.
**Review on:** 2026-11-25 — Grant's answers to the five Open questions below, and does Six Feathers want Grant's shop (phase 2) or no stringing at all (phase 1 only)?

## Problem

Grant, 2026-11-04: *"Separate out stringing service so it's an add on service. Rather than a mandatory."*

Grant, 2026-11-13: *"What if we tray the entire stringing feature as an add-on? It can be turned on for a group when it's on a stringer can be with the club or be someone that the organizer or stringer decide to join. Or the club's stringer can use the service."*

Today stringing belongs to a club the way a kitchen belongs to a house. The shelf of strings, the rate card, the stock, the bench of jobs and the money owed for them all live inside the club (`stringingJobs`, `clubSettings` and `ledger` are GROUP containers, `lib/containers.ts`), and the stringer is a club member with `Membership.canString`. That works for BPM Core, where Grant is both the organiser and the stringer. It does not work for:

1. **A club with no stringer.** Six Feathers, the first outside club in view, has none, but still gets the Stringing tab, the bench row and the stringing pushes (`NEXT_PUBLIC_FLAG_STRINGING` is one switch for the whole deployment).
2. **A club whose stringer is not one of its players.** The organiser knows someone who strings, but adding that person to the roster to unlock the bench would also put them on the sign-up list, the roster and the dormant count.
3. **One stringer serving two clubs.** If Grant strings for BPM Core and Six Feathers, he has ONE reel of BG80 on his desk. Today he would need two shelves, two rate cards and two stock counts, and neither count would be right, because each club's stock only subtracts its own jobs.

Nobody outside BPM has asked for 2 or 3 yet. They are Grant's read ahead of a second club.

## The idea in one line

**Split the shop from the club.** A club either has stringing OFF, runs its OWN shop (today's model, unchanged), or LINKS to someone else's shop. Think of a restaurant: the dining room (the club) is where people sit, and it can have its own kitchen or have food sent in from a kitchen down the street. The kitchen keeps its own pantry and its own till, whichever dining room the order came from.

Example: Six Feathers links to Grant's shop. Taufik (a Six Feathers member) opens Stringing in Six Feathers, sees Grant's strings and prices, and sends a request. It lands on Grant's bench beside BPM's jobs, tagged "Six Feathers". Grant strings it from the same reel, so stock drops by one set. Taufik's Home shows "Stringing · owed to Grant's shop", and the e-transfer goes to the shop, not to Six Feathers' organiser.

## Kill criterion

- **Phase 1 (the switch):** if the first outside club turns stringing ON within a month of joining, "off by default for a new club" was wrong; revert to on-by-default, switchable.
- **Phase 2 (linking):** if a linked club's members send no request in the six weeks after the link goes live, linking is not worth phase 3. Counted from `stringingJobs.createdAt` with `clubId` set to that club.
- **Phase 3 (a shop with no club):** not started until a real stringer outside every club asks for it.

## Non-goals

- Charging clubs or stringers for the add-on. "Add-on" means a switch the organiser turns on, nothing commercial (yet).
- A directory of shops to browse. A link starts from an invite code passed person to person, like a club invite.
- A club using two shops at once. One link per club.
- Different prices for different clubs from the same shop. One rate card per shop in v1.
- Moving BPM's data. BPM's ids are never rewritten (`.claude/rules/multi-group.md`); BPM Core's shop stays exactly where it is.
- Retiring `NEXT_PUBLIC_FLAG_STRINGING`. It stays as the deployment-wide kill switch, with the club setting under it.
- A per-member opt-out. The switch is the club's, like money.

## Proposed decisions (not yet made — Grant to confirm)

1. **A shop is stored as a group.** A group already scopes everything a shop needs (shelf, rate card, stock, jobs, ledger, stringers via `Membership.canString`), and the database is at its 25-container cap, so a new container is not an option. BPM Core's shop IS BPM's group, so nothing moves. A stringer with no club (phase 3) gets a group with `kind: 'shop'` that has no sessions.
   *Alternative it beats:* give the outside stringer a "stringer-only" membership in every club they serve. Cheaper to build, but each club keeps its own shelf and stock, which is problem 3 all over again.
2. **The club setting says which shop:** `GroupSettings.run.stringing?: { mode: 'off' | 'own' | 'linked', shopId?: string }`. Absent reads as `own` (BPM Core is unchanged). A new club gets its style's default (`first_come` own, `members_first` off).
3. **A link takes both sides.** Either the organiser or the shop's owner starts it, by an invite code; the other side accepts. Either side can end it. The link is a `kind: 'shopLink'` doc in `groups` (global, PK `/id`), id `shoplink:<clubId>`, so a club can never hold two.
4. **A linked club's jobs live in the SHOP's books.** The job is written under the shop's group with an additive `clubId` field. The shop's stringers see it on their bench with the club's name. The club's organiser does not see the bench: it is not their shop.
5. **Money is owed to the shop, not the club.** The charge and payment go in the shop's ledger. Home in the club shows the stringing balance as its own line with the shop's name and the shop's e-transfer details. The club's payments inbox never matches it; the shop's does. A club with `money: 'off'` can still use a shop, because the stringer still needs paying.
6. **What the shop learns about a linked club's member:** their name, their racket and string from their gear, and their own jobs. Not the club's roster, sessions or anyone else's data.
7. **Ending a link never hides money owed.** New requests stop at once; open jobs finish on the bench and stay on the player's Home until paid and archived.

## Phases

| Phase | What | Who it unblocks |
|---|---|---|
| 1. The switch | Stringing on/off per club (the 2026-11-04 plan). Off hides the Stringing tab (the nav drops to three), the bench row and bench signals, the stringing lines on Home's balance, the stringing pushes and the long-press shortcut. | Six Feathers with no stringer |
| 2. Link to another club's shop | The `linked` mode, the link doc, invite and accept, jobs tagged with `clubId`, the player reading their shop's shelf, the balance line "owed to <shop>", request pushes going to the shop's stringers. | Six Feathers using Grant's shop |
| 3. A shop with no club | `Group.kind: 'shop'`: a stringer creates a shop without running sessions, invites clubs to link. Shop-only nav (bench, shelf, money; no sign-ups). | A stringer outside every club |
| 4. (Maybe) the add-on as a product | Pricing for clubs or shops. | Only if Grant decides to charge |

Each phase is shippable on its own, and 2 needs nothing from 3.

## Open questions for Grant

1. **Who gets paid for a linked job:** the shop (the stringer), as proposed, or the club, which then pays the stringer?
2. **Who must agree to a link:** both sides (proposed), or can an organiser add a shop without the stringer accepting?
3. **Should a linked club's organiser see anything** of their members' jobs? Proposed: no, only "linked to Grant's shop" on "How your club runs".
4. **Same price for every club** from one shop (proposed for v1), or per-club prices?
5. **Is there a real stringer outside every club** today? If not, phase 3 waits.

## Risks

- **Two clubs, one person.** Lin is in BPM Core and Six Feathers, both linked to Grant's shop. Her jobs are hers in the shop's books, so she sees all of them in either club. That is right (it is her racket) but must be tested.
- **The cookie names the club, not the shop.** Every stringing route resolves `shopOf(club)` from the cookie's claimed club and writes through `groupScope(shopId)`. A helper `requireShopCustomer(req)` (active member of the club AND the club links that shop) must be the only door, pinned by a coverage test like `__tests__/group-scope-coverage.test.ts`.
- **Pushes cross clubs.** A request from Six Feathers pushes the shop's stringers, never Six Feathers' organiser. The two-club isolation tests gain "a linked request reaches only the shop".
- **Stock and the shelf map** read one shop, whichever club asks. They already take a group id, so this is the shop's id.

## Shape (proposed, not built)

| Piece | Where |
|---|---|
| Phase 1: `stringing` on `GroupSettings.run`, defaulted by club style, absent = BPM as today | `lib/clubRun.ts`, `parseClubRun`, `memberVisibleSettings`, `useClubRun()` |
| Phase 1: the switch on "How your club runs", beside money | `components/admin/CommandCenter/ClubRunPage.tsx` |
| Phase 1: off hides the tab, bench row, balance lines, pushes, shortcut | `components/HomeShell.tsx`, `CommandCenter.tsx`, `lib/useAdminNeedsYou.ts`, `lib/owedBalance.ts`, `lib/stringingNotifyDispatch.ts`, `lib/stringingRequestNotify.ts`, `lib/appShortcuts.ts` |
| Phase 2: link doc, `shopOf(clubId)`, invite and accept | new `lib/shopLink.ts`, `app/api/stringing/link/` |
| Phase 2: the one door for a customer | `requireShopCustomer` in `lib/auth.ts` |
| Phase 2: `clubId` on a job (additive) | `lib/types.ts` `StringingJob`, `app/api/stringing/jobs/route.ts` |
| Phase 2: balance line owed to the shop | `lib/owedBalance.ts`, Home's balance card |
| Phase 3: `Group.kind: 'shop'` and a shop-only shell | `lib/types.ts`, `lib/groups.ts`, `components/HomeShell.tsx` |
| Tests: two-club isolation gains the switch and the link | `__tests__/group-isolation-*` |
