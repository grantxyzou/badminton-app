# Changelog

All notable changes to the BPM Badminton app are tracked here.

This changelog tracks what ships to production. There is **one deployment**: every push to `main` auto-deploys to https://bpm.grantzou.com/bpm. (Until 2026-08-25 there were two, and this paragraph described promoting from a preview to a `stable` deployment; that second deployment has been deleted.) Work in progress lives behind feature flags rather than behind a separate environment, so `Unreleased` below means *shipped but not yet tagged*, not *not yet live*.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Tag convention: `bpm-stable-vX.Y`.

---

## Session dates and times on Admin read in the club's time (2026-11-12)

- **Admin's session dates and times followed the phone's own time zone**, so a Thursday 7 PM session read "Fri" and "2:00 AM" on a phone or browser set to UTC: the next-session card, its sign-up deadline and members-first window, the session list, Payments, the Ledger, Past sessions, the Roster's last-seen date and a player's history. Every date and time helper in `lib/fmt.ts` now reads in Vancouver time, as CLAUDE.md already said they did.
- **A shuttle purchase showed the day before it was bought** on a phone in Vancouver: its date is a plain calendar day, which a browser reads as midnight UTC, the afternoon before in BC. It now shows the day that was entered, on every phone.

## Admin pages and sheets checked against Apple's guidance (2026-11-12)

- **Every Admin page passed the automatic accessibility check (WCAG 2.2 AA) and the 44pt tap check**, after three fixes: the Skip dates field now has a label a screen reader can say, the names on Sign-in readiness take a 44pt tap (their rows sit 12 px apart now), and on a foldable the Admin pages open from the fold instead of sliding in from the edge.
- **"What's new" is easier to read and to close**: its grey title text was below the contrast minimum in both themes and is now well above it, and its ✕ takes a 44pt tap (the title bar is a few pixels taller).
- **The check-in sheet's ✕** keeps its circle and takes a 44pt tap behind it.

## Easier to tap: every small control takes a 44pt tap (2026-11-12)

- **Apple asks for tap targets of at least 44 by 44 points.** Measured in a browser on Home and every Stats register, a handful fell short: the You / Equipment / Play / Learn switch and Doubles / Singles (28 px tall), "Add to calendar" (16 px), the Balance row (20 px), "Update", "Share", "+ String tension", the racket to try next, its shop link, "Open this week's focus" and "All your kudos".
- **The rest of the app had the same check**: Stringing, Profile, Admin, the signed-out screens. Roster's filter chips (32 px) and a job's "Ready by" date field (42 px) take the same tap area; the chips' rows sit 12 px apart now so each row keeps its own. The round top buttons (theme, language, notifications) measured 42 px across and now measure 44.
- **Each now takes a 44pt tap area that is invisible**, so nothing moved or was redrawn: the same screens before and after match pixel for pixel on Home, Profile and Welcome, and differ on Stats only by 2 to 7 shades out of 255 on some text edges. The one visible change is the Roster's second row of chips, 6 px lower.

## Every tab on a foldable uses both halves, with motion (2026-11-12)

- **Profile on an open Z Fold or Duo**: your list on the left, the page a row opens on the right — Edit profile is open before you tap anything. The open row is marked in green. Sheets (notifications, install) still open in the left half.
- **Admin**: the console on the left, the page you open on the right, with Roster open by default. Opening another row swaps the right half.
- **The stringing bench's own pages** — Add job, Archived, the set-up page, an archived job — and a player's "A change to confirm" now open on the right half beside the list instead of covering both halves.
- **A page on the right has no Back button**: the list it came from is right beside it. A page opened from it (your name, from Edit profile) still has one.
- **Motion**: a page on the right slides in from the fold as it fades in, and the right half scrolls into view when a row far down the list opens it. With reduced motion it only fades.
- **Signed out on a foldable reads like a book**: the bpm logo on the left half, Sign up and Log in on the right. Log in and Sign up keep the logo on the left and put their form on the right.
- **Notifications** shows your settings on the left half and the recent list on the right.
- **Keep your account** (for someone an organiser let in) opens on the right half beside the banner that asks for it, instead of across both halves.
- **A phone is unchanged.**

## Stringing: two-colour sets, your own colours, and a tidier colour picker (2026-11-12)

