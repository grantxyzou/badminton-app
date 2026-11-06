# Payments by forwarding: no script to paste

**Track:** admin cost-automation (North Star pillar 3), the same track as `docs/plans/payments.md`. This is a better door into the inbox that plan built; the matching, the ledger and the "Needs a look" queue are unchanged.
**Status:** intent
**Review on:** 2026-11-19 — has one real Interac email, forwarded by Gmail, passed Interac's DKIM check at the far end? Nothing past step 0 starts until it has.

## Problem

Grant, 2026-11-05, after reading what the Gmail script does: "Is there an easier way we can build? Ux easy for user."

Today an organiser who wants payments detected has to:

1. make a key in the app;
2. open script.google.com in the right Gmail, paste a 130-line file, and add two script properties;
3. run `install` and accept Google's "this app wants to read your Gmail" screen;
4. paste the file again whenever it changes. The 2026-11-05 "was this sent to the club?" check works only for copies re-pasted after that date.

Grant can do that. A second club's organiser mostly won't: the permission screen reads like a warning, and it only works for Gmail. The script is also the app's only daily clock (it calls `POST /api/payments/remind`), so payment reminders run only where it is installed.

## The idea

Tell the mailbox to forward Interac's emails to an address the app owns, instead of installing a courier in it. Every email service can forward, so there is no code, no Google permission screen and nothing to re-paste.

For an organiser, setup becomes:

1. **Copy the club's address** from the Payments card, e.g. `sixfeathers-7k2q9x@pay.motioncraft-bpm.com`.
2. **Add it as a forwarding address** in Gmail (Settings → Forwarding). Gmail sends a confirmation code to it. The app receives that email and shows the code on the card, so nobody goes looking for it.
3. **Add one filter:** mail from `notify@payments.interac.ca` → forward to that address. Gmail's filter screen cannot be pre-filled from a link; the card links to the Interac search, where "Create filter" is one click, and shows the two fields to fill.
4. **The card turns to "Connected ✓"** when the first Interac email arrives.

Outlook, iCloud and Yahoo have the same two steps under different names; the card shows each one's.

## Kill criterion

**Step 0 decides it.** If a real Interac email, auto-forwarded by Gmail, does not pass DKIM for `interac.ca` when the app checks it, auto-matching cannot work through forwarding: every payment would land in "Needs a look". Stop there and keep the script.

After launch: if, four weeks after a club switches, fewer of its e-transfers auto-match than under the script (the `payments.md` measure, 70%), forwarding is losing information the script had. Find what before a second club is moved.

## Non-goals

- Retiring the script. It keeps working, and a club can use either; dedupe by Interac's reference number already stops one email counting twice.
- Reading anyone's mailbox from the server. Mail is pushed to us; we never sign in to it. This is the same line `payments.md` holds.
- Sending email from the app. This is receive-only.
- Moving the app itself to `motioncraft-bpm.com`. That is its own plan. This only uses a subdomain of it, so it never has to move later.

## Decisions to make

These need Grant's call before step 1.

1. **Which domain.** Proposed: `pay.motioncraft-bpm.com`.
   - A subdomain gets its own mail (MX) record. The Workspace mail on `motioncraft-bpm.com` is not touched, like adding a separate mail slot for one flat without changing the building's main mailbox.
   - DNS for that domain is at Squarespace (the 2023 Google Domains sale), and Squarespace takes custom records on subdomains.
   - Building on `bpm.grantzou.com` instead would mean moving every club's forwarding again when the app moves.
