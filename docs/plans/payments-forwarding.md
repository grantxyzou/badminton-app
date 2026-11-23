# Payments by forwarding: no script to paste

**Track:** admin cost-automation (North Star pillar 3), the same track as `docs/plans/payments.md`. This is a better door into the inbox that plan built; the matching, the ledger and the "Needs a look" queue are unchanged.
**Status:** intent
**Review on:** 2026-11-29 — has one real Interac email, forwarded by Gmail to a plus address, kept a `dkim=pass` for `interac.ca` in the receiving Gmail's own Authentication-Results? Nothing past step 0 starts until it has.

## Problem

Grant, 2026-11-05, after reading what the Gmail script does: "Is there an easier way we can build? Ux easy for user."

Grant, 2026-11-20: "I want to make the Gmail verify to check off paid name more consumer friendly so that people that are not technical can interact with UI to set that up."

### Today's flow (audit, 2026-11-22)

A member e-transfers the organiser's own address (the club's pay-to, `lib/payTo.ts`). Interac sends the money to the organiser's bank and a notice to that mailbox. `public/payments/apps-script.gs`, installed in that Gmail, searches Interac's mail every 5 minutes and posts each notice to `POST /api/payments/etransfer` with the club's key, Gmail's Authentication-Results, the To address and its own Gmail address. `ingestEmail` (`lib/paymentsInbox.ts`) parses it, runs `decideMatch` (`lib/etransferMatch.ts`), and either pays the lines or queues a review. Once a day the script also calls `POST /api/payments/remind`, which sends reminders and runs the ledger reconcile.

What the audit found, in the order an organiser hits it:

1. **Setup needs a technical person.** Create a key; on a computer, open script.google.com in the right Gmail; paste a 134-line file; add two script properties; run `install`; accept Google's "this app wants to read your Gmail" screen, which reads like a warning. Grant can do it. A second club's organiser mostly won't.
2. **Gmail only.** An organiser on Outlook, iCloud or Yahoo cannot use it.
3. **Updates need a re-paste, and nothing says a copy is old.** The "addressed to the club" check (2026-11-05) runs only in copies pasted after that date, so a security check can be silently missing.
4. **The script is the app's only daily clock.** A club without it gets no payment reminders and no daily ledger reconcile.
5. **A stopped script shows only after two weeks** ("No e-transfer email in two weeks"), so a dead setup and a quiet fortnight look the same.
6. **Each member's first transfer waits for one tap, by design.** Since F18 (#998, 2026-11-18) only a remembered alias auto-pays; a bank name equal to the roster name is `name_only`. Grant read it as "the email matching to who has paid stopped working" (2026-11-20). It is correct, and the card's sentence says what to do, but a fresh club will see it for every member once.

What is sound and carries over unchanged: the matching rules, dedupe by Interac's reference number, the addressed-to-club check, the ledger mirror, the hold, the member's Home balance and "I've sent it".

## Who owns what

Grant, 2026-11-22: "motioncraft-bpm is my sol prop. I am the organizer for BPM Core group. So people sends me money because I book the court and source the birds for them. For other clubs, the organizer expenses their own cost like court and birds. That is their out of pocket. Not mine."

