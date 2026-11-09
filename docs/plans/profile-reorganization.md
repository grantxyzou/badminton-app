# Profile, reorganised: you, your club, how you get in, this phone, help

**Track:** onboarding and retention (the door link, `docs/plans/door-link.md`, sends new people to Profile to keep their account and set their name).
**Status:** in-flight (spec handed off 2026-11-09)
**Review on:** 2026-11-22 — has Grant picked answers to the three open questions below? If not, build only step 1.

## Problem

Grant, 2026-11-08: "think about how profile page should be reorganized if we treat it like its a place for user to add information, system setting, and etc".

Profile today (signed in, an admin, 430 wide):

| Group | Rows |
|---|---|
| (card) | picture, name, rank chip, "Member since" |
| ADMIN | Admin tools |
| ACCOUNT | Your name in the club · Your groups · How you sign in · Update PIN · Have a recovery code? · Redeem a gift card · (Give a gift card) |
| PRIVACY | Stats & privacy · Privacy policy |
| APP | Notifications · Add to Home Screen / Move to the app |
| HELP | What's new · Report a problem |
| (footer) | Log out · Delete my account |

What is wrong with it:

- **ACCOUNT holds four different things**: who you are here (name), which club you are in, how you sign in (three rows: methods, PIN, recovery code) and money (gift cards). Six rows, one heading.
- **Information about you has no home.** The picture is changed by tapping the card, the name in a row below it, and the door's email is nowhere. A person asked to "add information" has three places to look.
- **Three rows are one job.** "How you sign in", "Update PIN" and "Have a recovery code?" all answer "how do I get back in"; PIN sign-in is being phased out (Grant, 2026-11-05).
- **Settings for this phone are split.** Notifications is a row; language and theme are the two icons in the header.

## What other apps do (Mobbin, 2026-11-08)

- **The header card opens your profile.** [Cal AI](https://mobbin.com/screens/0159c221-bad3-431b-a16f-a9dca51ff8c9) puts the person's card first with a chevron, then grouped lists (Account, Goals & Tracking). [theScore](https://mobbin.com/screens/c700534e-e06f-494f-a102-3c08f24d6dc8) does the same with "Edit Profile" as the first row.
- **About you is one page, split by who sees it.** [Fitbit's "About you"](https://mobbin.com/screens/2acfea82-98ec-40f4-96b5-7be6e396d6a9) groups the social profile (display name, location, bio) above "Your account" (created, ID). [komoot](https://mobbin.com/screens/1da9f534-70a3-42ca-bf9e-22c254fa8ed6) labels the halves "Public information" and "Private information".
- **A name you go by is one question.** [Cash App's "What name do you prefer to go by?"](https://mobbin.com/screens/0c61b079-3b79-4ead-bda6-f84f7555689e) and [Equinox+'s display name](https://mobbin.com/screens/10a6c51f-9f43-4d9e-916c-2ba6c1d289e1) each say where the name shows. Our new "Your name" page follows them.
- **Settings name their state.** [Strava's Preferences](https://mobbin.com/screens/dd42e3e8-9855-400a-9af6-8338464e753e) shows "Appearance", "Units: Metric" as rows with the current value on the right, and Privacy Controls is its own page.

## Proposal

Order by how often and by whom: the person first, then their club, then getting in, then this phone, then help.

1. **The card is "Your profile".** Tap it (a chevron says so) to open one page: picture, the name the club calls you, email (contact only), member since. Two halves, as komoot does: **"What the club sees"** (picture, name) and **"Only you"** (email, member since). This replaces "Your name in the club" in the list.
2. **CLUB.** Your clubs (with the current one as its value) · Admin tools (admins, with the live count) · Give a gift card (gifters). Admin stops being its own heading; it is a club job.
3. **SIGNING IN.** One row, "How you sign in" (Apple / Google / email / PIN as its value), whose page also holds "Use a recovery code" and, while PINs last, "Change PIN". Three rows become one.
4. **MONEY.** Gift cards & credit (redeem, and the credit balance) — or move redeeming onto Home's balance card, where credit already shows. *(open question 2)*
5. **THIS PHONE.** Notifications (On/Off) · Language (English / 中文) · Appearance (Light / Dark / System) · Add to Home Screen or Move to the app. *(open question 1: whether the header icons go)*
6. **PRIVACY.** Stats & privacy · Privacy policy.
7. **HELP.** What's new · Report a problem · Support.
8. **Footer.** Log out · Delete my account, as today.

A player who is not an admin or gifter sees: card, CLUB (1 row), SIGNING IN (1), MONEY (1), THIS PHONE (2–4), PRIVACY (2), HELP (3). Today they see 12 rows under 4 headings; this is 10–13 rows under 6 headings, each heading one question.

## Open questions for Grant

1. **Language and theme: move them from the header into "This phone"?** The header keeps only the bell. Fewer icons on every screen, but switching language becomes two taps.
2. **Redeem a gift card: Profile or Home's balance card?** Home already shows the credit, so redeeming beside it is where the money is.
3. **Email on "Your profile": show the sign-in email only, or let people add a contact email too?** The door asks for one (for the account step); keeping it would need a field and a privacy-policy line.

## Kill criterion

- People stop finding something they used: a "where is X?" from a member after the move, for any row that moved.
- The page gets longer for a player than today's 12 rows.

## Non-goals

- No new settings. Every row above exists today except "Your profile" (which gathers existing ones).
- No admin settings on Profile; they stay in Admin tools.

## Steps

1. "Your profile" page from the card: picture and name together (moves "Your name in the club" off the list). No question blocks it.
2. SIGNING IN folded to one row (PIN and recovery code inside "How you sign in").
3. CLUB group (Your clubs, Admin tools, Give a gift card).
4. THIS PHONE and MONEY, once questions 1 and 2 are answered.

## Decisions (mock-up review, 2026-11-09)

The mock-up was reviewed in comments on Grant's Design canvas; the hand-off spec is `docs/superpowers/specs/2026-11-09-profile-reorg-design.md`. What it settled:

- **Every flow behind a row is a page, not a sheet** (Grant, 2026-11-08). Redeem, Give a gift card and Report a problem move off their sheets.
- **Delete my account moves into Edit profile**; Profile ends with Log out as a red list row, no chevron.
- **MONEY is its own group** on Profile: Gift cards & credit, Account balance (the detailed view of Home's card, same data), Give a gift card.
- **Give a gift card is an organiser's (or gifter's) job only**, never a plain admin's, and a player's payment chart has no gift-card series.
- **Avatars: the member's own racket, drawn true to its livery, plus six logo-shuttle "birdies"** (Grant: "1, 2 is fine"; "I like my logo icon more … refine but not realistic"; "no more animate birds"). Cartoon, realistic-feather and earned/locked variants were tried and dropped.
- **The payments chart is one hue** (the app's green, dark → light); multi-hue palettes were rejected.
- **Help gets guides** with screenshots that must not leak data: taken from the offline test club, cropped to the card.
- **Report a problem gets tap-to-start prefills**, each tagging the report with a category.