2. **Which mail-receiving service.** Azure has no inbound email. The candidates, for a few dozen emails a month:

   | Service | What it would cost | Fit |
   |---|---|---|
   | Mailgun | Free plan, 1 inbound route ([help article](https://help.mailgun.com/hc/en-us/articles/203068914-What-does-the-Free-plan-offer)); Basic about $15/month | One catch-all route for the subdomain is all this needs. It can post the raw message, and it signs each post. **Recommended**, if the free plan still includes the route when we sign up. |
   | Amazon SES | About $0.10 per 1,000 emails, plus S3/SNS ([pricing](https://aws.amazon.com/ses/pricing/)) | The cheapest at volume, but a new AWS account and three services to wire for a handful of emails. |
   | Postmark | Inbound appears to need a paid plan, about $15–18/month (third-party sources disagree) | Good product, but paid for little use. |
   | Cloudflare Email Routing | Free | Needs the domain's DNS moved to Cloudflare, which means moving the Workspace records too. Not worth it for this. |

   Prices are from third-party pages and change. Read the provider's own page on the day of sign-up.
3. **Daily reminders without the script.** Proposed: the first visit of the day runs the daily job, the same pattern the members-first window uses (`releaseMembersFirst`).
   - "Visit" means any member or admin opening the app for that club.
   - A per-club stamp under the settings doc's etag makes sure only one visit runs it. The job is the reminder run and the ledger reconcile.
   - It runs after the response is sent (Next's `after()`), so nobody's page waits on it.
   - Reminders then arrive at "the first time anyone opens the app that day", not at 10 a.m. That seems fine for a nudge that comes three or seven days after settle. A GitHub Action or Azure timer was the alternative; it needs a deployment-wide secret and a list of clubs, which is what `paymentReminders.ts` already turned down.

## Steps

**0. The one-email test (needs Grant, about 10 minutes, no build).**

1. Make a Gmail filter forwarding one real Interac email to a second address he owns.
2. In that second inbox, use "Show original" → "Download original" and send me the `.eml` file.
3. I check Interac's DKIM signature on it offline. Plain auto-forwarding normally leaves the signature intact, but only a real email proves it.

The file contains a payment amount and a name, so it is read once and not kept or committed.

**1. The receiving route.** `POST /api/payments/inbound`, called by the mail service, never by a browser.

- **Proves it is the service:** verify the provider's signature (an HMAC with timestamp and token for Mailgun), refuse stale or replayed posts, and rate-limit first (rule 4).
- **Finds the club** from the address the email was sent to (the per-club token), never from anything in the email itself.
- **Checks Interac's DKIM itself** on the raw message, with an established library (`mailauth`, MIT). It does not take Gmail's or the mail service's word, because their verdicts describe the forwarding hop, not Interac's signature. Today's `isInteracAuthenticated` reads Gmail's header; the new route computes the same yes or no from the message and hands it to `ingestEmail` unchanged.
- **Knows who the email was for:** "addressed to the club" uses the forwarding Gmail's own address, which the app learns from Gmail's confirmation email in setup step 2. The club's pay-to address also counts, as today.
- **Treats the confirmation email as setup, not payment:** it is recognised by sender (`forwarding-noreply@google.com`), its code is stored for the card, and nothing else is.
- **Size limit:** the proxy refuses bodies over 256 KB (`MAX_BODY_BYTES`). An Interac email with its HTML may come close, so step 0's file sets the number, and this one route may get its own limit.
- **Keeps the existing rules:** the email body is never stored, and a refusal answers without saying why.

**2. The Payments card.**

- Shows the address with a Copy button, the confirmation code once it arrives, and the steps for Gmail, Outlook and iCloud.
- Shows "Connected ✓" after the first Interac email, or "Waiting for the first e-transfer".
- Offers "New address": it retires the old token, for a forwarding set up in the wrong mailbox.
- Admin screens stay English (`CLAUDE.md`).

**3. The daily job on first visit** (decision 3).

**4. Move BPM Core over, then the docs.**

1. Grant sets up forwarding next to the script and watches both for a week. Dedupe makes the overlap harmless.
2. He uninstalls the script.
3. The re-paste row in `docs/plans/audit-followups.md` is then closed.

## What it costs to run

- **Money:** nothing on Mailgun's free plan if it holds; otherwise about $15/month, or cents on SES.
- **Exposure:** one new public endpoint, gated by the provider's signature, and one DNS record.
- **New secrets:** the provider's signing key, as an App Setting.
- **Dependency:** one new library for DKIM checks.

## Shape

Filled in as it is built.

| Piece | File |
|---|---|
| Receiving route | `app/api/payments/inbound/route.ts` |
| DKIM check on a raw message | `lib/inboundDkim.ts` |
| Per-club address, token, confirmation code | `lib/paymentsInbox.ts` (fields on `PaymentsSettingsDoc`) |
| Daily job on first visit | `lib/dailyDuties.ts` |
| Card | `components/admin/` Payments card |