- **Motioncraft-BPM is the platform.** It runs the app for every club and pays the platform's costs; under this plan that includes one Workspace mailbox.
- **Each club's organiser is a tenant.** Members pay the organiser back into the organiser's own bank. BPM Core is one tenant like any other; its money is Grant-the-organiser's, not Motioncraft's.
- **Forwarding moves copies of notices, never money.** The money's path does not change. What changes is that other clubs' Interac notices (a member's legal name and an amount) pass through a mailbox Motioncraft owns, which is why the mailbox is a pass-through (step 1) and the privacy policy says so (decision 4). Card payments already split this way: each club has its own Stripe connected account under MOTIONCRAFT-BPM.

## The idea

The organiser tells their mailbox to forward Interac's notices to an address the platform owns, instead of installing code in it. Every email service can forward, so there is no code, no Google permission screen and nothing to re-paste.

The address is a plus address on one Workspace mailbox Motioncraft already pays for: `pay+<club-tag>@motioncraft-bpm.com`, e.g. `pay+rainbow-k7q2@motioncraft-bpm.com`. Gmail delivers every `+tag` to the same inbox, and the random tag tells the app which club it is for.

| Address | Who uses it | What it carries |
|---|---|---|
| `example@name.com` (the organiser's own) | Members, when paying | The money, through Interac, and Interac's notice |
| `pay+rainbow-k7q2@motioncraft-bpm.com` | Only the organiser's forwarding filter, set up once | A copy of each notice. Never money. |

For an organiser, setup becomes four states of the Payments card:

1. **Start.** Copy the club's address; in Gmail, Settings → Forwarding → Add a forwarding address.
2. **Gmail's code arrives.** Gmail sends a confirmation code to the address; the app reads that email and shows the code on the card, so nobody goes looking for it.
3. **Add the filter.** From `notify@payments.interac.ca`, forward to the club's address. Gmail's filter screen cannot be pre-filled from a link, so the card links to the Interac search and shows the two fields. Outlook, iCloud and Yahoo get their own two steps under their own names.
4. **Connected ✓** after the first Interac email, with the 28-day "matched on their own" count the card already shows.

The member's side does not change at all.

## Kill criterion

**Step 0 decides it.** If a real Interac email, auto-forwarded by Gmail, does not keep a `dkim=pass` for `interac.ca` in the receiving Gmail's Authentication-Results, auto-matching cannot work through forwarding: every payment would land in "Needs a look". Stop there and keep the script.

After launch: if, four weeks after a club switches, fewer of its e-transfers auto-match than under the script (the `payments.md` measure, 70%), forwarding is losing information the script had. Find what before a second club is moved.

## Non-goals

- **Retiring the script now.** It keeps working, and a club can use either; dedupe by Interac's reference number stops one email counting twice.
- **Reading an organiser's or member's mailbox.** Mail is forwarded to us; we never sign in to anyone's mailbox. The app reads exactly one mailbox, the platform's own.
- **Keeping the emails.** The app records the payment and deletes the email. The text is already never stored (`payments.md`).
- **Sending email from the app.** This is receive-only.
- **Moving the app itself to `motioncraft-bpm.com`.** That is its own plan. The address only uses the domain, so it never has to move later.

## Decisions

- **2026-11-22 — Receive in Motioncraft's own Google Workspace, not Mailgun** (Grant: "I like the idea using what we are already paying OR staying in one ecosystem"). One mailbox, `pay@motioncraft-bpm.com`, read by a service account through the Gmail API. Against Mailgun: no new vendor holding clubs' payment notices and no DNS change, for about $7–8/month. Reading a mailbox in your OWN domain is internal, so it needs no Google app verification or paid security assessment; asking each organiser to "Connect Gmail" would need both, every year. The Claude API was asked about (2026-11-22) and does not fit: it reads text it is given but cannot receive email, and "is this really Interac?" has to be a signature check, not a judgement.
- **2026-11-22 — Pilot on an alias; a dedicated seat before a second club forwards** (Grant asked what a seat costs and how hard the later switch is). A new Workspace user is a paid seat; an alias is free. But the service account's permission is per USER, and Google cannot narrow it to one address, so on an alias the app could read all of Grant's own mail. That is acceptable while only BPM Core's notices, Grant's own club, arrive, and not once another club's members' names do. The switch is cheap because organisers forward to an ADDRESS, not a mailbox: remove the `pay` alias, create the `pay@` user, and the address, every club's filter and Gmail's forwarding confirmation all stay as they are. The app reads the mailbox named in one App Setting (`PLATFORM_MAILBOX`), so the app side is that setting, the delegation in the Admin console, and a fresh Gmail watch. A notice arriving in the minute between is retried by the sending server for hours.
- **2026-11-22 — The address is on `motioncraft-bpm.com`** (Grant). With Workspace that is a plus address on the main domain, not the `pay.` subdomain proposed earlier, so there is no DNS change at all.
- **2026-11-22 — Daily reminders and the reconcile run on the hourly tick, not the first app open** (revised the same day; Grant confirmed 2026-11-23: "yes, build the reminders on the hourly job"). Grant chose the first app open when the alternative was described as a new scheduled job needing its own secret and a list of clubs. That job already exists: `.github/workflows/tick.yml` calls `POST /api/cron/tick` every hour with `CRON_KEY`, and `lib/tick.ts` runs each registered job for every open club (`docs/plans/stringing-request-nudge.md`). Reminders become one more `TICK_JOBS` entry that acts once a day, at a fixed hour, whether or not anyone opens the app. The Gmail mailbox catch-up read and the watch renewal are one `DEPLOYMENT_TICK_JOBS` entry. Nothing new to build or to keep secret.
- **2026-11-22 — Trust Google's verdict on our own mailbox; no DKIM library.** Today's `isInteracAuthenticated` reads the FIRST `Authentication-Results`, which only `mx.google.com` writes. In the platform mailbox that header is written by OUR Workspace, so the same check applies unchanged to the raw message the Gmail API returns. The earlier plan added `mailauth` because a third-party relay's verdict describes the forwarding hop; that reason went with Mailgun. SPF is irrelevant after a forward; only Interac's DKIM signature matters, and step 0 is what proves it survives.

### Still Grant's

1. **The privacy-policy line**, in `app/legal/privacy`: payment notices an organiser forwards are processed to record who paid, then deleted. Grant's wording.

## Steps

**0. The one-email test (Grant, about 10 minutes, no build).**

1. In Gmail, forward one real Interac email to a second address he owns. If the `pay@` mailbox exists by then, forward it to `pay+test@motioncraft-bpm.com` instead, which also proves plus-addressing takes the forward.
2. In the receiving inbox: ⋮ → "Show original" → "Download original", and send the `.eml`.
3. I check that the top `Authentication-Results` carries `dkim=pass` for `interac.ca`, and run it through `isInteracAuthenticated`.

The file contains a payment amount and a name, so it is read once and not kept or committed.

**1. Motioncraft's side (Grant, once, with steps written out for him).**

- The address `pay@motioncraft-bpm.com`: an alias on Grant's own user for the pilot, its own user before a second club forwards (the pilot decision above).
- A Google Cloud project with the Gmail API on, and a service account with domain-wide delegation for the user that holds it, scope `gmail.modify` (read and delete, nothing else). Its key goes into an App Setting, never the repo.
- A Pub/Sub topic that Gmail notifies on new mail, with a push subscription to the app. Pub/Sub's free tier covers this volume many times over.
- A filter on `to:pay` that skips the inbox and marks read, so the notices never sit in front of whoever reads that mailbox, Grant during the pilot.

**2. The receiving route.** `POST /api/payments/inbound`, called by Pub/Sub, never by a browser.

- **Proves it is Google:** verifies the push's OIDC token (issuer, audience = this URL, the subscription's service account email), rate-limited first (rule 4).
- **Reads only what is new:** Gmail's history from the last stored `historyId`, then each new message's raw form.
- **Finds the club from the `+tag` in the address it was delivered to**, never from anything in the email body. An unknown tag is dropped.
- **Hands the message to `ingestEmail` unchanged**, with the first Authentication-Results, the original To, and the forwarding mailbox as `owner`, so `addressedElsewhere` keeps working.
- **Treats Gmail's forwarding confirmation as setup, not payment:** recognised by sender (`forwarding-noreply@google.com`); the code and the requesting address are stored for the card, and nothing else is.
- **Deletes each message** once its payment doc exists. A failure leaves the message in place, and the next run picks it up.
- **A missed push is caught within the hour:** the hourly tick and the Payments card both run the same history read, so a lost notification delays a payment, never loses it.
- **Renews Gmail's watch**, which expires after seven days, from the tick.
- **Keeps the existing rules:** the body is never stored, and a refusal answers without saying why.

**3. The Payments card** (`components/admin/CommandCenter/PaymentsInboxCard.tsx`).

- The four states above. The copy button, the confirmation code once it arrives, and per-provider steps for Gmail, Outlook, iCloud and Yahoo.
- "Connected ✓" after the first Interac email, or "Waiting for the first e-transfer".
- "New address": retires the old tag, for forwarding set up in the wrong mailbox.
- The first-payment-per-member review keeps its one tap ("Is this Jordan? Yes, remember"), with that sentence leading, since a new club meets it once per member (audit finding 6).
- Admin screens stay English (`.claude/rules/i18n.md`).

**4. Reminders and the reconcile on the hourly tick** (the reminders decision above). Built 2026-11-23 (`lib/paymentsDaily.ts`), ahead of forwarding because it needs none of it: `POST /api/payments/remind` is deleted, and the script no longer calls it.

**5. Move BPM Core over, then the docs.**

1. Grant sets up forwarding beside the script and watches both for a week. Dedupe makes the overlap harmless.
2. He uninstalls the script.
3. The re-paste row in `docs/plans/audit-followups.md` is then closed.

**6. The dedicated mailbox, before a second club forwards.** Create the `pay@` user, move the alias onto it, point `PLATFORM_MAILBOX` and the delegation at it, renew the watch. No organiser changes anything.

**7. Every club off the script.** Then `public/payments/apps-script.gs`, `POST /api/payments/etransfer` and `/remind` are deleted (replace in place, `CLAUDE.md`), and so is the last copy of the app's URL that lives outside the app.

## The connected workplan

This plan and `docs/plans/domain-move.md` run as one sequence. The order is what keeps each move cheap: an address on `motioncraft-bpm.com` from day one never moves, and a club on forwarding has no copy of the app's URL to edit.

| Phase | What | Plan |
|---|---|---|
| A | Step 0, then forwarding on the `pay@` alias, BPM Core only (steps 1–5) | this one |
| B | The dedicated `pay@` user before a second club (step 6) | this one |
| C | Every club off the script (step 7) | this one |
| D–G | The app moves to `motioncraft-bpm.com`: both hosts serve, then the new one is the address, then the old one points onward, then clean-up | `domain-move.md` |

## What it costs to run

- **Money:** nothing during the pilot (an alias is free); then one Workspace seat, about $7–8/month (USD), a Motioncraft platform cost, never a club's. Pub/Sub and the Gmail API are free at this volume.
- **Exposure:** one new public endpoint, gated by Google's signed token; a service account that can read and delete one mailbox: Grant's own during the pilot, which is why phase B comes before a second club.
- **New secrets:** the service account key and the Pub/Sub audience, as App Settings.
- **Dependency:** Google's API client for the Gmail read, or plain `fetch` against its REST API with a signed JWT.

## Shape

Filled in as it is built.

| Piece | File |
|---|---|
| Receiving route | `app/api/payments/inbound/route.ts` |
| Gmail read, watch and delete | `lib/platformMailbox.ts` |
| Per-club tag, confirmation code, forwarding mailbox | `lib/paymentsInbox.ts` (fields on `PaymentsSettingsDoc`) |
| Reminders, reconcile, mailbox catch-up and watch renewal on the tick | `lib/tick.ts` entries |
| Card | `components/admin/CommandCenter/PaymentsInboxCard.tsx` |

The flow as a page, with the audit and mockups of the four card states: https://claude.ai/artifact/McwMdh76R7ugqxuKbWfphU (private to Grant).
