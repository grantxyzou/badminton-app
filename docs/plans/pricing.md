# Pricing and earning — a decision record, not a work item

**Track:** value-hub Decision D (`docs/plans/value-hub-slice-0.md`), the one
earning path the ROADMAP lock already names. Billing, a marketing site and
payments processing stay Non-Goals there, so this file records the options and
their constraints and starts nothing; the first line of code under it would be
a deliberate lock edit.
**Status:** intent
**Review on:** 2026-12-02 — has any club other than BPM and the demo club held a second session? If none, delete this file: the multi-group kill criterion fired first and there is nobody to price for.

## Problem

Grant, 2026-10-07, choosing between finishing the native app and finishing
multi-group: "when should I have it live on public store so I can start looking
into pricing model or earning methods, or multigroup first so public can use my
app then earning."

Nobody outside BPM has asked to pay for anything. The app has one club of 72
members, run for free by its organiser, and the store listing (live since
2026-10-07) currently leads a stranger to an invite-code prompt for a club they
are not in. Pricing today would be a menu written before the restaurant has a
customer; what the first outside clubs ask for is the only signal that can pick
a model. This file exists so that signal has somewhere to land.

## Kill criterion

- No outside club has held a second session by the review date. Then the
  question is moot and this file goes.
- The first dollar of any model would have to come through Apple's in-app
  purchase. A paid DIGITAL feature on iOS must use IAP and gives up 15–30% of
  it; if the only workable model is that one, the margin on a club-sized price
  is not worth the support load it brings.
- The model needs the legal copy to say something Grant is not prepared to be
  (a company, a data controller for strangers' clubs on commercial terms). The
  "one group, run by an individual, free" claims are already on the multi-group
  Phase 5 gate; pricing cannot be decided before they are.

## Non-goals

- Payments processing, a billing plane, subscriptions code, a marketing site —
  the ROADMAP lock, unchanged.
- Charging BPM's own members for anything they have today.
- Choosing a model in this file. It is a table of constraints until the review
  date answers yes.

## Decisions

None made. The options as they stand, with what each would cost to pick:

| Option | What it is | What it needs first | Where the store cut lands |
|---|---|---|---|
| **A. Affiliate links** | Retailer links on the racket and string recommendations, tagged | Decision D's own gate: three months of recommendation engagement data; disclosure on every card (Competition Bureau); the catalog's `sources[].affiliateTag` field is already there and `null` | None — it is a link out |
| **B. The stringing shop** | Already live: jobs, pricing, store credit and gift cards shipped 2026-10-06 (`docs/plans/payments.md`) | Nothing; it is a physical service paid by e-transfer, which Apple's rules leave alone | None — physical goods and services are outside IAP |
| **C. A per-club tier** | Clubs beyond some size or feature set pay | A lock edit (billing is a Non-Goal); IAP on iOS for any digital feature; GST/HST registration once revenue crosses the small-supplier threshold; the legal copy rewritten from "an individual" | 15–30% on iOS, Google's equivalent on Android |

Two facts every option shares, both arriving the day the multi-group flag
flips and before any revenue: Grant becomes the data controller for other
clubs' rosters and balances under PIPEDA, and he is the only support desk.

## Shape

Nothing to build until the review date answers yes.