- **A reel can be a two-colour set** (Grant: "two colour combo like aerobites"). "Red / White" means red mains and white crosses; the mains are always named first. A set is shown as a swatch split down the middle with a small M and C, and is counted in stock like any single colour: buy a reel of "Red / White", string a racket in it, and that set's count goes down.
- **An admin can add the club's own colour** (Grant: "custom picker for future"). "Custom colour" asks for a name and a colour (a quick pick, the hue strip, or a hex like #14B8A6). It is saved with the club's strings, so another string can use it too. Players see its swatch and the name you gave it.
- **The colour picker is tidier.** "Colours on the reel" lists what the maker makes the string in first ("Yonex makes BG80 in"), then "Two-colour sets" (the maker's, such as Aerobite's, and the club's) with "New combo", then "Other colours" with "Custom colour". The tiles are three across, and long names are shortened to fit ("Fl. yellow"). A stringer who isn't an admin gets the same picker and can make a new set, but can't add a club colour.
- **A player's request offers the sets and the club's colours** and sends the colour's English name ("Red / White", or "Teal") to the bench.
- **Catalog colours corrected against retailer listings**: Aerobite is red mains with white crosses ("Red/White"), Aerobite Boost is yellow mains with grey crosses ("Yellow/Grey", not white/yellow), and BG80 no longer lists red.

## Stringing: a walk-up's email goes once, and a waiting job can still be received (2026-11-12)

- **A walk-up never gets the same email twice.** Undoing and redoing "Mark ready" while the ready email was still going out, or a second "Send again" from another phone, could each send a second copy. The job now notes the email as being sent before it goes, and the job page says "Sending…" until it has.
- **"Send again" is gone from a job that is over.** A racket that was withdrawn, collected or archived gets no more email about it.
- **"Send again" shows "Sent" when the email already went from another tap**, instead of saying it could not send.
- **"Mark received" stays on a job waiting on the player.** A suggested change no longer hides it on the bench or the stringer's card; only "Mark strung" and later wait for the player to agree.

## Stringing on a foldable: the list on the left, what you tap on the right (2026-11-12)

- **On an open Galaxy Z Fold or iPhone Duo, Stringing uses both halves of the screen.** The title, the switch and the list keep the left half; what you tap opens on the right half beside it, where on a phone it covers the list. Nothing crosses the fold.
- **Something is already open on the right**: the job at the top of the bench (marked in green), the string the shelf's map picks, or your rackets in progress. With no racket in, the right half shows the strings on offer, and "Restring with this string" opens your request with that string picked. A stringer who isn't an admin sees their queue on the left and their shelf on the right.
- **A phone is unchanged**: tapping a job still opens its page, and a string still opens its sheet. So do the bench's new job, archive and set-up pages on a foldable.

## Stringing: one Save on a shelf string, and string types that follow the maker (2026-11-12)

- **A shelf string's sheet is rethought** (Grant: "rethink about this page, use mobbin"). The catalog match sits under the name; stock comes first ("19 sets left", metres left, what a set costs you and what you make); name, restring price and the note for players are three fields with one Save pinned at the bottom (a rename goes first, then the rest under the new name); the reel's colours are one row that opens a colour grid; purchases are rows with a menu; "Remove from shelf" is a quiet link.
- **String types follow the maker** (Grant: "double check the hybrid and all round"). Aerobite and Aerobite Boost are Control, Skyarc Durability and Li-Ning N68 power, as their makers class them; "Hybrid" was how Aerobite is built, not what it is tuned for. A test now holds our type to the maker's wherever the maker uses one of our words.

## Stringing: walk-ups get their spec and a ready email, and a receipt to share (2026-11-12)

- **A walk-up who left an email address is emailed automatically.** When the job is saved they get "Your racket is with BPM Core's stringer (J-0012)": the job number, racket, string and colour, tension, price ("$34, pay at pickup", or "Ask") and the ready-by date. When the job first moves to Ready they get "Your racket is ready (J-0012)", once, with "Bring $34 or pay your stringer at pickup." when it is priced and unpaid. An undo and a second move to Ready send nothing more. A phone number, or no contact, gets no email.
- **The job page has a "Send to Lee" card.** "Emailed automatically" says when the spec email went ("✓ Sent 3:04 PM"), or "Not sent" with "Send again" if it failed. "Share the receipt" opens "Receipt for Lee": an image of the job with Racket, String, Tension, Ready by, Dropped off, the total, and "Pay at pickup, to your stringer. Bring this receipt or the job number." (or "Paid"), with "Save image" and "Share". The receipt shows the name, never the phone or email.
- An email is sent after the job is saved and never stops it saving. Member jobs keep their own notices; nothing new is pushed.

## Stringing: the bench, in the stringer's card style (2026-11-12)

- **The admin's "Stringing jobs" list has no outer card.** A plain heading with "5 open · 1 late" under it, and a small "Open" pill with a green dot beside it while the shop is open. Each racket is its own card.
- **Each job card carries the 4-step bar** (Received · Strung · Ready · Picked up) under the racket's name, coloured by its status: the same bar the stringer's list draws, now one shared component.
- **A job waiting on the player** says what was suggested ("Suggested BG66 instead of BG80. Wei has to accept before you string it.") and has no next-step button until they answer. Racket, string and tension only: the price is never in that line.
- **The "Open for stringing" row is gone.** "Close shop" is now the last row, under "Strings, stock, prices & holes", with "Players can't send new requests until you open it."; it closes the shop exactly as the old button did. A sign that can't be read, or is still being read, shows in that row's place. The closed shop's card and its "Open shop" are unchanged.
- The archive keeps its list card; its job cards gain the same bar.

## Stringing: jobs for walk-ups (2026-11-12)

- **"New job" can take a racket from someone who is not in the club.** Search for a name that matches nobody and the card says "No one in the club is called Lee." with a row to "Add Lee as a walk-up". The walk-up shows with a "Walk-up" pill, "Not in the club", and an optional "Phone or email" so the stringer can tell them it's ready. The price card reads "How they pay: At pickup, to you". Everything else on the form is the same.
- **A walk-up gets nothing from the app**: no push, no email, no notice. Their job never shows to any player, and their contact goes only to admins and the stringer who has the job.
- **A change to a walk-up's job applies at once**, because nobody in the app can confirm it. The job page says to agree it in person, and the button reads "Save change". A paid job still can't be re-priced.
- **Money**: a walk-up pays the stringer at pickup. Their job is on no member's balance and the e-transfer inbox never matches it. "Mark paid" still counts as club income, and the daily ledger check counts an unpaid walk-up job as "unlisted", not as a mismatch. A strung walk-up job uses string stock like any other.
- The bench card and the job page show the "Walk-up" pill. The intake's error line now shows the general message for a refusal it has no sentence for, where it used to show the message key.

## Stringing: the stringer's note on each string, and a page for a change to confirm (2026-11-12)

- **Strings we offer shows each string in full.** A list row carries the packet, name, price, type and feel, stock, the description and the coloured trait line. On the map, the picked string is the same row, tinted, and opens its page.
- **A string's page leads with how it suits you**, then "Your stringer recommends" (a note the stringer writes per string in the shelf sheet, up to 280 characters; additive `OfferedStringsDoc.notes`), then "Ratings and specs", closed until tapped.
- **A proposed change carries the stringer's "why"** (additive `PendingEdit.reason`, up to 280 characters). The player's racket card shows an amber "Review changes" row and the tracker reads "On hold". The row opens "A change to confirm", a page in place of the old sheet, with the reason, each change in amber, and Keep mine / Accept change. A stringer who isn't an admin still sees no price, and gets the reason only beside a non-price change.

## Stringing: statuses you can tell apart, colour by trait, a calmer closed bench (2026-11-12)

- Every stringing status has its own colour AND icon, defined once and used by the stringer's list, the admin bench and the job page: not dropped off (grey, clock), received (amber, box), strung (blue, tick), ready for pickup (green), waiting on the player (purple, hourglass).
- The stringer's "Rackets to string" drops its outer card; each racket has a 4-step bar under its name, and a job waiting on the player says what was suggested and holds its button. The stringer sees what changed, never the price.
- The admin job page's progress is a horizontal row of steps in the current status's colour.
- Strings we offer: each row reads Power in orange, Control in blue, Durability in green; on the map each dot takes its string's type colour, with a legend, the selected string's meters use the trait colours, and the bottom axis reads "Durability".
- A string's page no longer lists colours (the request is where a colour is picked), and the level line reads "Rated Intermediate".
- The admin bench, when the shop is closed, shows one card in the empty-state pattern with "Open shop", and "Add job" is the solid main button.
- A change to confirm that is no longer waiting no longer shows the "has an update" line above "Nothing left to answer".

## On a foldable, your weekly read sits beside the tiles (2026-11-12)

- On an unfolded iPhone Duo or Galaxy Z Fold, the greeting at the top of Stats → You moves to the left page, under the Level, Games and Kudos tiles, so "Your skills" heads the right page. On an ordinary phone nothing changes.

## Stats opens like a book on a foldable (2026-11-12)

- On an unfolded iPhone Duo or Galaxy Z Fold, Stats now uses both halves of the screen: the title and the Level, Games and Kudos tiles on the left page, and the You · Equipment · Play · Learn switch with that register's cards on the right page. Until now Stats kept one column in the middle, so every card sat across the fold.
- On an ordinary phone nothing changes.

## The stringing animation reads inside its picture (2026-11-12)

- After sending a stringing request, each step's line ("Opening a fresh set of BG80", "Ready to pick up. We'll let you know.") now sits inside the picture along its bottom edge, and "Play again" is a small pill with a replay icon in the picture's top-right corner, instead of a link under the dots.

## Every sheet keeps its main button in reach (2026-11-12)

- A sheet's finishing button (Save, Send, Next, Done, a Keep / Delete pair) now stays pinned to the bottom of the screen while the content above it scrolls, across sign-in and account, the admin console, Profile and Stats. Stringing moved first. An error about that action shows just above the button, and a form still submits on Enter.
- The pinned area keeps clear of the iPhone's home indicator.
- A new build check fails any sheet that puts its primary button back inside the scrolling content; two sheets are exempt with their reasons (the cover choice, and the roster's selected toggles).

## A string's page reads top to bottom (2026-11-12)

- The header of a string's page puts the packet on the left and, beside it, the string's name as the largest line, with the stock pill on the same row and what the string is for underneath. That sentence used to appear a second time under the card; it shows once now.
- The sections below the card sit further apart, so each label reads with its own content.

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

## Unreleased

### String stock goes down for every finished job (2026-11-12)

Grant: "the stock is not going down based on the archived and finished stringing job".

- **A job added on the bench now uses up a set even when its string came from the player's bag.** The bag names a string the catalog way ("Yonex BG80") while the shelf says "BG80", and stock only matched the exact shelf name, so those jobs never came off the reel. A job's string now also matches the catalog name of a linked shelf string, and the same name typed with a space or a dash ("BG 80", "BG-80"). A name that could be two shelf strings is still left under "not on your list" rather than guessed.
- **Deleting an archived job no longer puts its set back.** The job is gone, but a small record of the string it used stays, so the shelf keeps counting it.

### Stringers name the strings and set their reel colours (2026-11-12)

Grant: "open up reel and string name, colour for stringers" (`docs/plans/stringer-shelf-edits.md`).

- **A stringer who isn't an admin now has a "Strings on the shelf" card** on their Stringing jobs page, under their queue. Each string shows its reel colours; tapping one opens a sheet to rename it and pick the colours on the reel, with one Save at the bottom. Members asking for a restring are offered exactly those colours.
- **Nothing else opens up.** Prices, adding or removing strings, catalog links, purchases and stock stay with an admin on the bench. The server refuses any other change from a stringer.

### A stringing request nobody takes now nudges the stringers (2026-11-12)

- **After 48 hours, and again at 3 days**, a stringing request still waiting sends a notification. If nobody has taken it, the club's stringers and organisers get it. If a stringer has it, only that stringer does. "Wei's Astrox 88D Pro has waited 2 days for a stringer." No price, no string spec.
- **The waiting job is highlighted** with an amber tint and a "Waiting 2 days for a stringer" line, on the bench and on a stringer's card.
- **Stringers can take a request themselves.** Their card now lists requests nobody has taken, under "Waiting for a stringer", each with a "Take it" button. If two tap at once, the second is told someone took it first.
- **The app has an hourly tick.** GitHub calls it once an hour, and the stringing nudge is its first job. It needs a `CRON_KEY`, set both in the App Settings and as a GitHub secret (`docs/plans/stringing-request-nudge.md`, "Setting it up").

### Calmer error cards, and a friendlier Stringing tab (2026-11-11)

- **"Couldn't load… / Try again" is no longer red.** A card that couldn't reach the server now shows a cloud icon over the message in normal text, with "Try again" under it, laid out like the app's other empty states. The server not answering isn't the person's mistake. Red is kept for things they need to fix, like a wrong PIN or a form error.
- **A closed stringing service says so in words**: a moon icon, "The stringing service is closed for now." and "Please check back soon to submit a request." The "Request and track…" line is gone from the closed and couldn't-check cards.
- **"Submit a request" is the app's main button**, filled green with a + icon, like Home's "Sign up for this week".
- **"See pricing details" is now "See what kind of strings are offered"**, and the tab it opens is renamed from "Pricing details" to "Strings we offer".
- **The Stringing sheets keep their main button at the bottom of the screen**: "Next: string tension", "Send the request", "Got it", the accept and decline on a change to confirm, and "Restring with this". The rest of the sheet scrolls above them. The other sheets in the app follow in their own change.
- **The "request sent" animation can be swiped through**: swipe the picture, or tap a dot, to stop on a step. "Play again" runs it from the start. Its caption and dots are centred.
- **Cancelling a stringing request now says "A cancellation fee may apply."** It used to say "Nothing is owed yet."
- **A change that is no longer waiting** shows the empty-state pattern: an icon, "Nothing left to answer", and "The stringer withdrew that change or already applied it."

### String colours follow the club's shelf (2026-11-11)

Grant, on the request sheet's colour chips: "this need to match and be dynamic to the strings inventory and string type" (`docs/plans/string-stock-by-colour.md`).

- **The request sheet offers the colours the club has, not every colour the maker sells.** It starts from the reel colours the stringer sets on a string's sheet on the bench (it used to ignore them and show the catalog's list), and falls back to the maker's colours only when he has set none. A colour the club is out of is hidden, not greyed out. One colour left: no question, it is sent as it is. Colour names are now in the member's language.
- **"Log a purchase" asks the reel's colour**: chips from the string's reel colours (else the maker's, else the whole palette), with "Mixed / not sure" first and the default. Mixed stores nothing, so skipping it logs exactly what it did before.
- **Stock is counted per colour once a purchase says one.** A strung job uses up its own colour; a job in a colour nobody tagged, and every untagged purchase, share a "Mixed / not sure" pool. The string's total, its stock band and its cost are unchanged. The bench's string sheet lists sets left per colour and shows each purchase's colour. Members are told which colours are on the shelf, never how many.

### A quieter sign-up card (2026-11-11)

- **The faces say who has signed up.** The line under the count reads "[faces] +7 others have signed up" instead of "Anders and 11 others have signed up". A screen reader still hears the names.
- **"Signing up as Lin" is gone** from the open and full cards: the button is always for your own account.
- **On a full session, the line about another court sits under "Join the waitlist"** and says the idea without numbers: "Another court can be added when enough people are on the waitlist." The waitlist card says the same. The admin's Next session card keeps the counted version.
- **On the waitlist, the banner says "Waitlisted as Lin. You'll be moved up automatically."** The position is already the big number above it. If this phone could get a ping and doesn't yet, "Turn on notifications" sits right there and opens the same ask a waitlist join shows.
- **"Add to calendar" ends the "you have signed up" line** instead of taking a line of its own, and only "Cancel my spot" is underlined in "Can't make it? Cancel my spot".

### "Your fit" opens at its first question (2026-11-11)

- **The racket fitting page opens at the top.** Opened from partway down Equipment, it used to show the page from its middle, past the Level and "Mostly you play" questions. A racket's page and the "Keep your account" page now go to the top on purpose too; before, they only got there because they load short for a moment. Same cause as the tab fix: the page scrolls inside the body, and these asked the window to scroll.

### Each tab comes back where you left it (2026-11-10)

- **Switching tabs keeps each tab's place on the page.** Scroll down Home, look at Stats, come back, and Home is where you left it; Stats opens at its top the first time and returns to its own spot after that. Before, every tab shared one position: Stats opened halfway down because Home had been, and Home came back wherever Stats was. The notifications page also opens at its top and closes back to where the tab was. The memory had never worked, because it watched the window while the page actually scrolls inside the body.

### A new receipt image: where the money went, and how to pay (2026-11-10)

- **The receipt image shared to the group chat is redrawn** (design F4, picked on the design canvas). A green band carries the club, the date, the app's logo and the big "$18.50 each". Under it, the sum: "2 courts × $48 · $96", "1 tube of shuttles · $15", "Total $111", "Split 6 ways · $18.50 each". Then a box that says how to pay: "E-transfer to:", the club's Wealthsimple handle when it has one, and "Please include a memo:". It is 3:4, so a chat shows it whole. The list of who played is gone.
- **A club can add its Wealthsimple handle** ($yourhandle) next to the e-transfer recipient in the admin settings. It is printed on the receipt image and in the copied text ("Or Wealthsimple: $…"). Leave it empty and the receipt shows e-transfer only.

### The receipt names the club in its memo, and the right day (2026-11-09)

- **The e-transfer memo on a shared receipt reads "BPM Core Oct 22 - {your name}" again.** It had been "Oct 22 - {your name}": the club's name never reached the receipt, so the memo collapsed to the date.
- **The receipt image says "Thursday was $18.50 each"** when it is shared on any day but the night itself. It used to say "today was" even for a session shared from Past sessions or the morning after.

### Money shows its cents properly on the admin screens and receipts (2026-11-09)

- **"$18.5" is now "$18.50" everywhere an admin sees money**: the Payments card (per player, each row, "owed", "covered", "Cover their …"), the cover sheet, the session card's "Sent · …" and "Share again", Past sessions, and the receipt image and text sent to the group. Whole amounts stay whole ("$18"). They all use the one money formatter the member screens already use.

### "Save job" says what it still needs (2026-11-06)

- **Save on a new stringing job is never a greyed-out dead end now.** If something is missing, usually whose racket it is, a line under the button says so, and tapping Save takes you straight to it with the search box ready. Once everything is in, it saves as before.

### Coming back is quicker, and Home shows up at once (2026-11-06)

Following "this app is getting really slow":

- **Coming back to the app skips the opening animation.** If you used the app in the last half hour (iPhones often close it in the background while you're in another app), it opens straight to Home. The first open of the day still plays the shuttle.
- **Home shows last time's week straight away.** Where, when, who's in and the announcement appear the moment the app opens, slightly dimmed with "Updating…", and the buttons wait a moment until the up-to-date week arrives. What you owe always waits for the up-to-date figures. Signing out clears it from the phone.
- **The app now notes how long it takes to open on your phone**, so slowness can be measured rather than guessed: a number of milliseconds and the kind of device, never anything on the screen. The privacy policy says so.

### Adding a stringing job works again after the admin sign-in runs out (2026-11-06)

- **"Save job" on the Stringing bench could stay greyed out for good.** When an admin's separate admin sign-in had run out on a phone, the app still showed the bench. But the job list wouldn't load ("Try again"), searching for a player found nobody, and so "Save job" never turned on. The bench now asks for your name and PIN first, just like the Admin page, then opens. Signing in on either one opens both.

### The app opens with a little less to download (2026-11-06)

- **The Notifications page now loads after the app opens**, in the background, so the first screen arrives sooner. The bell's red dot still appears as soon as there's something new: it never waited for the page. A tap that beats the download sees the page's usual loading frame for a moment.
- **Behind the scenes:** `npm audit` is back to zero. The one warning came from a pattern-matching library inside the code checker, which never ships to anyone; it now uses the fixed version.

### Faster to open, to come back to and to switch tabs (2026-11-05)

Grant: "this app is getting really slow". Measured on a production build played as a mid-range phone on mobile data, then fixed:

- **The app asks the server less when it opens: 27 requests instead of 35.** The tabs that open behind the launch screen used to ask again for what Home had asked a second before. They now reuse that answer, but only while nothing has been saved since, so after a sign-up or a payment the app still checks again.
- **Racket and string pictures are ready when you get there.** String packets used to wait until you opened their tab before they even started downloading. Your own racket and string pictures are now fetched while the app opens, and phones keep the packet pictures for a day as they already did the rackets. Opening Equipment takes about 0.3 s, and going back to it is instant instead of showing a loading card again.
- **Updates ship three times a day, not after every change.** Each update restarts the server and made every phone download part of the app again on its next open. Now updates go out off-peak in the morning, early afternoon and late evening, and an update that only changed notes doesn't go out at all. An update that changes no code no longer makes phones download anything. An urgent fix can still go out at once.

### Your racket, step by step (2026-11-05)

Grant: "a step by step animation when user send in an request … Racket goes on to [the] machine > stringing through a racket > off machine > tada", and "when the string package tears open at the top string comes out". After a member sends a stringing request, the screen plays a twelve-second animation in their own racket and string: the string's packet tears open at the top and the string comes out, the bare frame goes onto a stringing machine and the clamps close, it is strung while the machine pulls to the tension they asked for, it comes off and turns upright, and "Ready · Yonex BG80 at 26 lb". A caption under it says each step, and "Play again" replays it. It plays once and stays on the last frame; with reduced motion it shows only that frame. The machine is a generic one with no maker's name. A racket typed in by name draws the default frame, and a string with no packet picture starts at the machine. Every catalog racket now has a picture without strings for this (`public/rackets/bare/`, about 1.2 MB). Plan: `docs/plans/stringing-story.md`.

### Notifications in your language, and the last spot goes to one person (2026-11-05)

- **Notifications now arrive in the language you read the app in.** Switch to 中文 and the next "sign-ups are open" or "you're in from the waitlist" comes in Chinese on that phone. Session times in them are now Vancouver time; one used to say Friday 4 AM for a Thursday 8 PM session.
- **Rejoining can no longer take a spot that was already gone.** If you cancelled, then rejoined at the same moment someone else signed up for the last spot, you could both get in. Now one of you does and the other is told the session is full.
- **The language button says what it does**, in both languages, to a screen reader.
- **Behind the scenes:**
  - The page only runs scripts the server marked for that one page load, which shuts the usual door for an injected script.
  - The home page now runs the same first-visit step every other page did (it had been skipped).
  - What is left from the November audit, and who each item waits on, is in `docs/plans/audit-followups.md`.

### The app's sign-in stays on your phone, and the safety notes are right (2026-11-05)

- **Moving from the web app to the store app now asks first.** The "Move to the app" link used to sign the app in the moment it opened. Someone could send you their own link, and your app would quietly become their account. Now it asks you to confirm, and says who would be signed out.
- **The home-screen widget's sign-in stays on the phone it was made on.** Restoring a backup onto a new phone no longer brings it along. The widget simply waits until you open the app once. The widget also only ever sends its pass to the app's own website.
- *Both of these reach phones with the next store build.*
- **Behind the scenes:**
  - Next.js 16.4.5.
  - The iPhone app is pinned to the same Capacitor version as the Android app and the website.
  - The rollback instructions in the owner's notes did not work as written; they are fixed.
  - The AI settings table and the store build numbers in the docs are corrected.
  - The plan to replace Defender's watching with three cheap Azure alerts is written down.

### Easier to read, and kinder to screen readers and to Chinese (2026-11-05)

- **A refused sign-up explains itself in your language.** If a session was full, closed or already settled, the card used to show the server's own words. Sometimes that was an English sentence on the Chinese page, sometimes a code like `session_settled`. It now says what happened, in English or Chinese.
- **Faint text is easier to read in dark mode.** Hints and captions were too faint over the bright corner of each tab's background. They are a little lighter now and meet the standard contrast for reading.
- **Screen readers:**
  - A screen reader now stays inside an open sheet instead of reading the page behind it.
  - The tab bar, the light/dark switch, pull-to-refresh and loading screens are named in Chinese when the app is in Chinese.
  - A skill's close button now has a name.
  - The tension and racket-pick options are announced as choices, not as tabs.
- **The small round buttons at the top are easier to tap.** They look the same, but each now takes a tap across a full fingertip-sized area.
- **Keyboard users see where they are.** Every button now shows the same clear green focus ring.
- **Dates follow the app's language.** The stringing "ready by" date, an invite's expiry and Profile's session date now use the app's language and the club's time zone, not the phone's.

### The app opens with less to download (2026-11-05)

- **Each visitor now downloads only their own screen.** The app and the signed-out welcome screen came in one bundle, so members also downloaded the sign-up forms and newcomers downloaded the whole app. Now each gets only theirs. That is 13% less for a newcomer (254 → 220 KB) and 4% less for a member (254 → 245 KB) before anything appears.
- **Racket pictures next to names are about 6 times smaller.** A 32 px circle was downloading the whole ~18 KB racket picture to show its head. It now loads a 3 KB crop. Profile's large picture keeps the full one so it stays sharp.
- **The opening shuttle is 6 KB instead of 44 KB**, and the browser-tab icon is 3 KB instead of 55 KB. They look the same.
- **The admin screen is 69 KB lighter.** One setting was quietly pulling in server-only code. A check now fails the build if any screen does that again.

### Faster and cheaper behind the scenes (2026-11-05)

- **Opening Home no longer reads every session record the club has ever had.** Looking up what you owe used a database search that couldn't use the index, so it read all of a club's history every time. It now goes straight to the few records that matter.
- **The AI greeting on Stats is only written for people who read it.** Home used to have it written for every member every week, even people who never open Stats. Now it's written in the background only for members who've opened Stats in the last month; everyone else gets theirs when they open the tab. A greeting with nothing to say is also remembered, so the AI isn't asked again on every visit.
- **Release notes:** Home and Profile load the newest 30 instead of every one ever written, and the page has a rate limit.
- **Other loading work:**
  - The organiser's payments screen loads its data all at once instead of one piece after another.
  - Looking up a member's name takes one fewer step.
  - Skill-level and club-rating figures are re-worked out less often. They still refresh the moment someone logs a game or checks in.
  - Equipment lookups ask only the part of the database they need.
  - The payments calendar loads only the two details it shows.
  - The invite QR stops checking whether it's been used after 10 minutes.

### Deleting an account, done properly with more than one club (2026-11-05)

- **Deleting your account no longer touches anyone else's history.** Before, it removed the name "Lin" from records in every club. Another club's Lin could lose her games, her skill ratings and her session records. Now a name is only removed in the clubs where it was yours.
- **Your spot is freed in every club you'd signed up in**, not just the one you deleted from.
- **More of your details are removed:**
  - your name and e-mail as the pay-to on a club you organised
  - your name on rackets you strung for others
  - your name on payments waiting for an organiser to check
  - your name on a join request nobody picked up
  - your name on problem reports you sent
- **On a phone, deleting your account also clears the app's icon badge, its long-press shortcuts and its widgets**, the same way signing out does.
- **The privacy policy now lists** guests, join requests, e-transfer notices, stringing, store credit and in-app notices.

### Money fixes from the November audit (2026-11-05)

- **Covering or removing someone after the bill is done now does what the buttons say.** "Cover & remove" means the club pays their share, and everyone else's amount stays the same. "Remove without covering" means they still owe it. Before, both quietly spread the person's share over everyone else and wiped their own debt.
- **Splitting a share differently after people have paid is refused.** It would have changed what they owed after they had paid it. You can still cover the share yourself.
- **Stringing:** accepting a price change now updates the club's money records. A price change proposed before a job was paid can no longer be accepted after it.
- **The unpaid hold counts sessions.** A member who brought a guest to one unpaid session is no longer held as if they owed for two.
- **Store credit** can pay a session that still owes after the person was removed from the list.
- **A member's history** shows a session they played and were later removed from as played, shows "Covered" instead of "Unpaid", and never picks up another person's session by name.

### Two people with the same name (2026-11-05)

When two accounts share a name, a club gives the second one a different name, such as "Lin W". Before this fix the app sometimes went by the account name instead of the club name. Lin W could be refused her own balance and stats, see the other Lin's balance instead, or pay the other Lin's session out of her own credit. The app now goes by the person's account, never by the name, everywhere this mattered. A stringing job can also only be billed to someone in the club.

### Security fixes from the November audit (2026-11-05)

Nine ways in were closed. None is known to have been used.

- An admin can no longer reset the PIN of an organiser or another admin. The reset code clears the PIN, so it was a way to take over a higher rank. Only an organiser can do it now.
- "Sign out everywhere" in one club now holds when a phone switches into that club, or rejoins it, from another club.
- Release notes, which every club reads, can only be written by the person who runs the app. Before, the admin of any club could write them, and anyone can create a club. The AI writing helper stays open to club admins, with a daily limit per person.
- The e-transfer inbox only marks someone paid when the Interac email was sent to the club. A genuine Interac email about a transfer to someone else no longer counts. **The Gmail script needs updating**: paste the new `public/payments/apps-script.gs` and run `install` once. Until then it works as before.
- Wrong PINs sent all at once now each count toward the lock. Before, they could all slip past it together.
- A recovery code stops working after 5 wrong tries.
- A club's join link no longer hands over a name whose owner has signed in since asking.
- Moving to the store app now re-issues the cancel token for your own spot, never for another person with the same name.
- An API request whose size it does not declare is refused, so the 256 KB limit can't be avoided.

### The club's door link: one poster for everyone, every join approved by an organiser (2026-11-05)

A club can now hand out one reusable link, on a poster, in a group chat or on an NFC sticker. Opening it shows "Join <club> · Ask to join": someone whose name is already on the roster and unclaimed asks to be let in as themselves, and anyone else asks to join. Only an organiser approves; approving creates the account and the asking phone is signed in. A name a member already holds is refused, so the door never hands a stranger an existing account. The Invite page gains "A poster for everyone", and "New link" retires the old poster and the asks still waiting on it. `docs/plans/door-link.md`.

### Guests the way Six Feathers brings them (2026-11-05)

A club now sets how many guests a member may bring, none, one or two, under How your club runs; "Members first" sets two. A guest is written the club's way, `Jenny (Josh)`, on Home and in Copy list, a guest name already on the roster is refused, and an organiser can add a guest for a member from the session card. Home lists each guest with its own Remove. BPM Core reads exactly as before: one guest, if the club switches guests on. `docs/plans/six-feathers-guests.md`.

### Invite in person: the QR on the Invite page, and a poster to save (2026-11-05)

The Invite page shows the invite as a QR code for the person standing next to you, with the 8-character code under it for a phone that will not scan. When it is used the page says "They're in" and offers Next person, so a used code never stays on screen. "Save as image" draws a poster with the club's name, organisers, when and where it plays, the QR and the code, and says it works once, for one person.

### The share image is a story, drawn like the Equipment card (2026-11-05)

Grant: "This shared card should mirror what the card in app looks like and not truncate", then "Omg it's so busy … Can be vertical ig story size". The picture made by Share on the Equipment card is now a 9:16 story (1080 × 1920). It has your name at the top, your main racket's head large across the middle, then the racket's full name with "Main racket · 4U · even" under it, each string with its packet, "Mains · 0.66mm · repulsion" (or Crosses) and its tension in a pill, and, on the image's bottom edge, how long you've played at the club ("At BPM Core since 2024") with the app's logo in the corner. The words stay clear of the bars story apps draw over the top and bottom. It uses the app's own typefaces. Nothing is cut short: a long racket or string name wraps onto further lines and the racket moves up to make room. Your grip, the restring count, the club tension comparison and "1 of 4 at BPM Core" are left off the picture and stay in "Copy as text". The old flat 3D snapshot of the racket is gone.

### The Equipment card, redrawn (2026-11-05)

The Set-up card on Stats → Equipment now follows design A from the Stats canvas. It is headed "Equipment". Your main racket's head is drawn large and sharp across the right half of the card, from a new close-up picture of every catalog racket (about 40 KB each, and only the main racket's loads). Each item's name starts on the title's edge with its role in the line beneath ("Main racket · 4U · even", "Strings · 0.68mm · repulsion"), and the string's packet starts its line. "Racket and tension fitting" (formerly "Your fit") sits right under them. Below a rule, "Spare rackets" groups each spare and "+ Add a spare racket"; tapping a spare opens its sheet, which shows its string. The card no longer counts how many others play your racket; "What the club plays" still does.

### Each racket keeps its own string (2026-11-05)

On Stats → Equipment, swapping your main racket used to carry the string and its tension onto the new racket. Now each racket keeps its own: swapping in a spare shows that spare's string and tension, or a blank Strings line if it has none, and swapping back brings the first one's back. The same string can be on two rackets at different tensions. A string logged before today stays with the racket that was in play when you first swap. The Set-up card puts the racket and its string together, then a divider and your spares, each saying what it is strung with; tapping a spare opens its own sheet, where you can make it your main racket. The Strings line shows the string's packet with the string drawn in your racket's string colour, and no longer counts how many others use it. The main racket is drawn close up across the right half of the card, with the controls over it in a liquid-glass style. The club tension band, the fit verdict, the racket page and the share card all read the main racket's string. Plan: `docs/plans/string-follows-racket.md`.

### Every string shows its packet (2026-11-05)

The strings on the Stringing tab now have pictures: each string's 10 m retail packet, matched to maker and retailer photos and drawn without the maker's logo. The packet shows on every row of the strings list and in the map view's selected string, beside the name on a string's page, and in the request form's string list in place of the gauge tile. Each picture is about 9 KB, drawn ahead of time; nothing loads on screens that show no strings. A string with no packet keeps what it showed before. Plan: `docs/plans/string-packets.md`.

### A sign-up link the app opens (2026-11-04)

The weekly sign-up link is now `/bpm/s`. In a browser it opens Home; with the store app installed, the app opens it and lands on Home signed in. Shared messages carry the link once instead of twice, and the invite copy leads with the tap.

### Members first: spots kept for members until a set time (2026-11-04)

A club can keep its spots for members until a cutoff before the session (Six Feathers: Monday 11:59 PM), then let the waitlist in, in sign-up order, with the usual push. Until then a sign-up from someone not marked member, and every guest, waits. Nothing runs on a timer: the first visit after the cutoff lets the waitlist in, and the organiser can do it early from the session card. `docs/plans/members-first-window.md`.

### Claim your name, and sign out everywhere (2026-11-04)

Someone an organiser imported onto the roster can ask to be let in through the club's link; the ask names their club, so it reaches that club's organisers and nobody else's. An organiser can also sign a member out everywhere from the Roster sheet, which ends every session that person holds, the admin console's included; issuing a recovery code does the same. A phone that has signed in before remembers its club, so a later "let me in" ask goes to the right club's admins. `docs/plans/claim-your-name.md`.

### Profile shows your rank in this club (2026-11-04)

The Profile card shows a small chip beside your name, Organiser or Admin, for the club you are in; a player has none. It used to say Admin for every admin, organisers included. "Member since" and the chip now read in Chinese for Chinese users.

### Five fixes from a code review (2026-11-04)

Another club's admin could put someone on BPM's stringing bench; that switch now stays with the club that set it. Cancelling a guest could undo an admin's edit made at the same moment; it no longer can. Home's session card no longer fails when the club record cannot be read, only the plus-one row hides. The operator's change log keeps the newest 200 entries. The fifth, a "Get the app" card shown to people already getting notifications, went with the card when Notifications replaced it.

### Notifications, behind a bell (2026-11-04)

A bell beside the language and theme buttons opens a Notifications page, with a red dot when something new arrives. Turning notifications on, and on the web "Get the BPM app on your phone", sit at the top; below is what the club told you: sign-ups open, a spot from the waitlist, racket updates. The Stats privacy question is asked once, and closing it answers "Keep it private".

### How close the waitlist is to another court (2026-11-04)

When sign-ups fill up early, the sign-up card says how many more people would fill another court ("3 more fills a court"), and the admin's session card shows the same. It describes what could happen; booking the court is still the organiser's call.

### Every racket in its real paint (2026-11-04)

The racket pictures on Stats → Equipment, in the 3D viewer and on the share card now show each catalog racket in its real paint, matched to maker and retailer photos. That includes its fades, split halves, crown and throat colours and slashes, the shaft's colour change, the handle and grip, and its head outline. Every one of the 153 catalog rackets has it; 23 are approximate, because only angled photos existed. Four catalog rackets that do not exist (Victor Arrow Speed 88 and NitroLite 80X, Li-Ning Halberd 900 and G-Force Superlite) were deleted from the catalog, in production too, on the next deploy. Every racket, including the default, also got new materials: lacquer over a carbon weave, a ridged octagonal grip, a woven string bed, flush grommets and sharper edges. The list images are the same 240 × 624 pictures they were (2.8 MB for all 154), and nothing extra loads on screens that show no 3D. Logos are left off. Plan: `docs/plans/racket-fidelity.md`.

### Motion for the fold, and the scoreboard brought in line (2026-11-04)

Opening or closing a foldable now crossfades the app through the reflow instead of snapping it, and the courtside scoreboard's two halves slide with the hinge as the phone moves. The board fades in when it opens, each new point fades in, and the game ending gets the same small entrance a saved check-in does; in the store app every +1 taps lightly under the finger. Two design-system misses fixed on the way: the +1 targets lose their outer rim (fill-only, like every container), and the board wears the Stats field instead of a flat ground. Plan: `docs/plans/foldable-layout.md`.

### A courtside scoreboard that splits at the fold (2026-11-04)

Stats → Play → **Keep score** opens a scoreboard for a phone propped half-open on the bench: the score, in digits sized to be read from across the court, on the half that stands up; the +1 buttons, Undo, New game and Save on the half lying flat. It keeps score by the umpire's rules — game point, "20 all", "29 all · next point wins", the interval at 11, the server's dot — and Save hands the game to Add a game already filled in. The split lands on the fold itself: the store app asks the phone (`BpmFold`, in the next store build; the iPhone side needs Xcode 27.1), a browser that can say so is asked (Chrome on the Galaxy Z Fold today), and when nothing can, the middle of the screen — so on a flat phone it is simply a scoreboard with the score above the buttons. The screen stays awake while it is up. Plan: `docs/plans/foldable-layout.md`, step 3.

### Two panes on an unfolded foldable, nothing changed on a phone (2026-11-04)

On iPhone Duo held open, a Galaxy Z Fold's inner screen or a tablet, Home now shows this week on the left and your account on the right, with the gap between them in the exact centre of the screen — where the fold is, so the crease never runs through a card, a banner or a button. The install and app nudges sit in the right pane above your balance; sheets and notices open in the right half. Held sideways, the tab bar moves to the right edge, as Apple's iPhone Duo guidance has it, with the theme and language buttons at the top of the strip; held upright, it stays at the bottom and spans both panes. The corner buttons and the tab bar keep clear of a side camera or side controls. On a single phone-sized screen, and on a desktop, the app is pixel-for-pixel what it was. The reasoning, after Apple's iPhone Duo design guidance, and the three steps still to come are `docs/plans/foldable-layout.md`.
### The admin console opens on the glance tiles, and shows one week card at a time (2026-11-04)

Birds and Roster — the two numbers worth seeing without a tap — now sit at the very top of the console, above what needs a human. "This week" shows one card at a time behind a Session · Payments toggle, at that card's own height, instead of both stacked (Grant: "to save vertical space"; a side-scrolling rail was tried first and stood as tall as the taller card). The settings lists under it stay as they were: a grid of tiles was tried the same day and reverted, because sixteen doors drawn as cards left nothing to tell a thing to read from a thing to open. The loading frame mirrors the new order.

### The Fit page draws fill-only, like Home (2026-11-04)

Every tile, option row and callout on "Your fit" carried a one-pixel rim and a ring on the selected one, and a hairline ran between the questions; nothing on Home does either. They are fills now, a selected answer is a solid tint with accent text (the Level pill's own treatment), and the questions are set apart by space alone. The rule is written down in CLAUDE.md's Design System section. **And the page reads top-down**: the questions come first and the verdict follows them, where it used to lead the page as the fit sheet's result banner had — the answer sat above the questions it was built on (Grant: "the result is at the top which is weird"). The rest of the Equipment register follows the same rule: the Set-up card's lines lose the hairline between them, the line sheet's rows and feel chips, the tension stepper and ruler, the racket page's picture tile, spec grid, accordion rows and chart track, and Play's kudos notes are all fills now. Home's three label chips keep their rim on purpose. The admin console followed: its stat tiles, mini-cards, session chips, choice rows, filter and shelf chips and the catalog-gaps list are fills now; the hero's green edge, the outlined buttons and the status pills keep theirs.

### The fit engine asks the unanchored member about balance, and stops guessing their price (2026-11-04)

The first production run of the owned-racket backtest matched shaft flex and weight nine times in nine and balance and price tier under half the time, and both misses were axes the from-scratch path had no input for. `fit-5`: a member with no racket we know in their bag is asked **Balance** on the Your fit page — Head-heavy, Even or Head-light, the same words a typed-in racket's feel uses — and the picks start there (the goal still moves it; a sore arm still caps it at even); the question disappears once a racket anchors the engine, and sits outside the "n of 5". And with no racket to anchor on the engine **no longer steers toward a price tier from the level** — a club that buys premium at every level was being aimed at entry and mid-range — leaving the budget question as the one thing that speaks to price. The rated golden cases and the manufacturers' cases are unchanged; `docs/plans/racket-fit-engine.md`.

### Three new ways to check the racket fit engine, none of them an expert's evening (2026-11-04)

The fit engine's gate waited on the owner and the club stringer rating profiles (stuck at three of five) and on two engaged members in a club of thirty. `docs/plans/racket-fit-engine.md` gains three legs that need nobody's time: an **owned-racket backtest** (`GET /api/reports/fit-backtest`, behind the read-only reports key) that hides each member's racket, re-runs the engine and scores the class of the pick against the class of what they hold, totals only; a **property suite** that turns every rule in the engine's own header into a check over every racket in the catalog; and the **manufacturers' second opinion**, four golden cases built from the brands' own series positioning, counted apart from the expert ones. The engine (`fit-4`) passes all of it. The backtest's first read on production is the plan's next review.

### On a foldable, the week is the right-hand page (2026-11-04)

On an unfolded phone, this week's session now sits on the right pane — the page that opens, as Grant reads it — with the nudges and your balance on the left. Sheets and notices open in the left half so they never cover the week they came from. Plan: `docs/plans/foldable-layout.md`.

### Stringer per club, a named operator with a break-glass override, and staff usage left out (2026-11-03)

The rest of roles v2 (`docs/plans/roles-v2.md`). **Stringer is held per club**: a person who strings for one club is not on another club's bench until that club's admin ticks the box, and any admin may (the organiser rule is for ranks and gift cards); the stringers from before the move stayed on BPM's bench. **The operator is a named list** (`OPERATOR_MEMBER_IDS`), not "any admin of BPM", and holds the one exception to "nobody removes an organiser": `POST /api/operator/membership` sets any rank in any club behind the admin cookie, the list and the migration key, passes a club on when it takes the last organiser, and writes every use down where the operator's status read shows it. **The operator is staff**: their own app opens, tab views and sign-ins no longer count on the Metrics page, so one person checking a payment ten times a day cannot carry a small club's daily-active; an error from their phone is still recorded.

### Several organisers per club, and only they hand out ranks (2026-11-03)

Any admin could make anyone an admin, and each new admin could make more; a club that two friends run together had no way to say so, because a club held exactly one owner. Now a club may have several organisers, and a rank — admin or organiser — and the gift-card switch are an organiser's alone to hand out; an admin still runs the night and grants Stringer. Nobody removes an organiser, not another organiser and not an admin: they step down themselves from Profile → Your groups, and when the last one steps down or deletes their account the club passes to the longest-serving admin, else the longest-serving player. The privacy policy's "if you're the only organiser, the group closes" now says what the code has done since succession shipped. The reasoning and the three PRs still to come are `docs/plans/roles-v2.md`.

### Import a club's list (2026-10-29)

An admin can paste a list, cells from a spreadsheet or a numbered chat post, or pick a `.csv`, and put the names on the roster, each marked member or drop-in. A preview shows what each line will do before anything is saved, and running the same paste again only adds what is new. `docs/plans/roster-import.md`.

### Bring a guest (2026-10-29)

A club can let members bring a guest. The guest gets a spot of their own, or waits when the session is full, and their share is on the member's balance. A guest leaves with the member who brought them. Off unless the club switches it on. `docs/plans/plus-one.md`.

### One level everywhere (2026-10-29)

The app showed a member two different levels. Home's "Your level is climbing" card quoted the latest check-in's raw score (Lin: 3.4, "+0.8 since September"), while the Stats LEVEL tile showed the canonical level, the smoothed check-ins blended with logged games (3.1), under a caption that was the raw jump again ("▲ 0.8"), so nothing on screen added up. "Your level over time" plotted the raw scores (2.6 → 3.4). All three now show the canonical level, and every "since …" change is the step between two points of its new trail, the level as of each check-in, which `GET /api/stats/level` returns as an additive `trail` (`docs/plans/one-level.md`). Lin now reads 3.1, "+0.5 since September", on Home, the tile and the chart alike, and the chart's sentence reads its phase off the same 3.1.

The LEVEL tile also lost its filled green slab, which in light mode read as a dark block on a pale page (Grant: "This colour... it feels odd"). It is now the same glass as the Games and Kudos tiles beside it, in both themes, and leads by colour alone: its number and a rise's ▲ are green, the "0.5 since September" words the same grey as the other captions, and a fall's ▼ stays grey.

### How your club runs (2026-10-28)

An organiser picks how the club runs, first come first served like BPM Core, or members first like Six Feathers, and can adjust each rule: players per court, whether the app handles money, and more since. "Copy list" puts the week's list in the club's group chat as text. `docs/plans/six-feathers-onboarding.md`.

### Add to calendar (2026-10-28)

The green sign-up banner's second line repeated the date and place. It is now one button, Add to calendar, which opens the phone's own New Event screen filled in. Nothing is saved until you tap Add.

### A freed spot goes to the first person waiting (2026-10-28)

When someone cancels, an admin removes a player or the player cap goes up, the waitlist moves up in sign-up order and each person promoted gets a push. It stops once the session starts. Someone moved up inside the late-cancel window can give the spot back without it counting as late. The waitlist card says so.

### Stringing, redesigned (2026-10-28)

A player sees the exact price their stringer quoted instead of a $4 band, and the email quotes it too; the push still carries no money. One progress card per racket, a two-step request sheet, and a strings map you can zoom into. `docs/plans/stringing-canvas-redesign.md`.

### Google and Apple sign-in no longer depend on a deprecated library (2026-10-27)

The library that ran the Google and Apple sign-in handshake, `arctic`, was deprecated by its author in July 2026, with no successor. The two calls it made for each provider (build the sign-in link, exchange the code) now live in `lib/oauth/`, about 150 lines over `fetch` and `node:crypto`. They send exactly the requests `arctic` sent, checked byte for byte against requests recorded from `arctic` before it was removed, and the package and its five `@oslojs` dependencies are gone. Nothing changes for players. The proof that counts is one real Google and one real Apple sign-in on production after the deploy.

### "Draft with AI" on release notes works again (2026-10-25)

Grant: "why does it always say error when the content is too long". The release form pre-fills its notes box with the whole `Unreleased` section of this file, which is never cut when a release is published from the form, so it had grown to about 87,000 characters against the 24,000 the draft accepts, and every draft stopped at "too long" before asking anything. The box now holds only the entries dated on or after the day the last release went out (`lib/releaseNotes.ts`), about 10,000 characters for v2.3, and the line under it says which day it was narrowed to. Entries from the publish day itself stay in, since a release can go out mid-day.

### Admin's first open starts loading at once (2026-10-25)

Grant: "Admin still loads taking some time." Timed on a local build with simulated database delay, the first tap on Admin spent about 0.3 s doing nothing, then asked the server "is this an admin?" again (the app had just asked), and only then started the console's reads. The slowest of those was the full e-transfer inbox, which reads every member's balance to fill one menu row.

- **No pause before the console.** The Admin code downloaded in the background is now used directly. Through `dynamic()` alone React still suspended on the first tap and held its placeholder for its minimum ~300 ms.
- **No second admin check in front of the reads.** When the app's own check already said yes, the console draws at once and the tab's check runs behind it; a refusal still shows the PIN form.
- **The E-transfers menu row reads two numbers** (`GET /api/admin/payments?count=1`): set up or not, and how many wait. It used to read the whole inbox: 17 database trips against 2.

Locally the tap-to-first-read time fell from about 330 ms to about 40 ms, and the screen settled in 0.61 s instead of 0.84 s; production adds the phone's network time to each step that was removed.

### The privacy policy names the crash records (2026-10-25)

Grant's call. "How you use the app" in the privacy policy now says that when a screen stops working for a signed-in member, the app records that it failed and which tab it was on, never the screen's content or the error's details, and that the organiser sees those only as totals, like the rest. English and Chinese, and the policy's date moves to 25 October 2026. (`docs/plans/client-error-beacon.md`)

### Admin opens once and stays (2026-10-25)

- **The Admin tab is kept once you have opened it**, like the other tabs: going back to it shows what you left, with no reads. It is not opened early; only its code downloads in the background, for admins.
- **Back from an admin page shows the console at once.** Every Back used to rebuild the whole console behind skeletons (fourteen reads); it now stays underneath each page and re-checks quietly, so what you changed on the page still shows.
- The Roster's add button no longer shows over another tab while Admin is kept behind it.

### A screen that crashes is counted (2026-10-25)

Grant: "When a button or feature fails how would we know without you in it?" When a screen breaks for a signed-in player, the app now records one `client_error` event: which kind of failure and which tab, never the message, the stack or the address. At most three per page load, and none for the "new version" error that reloads itself. The count (last 7 days, this club only) is in `GET /api/admin/slice0` and in the metrics report, so the daily health check sees it. (#711, `docs/plans/client-error-beacon.md`)

### Store builds 5 (Android) and 6 (iPhone) carry the widgets (2026-10-24 to 25)

The iPhone widget extension's Xcode target is committed (#716), so a fresh checkout builds it; Xcode had raised the app's minimum iOS on its own while making it, and it is back at 15 (the widget needs 17). Build numbers go from 4 to 5 on both platforms (#719): build 4 predates the widgets, the icon badge and the long-press menu, and this is the build that ships them. The iPhone then moved to 6 (#724): TestFlight already held a 6, uploaded two minutes after the 5, so the next archive at 5 would have been refused as a duplicate. Android stays at 5, which is what Play holds.

### Home's second wave starts with the first (2026-10-24)

A trace of a signed-in open showed Home loading in two waves: the balance and skill cards mounted only once the week's five reads had landed, so their own reads started at 1.6 s and Home finished at 2.3 s. Home now starts those three reads at the same moment as the week's, and each card picks up the request already in flight (`primeFetch` in `lib/sharedRead.ts`); a refetch after a payment still goes to the server. The launch screen's full shot stays the floor and is never cut short (Grant). (#717)

### An admin's rights stay inside their own club (2026-10-24)

From the 24 October security review (#708, #710):

- With groups on, an admin check requires the admin cookie and the member cookie to name the same club, and editing or removing a member requires that person to be on the admin's own roster. Hard-deleting a member is refused (account deletion stays `DELETE /api/members/me`).
- Making someone an admin, restoring them and renaming them now write to their place in THIS club. Since groups went on (22 Oct) the Roster's "make admin" and "restore" had been writing a field nothing read. The club's owner cannot be demoted or removed there.
- Giving kudos, listing who you can thank and requesting stringing re-check that you are still on the roster, so a removed member's cookie stops working at once.
- Signing out revokes the home-screen widget's pass on the server, not just on the phone.

### Widgets on a real phone (2026-10-23 to 24)

The first runs on Grant's iPhone (#702, #703, #712, #714): fixes for the widget plugin not registering and a Swift layout that would not compile; "Signed up" in place of a status word; a stringing section on the large widget that says when strings are due by weeks worn, not sessions played; and a score-keeping widget with A side and B side, umpire's calls ("20 all", game point, the interval at 11) and a large court-side scoreboard listing tonight's games. Its Save game opens Add a game with the score filled in, and Add a game lists the whole club, not only tonight's sign-ups. No strokes on the tiles, the launch screen's shuttle as the BPM mark in every header, and colours that read in light mode.

### Housekeeping (2026-10-24)

The twenty hand-written "is the container ready" promises are gone (`ensureContainer` already remembered its answer); the list of refused PINs lives in one place; and a chart test that failed on any computer west of Greenwich is pinned to UTC. (#707)

### Group leaks are written down, and the leak watch waits for a second club (2026-10-24)

Grant: "dont ask me to monitor group leak until there is a second group created
and completed one end to end. Also trake what got leaksed". `groupScope()`
already dropped any query row belonging to another club and logged
`[group-leak]`; it now also writes one record per distinct leak (container,
the club that asked, the club the row belongs to, the row's id — never its
contents) to the global `groups` container, and the operator's
`GET /api/admin/migrate-groups` status reports them as `leaks`. Turning off
the old-data fallback (`TOLERATE_UNSTAMPED`) now waits for a second club to run
one session end to end and for that read to show zero, instead of a week of
someone watching the log stream. The same route turned out to admit any
club's admin once groups were on, while its status covers every club, so it
is operator-only now (an admin of BPM). The plan's review moves to 2026-11-25.

### Racket fit flag retired (2026-10-24)

`NEXT_PUBLIC_FLAG_RACKET_FIT` was already `'true'` in production; the fit engine is now the only racket recommender in `GET /api/recommend`. Nothing changes on screen.

### Home-screen widgets (2026-10-22)

This week's session and your place in it, your balance and (on the large size) your level, on iPhone and Android, plus lock-screen widgets that hide the amount until Face ID. Join and Undo work from the widget itself and go through the same sign-up rules as Home's button. A widget has no cookies, so the app gives it its own pass, which only the widget routes accept and which is re-checked against the club's roster on every read. They ship with store build 5 on Android and 6 on iPhone. (#699, `docs/plans/native-widgets.md`)

### A health check that reads nothing (2026-10-22)

`GET /api/health` answers `{ ok, build }` without touching the database, a cookie or a rate limit; it is the path Azure's health check probes. The only other public read touches the database, and Azure replaces a server that fails its probe for an hour, so a database blip would have recycled a healthy one. The database stays the smoke test's job. (#701)

### Multi-group is on (2026-10-22)

`NEXT_PUBLIC_FLAG_MULTI_GROUP` is `'true'` in `deploy-next.yml` (and in
`pr-ci.yml`, which builds what production builds). Grant re-ran the backfill
first: 3 memberships created, 3 created already removed, 22 deactivated to
match accounts turned off since September, and the status then read
`mismatched: 0` and `withoutMembership: 0`. From this deploy the cookie's club
claim and a membership check decide every request, Home's header shows the
club's own name, and a signed-in person with no club sees the doors to create
or join one. Cookies minted before the claim existed read as BPM, so nobody is
signed out. The rollback is setting the flag back to `'false'`. Next: a week of
App Service logs with no `[group-leak]` line, then `TOLERATE_UNSTAMPED = false`
(plan review 2026-10-29).

### The app is BPM and the club is BPM Core (2026-10-22)

Grant: "to avoid confusion I think we should change the group name to BPM core.
The APP would be BPM (short for Badminton Per Management)". `APP_NAME` in
`lib/brand.ts` is now `BPM`, which the document title, the manifest, every
`%APP%` string, the emails and the native display names follow; three literals
that had hardcoded the product (the chunk-error screen, the migrate page title,
the wordmark's label) read the constant. The club is separate on purpose:
renaming the product never renames group #1's record, so Admin → Club gains a
**Club name** card that writes `Group.name` through `PATCH /api/admin/settings
{ groupName }` (same 2–40 character rule as creating a club; 409 before the
record exists), and the dev seed and backfill write `BPM Core` for a new
deployment. The OG share card reads the club's record instead of a literal, and
the receipt memo placeholder shows `{club}` as the server fills it. The brand
canary now scans string literals for the name as a whole word, since the
three letters are also the group id. With groups off, members keep seeing the
app's name where the club's will appear at the flip.

### The admin's "Sign-in requests" list is their own club's (2026-10-22)

Grant asked whether players without a PIN block the multi-group flip. They do
not — the backfill ignores credentials, a live cookie keeps reading as BPM, and
a lapsed one goes through "Ask to be let in" exactly as today — but reading
that flow found one route that was not per club: `GET`/`POST
/api/admin/access-requests` listed every member with a pending request in the
deployment, because a request lives on the person and nothing on the row says
which club they asked. With one club that is invisible; with two, one admin
would have seen and could have approved the other club's askers by name. Both
are narrowed to the admin's roster now, like the sign-in readiness list beside
them, and a person off the roster answers the same 404 as one with no
request. The second gap — a signed-out ask cannot name its club, so a future
second club's PIN-less member would be looked up in BPM — is recorded on the
Phase 6 list; it needs a design choice before the first outside club, and is
not a gate for the flip.

### The app's icon counts what you owe, and long-press opens three shortcuts (2026-10-21)

The red number on the app's icon counts what you owe once it is final (settled sessions not reported paid, plus finished stringing), set only after a read that worked; it never asks for permission. Long-press the icon for Sign up for <day>, What I owe and Request stringing. The installed web app gets the same badge. In the store app from build 5 on Android and 6 on iPhone. (#689, `docs/plans/native-badge-shortcuts.md`)

### The stringing screens, second design pass (2026-10-21)

One money field everywhere (`MoneyInput`, the `$` inside the box): dollars had been drawn three different ways. A bad price shows as an error that a screen reader announces. The mono font only on figures. The date picker opens above its field when there is no room below, so the last weeks of the string-purchase date are reachable inside a sheet. The stringing files now fail the build on any new style drift. (#697)

### Rename a string on the shelf, and pick its colours (2026-10-21)

A string's sheet on the bench has a Name field and a colour picker. A rename carries the price, catalog link and colours with it, and stock still counts the old name as the new one. Colours come from a fixed fourteen-colour palette and show as dots on the Stringing tab and as "On the reel" on the string's page. (#681)

### The running build at the bottom of Profile (2026-10-21)

Profile ends with "Version 1e69865": the first seven characters of the commit the phone is running, so "is the fix live on my phone?" has an answer. (#670)

### Two plan reviews answered: multi-group is not live because the flip waits on a backfill re-run, and the shuttle burst stays (2026-10-21)

Docs only. `docs/plans/multi-group.md` records Grant's "why isn't it live?":
nothing in the code blocks the flag — the two Phase 5 decisions closed on
2026-10-07 and 2026-10-17, and the "removal does not revoke the cookie" item
from the review of #373 closed with members-only, which re-reads the
membership on every request — but the production backfill of 2026-09-10 has
six weeks of flag-off roster edits drifted against it, so the order is: Grant
re-runs `migrate-groups` from his admin browser until it reads all zeros, then
the one-line flag PR, then a clean week of `[group-leak]`, then
`TOLERATE_UNSTAMPED = false`. The review date moves to 2026-11-04 to ask
whether the re-run has happened. `docs/plans/signup-shuttle-burst.md` closes
on "nothing" after three Thursdays — no one annoyed, no one crediting it —
which passes its kill criterion; the burst stays as built.

### The Metrics page counts who has moved to the store app (2026-10-21)

The native-shell plan's review asked whether anyone had used the "Move to the
app" link since it went live on 2026-10-07. Grant: "Yes, and where is the
tracking in Metrics?" It was there, but buried: a migration claim is a
`sign_in` with `via: 'migrate'`, and the only place that showed was the Usage
card's "Signed in with" caption — a 28-day count among seven methods, which
forgets each move a month after it happens. `clubMetrics()` now reads those
sign-ins all time (bounded by the events container's TTL alone) and the Usage
card carries its own line, "Moved to the store app: N members, last on
<date>" — distinct roster members, not devices; a zero once usage is recorded
means nobody has, and before that the line draws nothing. `UsageMetrics` gains
`movedToApp` and `movedToAppLastAt` (additive), and the weekly report carries
them through the same reader. `docs/plans/native-shell.md`'s review line is
closed.

### The legal copy names no place or person for the operator (2026-10-21)

Grant's call on the legal-copy review: "take out all private informations about me". The policy already named no person; the city in "the app's operator, in Vancouver, BC" is now "in British Columbia, Canada" in both locales (the province stays because the policy cites BC PIPA), and the crash screen's "let Grant know" reads "let the operator know". The support mailbox was never repo text (`SUPPORT_EMAIL`). The Play listing's developer name is deliberately not added to the policy; `docs/plans/legal-copy-multi-group.md` D10 records why and what satisfies Play's rule instead.

### A query that names its partition runs against one partition (2026-10-21)

From the code review of efficiency. Every scoped query went to Cosmos with no partition-key feed option, so a read that already filtered on the container's own key — a session's `players` rows, a member's `ledger` or `stringingJobs`, the kudos for one recipient — was still executed as a cross-partition fan-out: the SDK asks every physical partition and merges. Those are the hottest reads in the app (Home's balance, the sign-up capacity check, settle, the bench).

- **`groupScope.query` takes an opt-in `partitionKey` hint** and passes it to the SDK; 35 call sites whose WHERE is a plain equality on the container's key now carry it. No query's WHERE, ORDER or results changed.
- **Never inferred.** A parameter inside an `OR`, an `IN` or an `ARRAY_CONTAINS` would silently drop rows if the accessor guessed, so the hint is given by hand, the accessor refuses it on a `/id`-keyed or non-GROUP container, and a source-scan canary (`__tests__/group-scope-pk-hint.test.ts`) checks every hint against its WHERE, its params and the registry — the mock ignores the option, so nothing else could catch a wrong one.

### The Command Center reads the roster, the birds and the bench once (2026-10-21)

From the code review of efficiency. The admin landing mounts its cards in one commit, and three of them asked for the same thing: the Needs-you card and the stat tiles each read `/api/members` and `/api/birds`, and the Needs-you card and the bench menu row each read `/api/stringing/jobs`. Three extra round trips on every open of the admin screen, for answers already on their way.

- **Those reads go through `sharedFetch`** (`lib/sharedRead.ts`), the in-flight dedupe the session and roster reads on the same screen already use: one request per path while it is open, nothing after, so a refetch after a payment or a move on the bench still reaches the server. Each card keeps its own error handling.
- The review's grep named `/api/admin/settings`, `/api/admin/expenses`, `/api/admin/credit` and `/api/releases` as the duplicates; on reading, none is. Every second read of the last three is a write, and every other reader of the settings is its own admin page or a tap, with the Payments card already on `sharedFetch`. Left as they are.

### Kudos reads every recent roster at once (2026-10-21)

From the code review of efficiency. Who you may thank is anyone you shared a roster with in the last eight sessions, and both the card that lists them and the send that checks them read those rosters one session at a time — up to nine database round trips in series on every GiveKudosCard mount, and the send asked each session for its game log too before moving to the next. The rule is unchanged; the reads now go out together.

- **One query per session, all in flight at once**, merged in session order so the list still leads with the people you played with most recently. Still one `@sessionId` query each, never one `ARRAY_CONTAINS` query: that would be a cross-partition read in Cosmos and, in the mock store, every row in the container.
- **The send proves by roster first.** Every roster is read at once; the game logs are read — also at once — only when no roster proved it. A refusal costs the same reads the serial walk made at its worst, in three round trips instead of eighteen.

### The session picker reads what it shows (2026-10-21)

From the code review of efficiency. `GET /api/sessions` — the Payments card's session picker and the bird-usage assign sheet — was an unbounded `SELECT *` over the `sessions` container: every session the club ever had, every field (bird usages, settle snapshots, invite lists, advance snapshots), on every open of the Command Center.

- **Projected to the nine fields its two consumers read**, and bounded in SQL to the calendar's 200 sessions — `SESSION_CALENDAR_LIMIT` in `lib/sessionCalendar.ts`, which `/api/sessions/history?counts=1` (the picker's owing dots) now reads from the same constant, so the list and the dots cannot cap at different places.
- The admin anomalies route read the whole history to keep one row's `datetime` (the previous session, for `long_break`); it asks for that one row, two fields, now.
- The whole-history reads stay whole: bird stock, a member's history, the ledger and the owed balance need every session.

### A failed read of your own account is a failure, not "no PIN" (2026-10-21)

From the code review of logic. `GET /api/members/me` — the probe behind Profile's PIN row, the first-PIN gate and the club-comparison consent sheet — answered a thrown database read with a 200 of defaults: `hasPin: false`, `statsPrivacy: null`, no `authed`. Every reader took that for a fact about the member, so a Cosmos outage read as "you have no PIN and never consented". The sibling reads (`/api/session`, `/api/members`, `/api/sessions`) have answered 503 `read_failed` since September; this one now does too.

- **A thrown read answers 503 `read_failed`.** The no-`?name` anonymous shape still answers 200 — nothing was read for it.
- **The admin verdict stays undecided on a 503 or a 429** from that probe instead of bouncing the admin tab to Home: the body carries no `role`, and reading it as "not admin" took an outage for a demotion. A 401 or 403 is still a verdict. Profile, Home's credential check, the sign-in probe and the privacy hook already treated a non-ok status as unknown.

### A credit spend whose row was paid another way is refunded (2026-10-21)

From the code review of money accuracy. "Pay with credit" writes the spend before it marks the row paid; a process that died between the two left credit taken for a line still owed, and the recovery for that walked the member's OWED lines. A row since paid by e-transfer, an admin's tap or a cover is no longer owed, so it was never visited — and with nothing else owed the tap answered `nothing_to_pay` before any recovery ran. That credit stayed taken forever.

- **`refundStaleSpends` walks the LEDGER instead**: every line whose spends outweigh its refunds is checked against its row — still unpaid → finished (as before); paid another way, covered, removed or gone → `refund:<ref>:<n>` ("Paid another way — credit returned"). A fresh spend (under two minutes) is still left to the request that owns it.
- It runs first on every "Pay with credit" and, best-effort, on the member's own balance read, so a member with nothing left to pay gets the credit back the next time they look. The admin reconcile stays no-auto-repair.
- **A completed credit payment costs no row read.** Every credit payment ever made nets negative on its line forever; the ledger mirror's own `payment` entry (`meta.via: 'credit'`, same partition) answers for it, so the balance read does not grow with the member's history. Only a line with no such entry — mirror off, or a mirror write that failed — has its row read. A stringing job carries no `paidVia`: there, it counts as credit's when its `paidAt` is the spend's own timestamp (what the credit path stamps).

### Removing a sign-up deadline is an anomaly too (2026-10-21)

From the code review of logic. The settings-drift check compared the sign-up deadline only when BOTH this week and last week had one, so a deadline that was there last week and is gone this week — sign-ups that used to close now staying open — was never mentioned to the admin, while adding one was.

- **Presence against absence always flags `deadline_changed`**, with no tolerance: the 6-hour tolerance exists for a DST crossing moving the offset, and nothing about DST removes a deadline. Both weeks having one keeps the tolerance.
- The anomaly's message now says which happened: moved ("close 47h before this session, was 23h last week"), added ("last week they stayed open") or removed ("stay open this week; last week they closed 23h before the session").
- The advance snapshot records a session with no deadline as `null` (it wrote `0`, which also meant "at the session's start"; a stored `0` still reads as none), and a snapshot that never recorded the offset at all fires nothing. The route reads the offset with the same function the check does, so the two sides cannot be computed two ways.

### A paid stringing job cannot be re-priced (2026-10-21)

From the code review of money accuracy. "Change without asking" on a job the player had already paid voided the old charge and wrote a new one at the new price, but the payment entry — keyed on when it was paid, at the amount paid — stayed where it was, so the ledger said the member owed the difference while the job said paid, and the daily reconcile flagged it every morning with nothing able to repair it.

- **`PATCH /api/stringing/jobs/[id]` answers 409 `job_paid`** to a differing price on a paid job, with `force` or as a proposal to the player. The correction is mark unpaid → change the price → mark paid again; the ledger then holds the void, the new charge, the voided old payment and a new payment at the new amount, and the job nets to zero. A single PATCH carrying both `paid: false` and the new price is accepted, because the mirror reads the job before against the job after and records both moves.
- The bench's "Change this job" names the refusal instead of "That didn't save. Try again."

### A bounced credit spend no longer reads as a used gift card (2026-10-21)

From the code review of money accuracy. "Pay with credit" writes a spend and, when the balance comes up short or the row cannot be marked, the refund that reverses it — both within one request, so often in the same millisecond. A card's record is a reading over those entries in time order, and the tie-break was the id: `refund:…` sorts before `spend:…`, so the refund was processed first, found nothing to give back, and the spend that followed drew from the card. The card then showed that money as used although the member still had it.

- **Within one timestamp a source comes first, then a drain, then a refund** (`lib/creditAttribution.ts`), so a refund always finds the spend it reverses. A grant and a spend in the same millisecond see the grant first.
- **A refund carries its own timestamp** rather than the request's, so real history reads in the order it happened; the tie-break stays, because two writes can still land in one ms.
- A refund whose spend is genuinely missing from the history still counts as a source — the balance already holds that amount — and the docblock now says so.

### One live estimate for an unsettled week (2026-10-21)

From the code review of money accuracy. Three live estimates existed for a session that was not yet settled: Home's balance line and the advance snapshot each divided the total by the active count, while the receipt (and settle, which freezes the bill) used `costSplit`, which drops a resplit-covered player from the denominator. Cover someone with "resplit" before settling and Home showed one figure for the week while the receipt showed another.

- **Every live per-person figure now comes from `costSplit`**: `classifyOwed` takes the session's rows instead of a count, the per-person owed read projects two more fields from the one roster query it already made (no extra read on the Home path), the whole-roster read and the admin owed audit hand over the same rows, and the advance route's `prevCostPerPerson` fallback splits over every row of the outgoing session.
- No change to settled sessions: a frozen `owedAmount` was never recomputed.

### The session editor refuses a bad datetime instead of saving nothing (2026-10-21)

From the code review of logic. `PUT /api/session` turned any datetime it could not store — unparseable, truncated, or without a timezone offset — into an empty string and answered 200. For the deadline, an empty string means "no deadline", so a client bug would have silently left sign-ups open for ever; for the session time it was a session with no time.

- **Clear and invalid are different answers now.** `null` or `''` still clears `deadline` / `endDatetime` (`''` is what the editor sends for an empty input); a non-empty value that does not parse as an ISO datetime with an offset answers 400 `invalid_datetime` naming the field, and nothing is written. `datetime` can never be cleared.
- The Setup page shows that refusal as a sentence ("The sign-up deadline isn't a valid date and time.") rather than the raw code.
- The acceptance rule itself is unchanged (`toValidIso`); the advance route keeps its behaviour.

### The mock store reads the operator on `@id`, so a rename collision is testable (2026-10-21)

From the code review of logic and test fidelity. `PATCH /api/members` refuses a rename onto another active member's name with 409 `name_taken` by asking "does anyone ELSE hold this name?" (`… AND c.id != @id`). The in-memory mock filters by parameter name alone and read every `@id` as equality, so that query answered with the member being renamed and nobody else: the 409 could not fire in a test, and a real collision passed CI silently.

- **The mock now honours `!=` / `<>` on `@id`** by reading the query text, the way it already does for `c.removed != true` and the `@groupId` tolerance; a plain `c.id = @id` still selects only that row (`__tests__/mock-store-neq.test.ts`).
- The rename-collision 409 and the two non-collisions (a case change of your own name, a free name) are now covered in `__tests__/members.test.ts`; the first failed on the old mock.

### The admin Payments card reads the roster once (2026-10-21)

From the code review of efficiency (PR 5 of 5). The card's "would remind" and "would hold" previews each walked the whole roster through the per-person owed path — about four serial database round trips a member, twice, on every Command Center open and every payment tap. Both previews, and the daily reminder run, now come from the one whole-roster read the reconcile already uses (`computeOwedForRoster`): four queries instead of several hundred. Same classification functions, so Home and the card still agree.

### A read-modify-write cannot overwrite a change it never saw (2026-10-21)

From the code review of money accuracy (PR 4 of 5). `groupScope.replace` verified that the doc still existed but not that it was unchanged, so two taps that both read "unpaid" both wrote, and a credit spend racing an e-transfer ingest could charge a member twice.

- **`replace` now sends the etag the caller read** and treats a 412 like a vanished doc: the caller re-reads and decides. Every caller already handled that outcome; the credit spend refunds itself, the inbox skips the row.
- A stringing status tap that lands on a job edited from another phone answers 409 `changed_elsewhere` instead of a false "not found"; an ownership hand-over that cannot land fails loudly instead of silently not happening.

### A payment is matched to frozen money only (2026-10-21)

From the code review of money accuracy (PR 3 of 5). An unsettled past session's live share is what Home shows, but it moves until settle: a no-show removed on Wednesday raises Thursday's figure. A member who paid the estimate was marked paid, settle then stamped a higher `owedAmount` on a row already `paid: true`, and the difference was never collected and never shown.

- **The e-transfer auto-match and "Pay with credit" read settled lines only** (`settledLines` in `lib/owedBalance.ts`); a payment that includes an estimate goes to "Needs a look" as an amount mismatch, with the frozen lines proposed. An admin assigning a queued payment by ref may still pick any line — a person deciding is the rule.

### The ledger dates money by its own clock, and a week's early payments reach it at settle (2026-10-21)

From the code review of money accuracy (PR 2 of 5). Three gaps in the mirror, none in the arithmetic:

- **A row ticked paid before settle now gets its payment entry at settle.** An unsettled row has no `owedAmount`, so marking it paid mirrored nothing, and settle wrote only the charge: `collected` ran short by every row paid during the week, and the reconcile reported `missing_payment` daily until a backfill. Settle and the backfill share one builder (`paymentEntryAtSettle`), so they compute the same id and the second is a no-op.
- **Covers are dated by the settle they reverse, stringing charges by the job's own clock, and a shuttle cost correction by the purchase's day.** A backfill used to stamp all three with the day it ran, so a year of covers and stringing income landed inside that month's window on the money view.

### A settled session is frozen: nothing can add a row to it (2026-10-21)

From the code review of money accuracy and logic. Settle stamps each row's bill, so any row that arrived AFTER settle owed nothing and was invisible to the balance card, reminders, the hold, the reconcile and the ledger.

- **Sign-up, admin add, waitlist promotion and the restore of a row removed before settle all answer 409 `session_settled`** on a settled session. The one row that may come back is a cancelled one that was stamped before it left — it returns with its bill. Unsettle, add, re-settle is the path for a late addition.
- **Advancing to a date that already has a session answers 409 `session_exists`** instead of overwriting it: re-advancing to an archived date used to replace the doc wholesale, dropping its `settled` snapshot while the rows kept their frozen amounts.

### Usage records are permanent (2026-10-21)

`NEXT_PUBLIC_FLAG_USAGE_METRICS` retired with its ON branch: sign-ins, app opens and tab views are recorded for the Metrics page without a switch. The 404 that `POST /api/events` answered for those kinds with the flag off, the matching check in `recordSignIn`, the client gate in `useUsageBeacons` and their flag-off tests are gone, and the flag left `lib/flags.ts`, both workflows, `.env.local.example` and `dev:next`. Stopping the beacons is now a code change.

### Tabs stay where you left them, and the app opens complete (2026-10-21)

- **A tab you leave is kept, not rebuilt.** Going back to Home, Stats, Stringing or Profile shows what you left at once — no skeleton, and no data request (the usage beacon is the only one). A tab away for 10 seconds or more re-checks quietly in the background: Home's sign-ups and announcement, your balance, your rackets and the bench. Each tab keeps its own scroll position. Before, every tap rebuilt the tab from nothing: five to ten requests and up to a second of skeletons, even for a tab seen seconds earlier.
- **The launch animation plays through for a signed-in member, and the app loads behind it.** The splash lifts once the shot has landed and Home has finished loading (at most 2.5 seconds after the shot), and the other three tabs open, hidden, in the meantime. Measured on a phone profile: the splash lifts at 2.3 seconds onto a finished Home. Skipped when the browser asks to save data; a reload still skips the shot.
- **Pull-to-refresh refreshes the tab you are on**, not every tab.
- Sheets left open on a tab you switch away from stay with that tab; "Get it strung" from Stats and "turn this off" links still land on the right screen; `stats_open` counts visits, so a Stats opened in the background counts nothing.

### Stats canvas, third pass: Your kudos, play style as courts, no overgrips (2026-10-20)

Play has a "Your kudos" page, opened from "All your kudos" on the Send kudos card: how many kudos and from how many people, a bar per tag with your most-noticed one, then every month — signed notes with their dates, and tags on their own as counts with no date and no name. Your fit asks "Mostly you play" as five court tiles (Doubles, Singles, Mixed · front, Mixed · back, All-around) with you as the green dot; an older plain "Mixed" answer is asked again, and the engines still read every mixed answer and All-around as singles and doubles alike. The "I wrap two overgrips on it" switch is gone: the answer was saved and nothing used it, and "Clear my fit answers" still clears a stored one. `docs/plans/equipment-setup-card.md`.

### Stats canvas, second pass: registers, the fit page, the pick sheet (2026-10-19)

Stats now runs You · Equipment · Play · Learn. On Equipment: "Add a spare racket" is a footer link beside "Your fit" until a spare exists; "Racket to try next" draws a bigger frame with the name as the door and the price row under the description; the pick sheet reads brand → name → typical price, keeps each alternative's price difference beside its price, has a "Where to buy · {brand} site" link under the action and smaller thumbs, and drops the "not a verdict" footnote; the String tension card's three level lines are reworded in the app's voice and spaced properly. Your fit asks swing speed as how far your clear goes (Gentle / Medium / Hard, with a court per tile), marks G5 as the standard grip, says what the overgrip switch means, and counts "n of 5 answered". The engines read the same values as before. `docs/plans/equipment-setup-card.md`.

### Equipment copy and layout from the Stats canvas (2026-10-19)

On Stats → Equipment, the Set-up card's racket line is "Main racket" with no In-play pill, and adding a spare is a line on the card under it ("Add a spare racket") instead of an action buried in the racket's sheet. An untensioned string says "+ String tension", and its club fact reads "3 others in this group use this string". The racket sheet says "Change racket", "3D rendering" (marked Preview) and "Delete this racket", and a typed-in racket's feel questions fold behind "Share more about this racket". The suggestion card is "Racket to try next": its reason line no longer carries the price, which has its own row linking to the maker's site for Yonex and Victor, and the "not a verdict" note is gone. `docs/plans/equipment-setup-card.md`.

### "Where you sit" is two compact rows (2026-10-19)

The Stats card that places your sharpest and weakest skill in the group drops the sentence that repeated its bars. Each skill is now one row: the name, three dots with your third lit, and the third in words, in green for the top third, blue for the middle and neutral for the bottom (never red). "in the group" sits in the header, and the footnote is new copy: "Based on your latest check-in. You can turn this off in Profile.", where "turn this off" opens Profile straight on Stats & privacy The private state keeps both rows unlit. `docs/plans/where-you-sit-rows.md`.

### The fit page and racket pages are permanent, and fit answers can be cleared again (2026-10-19)

`NEXT_PUBLIC_FLAG_GEAR_PAGES` and `NEXT_PUBLIC_FLAG_FIT_VERDICT` retired with their ON branches, after the racket-fit review read `picks.engagedMembers` at 2. The old fit sheet (`GearFitSheet`) and its tests are gone, "Your fit" and a racket's name always open their pages, and the verdict route words the facts whenever an API key is configured. The sheet was also the only thing that could clear a fit answer, which the privacy policy promises and which nothing on screen had done since the pages went on in September, so "Your fit" gains a "Clear my fit answers" action (one confirm, every answer including the older arm question blanked in one write) and the policy now says "from that page" (both locales).

### Fewer member scans, and the club's ratings read once a minute (2026-10-19)

The rest of the performance audit. Stats reads resolve the member they are asked about, and with groups off each was a case-insensitive scan of every member; a member asking about THEMSELVES is now one read by the id in their cookie (`lib/memberResolve.ts`, plus the copies in `members/me` and `stats/insight`), falling back to the scan whenever that read does not find them active under that name. The club bands no longer read every check-in ever stored on each request: `lib/latestRatings.ts` keeps everyone's latest for a minute against real Cosmos, cleared by a new check-in and by account deletion. A player's all-time games are filtered in the query instead of after reading every game (with a fallback to the full read if the query is refused), and a member's roster read fetches three fields instead of whole documents. Profile asks for `/api/members/me` once instead of twice. Not done, on purpose: keeping answers across tab switches, which `lib/sharedRead.ts` rules out because a refetch after a sign-up or payment must not see the answer from before it.

### Less to download on every launch, fewer waits behind "what you owe" (2026-10-19)

From a performance audit of production and a local production build on a throttled phone. Every page carried the whole message file (~37 KB compressed) in its HTML, which is never cached; the strings now ship in script chunks cached for a year, English bundled and Chinese fetched only on a Chinese page, so a page is ~5.5 KB compressed instead of ~43 KB. Racket pictures, brand art and icons in `public/` are cached for a day instead of re-checked on every launch (the service worker, manifest, payments script and changelog stay uncached). `/api/players/unpaid`, on Home every visit, resolves a member asking about themselves by their cookie's id instead of scanning every member by name, and runs its independent reads at the same time. Home's insight warm-up now goes through `useInsight`'s memo, so Stats reuses it instead of asking a second time.

### Club data needs a signed-in member, always (2026-10-17)

`NEXT_PUBLIC_FLAG_MEMBERS_ONLY` starts retiring (members-only is permanent, Grant 2026-10-09). This first part makes the read gate unconditional: `requireMember` and the page gate no longer read the flag, so the flag-off pass-through is gone. Production has had the flag on since 3 Oct, so nothing changes there. Second part: sign-up. `POST /api/players` needs a signed-in member for every non-admin caller (the name comes from the account), and `signupGroupFor` refuses a new account without an invite whatever the env says. The body-PIN sign-in block and the `account_claim_needs_approval` guard in that route could no longer be reached by anyone and are deleted. Third part: the Home sign-up card is always the locked "Signing up as {name}" card (the name field, its autocomplete, the PIN fields and the probe-driven sign-in and create modes are gone, with the pre-flip warning banner), `invitesOn` and its guards are gone because the invite surfaces always exist, the readiness card lost its pre-flip branch, and the flag left `lib/flags.ts`, both workflows, `.env.local.example` and `dev:next`. `docs/flag-retirements.md` has the record.

### Late cancellations: a warning the player confirms, a tag the admin sees (2026-10-16)

`docs/plans/late-cancel-fee.md`. Grant: "when player wants to cancel, they need to confirm there may be a fee if its done less than 48 hours away. This should be a per group setting for the admin to toggle on." Admin → Late cancellations turns it on and sets the window (12, 24, 48 or 72 hours; off by default). A player cancelling their own spot inside it is answered by the server with a warning — "The session starts in less than 48 hours. Cancelling this close to the session may come with a fee. The organiser decides." — and must tap "Cancel anyway". The cancelled row is tagged "Late · 20h" in Payments. No money moves; the admin decides any fee. Admins and people leaving the waitlist are never warned.

### The string map can show control or feel (2026-10-16)

`docs/plans/string-inventory.md`. Power and durability are near mirror images in the catalog, so the map on the Stringing tab drew one dimension as a diagonal. A Power, Control and Feel switch above the map now sets what runs up the side, with durability still along the bottom. It opens on power and remembers the pick. On the club's strings, Control lifts Aerobite Boost from a bottom corner to the top. The card is now titled "Strings in stock", and the selected string's line adds its feel out of 5.

### No card lifts on hover (2026-10-15)

Grant: "Nothing lifts." Since 2026-09-14 only a card that is itself a button rose 2px and deepened its shadow under a mouse, and that turned out to be two cards in the whole app (the Home skill lead and the Gear "next racket" card), so it read as an inconsistency. Every card hover rule is gone (Home, Stats, admin `cc-dcard`), along with the locked-card override that existed only to cancel the lift and the two hover tokens. Pressable cards keep their chevron, pointer cursor and 0.98 press scale. Phones never showed a hover, so members see no change.

### Sign-up wording (2026-10-15)

Grant's copy: the confirmation reads "{name}, you have signed up for this week!" (both the green banner and the amber PIN-setup one, which keeps its own body), and the line under the sign-up card reads "A has signed up", "A and B have signed up", or, for three or more, "A and N others have signed up" — one name and a count, where it used to name the two newest. Chinese follows. The button itself reads "Sign up for this week" (was "I'm in this week"; Chinese already said 立即报名), and "Join Waitlist" becomes "Join the waitlist".

### Email, Google and Apple sign-in are no longer behind a flag (2026-10-15)

`NEXT_PUBLIC_FLAG_AUTH_PROVIDERS` retired on its date. It has been on in production since the store launch, so nothing a member sees changes. The code that ran when it was off is gone: the 404 at the top of all sixteen `/api/auth/*` routes, the "Sign-up isn't available yet" and "needs an account" screens, and ProfileTab's PIN-only arrangement. Which buttons show is still decided by which providers have credentials configured (`configuredProviders()`), so a deployment with none still gets the PIN form alone. `docs/flag-retirements.md` has the record.

### Home's title matches every other tab (2026-10-15)

Grant: "this header size is off from the other page." Home rendered the club name at 16px semibold (`PageHeader compact`, from the 2026-08-27 hierarchy pass) while Stringing, Stats and Profile use the 30px `bpm-h1`; the compact title also grew to 18px on scroll, because the shared condensed rule is more specific. The variant is deleted and Home uses the same header as every tab. The "What's new" line under it loses its 8px inset so it lines up with the title.

### The Home skill lead, rebuilt as an upsell (2026-10-15)

`docs/plans/home-skill-lead.md`. The one-line card ("Level 3.4 overall, up 0.5 since September. See the trend →") gave no scale and no reason to tap. It is now one compact tappable card in the Stats tab's blue: a headline in words, the level out of 5 beside a small line through the recent check-ins, and chips naming what Stats holds (Focus drill, Your record, Racket fit). A member who has never rated sees "This is {club}'s average skill level" over the club's technical, physical and mental bars, and "Add yours to get improvement tips, drills, and racket and string picks." Rated once, a dotted line runs to the next check-in. A dip reads in neutral text, never red. The card holds 160px in every state.

### The Home skill lead (2026-10-14)

`docs/plans/home-skill-lead.md`. The skill-leads reading (#623) showed 17 of 36 members ever open Stats, so the Home decision was reopened. One card under the sign-up card, for every identified member, every week, in the third person: the group's skill spread and the ask for someone who has never rated, their level after one rating, and the change since the previous check-in after two. A failed read renders a plain line, never a number. Replaces the self-retiring `SkillDiscoveryCard`. `stats_open` may now carry `source: 'home'`, and slice0 reports `homeLeadTappers`.

### The Set-up card is the Gear register (2026-10-14)

`NEXT_PUBLIC_FLAG_GEAR_SETUP` retired, a month after it turned on (Grant: "yes retire the flag"). The flag-off register — `GearPickRail`, `YourKitCard`, `BagList`, `GearSheet` and their six test files — is deleted; `GearRegister` is the Set-up register outright. `GearPickCard`, the rail's card, followed the next day once it was clear nothing rendered it (its types moved to `components/stats/gearPick.ts`), and `docs/flag-retirements.md` records the retirement. Nothing a member sees changes. The plan's kill criterion (`docs/plans/equipment-setup-card.md`) could not be read as written, so the card stays on a product call, with `racketSavers` 10/36 recorded as the baseline for the next look.

### Three containers folded into the cabinets that hold their kind (2026-10-14)

`docs/plans/container-fold.md`. Grant's portal reading showed the shared Cosmos database at its 25-container cap and `aliases` on its own dedicated throughput, so the account provisioned two minimums for 3.7 MB of data (both free, it turned out: the account is on Cosmos's free tier, so the fold's win was two shared slots, not money).

- **E-transfer aliases are `kind: 'alias'` rows in `clubSettings`** (`lib/aliases.ts`); **problem reports are `kind: 'feedback'` rows in `releases`** (`lib/feedback.ts`); **the PWA-to-native migration stash lives in `authhandoff`**, kind-checked both ways so a handoff ref can never redeem a migration doc.
- **Nothing is unreadable during the move**: every alias and report read is the new home union the old container until the copy has run, and editing a legacy alias moves it.
- **`GET`/`POST /api/admin/migrate-containers`** (admin cookie + `x-migration-key`, the `migrate-groups` gate, now shared through `lib/migrationKey.ts`) copies the old rows under their own ids, idempotently, and reports what is left. PR 2 deletes the fallbacks and the route; the old containers are then deleted in the portal.
- The releases route stamps `kind: 'release'`, lists releases only, and refuses to delete a report by id.
- **2026-10-15: the copy ran** (14 aliases, 4 reports, nothing remaining) and PR 2 removed the fallback reads, the copy route and the legacy registry entries; the code defines 24 containers. The three old containers are deleted in the portal.

### Motion hygiene from the design-engineering review (2026-10-11)

- **Admin notices leave instead of vanishing.** A toast that timed out or was dismissed used to disappear between frames; it now fades and drops the 8px it rose by, in 150ms.
- **The sign-in / offline banner lands in 280ms** (was 420ms with a visible bounce) and still leaves faster than it arrives.
- **The sheet rubber-bands progressively** when dragged upward: it follows a third of the first pixel, less and less after, and never travels more than 36px, instead of a flat 18% everywhere.
- **The Next Session capacity bar is now the Fill recipe** (a scaleX transform, not an animated width), and the segment tabs and check-in rows no longer use Tailwind's `transition-all`.
- **The quiet text link's hover is gated** like every other hover, so on a phone it no longer stays lit after a tap.
- **Buttons, inputs and the theme/language toggles read their durations and curves from the motion ladder**; three of them had been running the weak built-in `ease`, so a press started slow. The swipe-back release uses the ladder's tokens too.

### It's a "group" everywhere, and Sign up says what BPM is (2026-10-09)

- **Every "club" the app shows is now "group"**, in English and Chinese (群组), from Stats and Gear to the privacy pages, plus the launch line ("Weekly badminton with your group."). Two lines that mean real-world badminton clubs keep the word.
- **Sign up opens with what the app is**: "BPM is a badminton group management app, currently in testing and invite-only."

### A brand-new group's organiser sees no false alarms (2026-10-09)

- **Before a group's first session**, Profile's admin row and the Next Session form no longer say "Couldn't check" or "Couldn't load the current session" in red, and the form no longer promises to archive a session that doesn't exist. Having no session yet is a normal state, not an error.
- **Nobody counts as inactive in their first 60 days in a group.** A new organiser used to open their group to "1 need you" — themselves — and every fresh invite counted as dormant until their first session.

### No more "Set a PIN" for an admin who has one (2026-10-11)

- **Home showed "Set a PIN so you can get back in" on a phone where an admin had signed in at Profile.** The admin sign-in sets a different cookie from a member sign-in, and the check behind that card only read the member one, so it saw nobody and said "no PIN". It now reads either, as the rest of the app already does.

### Stringing screens on the design system (2026-10-10)

- **Stringing tab**: each string on "Strings we offer" is a standard list row, and one the catalog doesn't know yet is shown dimmed rather than as a look-alike card. The request sheet's ✕ is the shared one every sheet has.
- **Admin bench**: job-status chips are the app's standard pills; the price list's reorder arrows and remove × are full-size tap targets (they were 18px tall); the member picker on "New job" and the string-stock rows use the standard row layout and padding; the Lin/Viktor action sheet's ✕ is the shared one.

### The string stock card loads (2026-10-10)

- **Admin bench → "String stock" said "Couldn't load the string stock" from the moment it shipped.** Its purchases were stored in a database container of their own, and the one new thing that card did in production was create it — which a shared-throughput Cosmos database refuses past its 25th container. Purchases now live beside the gift cards in a container that already exists; nothing had been saved, so nothing was lost. The error, if it ever returns, now says which read failed.

### String inventory, and the strings the club offers explained (2026-10-10)

- **Stringing tab → "Strings we offer"**: every string on the club's shelf with what it is like, and a page per string the catalog knows: what it is best for, its repulsion / durability / control ratings, what the gauge, type and feel mean for how it plays, the spec sheet, and a typical shop price (the club's price stays on the rate card). "How to choose a string" underneath is the short version of the whole subject.
- **Admin bench → "String stock"**: log a reel or a pack of sets, and the card counts what went onto rackets from the jobs themselves (a job moved to "strung" is one set), what is left, and what the string on each racket cost. Purchases land in the ledger as string outlay.
- **Matching a string to the catalog**: on the bench's "Strings you stock", pick the catalog's match while typing a string, or tap the link glyph on one already listed. A matched string gets its page for members and its reel length for the inventory.

### Gift cards keep a record, and helpers can give them out (2026-10-09)

- **Tap a gift card in the admin console and it opens into its record**: who made it, who redeemed it and when, how much of it has been spent on what, and what is left. "What is left" is worked out from the member's credit history, oldest card first, so it always matches the entries you can see.
- **"Can give out gift cards" on a member's roster entry** lets them make cards from Profile → Give a gift card, up to ten a day, and see which of theirs have been redeemed. Who redeemed one stays on the admin's record.

### The Astrox 88S is no longer offered as a power step up from the 88D (2026-10-09)

- **The four Astrox 88S rows (Pro 2nd and 3rd gen, Tour, Game) now read as even-balanced in the catalog.** They are the front-court sibling of the 88D, lighter at the top, and the catalog had them labelled the same as a 99 Pro, so a rear-court smasher asking for more power was being shown an 88S Pro. The stringer confirmed the relabel against the published reviews.
- Two more sample players (the quick doubles tactician and the hard smasher) are now rated in the racket-fit test set, three of the five it needs.

### A slow swing is not sent a head-heavy racket for "more power" (2026-10-09)

- **Ask for more power with a relaxed swing and the racket pick now stays even-balanced and no stiffer than Medium**, instead of stepping to a head-heavy frame. A heavier head adds smash power only to a swing fast enough to accelerate it; at a relaxed pace the power comes from the shaft bending and the string bed launching, which is what every buying guide says and what the club's stringer confirmed. The pick says so in one line. Medium and fast swings are unchanged.
- The first expert-rated sample player (the developing player) is now in the racket-fit test set; the engine is `fit-3`.

### The string tension follows your swing (2026-10-09)

- **Tell the app your swing speed on Your fit and the tension it suggests follows it.** A relaxed swing is strung looser — at that pace a softer bed does the work and gives more power, not less, with a bigger sweet spot — and a fast swing a touch firmer. The string pick, the fit verdict and the tension card all say the same number, and the page says why the range moved when it did. Nobody who hasn't answered the swing question sees a change.
- Three draft sample players (a developing player, a quick doubles tactician, a hard smasher) are in the racket-fit test set for the club's stringer to confirm or correct.

### The privacy policy and terms name who looks after your data (2026-10-07)

- **Two roles, said plainly**: the operator, who runs the app for every group, and your group's organisers, who run your group. The terms gain a "Running a group" section, the British Columbia privacy commissioner is named, and the pages say the app is free today and what would happen before that ever changed. Both languages.

### "Move to the app" is on (2026-10-07)

- **Profile → Move to the app** carries a signed-in web or home-screen account into the App Store / Google Play app with a one-time link or a 6-digit code, so nobody has to sign in again. It was held back until both store listings were live; they are now.

### Admin → Metrics, and the app starts counting how it is used (2026-10-07)

- **A Metrics page for the organiser** (Admin console → Metrics): active members, how fast each session fills, waitlists and cancels, new members and whether they come back, kudos / stringing / notifications use, and how quickly people pay. Club totals only — never a list of who did what.
- **The app now keeps a simple first-party record of use**: when it is opened, which tab is viewed, and how someone signed in. It stays in BPM's own database, is only ever read as club totals, is deleted after 13 months or at once with the account, and nothing goes to a third-party analytics tool. The privacy policy, the App Store and Play privacy labels and a Home announcement all said so first.
- **A weekly report and a monthly UX report** are prepared from the same totals with a read-only key the organiser creates on the Metrics page.

### Screens fill in from the top, and nothing says something untrue while it loads (2026-10-03 – 10-06)

- **Every tab now fills top to bottom.** Cards used to arrive in whatever order the network answered, and a late one would land above or between cards you were already reading and shove them down. Now each card holds its place with a grey outline the size of the real card from the first moment, and shows only once everything above it has — so Home, Stats, Profile, Stringing and the admin console settle once instead of jumping. If it all arrives quickly (switching back to a tab), it simply appears; if it takes a moment, it fades in from the top.
- **No wrong answers while loading.** Stringing said "Coming soon" while it was still checking (and kept saying it if the check failed); the admin console said "No active players yet" and "No announcements posted" before it had looked; Profile briefly showed the signed-out "Welcome back" card to people who were signed in; the roster showed an empty list when it couldn't load. Each now shows a placeholder while it waits and says plainly when something couldn't be loaded, with a way to try again.
- **Smaller fixes along the way:** your announcement shows on Home straight away (it was hidden behind a placeholder); saving a skill check-in no longer blanks two Stats cards; the admin page no longer goes blank or changes its header as it loads; and the Notifications row in Profile no longer pops in and pushes the rows below it down.

### The sign-up count says what it means (2026-10-06)

- **An empty session no longer looks full.** The count on Home read "12/12 spots left", and a slash reads as "taken out of total", so twelve open spots looked like twelve taken. It now reads "12 spots left out of 12", and "1 spot left" when there is one.

### The buzz lands with the shuttles (2026-09-28)

- **In the app, the little vibration when your sign-up lands now happens at the same instant the shuttles pop off the button.** It used to come about a quarter of a second early, while the button was still turning into the confirmation, so it felt like a separate event. The first shuttle now also leaves exactly on the buzz.

### The shuttles fly like shuttles (2026-09-28)

- **The sign-up burst now moves the way a shuttlecock does.** It used to scatter in straight lines and fade, which looked like neither confetti nor badminton. Now each piece pops UP out of the button cork-first, runs out of speed the way a real shuttle does, flips nose-down at the top and drops almost straight down at a steady pace with a little rock, landing below the card about a second later — the shape of a shuttle's flight, taken from the published physics rather than guessed.

### Signing up throws shuttles (2026-09-28)

- **When your sign-up lands, a burst of little shuttlecocks flies off the button** — the same pink, yellow and green ones the PIN field uses, each at its own size and in its own direction. Once a week, under a second, and never for a waitlist join (nothing has landed yet). If your phone asks for reduced motion, you get the confirmation without the burst.

### The rest of the 2026-09-28 audit (2026-09-28)

- **The site refuses what a browser should never send it.** Every API write is refused when it comes from another site or with a body over 256 KB, before any handler runs; the page cannot be framed by another site, and its forms cannot be pointed elsewhere.
- **Fewer database reads on every screen.** The session pointer is remembered for five seconds, the equipment catalog for a minute (and for five minutes in your browser), the translations are merged once per server start, and club statistics in a multi-club deployment read only the club's members.
- **A first visit downloads less.** Eleven sheets that open on a tap — kudos, release notes, the recovery-code and PIN sheets, the onboarding and sign-in screens — load the first time they open instead of with the page.
- **Too many sign-up probes now say so.** Over the limit the probe answered "no account" and showed a member with a PIN the anonymous form; it answers "try again shortly" and the form keeps what it knew. The limit is per name, so a shared gym address is no longer one bucket.
- **A purchase logged after 5 pm lands on today's date.** The bird purchase form's "Add" reset the date in UTC; it uses local time now. The purchase and reconcile sheets are their own components.
- **The session editor refuses a time with no timezone**, and the client no longer has a fallback that could send one.
- Under the hood: one helper strips credentials from every member and player response and one names "the server refused this caller", each replacing a dozen hand-written copies; eighteen internal symbols are no longer exported.

### Five fixes from the 2026-09-28 quality, efficiency and security audit (2026-09-28)

- **Undoing a cover on a settled session can no longer thaw the bill silently.** The re-settle after an uncover swallowed both of its requests; if the first landed and the second failed, the session was left unsettled while the screen showed live numbers as if they were frozen. `lib/resettleSession.ts` is now the one owner of that pair for both the cover sheet and the uncover action, and a failure is shown in the sheet.
- **A database outage looks like one.** `GET /api/session`, `/api/members` and `/api/sessions` answered a failed read with a default session or an empty list and a 200; they answer 503 now, so the app's "Couldn't load" state can fire.
- **Sign-in recovery and access-request polling are rate-limited per IP before the body is read.** Both were keyed only on a caller-chosen name, so each new name was a fresh allowance.
- **A failed push no longer writes the device's push endpoint (a send credential) to the server log.**
- **Push reads are scoped to the member.** Sending to a member, or registering a device, read every subscription of every member and filtered in code; they read one partition now.

### Items 11 to 15 from the same audit (2026-09-28)

- **The equipment features no longer sit behind a stale switch.** The value-hub flag was overdue and turning it off broke six screens rather than hiding them; it and its twelve off-branches are gone.
- **A wrong PIN no longer stalls everyone else.** PIN and password checks run off the server's main thread, so one sign-in attempt cannot pause other requests on the single instance.
- **Mail that cannot connect gives up in seconds, not minutes**, so a stringing status update is never held hostage by an unreachable mail server.
- **Admin powers on the sign-up route are checked against the live account**, not just the cookie, so a demoted admin loses them immediately; the PIN-change path resolves the member inside the club.
- **CLAUDE.md's numbers are pinned to the tree** so counts that drift now fail the build, and a plan is recorded for replacing the deprecated OAuth library.

### Five more from the same audit (2026-09-28)

- **Guessing a PIN locks the account, not just the phone it came from.** After five wrong PINs in a row an account refuses PIN sign-in for a minute, doubling each time up to an hour; a correct PIN clears it. Before, every guard was per network address, so a four-digit PIN could be walked through from enough addresses.
- **Your history matches your receipt.** A member's session history recomputed the per-person cost even for a settled session and ignored resplit covers, so it could show a different number than the receipt. One split now, everywhere; a session with no recorded cost says so instead of drawing a $0 receipt.
- **Home and the admin landing ask the server less.** Duplicate reads on one screen are made once; the "are you still an admin?" check runs when the app is brought back to the front, at most once a minute, instead of on every focus.
- **Your balance loads from your own rows.** The unpaid-balance read used to scan every session and every player row in the club on every Home load; it reads your rows first and only the sessions they name.
- **Stats loads lighter.** The level calculation checks its cache before scanning game and check-in history, and container provisioning is checked once per server start instead of on every request.

### "Your groups" looks like the rest of Profile (2026-09-16)

- Each club is a proper row now — its initial, its name, your role — with a tick on the one you're in, instead of a squashed pill with the text on its edge.
- "Join another group" and "Create another group" are two equal rows like Profile's settings, instead of a grey button over one that looked switched off.

### Tapping a notification opens the right screen, without restarting the app (2026-09-16)

- **In the app from the store**, tapping a notification used to reload the whole app — splash screen and all — even when it was already open. It now switches straight to the screen the notification is about, and refreshes it.
- **In the home-screen web app**, tapping a notification only brought the app forward and left you wherever you were. It now takes you to that screen too.

### Pull to refresh feels like a phone's (2026-09-16)

- **About a third of the pull.** It used to take ~283px of finger travel to refresh — three times iOS Mail. Now ~100px, and the pull stiffens as it goes instead of moving in a straight line.
- **One thing moves.** The page used to bounce under the spinner at a different speed; now the page stays put and only the spinner comes down. In an Android browser tab, Chrome's own refresh no longer fires on top and reloads everything.
- **You can feel when it will refresh**: the spinner swells as it arms, and Android phones give a tiny tick. It also stays on screen long enough to read as a refresh rather than a flicker.

### The keyboard no longer covers the button you need (2026-09-16)

- **A sheet you're typing into moves up above the keyboard.** On iPhone the keyboard covered the bottom of the sheet — including the button that saves what you just typed. The sheet now lifts by the keyboard's height and shrinks to fit what's still visible, and the field you tapped scrolls into view.
- Search fields show a **Search** key instead of a plain return.

### Sheets can be dragged down to close (2026-09-16)

- **Every sheet has a grabber and closes the way a phone's own sheets do**: drag it down from the grabber or its title. Past about a quarter of the way, or with a quick flick, it closes; a short drag springs back. The ✕ is still there. A sheet that has to be answered (the club-comparison question) can't be dragged away.

### Fewer repeat requests on Stats (2026-09-15)

- **Three things were being asked for twice on the same screen** — the club bands, your kudos and your games, each read by two cards that load together. They now share one request. Pulling to refresh still refetches everything.

### The app stops waiting on Google to draw the first screen (2026-09-15)

- **The icon font is ours now** — 11.7 KB served from the app, instead of a stylesheet on Google's CDN that the browser had to fetch (twice) before it could paint anything. Nothing about the icons changes.

### Smoother scrolling (2026-09-15)

- **The condensing header no longer animates while you scroll.** It was animating its blur, its padding and its title size — the three things a phone has to redo on every frame — at exactly the moment scrolling needs them. The header still condenses; it just arrives.

### Better to touch (2026-09-15)

- **Typing no longer zooms the page on iPhone.** Any field under 16px makes iOS zoom in on focus and never zoom back; fields are 16px on a touch screen now, and unchanged with a mouse.
- **Everything you tap answers.** Set-up lines, list rows, the mini cards and the bottom-nav tabs gave no response to a tap except the browser's own grey flash. They now press like the buttons do, and the grey flash is off.
- **Bigger targets on touch**: buttons, list rows, filter chips and the colour swatches all clear 44px — on touch screens only, so the admin screens keep their density on a laptop.
- A sheet's scroll stays in the sheet, and the filter chips settle on a chip.

### Faster to open (2026-09-15)

- **Opening the app no longer downloads the screens you haven't opened.** Sign-Ups, Stats and Profile now load when you first go to them; Home (and the announcement, which is the first thing you read) is unchanged. A canary keeps them from creeping back into the first load.
- **Racket pictures no longer shift the list** as they arrive: every one carries its size up front.

### Equipment — hybrid strings: mains and crosses (2026-09-15)

- **A racket can be strung with two strings.** From the string's sheet, "Use a different string for the crosses" picks the crosses string; the Set-up card then shows Mains and Crosses on the Strings line, each with its own tension, and the sheet sets each one. "One string throughout" takes the crosses off.
- The crosses tension starts from a suggestion 2 lb over the mains (the usual convention), never saved until chosen.
- Everything that compares a tension — the club's range, the fit verdict, the share card's club line — still reads the mains. The share card shows "BG80 / BG66" and "26 / 28 lb" for a hybrid.

### Equipment — swapping rackets no longer breaks "Where you'd go next" (2026-09-15)

- **Swapping a racket in a few times in a row** showed "Couldn't load this pick": every swap re-asked both picks, and the recommendation limit (10 a minute per IP) ran out on the fifth. A burst of swaps is now one re-ask, and the limit is 30 a minute — one gym's wifi is one IP for everyone on it.

### Equipment — tension past 30 lb (2026-09-15)

- **A saved tension can be retyped.** Clearing the field in the string's sheet used to snap the saved figure straight back, so a string saved at 32 lb could not be changed by typing.
- **The steppers go past 30** when the frame prints no rated range, and a figure above a frame's range steps back a pound at a time instead of jumping to the edge.
- **The ruler widens** to hold a figure past 30 (or below 20) rather than pinning the line to the end.

### Equipment — a tension ruler, and club rows that open the racket (2026-09-14)

- **Strung at** has a live ruler under it: the frame's rated window, the club's range once three members have logged one, and your figure as a line that moves as you type or tap. A suggested figure draws dashed; one outside the rated window turns amber.
- **The club line always says what it knows**: the club's range, "Not enough of the club has logged this frame yet", or "We couldn't reach the club data just now" — a failed read no longer looks the same as a quiet club.
- **What the club plays**: a racket row that names a catalog racket opens that racket's page.

### Equipment — one price per racket (2026-09-14)

- **Every screen shows the same price for a racket now.** Nine rackets had a hand-set figure on the pick sheets that disagreed with the typical range on their own page (the 3D Calibar 900 read $209 in one place and $345–$415 in the other). Prices come from one sourced figure (`lib/catalogPrice.ts`), and a test holds every catalog row to it.
- **Prices re-checked online** for those nine: ArcSaber 11 Pro, Auraspeed 90K and Nanoflare 001 Ability ranges updated; the rest held.
- The string pairing's "a $X set" warning is in Canadian dollars like every other price.
- **Release notes**: the form suggests the next version above the last one published (v2.1 after v2.0), not only above CHANGELOG.md's headings.

### Equipment — Your fit and racket pages are on (2026-09-14)

- **`NEXT_PUBLIC_FLAG_GEAR_PAGES` and `NEXT_PUBLIC_FLAG_FIT_VERDICT` are on** in production and PR CI. "Your fit" opens the fit page with a verdict on your racket, and "About this racket" opens the racket's own page.
- Rollback is this commit's revert: the fit sheet and the fixed verdict wording are still on main.

### Equipment — a page for every racket (2026-09-14, dark)

- **About this racket** (behind `NEXT_PUBLIC_FLAG_GEAR_PAGES`): the frame in 3D, its specs, a typical price range in dollars, and four rows — your fit verdict (or how it would suit you), the club's tension band with your line on it, your restring log, and the rackets closest to it.
- **Reached from** your racket's sheet, the ranked frames on Your fit, and from one racket's page to the next; back walks back through them.
- **Only what's real**: no release year, no member-reported price, no string log for a racket you don't own, and no club band until three members have logged this frame.

### Equipment — Your fit, and a verdict on your racket (2026-09-14, dark)

- **Your fit is a page now** (behind `NEXT_PUBLIC_FLAG_GEAR_PAGES`): level, what you mostly play, swing speed drawn as where you meet the shuttle, grip size drawn to scale, and anything sore. Every tap saves.
- **The verdict** says whether your racket suits you, is fighting you slightly, or is fighting you, with the reasons and a string tension range. The judgement and every number are decided in code; with `NEXT_PUBLIC_FLAG_FIT_VERDICT` on, Claude only puts them into words, and a reply with any number in it is thrown away for the app's own wording.
- **Nothing stronger than the answers support**: under five answers, or a racket nobody has described, it says it can't call it yet.
- **Privacy**: the policy now says fit answers shape a verdict, and what the AI receives to word it (never your name).

### Equipment — the racket in 3D (2026-09-14)

- Every racket picture is now rendered from one 3D model, painted in each model's colours.
- **See it in 3D** on your racket shows it live: drag to turn it. Pick your string colour and overgrip, and your share card shows them. A racket you typed in by name can take a frame colour, paint pattern and head shape too.

### Equipment — search filters, tension as a field, a share card worth sending (2026-09-14)

- **Add a racket**: the brand tabs are gone. Search leads and chips narrow it (Brand, Weight, Balance, Shaft), with a live "7 of 151 rackets" and group headers that count what is shown.
- **Strung at** is a real number field now, with steppers that stop at the frame's rated range, a warning (not a block) outside it, and the club's range for that frame once three members have logged one.
- **Share card**: "Answer 'what are you playing?'". It is dark and shows how long you have been at the club, restrings on this frame, tension against the club average, and how many of you play it. It leaves out any line it cannot say honestly.
- **Recording starts today**: every restring and tension change is kept, which is what those numbers read.

### Equipment — one Set-up card (2026-09-14, #419)

- **The Gear register is one card now.** Two lines to fill, Racket and Strings, replace five empty fields, the pick rail and the kit rows. A filled line shows its spec and how many others in the club play it; a spare racket sits on its own line with "Swap in". Shoes and Shuttles are gone from the register.
- **Picking and storing are one pass.** The add sheet searches the catalog by brand, offers your check-in's suggestion (it asks "Is this the one you play?" before saving), and captures "This is the one I play" for a racket or "Strung at" for a string on the row you just saved. Each filled line has its own sheet: change it, set the tension, or remove it.
- **Payoffs.** "Where you'd go next" suggests the racket after the one in play, a complete card can be shared as an image (gear and tension only) or copied as text, and the club tally marks your own row "yours".
- **Every catalog racket is drawn in its own colourway**, with an isometric head, researched from maker and retailer listings.
- **Changing a string replaces it.** Found in review before it shipped: the first cut added the new string and left the old one voting in the club tally.

### Design — the fields stop being a flag (2026-09-10)

- **`NEXT_PUBLIC_FLAG_VISUAL_FIELDS` is retired.** It was `'true'` in both workflows, so nothing changes on screen: the per-tab coloured grounds and the 30px frosted card material are simply the look now. The `data-visual="field"` attribute is gone from `<html>`, the flag is out of the registry and both workflows, and the seven pre-field rules it used to switch away from are deleted.
- **One selector survived the flag on purpose.** Every field rule was scoped `html[data-visual="field"]`, which is specificity (0,2,1), and two things quietly depend on that weight — the card padding that governs ~124 call sites has to outrank a Tailwind `p-5`, and the field card material has to outrank the Stats-tab `.glass-card` rule 128 lines above it. The rules now read `html:root`, the one substitution that preserves the exact weight. It looks like a leftover and is not; three comments and a canary now say so.
- **Verified by looking, because nothing else can.** jsdom applies no stylesheet and computes every length as `0px`, so the suite is structurally blind here. Checked in a real browser across all five tabs in both themes: five distinct grounds, padding `15px 18px` rather than Tailwind's `20px`, and the Sign-Ups court etching and Stats dot grid still riding on top of their fields.

### Equipment — the racket fit engine re-weighted on the published evidence (`fit-2`, 2026-09-10)

- **Flex follows the swing, not the check-in.** The level-derived flex ceiling is gone; an unanswered swing widens the tolerance and the pick says "tell us your swing speed" instead of guessing. When the racket on file is two or more flex steps above what the swing wants, the pick says so first and the picks are softer on purpose.
- **Balance outweighs grams.** Ten grams now costs about half a balance step, and the "faster" and "less fatigue" goals move balance first.
- **A sore arm steers tension and swing-weight, not flex.** The comfort answer keeps its weight and head-heavy caps, lowers the paired string tension by one or two pounds inside the frame's rated window, and no longer caps shaft flex.
- **Tier is price, not fitness for level.** A Beginner reaching up past the target's tier pays double so Entry and Mid frames that fit as well rank first — reordered, never excluded. A Beginner already playing a Premium frame is not steered down from it.
- **The first alternative is the runner-up.** It used to be the first racket that differed from the top on balance, shaft or tier, which skipped the owner's own second choice in the golden set for a softer frame he did not want. The second alternative still shows a contrast.
- **A few dollars over budget is no longer a twenty-point cliff.** The penalty ramps to its full weight at 25% over; the golden set showed the owner choosing a $207 racket against a $200 budget.
- **The string card is scored at the tension it names.** The comfort reduction reaches the pairing engine, not only the displayed figure, and a comfort change re-asks the string card even when it is paired with your own racket.

*Items here are already live on production. A tag just marks the release.*

<!-- Add bullets under the matching subheading as you ship user-facing changes.
     Format: `- **Short title** — one-sentence what + why.` See v1.3 below for examples.
     Empty subheadings are fine; delete a section if you don't end up using it. -->

### Added

- **Two alternatives, and a way to say if we got it right** — the racket pick now comes with two others to consider, each with one line on how it differs ("stiffer · $60 less"); tap one and the sheet switches to it. Under the pick, a yes/no on whether it was any good; once you own it, an "I've tried it" button. Both are anonymous counts that tell us whether the suggestion is worth keeping. Reasons now read in your language.
- **The racket suggestion now starts from YOUR racket** — with the fit questions answered, the pick is built from the racket you play now and what you said you'd change about it, instead of from your skill ratings alone. A sore arm rules out the stiffest, heaviest frames rather than quietly scoring them; a fast swing opens up stiffer ones. Reasons say how a pick relates to your current frame ("a step up in power from your Astrox 88D Pro"). Two alternatives follow in the next release.
- **Tell us how you play — the racket-fit questions** — from the racket pick on Equipment, tap Fit: what you'd change about your racket, your swing, grip size, string budget, and an optional note on whether your arm or shoulder is sore after play. Everything is optional and one tap each. The suggestion doesn't use them yet — that's the next release — but they are saved now so it can. The arm-or-shoulder answer is only visible to you and the organiser, is covered in the privacy policy, and can be cleared any time.
- **A privacy policy, terms, support and account-deletion page** — at `/bpm/legal/privacy`, `/terms`, `/support` and `/delete-account`, readable without signing in, in both languages. The delete-account page walks you into the in-app flow; if you can't get in, it tells you how to ask instead. (These are also the URLs the App Store and Google Play listings need.)
- **Groundwork for the BPM app on the App Store and Google Play** — not visible yet. The native shell, its push transport and the "Move to the app" link are built and tested; the store side (listing, review, Firebase) is still to come, so nothing changes for you today.
- **Grant can ask you before a stringing price changes** — if the price or spec on your racket changes after he's quoted it, you get a prompt showing exactly what's changing, from what to what. Your balance doesn't move until you say yes. Declining leaves the original standing.
- **The stringing bench can be tidied** — Grant can pin an urgent job to the top, archive finished ones off the list, and permanently delete an archived job. Archiving never changes what anyone owes; only deleting does, and it says so with the amount first.

### Fixed

- **"Where you sit" no longer disappears when it can't load** — if your check-in history failed to load, the card vanished silently, which looked exactly like the club being too small to compare. It now says it couldn't load, and waits for your history rather than flashing in a moment after the rest of the page.
- **Screen readers no longer say "no level yet" while your level is loading** — the Level tile announced a confident "no level yet" during the moment before your level arrived. It now says it's loading, matching what the caption underneath already did.
- **Sign in with Apple from the installed app** — picking Apple on the home-screen app used to sign Safari in and leave the app signed out. It now comes back signed in, the same way Google has since late August.

### Changed

- **Kudos is easier to find, and you can say why** — giving kudos lives in two places now: the Stats tab under **Play**, and next to any name on the Sign-Ups list. You can add a short note and point at the skill you noticed. The tag on its own stays anonymous; a note is signed with your name, so people know who spotted it.
- **Your rackets live on the Equipment tab now** — the tab shows the racket you're using today, then every racket you own, with "Add a racket" underneath. Picking one used to mean opening a sheet that tried to be both your bag and a 50-racket catalogue at once; adding is now the only thing that opens a sheet, and one tap adds a racket instead of tap-then-save.
- **Finding your racket got easier** — the picker is full-height, searches every brand at once, and shows the brand above each model, so a search that crosses brands no longer gives you a list of bare model names. Rackets already in your bag don't show up in the list.
- **Sign-in options are a row, not a block** — "How you sign in" now sits with Update PIN and Have a recovery code? in Account, and tells you what you've got (PIN · Google) without opening it. It used to be a panel wedged between those rows, taking up half the screen to say the same thing.
- **It's "equipment" now, not "kit"** — the Stats tab, the stringing sheet and Profile all say equipment, the word Yonex uses, so what you own is called the same thing here as on the box it came in. Chinese already said 装备.

### Fixed

- **Kudos no longer disappears the moment the session rolls over** — you can now thank anyone you've played with in the last couple of months, instead of only the people on this week's list. Previously the sign-up list resets as soon as the next session is posted, so the card quietly vanished and there was no way to tell it existed at all.
- **You can remove your racket when it's the only one you have** — the bag hid itself entirely if you owned just one racket, so there was no way to remove or replace it.
- **"Add a racket" reads like a button now** — it was smaller and quieter than the rows above it, and below the minimum tap size.
- **The empty state answers the question it's under** — "What is the racket you are using today?" now gets "Haven't picked one yet." instead of a label telling you to look below at a button you can't miss.
- **Payments says nothing's there instead of showing you a blank bill** — with nobody signed up it was printing "0 players", a dash where the amount goes, and a Share receipt button that did nothing. Now it just says no one's signed up yet, above the box for adding someone.
- **Cards line up again** — on Gear, a card with a "Coming soon" tag started its text lower than the card beside it. On Stats, the note under the comparison bars was pressed flat against them. Admin's Birds and Roster tiles had their numbers too close to the edges.

### Security

- **Skill check-ins can only be written by you** — assessments were accepted for any name, and member names are guessable, so someone could have written ratings against another player's account. Writing now requires being signed in as that member (or being an admin).
- **Someone else's ratings can't move your level** — check-ins written for a name with no account were being folded into the calibration of the real member who shared that name, which could shift their level without touching their account.

### Notes

- The **racket recommendation based on your check-in** is on `bpm-next` only (`NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER`) and is deliberately **not** part of this cut — it stays off on stable until it has been lived in. The Equipment tab changes above *are* included, since they aren't gated by that flag.
- Dependency updates: Next.js 16.2.9 → 16.3.1 (closes nine advisories, none of which were reachable in this app) and seven production packages. `npm audit` went 34 → 5, with every survivor confined to build and test tooling.

---

## v1.8 — Pooled shuttle costs, settle correctness, and a working Equipment tab (2026-08-16)

This cut closes the two-month gap between stable and `bpm-next` — most importantly it makes stable able to *read* the pooled shuttle usage that `bpm-next` had been writing since July (v1.7's admin cost form showed $0 shuttles and refused to save those sessions). It also brings the Equipment tab to life: the racket picker and recommendation had never rendered for anyone, and the catalog behind them had never been loaded.

### Added

- **Your balance on Home** — the Home tab now shows what *you* still owe, as a short itemized invoice: a line per unpaid session, then the total. It replaces the rough per-person estimate and adds up every past session you weren't marked paid for, so it's your real running tab — not just one week's guess. The same balance shows on your Profile.
- **Pull to refresh** — pull down on any tab to refetch the latest sign-ups, cost, and announcements, so you're never looking at a stale screen.
- **Report a problem** — a "Report a problem" option in Profile lets anyone flag a bug or idea from inside the app; it's saved and emailed straight to the admin.
- **Bird stock reconciliation** *(admin)* — true up the shuttle count against a physical count in one step, and depleted tubes drop out of the session-create picker so they don't clutter the list.
- **Add to Home Screen** — BPM is now installable: save it from your browser and it opens full-screen like a real app (no browser chrome), with a shuttlecock icon. A one-time hint on Home and a Profile entry walk you through it on iPhone and Android. No service worker — it still needs a connection to open, same as before.
- **Past sessions and their receipts** *(admin)* — browse any past session's cost-per-person and re-copy or re-share its receipt, so "what did we pay in June?" doesn't mean digging through messages.
- **Payments summary header** *(admin)* — each session's payments view now leads with date · players · % paid · $/each and a Share button, so the state of the week's collection reads at a glance.
- **Owed audit** *(admin)* — cross-checks outstanding balances against session history, so a mismatch surfaces instead of quietly sitting in someone's running total.
- **Stats Summary, redesigned** — the Summary view leads with per-dimension tiles alongside the trend radar, instead of stacking separate cards down the page.
- **Equipment tab on Stats** — your racket and the recommendation beside it now have their own tab, alongside Summary and Game stats. They were built a while ago but had never actually appeared for anyone; this is the first build where you can see them. Tap the recommendation to find out why it was picked for you.

### Changed

- **Smoother loading** — every tab now loads through one shared skeleton, and cards fade in on the swap instead of popping in out of order.
- **Log a game any day** — the game-score logger is no longer tied to session day; record a result whenever you played.
- **Shuttles are one number now** *(admin)* — a session logs "tubes used × price per tube" instead of picking which batch each tube came from. The price fills in from your most recent purchase and you can override it for a one-off. Sessions logged the old multi-batch way still open correctly and flatten to the simpler shape the next time you save.
- **Bird inventory, slimmed** *(admin)* — brand cards show what you bought and the stock caption shows today's price per tube. Per-batch "X left" is gone: pooled tubes don't belong to one batch, so that number would have been misleading.
- **Command Center polish** *(admin)* — a pass over the admin home for clearer tiles, tighter spacing, and fewer taps to the things you touch every week.
- **Profile cost row** — the amount you owe now reads as the primary number with its context beneath, instead of the two competing for attention.
- **Racket picker: browse, don't type** — picking your racket is now brand tabs and tappable model rows (with the "4U · head-heavy · stiff" spec line to jog recognition) instead of a search box that needed you to remember the model name. Tapping selects; a separate Save button commits — so browsing can't accidentally overwrite your pick. Your current racket comes pre-selected on its brand tab.

### Fixed

- **The racket catalog was empty** — picking your racket showed no rackets at all, and the recommendation card had nothing to recommend, because the catalog was never loaded into the live database. It now fills itself, so both work.
- **Sign-ups can't overshoot the cap** — two people tapping "I'm in" at the same moment could push a session one or two players over its limit. Sign-ups now reconcile deterministically, so the cap holds.
- **Finalizing the bill is guarded** — you can't settle a session while sign-ups are still open (one more person joining would make the split wrong the instant you finalized), and if the cost changes after you've finalized, the app now says so instead of leaving a stale bill in place.
- **Owed amounts stop lying after an unsettle** — unsettling clears the frozen per-player figures instead of leaving last week's numbers on screen, and the Payments card reloads after settle/unsettle so what you see matches what you just did.
- **"0 of us" cost preview** — the per-person preview no longer divides by an empty roster before anyone has signed up.
- **The cost form totals every shuttle purchase** — it was summing only the batch it happened to be editing, understating the session's cost.
- **Receipts follow the session you're looking at** — an individual receipt opened from a past session showed the *active* session's numbers; it now uses the one on screen.
- **Unpaid sessions match on identity** — outstanding balances are matched by member identity rather than by name, so a rename or a near-duplicate name can't hide or double-count what's owed.
- **Bird inventory fails honestly** *(admin)* — a failed inventory read shows an error instead of a confident zero, stock can't go negative, and deleting a purchase a session still references is blocked with an in-sheet confirm rather than silently breaking that session's cost.
- **Stats measure one period, not three** — the streak window, the AI insight cache, and the partner card's default window each covered a slightly different span; they now agree.
- **Data numbers render in the right font** — costs, PINs, streaks, and other tabular numbers now use the intended monospace face everywhere (some were quietly falling back to the body font).
- **Light-mode polish** — subtle card tints and a few button hover colors now adapt correctly to light theme instead of showing washed-out or low-contrast hues.
- **No accidental zoom on the web app** — pinch and double-tap zoom are off, so the mobile layout stays put.
- **iOS admin polish** — the date/time pickers, receipt rendering, and the share-sign-up-link flow all behave correctly on iOS now.
- **Shared receipt image on iPhone** — the receipt image shared from a home-screen install arrived as a file Photos refused to open; share and download now hand over the same PNG.
- **Saving the cost image does something, or says why not** *(#238)* — on iPhone, tapping to save the receipt image could do nothing at all: no file, no error, no sign anything had happened. Sharing works as before; when a save isn't possible the app now tells you to press and hold the preview and choose "Save to Photos" instead of failing in silence. Cancelling the share sheet stays silent, because that isn't an error. The same fix covers the Share image button on the session set-up screen, which had been missed entirely.
- **Nav highlights Profile in Admin** — opening admin tools from Profile no longer lights up Home in the bottom bar.
- **Pull-to-refresh is less trigger-happy** — scrolling up at the top of a tab no longer fires a refresh you didn't ask for.
- **Add to Home Screen sheet** — the iPhone install walkthrough no longer overflows on small screens.
- **Stats works offline the way the rest of the app does** — the sheets that write data are disabled while you're offline (with the banner explaining why) instead of failing after you tap, and the last hardcoded English strings in Stats are translated.

### Security

- **PIN reset is member-scoped** — resetting a PIN is now bound to the member it belongs to, closing a gap where a reset wasn't tied to the specific account.

---

## v1.7 — Stable reaches full parity with `bpm-next` (2026-06-13)

This cut flips **every** remaining feature flag on, so stable and `bpm-next` are now feature-identical (only `NEXT_PUBLIC_ENV` differs, keeping the preview banner off on stable). Headline: the **skill-accuracy spine** and **Value-Hub Slice-0** go live for everyone, on top of the full app-code audit remediation, accessibility pass, and security hardening accumulated since v1.6.

### Added

- **Skill self-assessment** *(flag-gated `NEXT_PUBLIC_FLAG_SKILL_ASSESS`, now on for everyone)* — periodic anchor-card check-in across 14 skills, a then-vs-now trend radar, phase placement, and an AI "Your read" that folds in the assessment. *(now live)*
- **Value-Hub Slice-0** *(flag-gated `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`, now on for everyone)* — 48h game logger and partner-frequency Stats card. *(now live)*
  > **Correction (2026-08-16):** this entry originally also claimed "racket pick → recommendation card" shipped. It did not. The Stats tab parks its Equipment register whenever the skill-assessment spine is on (`SkillsTab.tsx` — `gearContent` is only passed when `SKILL_ASSESS` is off), and this same cut turned that spine on for everyone. So the racket picker and the recommendation card have never rendered on either deployment. The game logger and partner card are unaffected — they live in the Game register and did ship. This matters because the Value-Hub Slice-0 kill-criterion is written against rec-card engagement; see `ROADMAP.md`.
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
