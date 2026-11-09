# Profile reorganisation — hand-off spec

Intent: docs/plans/profile-reorganization.md

**Mock-up:** the "Profile reorganisation mock-up" Design canvas (Grant's, private): https://claude.ai/artifact/McqsPzJuDPWtVdArthhj7X. Every screen below is a board there; press Play to tap through. Where this spec and the mock-up disagree, this spec wins (the mock is a drawing in raw hex; the build uses tokens).

**Date:** 2026-11-09. **Status:** ready to build, with three open questions marked **Q1–Q3** (end of this file). Build order is at the end.

---

## 0. Ground rules for every screen here

These apply to all nine screens and are not repeated below.

| Rule | What it means here |
|---|---|
| Pages, not sheets | Every row that opens something opens a **page** in place of Profile: the `animate-slideInRight` page pattern, a back chevron that returns to Profile, registered in `lib/pageStack.ts` so the Android back button steps out first (same as `NicknamePage`). Grant, 2026-11-08: real-person flows "should be using a page not a sheet". Today's `RedeemGiftSheet`, `GiveGiftSheet` and `ReportProblemSheet` become pages. Confirmation dialogs (Log out? Delete?) stay sheets. |
| Tokens only | No raw px, hex or rgba at call sites (`spacing-canary`, ESLint token selectors). The mock's numbers map to the tokens in each table. |
| Cards | `.glass-card` (16px radius, field material on the Profile tab). Fill-only, no outer stroke (`.claude/rules/design-system.md`, "Containers are FILL-ONLY"). Lists inside cards use the existing `SettingsList` row; rows are separated by space or the existing row inset, never a hairline the list does not already draw. |
| Section labels | `ProfileEyebrow` (already in `components/ProfileTab.tsx`): uppercase, `--fs-2xs`, display face, `--text-muted`. |
| Numbers | Money and codes in `var(--font-mono)` (JetBrains Mono). Money goes through `fmtMoney` in `lib/fmt.ts`. |
| Loading | A skeleton the size of the card, from the first frame (`CardSkeleton` / `RevealSlot`); a refetch keeps its content. Never `null` while loading, never "Loading…". |
| Errors | A read that fails shows `ErrorState` ("Couldn't load — pull to refresh"), never a zero. Server answers 503 `read_failed`, never an empty 200. |
| Copy | Every string through `t()` in `messages/en.json` and `messages/zh-CN.json`. Screen-reader-only names go in the `a11y` group. Server error codes map to our own sentence; never print the server's words. |
| Tap targets | 44×44 minimum. Smaller drawn controls take the inset `::before` tap area. |
| Light and dark | Spec'd in light (the mock). Dark uses the same tokens; no extra work unless a row below says so. |
| Foldables | No new rule. Profile already lays out in the right pane on a two-pane screen. |

### Token map used throughout

| Mock value | Token | Used for |
|---|---|---|
| 4 / 8 / 12 / 16 / 20 / 24 px | `--space-1` / `--space-3` / `--space-4` / `--space-5` / `--space-6` / `--space-7` | gaps and padding |
| 22 px between sections | `--space-6` (snap 22 → 20) | page stack gap |
| 12 / 13 / 14 / 16 px text | `--fs-sm` / `--fs-base` / `--fs-md` / `--fs-lg` | helper / body / row emphasis / row label |
| 28 px page title | `.bpm-h1` | page headings |
| 34 px money | `--fs-count` | the one big figure on a page |
| 12 / 16 px radius | `--radius-lg` / `--radius-xl` | inner rows and buttons / cards |
| pill | `--radius-pill` | chips |
| green text / button | `--accent`, `.btn-primary` | the one primary action, active states |
| amber "owed" | `--accent-amber` | an amount owed; never red |
| muted text | `--text-muted` | helper lines, eyebrows |
| row press | `--press-bg` | pressed row flash |

---

## 1. Profile (the tab)

**Board:** "Proposed · Profile". **Replaces:** today's Profile list. **Who:** every signed-in member; rows marked *admin* or *gifter* are conditional.

### Layout (top to bottom)

1. **Header row**: "Profile" (`.bpm-h1`) left; the toggles right. Today: bell, language, theme. **Q1**: bell only, with Language and Appearance moved into Settings.
2. **Identity card**: one `.glass-card`, whole card is a button.
   - Avatar 52 px (`MemberAvatar`, size 52), `--space-4` gap.
   - Name (display face, `--fs-stat`), then the rank chip beside it (Organiser / Admin; none for a player), as today.
   - Second line `--fs-base`, `--text-muted`: "{club name} · Edit profile".
   - Trailing chevron. Tap → **Edit profile** (§2).
3. **CLUB**
   - *Current club*: `groups` icon, meta = club name, chevron → today's `GroupsPage` (switch / join / create).
   - *Admin* (admin only): `admin_panel_settings`, meta = live count "{n} need you" in accent (or "All clear", or "Couldn't check" muted), chevron → Admin tab. Same signals as today's row (`useAdminNeedsYou`).
4. **SETTINGS**
   - *Notifications*: bell icon, meta On/Off, → today's push settings.
   - *Language*, *Appearance*: **only if Q1 = yes**. Meta = current value.
   - *Ways to sign in*: lock icon, meta = summary ("PIN", "Google · Email"), accent when the server sets `nudge`. → **Ways to sign in** page (today's `SignInMethodsSheet` content as a page, also holding "Use a recovery code" and, while PINs last, "Change PIN"). Replaces the three rows How you sign in / Update PIN / Have a recovery code.
   - *Get the BPM app*: phone icon → today's install / move-to-app flow (`InstallSheet`). Hidden in the store app (`isNative()`).
5. **MONEY**
   - *Gift cards & credit*: card icon, meta = credit balance (`fmtMoney`, mono, `--text-muted`; "$0" when zero). → §3. Hidden while `NEXT_PUBLIC_FLAG_STORE_CREDIT` is off.
   - *Account balance*: coin icon, meta = "{amount} owed" in `--accent-amber` when owing, none when $0. → §4.
   - *Give a gift card* (**organiser or `canGift` only**, Grant 2026-11-09: "Gift card is only Organizer capability"; the mock shows it on the admin view, which is wrong). Gift icon → §5.
6. **HELP**
   - *What's new* → today's release notes.
   - *Report a problem* → §6 (page).
   - *Support* → §7.
7. **PRIVACY**
   - *Stats & privacy*, meta On/Off → today's screen.
   - *Privacy policy* → `/legal/privacy` (full navigation, as today).
8. **Version line**: "BPM v{version}", `--fs-sm`, `--text-muted`, centred.
9. **Log out**: its own `.glass-card` with one row. Logout icon and label in `--color-red`, **no chevron** (it acts at once). Tap → today's confirm, then `ProfileTab.handleLogout`.

**Delete my account** leaves this page; it lives at the bottom of Edit profile (§2).

### States

| Element | State | Behaviour |
|---|---|---|
| Identity card | pressed | `scale(.98)` (card press recipe) |
| Any row | pressed | `--press-bg` flash; a row needs its background on a class, not inline, or `:active` loses |
| Row meta (credit, owed, admin count) | loading | meta absent (row still shows and still opens) |
| Row meta | failed | credit/owed: meta absent; admin: "Couldn't check" muted (today's rule). Never "$0" off a failed read |
| Give a gift card | not organiser/gifter | row absent |
| MONEY group | store credit off and nothing owed | group shows Account balance only |

### Data

| Row | Source |
|---|---|
| Credit meta | `GET /api/credit` (balance in cents) |
| Owed meta | `GET /api/players/unpaid` (the same read Home's balance uses; one shared fetch through `sharedFetch`) |
| Gifter check | `GET /api/giftcards` → `canGift` |
| Admin count | `useAdminNeedsYou` |

### Accessibility

- Focus order: header toggles → identity card → each group's rows top to bottom → Log out.
- Identity card: `aria-label` = "{name}, {rank}, edit profile".
- Each group is a `<section>` with its eyebrow as `aria-labelledby`.
- Row meta is part of the accessible name ("Account balance, 39 dollars owed").

---

## 2. Edit profile

**Board:** "Proposed · Edit profile (tap the card)". **Opens from:** the identity card. **Replaces:** tapping the card for `AvatarSheet`, and the "Your name in the club" row.

### Layout

1. Back chevron + "Edit profile" (`.bpm-h1`).
2. **Current picture**: 112 px circle, centred (`MemberAvatar`, size 112, the full picture, not the head crop).
3. **Picker**: two labelled groups, each a 5-column grid of 52 px circles, `--space-4` gap. The labels "Yours" and "Birdies" are `--fs-sm`, weight 600, `--text-muted`.
   - **Yours**: *Your initial* (initial on its per-name colour), *My racket* (only when the member has a racket on their Equipment set-up).
   - **Birdies**: six logo shuttles, green, yellow, pink, blue, purple and orange.
   - Selected = a 3px `--accent` ring (`box-shadow`, so the circle keeps its size). This is the one ring the system allows, because the picture itself is the fill.
   - **Tap saves at once** (`PATCH /api/members/me { avatar }`), with no Save button. Optimistic: ring and big circle move immediately; on failure revert and show `.field-error` "Couldn't save your picture".
   - **No animation** on the pictures (Grant, 2026-11-09: "no more animate birds").
4. **{CLUB NAME}** card (eyebrow = club name):
   - *Display name*: value = roster name, chevron → today's `NicknamePage`.
   - *Account role*: value Player / Admin / Organiser, then a short bullet list of what that role can do (`--fs-base`, `--text-secondary`). Strings per rank: Player: Sign up, pay, ask for a restring. Admin: Run sessions and open sign-ups · Mark payments and settle the bill · Add, rename and remove members. Organiser: Admin's list + Give ranks and gift cards.
   - *Member since*: month and year of `Membership.joinedAt` (fallback `Member.createdAt`). Not tappable.
5. **CONTACT INFORMATION** card (**Q3**):
   - *Email*: the sign-in email if there is one (not tappable, "Used to sign in"), else "Add an email", chevron → today's add-email-and-password flow (`KeepAccountForm`).
6. **Delete my account**: its own card, one row; bin icon and label in `--color-red`, chevron (it opens a confirmation). Under it, `--fs-base` `--text-muted`: "Removes you from every club. Your games and payments stay in the club's records under "Former member"." → today's `DeleteAccountSheet` (a sheet: it is a confirmation).

### Pictures (assets)

| Picture | How it is made | Ground |
|---|---|---|
| My racket | The racket's own render, `public/rackets/head/<id>.webp` (the true livery from `lib/racketLivery.ts`), tilted 35°, soft shadow, cropped to the circle. **Do not thicken the frame or recolour**; the mock's first try did and looked wrong. Large circle uses the full head render; ≤ 48 px uses the avatar crop as today. | `racketGround()` from `lib/racketLook.ts` (light behind a dark frame, dark behind a light one) |
| Birdies | The app-icon shuttle (`public/brand/launch/shuttle.png` is the reference), redrawn clean at 512 px: white skirt, coloured rim and five spines, ridged collar, round cork, tilted 30°. One file per colour, pre-rendered (like the rackets), never drawn live. | A pale tint of the rim colour |
| Initial | Unchanged | Per-name colour (unchanged) |

Birdie rim colours (the mock's values, to be tokenised as a small data table beside `racketLook`, with the same `no-restricted-syntax` annotation the racket paint carries): green `#1fa64a`, yellow `#f0b400`, pink `#ec4f93`, blue `#2c6fe4`, purple `#7a49dc`, orange `#f26a14`.

### Data

- `Member.avatar` gains a second kind: `{ kind: 'birdie', colour: 'green' | 'yellow' | 'pink' | 'blue' | 'purple' | 'orange' }`. `lib/memberAvatar.ts`'s `parseAvatar` already keys on `kind`; add the second branch and an allowlist of colours. **Additive** (rollback reads it as unknown and shows the initial).
- `MemberAvatar` and `lib/useMemberAvatars.ts` render the new kind everywhere a name appears (roster, kudos, sign-up list). Nothing else needs to change.

### Accessibility

- Each group is `role="radiogroup"` with `aria-label` "Yours" / "Birdies"; each circle is `role="radio"`, `aria-checked`, with an `aria-label` like "Green birdie" or "My racket, Astrox 88D Pro".
- Arrow keys move within a group.
- On save, announce "Picture saved" (polite live region).

---

## 3. Gift cards & credit

**Board:** "Proposed · Gift cards & credit". **Replaces:** `RedeemGiftSheet`. **Who:** every member (store credit on).

1. **Credit card**: "Your credit" (`--fs-base` muted), the balance (`--fs-count`, mono, `--accent`), then one line: "Credit pays a whole session once its bill is settled."
2. **REDEEM A GIFT CARD** card: a code field (mono, auto-uppercase, accepts with or without dashes, `autocomplete="one-time-code"` off, `inputmode="text"`) and a full-width `.btn-primary` "Redeem", disabled until the field is non-empty.
   - Success: the field clears, the credit figure updates, and a top toast "Added {amount} to your credit".
   - `gift_not_found` (404) → `.field-error` "That code didn't work. Check it and try again." (one message for unknown, used and malformed: the server answers them alike on purpose).
   - 429 → "Let’s give it a rest for a bit, then try again." (the voice charter, `__tests__/voice-canary.test.ts`, bans "too many tries")
3. **HISTORY** card: one row per credit event, newest first: label ("Gift card · From {club}" / "Paid {session}"), date, signed amount (+ in `--accent`, − in `--text-secondary`). Source: `creditLedgerFor` through `GET /api/credit` (never the whole partition, per CLAUDE.md "A LISTED credit history is `creditLedgerFor`").
   - Empty: `EmptyState` "No credit yet. A gift card adds it here."

**Q2** (open): Home's balance card could also take the redeem field. This page is spec'd regardless; Home's entry would be a link to it, not a second field.

---

## 4. Account balance

**Board:** "Proposed · Account balance". **New page.** **Who:** every member. **Relationship to Home:** Home's balance card is the summary; this is the detailed view (Grant, 2026-11-09). Both read the same owed list, so they cannot disagree. Home's card gets a "See details" link here.

### Top card (one `.glass-card`)

1. Header row: left "You owe · {n} items" (`--fs-base` muted) over the total (`--fs-count`, mono, `--accent-amber`); right, a tinted box "CREDIT" (`--fs-xs`, uppercase) over the balance (mono, `--accent`), shown only when credit > 0.
2. One row per owed line, from `computeOwed` (`GET /api/players/unpaid`):
   - leading 36 px tinted square with an icon (shuttle for a session, racket for stringing)
   - title: session "Thu, Nov 5 session"; restring "{racket model} restring"
   - subtitle, short facts with dates:
     - session: "Settled {date} · {n} players · {k} days ago" (unsettled: "Estimate until the bill is settled")
     - restring: "Ready {date} · {string} at {tension} lb · pick up {day}"
     - the stringer's name never appears (roles doc)
   - trailing amount, mono.
3. Footer, two full-width buttons:
   - `.btn-primary` "Pay {amount} with credit": only when credit covers at least one **settled** line in full (`settledLines`, `payWithCredit`, oldest first). The amount is that line's. Absent otherwise.
   - secondary (outlined, `.btn-ghost` family) "Pay {total} by e-transfer": opens a small sheet with the club's pay-to address (`payTo` from the same read) and a copy button.
   - No helper paragraph under them (Grant asked for it removed).

### WHAT YOU'VE PAID card (the chart)

- Header: "Last 6 months" left, the 6-month total right (mono).
- Legend: one swatch and name per series, wrapping.
- A stacked bar per month, the last 6 calendar months:
  - bar width 22 px; plot height 150 px; 2 px gap between segments (`--space-05`)
  - only the top segment is rounded, 4 px (`--radius-xs` is 6; use 4 via an SVG `rx`, inline SVG as `DimensionBars` does)
  - baseline: a 1 px line in `--border-subtle`
  - no gridlines, no y-axis
- **Series, bottom → top** (one hue, the app's green, dark → light; Grant chose tonal over multi-hue):

  | Series | What counts | Colour |
  |---|---|---|
  | Sessions | `Player.paid` lines, by `paidAt` month | `#14532d` |
  | Stringing | `StringingJob.paidAt` | `#2fb35f` |
  | Other | guests' lines (`guestOf` = me), shuttle top-ups | `#9fdcb5` |

  **No gift cards**: only an organiser makes them; a player never pays for one. Tokenise the three greens as `--chart-green-1..3` in `globals.css` (light and dark values; dark steps validated against the dark surface with the dataviz validator).
- Interaction: each month column is a button. Tap selects it: soft background (`--press-bg`), the total appears above the bar, and month label weight 600. The latest month with any payment is selected on open.
- Breakdown box under the chart (tinted `--bg-surface`): month name and total, then a row per series present: swatch, label ("Sessions · 3 nights", "Stringing", "Guest · Jenny, Sep 18"), amount.
- "See every payment" link → a plain list page (date, what, how paid, amount). Not in the mock; same rows, no chart. **Not built in step 5** (the monthly read returns totals, not lines).
- Empty (no payments in 6 months): the card shows `EmptyState` "Nothing paid in the last 6 months." and no axes.
- Accessibility: the plot is `role="img"` with an `aria-label` listing every month's total; each column button has `aria-pressed` and a label "October: 59 dollars 50 (Sessions 31.50, Stringing 28)". The breakdown box is the table view the dataviz rules require.

### Data (new)

`GET /api/members/me/payments?months=6`, members-only (rule 13), rate-limited, group-scoped (`groupScope`). It returns `[{ month: 'YYYY-MM', sessions, stringing, other, nights, notes[] }]` in cents. Built from the **rows** (`Player.paid` / `paidAt` / `owedAmount`, `StringingJob.paidAt`), **not the ledger**, until the ledger reconcile has run clean (CLAUDE.md: rows stay the truth). Add it to the members-only coverage canary and a `group-*` sweep test.

---

## 5. Give a gift card

**Board:** "Proposed · Give a gift card (admin)". **Replaces:** `GiveGiftSheet`. **Who:** organiser or `canGift` (the route's `canGift` check is the gate; the row is hidden otherwise).

1. AMOUNT card:
   - chips $10 / $25 / $50: 44 px tall, `--radius-lg`, fill-only; the selected chip is an accent tint with accent text
   - "Note on the card (optional)" field, max 80 characters
   - `.btn-primary` "Make a {amount} gift card"
   - a line under it: "It's added to the club's books as money owed to whoever redeems it."
2. After `POST /api/giftcards` succeeds, the card is replaced by:
   - "BPM Core gift card · $25"
   - the code (mono, `--fs-stat`, letter-spaced)
   - "Works once. Whoever redeems it gets the credit. This is the only time the code is shown, so copy or share it now." (The server stores only the hash.)
   - Copy code and Share (`navigator.share`, or the native share; call `markExternalExcursion()` before it)
   - "Make another"
   - Leaving the page discards the code: confirm first, with "You haven't copied this code. Leave anyway?".
3. CARDS YOU GAVE card: a row per card from `GET /api/giftcards`:
   - "Redeemed {date}" or "Not redeemed yet", with "Given {date} · …{last four} · {note}". **Built without the name** (2026-11-09): the route never tells a gifter who redeemed a card, by design (`docs/plans/gift-card-ledger.md`, non-goals), and a card has no partial balance to show
   - the amount on the right
   - Empty: `EmptyState` "No cards yet."
- Errors: 403 → "Only organisers can make gift cards." 429 → rate-limit sentence.

---

## 6. Report a problem

**Board:** "Proposed · Report a problem". **Replaces:** `ReportProblemSheet` (a page now).

1. Intro line: "Something not working? Tell us what happened and we'll take a look."
2. Card:
   - "Pick one to start, then add what happened" (`--fs-sm` muted)
   - Chips (wrap, 34 px tall, `--radius-pill`, fill-only; the selected one is an accent tint with accent text). Tapping one fills the box with its starter sentence and tags the report with its `category`:

     | Chip | Starter text | `category` |
     |---|---|---|
     | Couldn't sign up | "I tried to sign up for this week's session and " | `signup` |
     | Amount looks wrong | "The amount I owe looks wrong. It shows $ but I expected $ because " | `money` |
     | Payment not showing | "I sent an e-transfer on [date] but it still shows as owing. " | `payment` |
     | Stringing status | "My racket's stringing status is wrong. It says  but " | `stringing` |
     | Slow or stuck | "The app was slow or stuck on the  screen. " | `performance` |
     | Something else | (clears) | `other` |

     Tapping a chip when the box already has the user's own text asks first: "Replace what you wrote?"
   - Textarea, 6 rows, max 2000 characters (`MAX_MESSAGE` in `app/api/report/route.ts`); a counter appears from 1800.
   - Helper line: "The page you were on is sent with it, so there's no need to describe where you were."
   - `.btn-primary` "Send report", disabled while empty.
- Server: `POST /api/report` gains an optional `category` (allowlisted, additive). The report keeps `url` (path only).
- Success: page replaced by a confirmation ("Thanks. We'll look at it soon.") and Done.

---

## 7. Support

**Board:** "Proposed · Support". **New page.**

1. HOW TO USE BPM: guide rows with a 36 px tinted icon, title and one-line subtitle, chevron:
   - Signing up for a session
   - Paying what you owe
   - Getting your racket strung
   - Your stats
   - The app and notifications
   - For organisers (organisers and admins only)
2. COMMON QUESTIONS: three short Q&A rows (not tappable).
3. GET IN TOUCH: Report a problem (→ §6), Email the operator (`mailto:` the support address).
4. A card with Privacy policy and Deleting your account (→ `/legal/privacy`, `/legal/delete-account`).

## 8. Guide page (template)

**Board:** "Proposed · Guide: Signing up for a session". One template for every guide.

1. Back → Support; breadcrumb "Support · Guides" (`--fs-md` muted).
2. Title (`.bpm-h1`), intro paragraph (`--fs-lg`, `--lh-normal`), "{n} min read".
3. Sections, each with an eyebrow:
   - numbered steps: 26 px accent-tint circle with the number, then title and body
   - plain cards for prose
4. **Screenshots** sit under the steps they illustrate: full card width, `--radius-xl`, soft shadow, with a caption below (`--fs-sm` muted).
   - **Screenshots must not leak data** (Grant, 2026-11-09). Take every screenshot from the offline mock store (`SEED_DEV_SCENARIO=fresh-thursday`: made-up players), never production.
   - Crop each one to the card being explained, so no address, date or other names show.
   - Every image carries alt text that says what it shows.
5. Tip callout: accent-tint fill, lightbulb icon, bold lead-in.
6. "Was this helpful? Yes / No": two pill buttons; each tap writes one `events` row (`kind: 'guide_feedback'`, guide id and answer; add the kind to the allowlist). Nothing else is stored.
7. RELATED: two or three guide rows.

- **Where guides live:** server-rendered pages under `/legal/help/<slug>`, beside `/legal/support` (public and indexable, readable before sign-in, linked from the store listings). The copy goes in the `legal` message namespace as arrays, like the other legal pages. Screenshots go in `public/help/` (or Blob Storage through `assetUrl()`), one per locale where the UI text differs.

---

## 9. Ways to sign in

**Board:** "Proposed · Ways to sign in". This is today's `SignInMethodsSheet` content, moved onto a page:

- the methods list
- "Add Apple / Google / email and password"
- "Use a recovery code" (today's `EnterCodeSheet` flow)
- "Change PIN" (shown while the member has a PIN; PIN sign-in is being phased out)

---

## Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Any page | open / back | slide in from the right / out | `--duration-normal` | `--ease-out-quart` |
| Row | press | `--press-bg` flash | `--duration-press` | — |
| Card / identity card | press | `scale(.98)` | `--duration-press` | — |
| Chip | press | `scale(.97)` | `--duration-press` | — |
| Avatar picker | select | ring and big picture swap instantly; the big picture fades in (`.motion-fade`) | `--duration-fast` | — |
| Chart bar | month change | none (the selection is a highlight, not a re-draw) | — | — |
| Credit figure | after redeem | `.motion-fade` on the new value | `--duration-fast` | — |

Reduced motion: page slides become the crossfade; fades stay (`.claude/rules/design-system.md`).

---

## Edge cases

- **Long names**: the identity card name truncates with ellipsis at one line; Display name wraps to two lines.
- **Chinese**: every label is in `zh-CN`. Rows wrap their label rather than truncating it, and meta values truncate first.
- **No club** (removed member): Profile still renders. CLUB shows "Join or create a club" and MONEY is hidden.
- **Admin cookie lapsed** but role admin: the Admin row still opens Admin, which shows `AdminSignInCard` (existing rule).
- **Store app**: Get the BPM app is hidden. The racket picture, birdies and initial behave identically.
- **Slow connection**: pages open at once with skeletons in each card's place. Actions disable while their request is in flight, and the button shows its own pending state (label kept, dimmed).
- **Offline**: every mutating button is disabled through `useOnline()`, and the app-wide banner explains why.

---

## Open questions (Grant)

1. **Q1** Move Language and Appearance from the header into Settings (bell stays in the header)?
2. **Q2** Redeem a gift card on Home's balance card too (as a link to §3)?
3. **Q3** Keep the email typed at the join step as a contact email on Edit profile? It would need a privacy-policy line.

## Build order (one PR each)

1. **Edit profile page**: the card opens it; Delete moves into it; "Your name in the club" row goes. Avatar picker with Yours (initial, racket) only.
2. **Birdie avatars**: the `Member.avatar` second kind, nine pre-rendered files plus a render script, picker group.
3. **Ways to sign in** page; fold three rows into one.
4. **MONEY**: Gift cards & credit page (from `RedeemGiftSheet`), Give a gift card page (from `GiveGiftSheet`, organiser/gifter only).
5. **Account balance page and the payments chart**: the new read, the chart, "See details" on Home. **Built 2026-11-09**, with three things left for later: the "See every payment" list page, a session line's player count, and a restring line's string, tension and pick-up day (the balance read carries none of them; adding them is a change to `GET /api/players/unpaid`, not to this page).
6. **Report a problem page** with prefills (`category` on the report).
7. **Support page and guides** (`/legal/help`), screenshots from the mock store.
8. **Header and Settings** once Q1 is answered.
