# Members only: a signed-out visitor sees nothing but "Sign up / Log in"

**Track:** Store launch — a stranger who installs the app must not see a club they are not in, and multi-group readiness depends on the same boundary.
**Status:** in-flight
**Review on:** 2026-10-15 — has the flag been flipped, and did any regular get locked out on a sign-up day?

## Problem

Grant, 2026-09-13:

> People shouldn't be allowed to sign up when they don't have an account. When first lands: if logged in then all is good, they can sign up and check everything in the app. If user is not logged in, no information about the group should be shown. Like a normal app. It's asking them to sign up, sign in.

What a stranger could read without signing in, as measured in code that day:

- this week's date, time, location and cost (`GET /api/session`);
- the announcement (also serialized into every page load by `app/page.tsx`);
- the full roster, **including who has paid and what they owe**, and each player's failed PIN-recovery events (`GET /api/players`);
- every member's name (`GET /api/members`), and whether a given name has an account and a PIN (`GET /api/members/me?name=`).

And anyone could create an account with email, Google or Apple. With the multi-group flag off, an account is BPM access — so hiding the UI alone would have protected nothing.

## Kill criterion

A sign-up day on which a regular cannot get in and no admin is reachable to approve them. If that happens once after the flip, turn the flag back off and fix the path before trying again.

## Non-goals

- Turning on multi-group. This works with `NEXT_PUBLIC_FLAG_MULTI_GROUP` off.
- The OAuth F3/F4/F13 hole from the 2026-09-11 security scan. Separate, and still Grant's decision.
- Hiding the link preview. `app/opengraph-image.tsx` keeps showing session details (decision 4).
- Changing how admins log in.

## Decisions

1. **New accounts are invite link or code only** (Grant). Beat: "admin approves after sign-up" and "anyone who signs up gets in". The last protects nothing; the first leaves a stranger holding an account. The invite machinery already existed in `lib/invites.ts`, dark behind multi-group.
2. **Regulars: ship dark, warn first, then "I play here already" → an admin approves** (Grant). Beat: admins bulk-issuing codes (a lot of messaging) and letting names claim accounts for a window (anyone who knows a name — and names are public today — could take the account).
3. **Welcome screen is two buttons**, Sign up and Log in (Grant; the Wealthsimple pattern). Beat: Airbnb's single "log in or sign up" sheet.
4. **Link previews keep session details** (Grant). The share card is the one sanctioned public surface.
5. **Everything is behind `NEXT_PUBLIC_FLAG_MEMBERS_ONLY`, read server-side.** A client flag cannot protect a route, and the flip has to wait until the list of members with no way to sign in is short.
6. **`app/page.tsx` server-renders nothing club-related while the flag is on.** It had been reading the announcement for every visitor and passing it to `HomeShell` as a prop, which serializes it into the HTML — so gating the API route alone left it readable with `curl`. Caught by the review bot on #395. Part 3 restores the server render for signed-in members once the page itself knows who is signed in.
7. **The gate re-reads the Member** (`requireGroupMember`) rather than trusting the cookie's signature alone. A removed member's 30-day cookie must stop working at once. One point read per request.

## Shape

| Piece | File |
| --- | --- |
| The flag | `lib/flags.ts` |
| The gate | `requireMember` in `lib/auth.ts` |
| Coverage canary | `__tests__/members-only-coverage.test.ts` |
| Smoke test's Cosmos proof | `scripts/smoke-prod.mjs` → `GET /api/releases` |
