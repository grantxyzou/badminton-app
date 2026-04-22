# SaaS Productization Findings — BPM Badminton

> **Date:** April 18, 2026
> **Method:** Strategic analysis grounded in codebase audit + market scan
> **Status:** Internal strategy memo — decision artifact, not a product announcement

---

## 1. Executive Summary

BPM Badminton is a single-tenant web app built for one Chinese-Canadian recreational badminton group. It is unusually well-factored for its size: 23k LOC, 245 tests, date-keyed session pointer architecture, bilingual i18n, a 7-dimension skill matrix, AI-assisted announcements. The primitives it solves — invite-list gating, waitlist, soft delete, cost splitting with partial-tube granularity, payment reconciliation, session archival — are shared across casual recreational sports coordination in general, not just badminton.

The productization question is whether to multi-tenant the codebase and sell access to other organizers (club captains, rec-league coordinators, paddle-sport meetup hosts) as a lightweight, mobile-first, bilingual alternative to WhatsApp-plus-spreadsheet or the heavyweight incumbents (SportsEngine, TeamSnap, Spond).

**Recommendation:** Pursue as a staged, in-place multi-tenant migration with BPM as tenant #1 — but only after pilot validation with 3+ committed organizers and honest acknowledgement that this doubles the maintenance surface. The tech lift is tractable (see §7, §11); the economic and go-to-market risk is meaningfully higher than the engineering risk.

### Known limitations of this analysis

Readers (including future-me) should treat these as caveats, not conclusions:

- **Pricing in §3 and §5 is anchored, not validated.** The $10–15/month Persona A figure is inferred from Meetup/TeamSnap price anchors, not from the 10+ willingness-to-pay conversations §10 requires. Treat it as a hypothesis until those conversations happen.
- **Solo-maintainer bandwidth is under-weighted in §9.** Listed as "Medium" severity; arguably the highest-severity risk on the list, because it's the only one you cannot buy your way out of. Every other risk has a technical or financial mitigation; this one ends 12-month experiments.
- **The 4–6 week estimate in §11 assumes focused dev time.** For a product-designer-learning-to-code maintainer on evenings-and-weekends pace, realistic range is closer to 3–6 months.
- **Open question #1 — "does the maintainer want to run a SaaS?" — is unanswered.** Every §7 item is speculative until it lands.

---

## 2. The Opportunity

Casual recreational sports groups are underserved by existing software. WhatsApp group chats plus shared spreadsheets are the modal solution; dedicated tools (SportsEngine, TeamSnap) are built for leagues with referees, standings, and league fees, not 12 friends splitting court cost.

BPM's architecture already encodes the primitives this audience needs:

- **Invite-list gating** (`session.approvedNames`) solves the "randos crash the group" problem that open signup tools create
- **Waitlist with admin-promote** (capacity-checked) matches how casual groups actually run overflow
- **Soft delete + restore** matches the "sorry I'm back in" / "actually no I can't" reality of friend-group attendance
- **Bird-usage multi-source tracking** with 0.5-tube increments is a specific case of a general pattern: *consumable cost split across a session*, applicable to any group with shared equipment (climbing ropes, yoga mats, rental gear)
- **Cost per person derived from per-court + consumable + participant-count** is the cost-split primitive, minus the badminton labels
- **E-transfer alias mapping** is the "real name vs payment name" primitive, which every cash-collecting group encounters
- **ACE skills matrix** (7 dimensions × 6 levels) happens to be badminton-authored, but the data shape is sport-agnostic at the storage layer

**TAM sketch (not a forecast — a size-check):** Canada alone has hundreds of municipal badminton clubs and recurring drop-in groups, thousands of paddle-sport meetups, uncounted rec volleyball nights and climbing meetups. If even 0.1% of North American casual-sports organizers paid $10/month, that's five-figure ARR at low infra cost. The ceiling is modest by SaaS standards. The floor — enough MRR to cover Cosmos + App Service + Stripe fees and fund continued development — is plausibly reachable with 10–30 paying organizers.

> The product thesis is not "disrupt SportsEngine." It is "be the WhatsApp-replacement for the friend group treasurer."

---

## 3. Target ICP & Buyer Personas

These are the *paying buyer* personas — the person who creates the account and hands their credit card over. Distinct from the 8 *player* personas in `user-research-simulation.md`, which describe end users.

### Persona A — "The Club Captain"

| | |
|---|---|
| **Background** | 30s–50s, organizes weekly drop-in for 15–30 players at a rented gym |
| **Current stack** | WhatsApp broadcast + Google Sheet roster + Venmo/e-transfer |
| **Primary pain** | Chasing RSVPs every week, chasing payments every week, no visibility into skill distribution |
| **Willingness to pay** | $10–15/month out of pocket, or $1/member collected as part of session fee |
| **Adoption trigger** | A friend (BPM-style advocate) shows them the app; they see the invite-list + waitlist flow and recognize the problem |
| **Churn risk** | Summer break / venue loss; app only has value when sessions are running |

### Persona B — "The Rec-League Coordinator"

| | |
|---|---|
| **Background** | Volunteer or paid part-time for a municipal/community league, 50–200 members |
| **Current stack** | Mailchimp + SportsEngine-lite + paper rosters |
| **Primary pain** | SportsEngine is overkill and expensive; needs something between "group chat" and "league management platform" |
| **Willingness to pay** | $30–75/month on a community-org budget, needs invoice + receipt |
| **Adoption trigger** | SportsEngine renewal quote; someone on the board demos the alternative |
| **Churn risk** | Season-based (outdoor leagues go quiet in winter) |

### Persona C — "The Paddle-Sport Meetup Host"

| | |
|---|---|
| **Background** | Retired or semi-retired organizer, runs 2–4 drop-in sessions per week at public courts or a rented facility |
| **Current stack** | Meetup.com (paid) + Venmo + manual reminders |
| **Primary pain** | Meetup attracts too many no-shows; wants to build a regular community with invite gating |
| **Willingness to pay** | $15–25/month — Meetup organizer accounts already cost similar, so price anchor exists |
| **Adoption trigger** | Meetup subscription renewal, or a no-show incident |
| **Churn risk** | Fragmentation — paddle-sport players migrate between Meetup, Facebook groups, Strava clubs |

### Persona D — "The Corporate Wellness Organizer"

| | |
|---|---|
| **Background** | HR or benefits coordinator organizing optional team sports (volleyball nights, softball) for a 100–500-person company |
| **Current stack** | Slack channel + company intranet + petty cash |
| **Primary pain** | Low turnout visibility, no way to confirm attendance without pestering coworkers on Slack |
| **Willingness to pay** | Expensed. $50–150/month is unremarkable if invoice is clean |
| **Adoption trigger** | Low-turnout incident, request from execs to "track engagement" |
| **Churn risk** | Personnel change on the HR side; unless the product is sticky with end-users, champion departure kills the account |

**Primary ICP for v1:** Persona A (Club Captain). Same shape as BPM's actual organizer, lowest procurement friction, lowest feature-expectation ceiling. Personas B–D are expansion targets.

---

## 4. Competitive Landscape

| Product | Position | Strengths | Weaknesses for casual-sports ICP |
|---|---|---|---|
| **SportsEngine** | League management | Full roster, scheduling, payments, registration | Heavy, per-league pricing, sales-led, complex onboarding |
| **TeamSnap** | Team communication | Roster + schedule + chat; widely known | Per-team pricing gets expensive for multi-team orgs; weak for drop-in formats |
| **Heja** | Team messaging app | Free, clean UX, mobile-first | No payment split, no invite gating, team-not-drop-in oriented |
| **Spond** | Norwegian team app, expanding | Free core, polished mobile, payments in EU | Payment rails US/Canada-limited; drop-in UX awkward |
| **Meetup** | Public interest groups | Huge discovery pool, paid organizer tier | Public-by-default conflicts with invite-list ethos; no cost-split primitives |
| **WhatsApp + Spreadsheet** | The actual incumbent | Free, zero onboarding, universal | No structured state — every week is re-announced manually; payment chasing is the killer |

**Where BPM's product sits:** lighter than SportsEngine/TeamSnap, more structured than Heja, more private than Meetup, replaces the spreadsheet in the WhatsApp-plus-spreadsheet pair without replacing the chat. Bilingual by default — a defensible niche for Chinese-diaspora and other non-English-primary communities that the incumbents under-serve.

> The real competitor is the spreadsheet. The real win is saving the organizer four hours of admin a week.

---

## 5. Pricing Model Options

| Shape | Example | Pros | Cons |
|---|---|---|---|
| **Freemium, feature-gated** | Free: 1 session/week, up to 12 players. Paid: unlimited sessions, Skills tab, AI features, release notes, CSV export | Zero-friction trial; BPM-shape fits in the free tier (good PR / advocacy) | Revenue ceiling limited by how aggressively you gate; gating the wrong feature kills trials |
| **Flat per-club** | $10/month all-in, unlimited players and sessions | Simple pricing page, predictable margin, aligns with "friend group treasurer" mental model | Leaves money on the table at Persona D; hard to upsell |
| **Per active player** | $0.50/month per player who signed up for a session in the last 30 days | Scales with value delivered; natural expansion revenue | Billing complexity; organizers feel nickel-and-dimed; inflates churn noise |
| **Per active session** | $2/session, prepaid in packs or billed monthly | Aligns cost to usage; summer breaks = no charge | Too tactical; hard to forecast as a buyer |
| **Tiered (freemium + flat Pro + flat Team)** | Free (1 session/wk) / Pro $15/mo / Team $50/mo (multi-session, branding, priority support) | Covers all four personas; classic SaaS shape | More UI work; requires billing gating at many surfaces |

**Recommended starting shape:** **Freemium → Flat Pro at $15/month**. Single paid tier until ten paying organizers exist, then split Pro into Pro/Team when expansion signals emerge. Avoid per-seat pricing at launch — the ICP is allergic to it (they are collecting cash from friends, not running a business). Per-seat can arrive later as a Team-tier option for Persona B/D.

---

## 6. Product Shape for SaaS

What generalizes cleanly:

- Session lifecycle (create, advance, archive)
- Waitlist, soft delete, invite gating
- Cost per court + per-person derivation
- Announcements (AI polish is a sellable premium feature)
- Payment status tracking with e-transfer alias map (alias becomes "payment handle" more generally)
- Skills matrix (7 dimensions × 6 levels) — the *framework* generalizes; the *content* does not

What is badminton-specific and needs a decision:

- **Bird tracking** (`session.birdUsages`, 0.5-tube increments). Rename to "equipment" or "consumables" and keep the UI, or hide it behind a sport-type flag. Renaming is the right answer — the data model already handles multi-source and partial units (`lib/birdUsages.ts`); only the labels are badminton.
- **ACE Skills Matrix naming** (`lib/skills-data.ts`). The rubric is badminton-authored (categories like Serve, Shot Accuracy, Footwork). Other sports need their own rubric. Options: (a) keep ACE as the badminton default, ship blank-rubric mode for other sports; (b) let tenant upload a rubric definition JSON; (c) punt on Skills entirely for non-badminton tenants at launch.
- **"BPM" brand throughout** — app name in `messages/en.json:54`, `messages/zh-CN.json:54`, `components/HomeTab.tsx:247`, `components/ShuttleLoader.tsx:4-6`, `next.config.js:3` (basePath `/bpm`). See §7c for the branding plan.
- **`ShuttleLoader`** is a literal badminton shuttlecock animation. Either keep as a BPM-only easter-egg or generalize to a neutral loader for other tenants.

**Recommendation for sport scope at launch:** badminton-only but tenant-configurable branding. Opening the sport matrix adds content-design burden (new rubric per sport) and complicates onboarding. Land the badminton ICP first, then generalize.

---

## 7. Technical Pivot

This is an in-place migration analysis — the decision is to add `tenantId` everywhere in the existing repo rather than fork. See §8 for the fork-vs-in-place tradeoff.

### 7a — Multi-Tenant Data Model

Today's containers from `CLAUDE.md`:

- `sessions`, `players`, `announcements`, `skills` — partitioned by `/sessionId`
- `members`, `aliases`, `birds` — partitioned by `/id` (global)

All writes and reads funnel through `getContainer(name)` in `lib/cosmos.ts:109-114`. No tenant scoping exists today.

**Migration pattern:**

1. Add `tenantId: string` as an additive, optional field on every document. Backfill all existing docs with `tenantId: 'bpm'` via a one-shot script.
2. Add a `tenants` container, partitioned by `/id`. Holds `{ id, slug, brandName, accentColor, plan, createdAt, ownerMemberId }`.
3. Change `getContainer` callers to go through a new `getScopedContainer(tenantId, name)` helper that auto-injects a `tenantId` filter in every query.
4. Phase the partition-key change: the global containers (`members`, `aliases`, `birds`) should be re-partitioned to `/tenantId` so cross-tenant queries stay impossible at the data layer. Session-scoped containers can either stay on `/sessionId` (with a composite `sessionId` that embeds tenant, e.g., `tenant-bpm/session-2026-04-19`) or move to `/tenantId` with `sessionId` as a secondary filter.
5. Delete the legacy `'current-session'` fallback in `lib/cosmos.ts:143` — it's BPM-specific production state from pre-pointer days. Replace with an explicit per-tenant default-session creation during onboarding.

**Cost:** touches all 13 API routes + `lib/cosmos.ts` + mock store. Mock store `getMockContainer` at `lib/cosmos.ts:11-75` does not filter by `tenantId` today — tenant isolation tests (§9 risk) must exercise real filter behaviour, not just mock pass-through.

### 7b — Auth Replacement

Today, admin auth is a single shared `ADMIN_PIN` env var (`lib/auth.ts:6-16`) validated via `timingSafeEqual` on a SHA-256 hash (`app/api/admin/route.ts:27-30`). Players identify themselves by `{ name, token, sessionId }` in localStorage (`lib/identity.ts`). No per-user accounts exist.

**Options:**

| Option | Lift | Fit |
|---|---|---|
| Email magic link (custom or Auth.js) | Medium | Matches current no-password ethos; fewest surprises for end-users |
| Clerk / WorkOS / Stytch | Low engineering, medium $ | Org primitives for free (invites, roles, audit log); accelerates §7f |
| OAuth (Google/WeChat) | Medium + WeChat compliance burden | WeChat login critical for the bilingual ICP in mainland / diaspora |

**Recommendation:** Clerk for v1. Built-in org/role primitives map to the multi-tenant model; Google + magic-link + Apple cover North American personas; WeChat can be added via OIDC-compatible relay later if the zh-CN ICP proves out.

**Integration shape:**
- Replace `ADMIN_PIN` with Clerk session → `lib/auth.ts` becomes `getUserContext(req)` returning `{ userId, tenantId, role: 'owner' | 'admin' | 'member' | 'guest' }`
- `isAdminAuthed(req)` in `app/api/admin/route.ts:9` stays as a call site but internally becomes `const ctx = await getUserContext(req); return ctx.role === 'admin' || ctx.role === 'owner'`
- Retire the 5-tap admin-reveal easter egg and PIN dialog in the admin tab — replaced by Clerk sign-in
- Player identity (`lib/identity.ts`) either (a) stays as-is for non-authed guest signups, or (b) is deprecated in favour of Clerk user → `memberId` mapping. Keep guest flow for v1 — the friction of forcing auth to sign up is a known ICP-killer.

### 7c — Branding & Theming

Hardcoded brand touchpoints confirmed in audit:

- `messages/en.json:54` — `"Welcome to BPM Badminton"`
- `messages/zh-CN.json:54` — `"欢迎来到 BPM 羽毛球"`
- `components/HomeTab.tsx:247` — literal `BPM Badminton` string
- `components/ShuttleLoader.tsx:4-6` — component doc-comment references BPM explicitly; the animation itself is a shuttlecock
- `next.config.js:3` — `basePath: '/bpm'` hardcoded
- App icon, OG image, theme accent color — all BPM-chosen

**Pattern to introduce:**

- `tenant.brandName`, `tenant.accentColor`, `tenant.logoUrl` on the `tenants` container doc
- Replace hardcoded strings in i18n messages with `{brandName}` ICU interpolation variable passed from SSR context
- `ShuttleLoader` becomes `BrandedLoader` that renders the shuttlecock for badminton tenants and a neutral generic loader otherwise
- Drop the `/bpm` basePath for SaaS deployments (path prefix doesn't work for multi-tenant); use the root and resolve tenant from subdomain or cookie (see §7d)

**`NEXT_PUBLIC_*` constraint:** every client-exposed env var is baked at build time (documented gotcha in `CLAUDE.md`). This means tenant-specific branding *cannot* come from env vars — it must come from runtime data passed through SSR or the API. The existing pattern (props threaded through server components + API-fetched state) already supports this; the fix is disciplinary, not architectural.

### 7d — Domain Routing

Today: `proxy.ts` (renamed from `middleware.ts` in Next 16, per `CLAUDE.md`) runs on every user-visible path and sets a locale cookie. `proxy.ts:9-38` is the exact template to extend for tenant resolution.

Options:

| Shape | Example | Tradeoffs |
|---|---|---|
| **Subdomain** | `bpm.sportup.app`, `yourclub.sportup.app` | Cleanest isolation, but wildcard TLS, wildcard DNS, wildcard App Service routing all become ops work |
| **Path prefix** | `sportup.app/bpm`, `sportup.app/yourclub` | Simpler infra; conflicts with Next `basePath` (need to drop `/bpm`); SEO / link-sharing less clean |
| **Cookie-first (detect once, remember)** | `sportup.app` detects tenant from auth or manual picker, stores in cookie | Simplest v1; fails for unauthed landing / shareable invite links without query-param fallback |

**Recommendation:** Subdomain for the SaaS deployment, cookie-based tenant memory as a v1 shortcut during development. Extend `proxy.ts` with a block *before* the locale check that reads the host header, resolves to a tenant, sets `x-tenant-id` on the request, and falls back to a marketing-site redirect if the host doesn't map.

### 7e — Billing Integration

Current state: none. Payment flow is e-transfer between end users; there is no money flow between the app and its users.

**Stack:** Stripe Checkout + Customer Portal + webhook handler. Standard SaaS shape.

- New container `subscriptions` partitioned by `/tenantId`, mirroring Stripe state
- `/api/stripe-webhook/route.ts` updates `tenant.plan` and `subscription` on `customer.subscription.*` events
- Feature gating helper `requirePlan(tenantId, 'pro')` at the start of paid-feature API routes
- Capacity gating: free tier caps `maxPlayers`, `activeSessions`; reaching the cap prompts upgrade (not hard-errors — the friend group still playing on the free tier is advocacy fuel)
- Dunning: on subscription lapse, flip `tenant.plan = 'free_readonly'` for 30 days (sessions still viewable, no writes) before downgrading to free tier with data truncation warnings

**Not at launch:** usage-based billing, metered AI consumption, annual-prepay discounts. Introduce once billing data proves they're worth the complexity.

### 7f — Super-Admin Plane

Today: none. There is no "who are my users" console because BPM has one tenant.

**v1 requirements:**

- **Onboarding flow** — public signup → email verify → create tenant → enter brand name / timezone / sport → seed first session → invite first member. The `ensureContainer` pattern (`lib/cosmos.ts:125-134`) already solves the container-provisioning half.
- **Impersonation** — ability for SaaS operator to log into a tenant read-only for support. Clerk supports this natively.
- **Usage dashboard** — active tenants, MRR, plan distribution, last-active timestamp per tenant. Not a full analytics product; a single internal page is sufficient for the first 50 tenants.
- **Billing exception handling** — refund, plan-override, comp-account flags per tenant.

Defer: tenant deletion / data export (legal requirement eventually, but not day-1 blocker), multi-user admin on the SaaS side (one operator is enough until team of 2+).

### 7g — Email & Notifications

Today: zero outbound email. All communication is in-app + out-of-band (WhatsApp/WeChat).

**SaaS-required outbound:**

- Signup email confirmation (Clerk handles)
- Stripe receipt / invoice (Stripe handles)
- Deadline reminders (signup closes in 24h) — new
- Weekly session digest for organizers — new
- Payment nudges (optional — automate the "you still owe me" WhatsApp message) — new, Pro-tier feature

**Provider:** Resend or Postmark. Resend has the developer-first API; Postmark is more established for transactional. Either is fine at launch volumes.

**Locale-awareness:** email templates reuse the existing `next-intl` messages (`messages/en.json`, `messages/zh-CN.json`, `i18n/request.ts`). Templates live in a new `emails/` directory with one file per template × locale, rendered server-side before send.

> Email is the one net-new system category. Everything else in §7 is a modification of something that already exists.

---

## 8. Migration Strategy

Three options, ordered by increasing ambition:

| Strategy | Shape | When to pick |
|---|---|---|
| **(a) Fork** | New repo, new stack (e.g., Postgres instead of Cosmos), BPM stays frozen as a personal project. | If you want BPM to remain unchanged and the SaaS to be unconstrained by historical choices. Highest optionality, highest duplication. |
| **(b) In-place multi-tenant** | Add `tenantId` everywhere in the existing repo. BPM becomes tenant #1 on launch day. | If you want one codebase, willingly accept that every SaaS concern touches BPM's runtime. Lowest duplication, shared risk. |
| **(c) Extract shared library** | Split into `packages/core` (domain logic, already sport-agnostic), `apps/bpm` (frozen), `apps/saas` (new). Cosmos shared via core. | Middle ground. Adds monorepo tooling but preserves historical BPM behavior. |

**Recommended path: (b) in-place with dual-read cutover.** The codebase is small enough that a monorepo split (c) would be over-engineering; a fork (a) doubles the maintenance surface, which is the single constraint the solo maintainer cannot afford. In-place means:

1. Tag current main as the BPM-only baseline (`bpm-stable-v1.0`, already planned)
2. Add `tenantId` as additive/optional across containers; BPM continues to work with implicit `tenantId: 'bpm'` default
3. Introduce the `tenants` container; backfill BPM as tenant #1
4. Build the onboarding flow, Clerk auth, Stripe billing, tenant routing in parallel behind feature flags (see deployment strategy doc)
5. Promote to stable only when tenant isolation is verified end-to-end
6. Launch second tenant (pilot) — BPM's weekly session is the production smoke test for every release

The in-place migration is compatible with the dual-deployment + feature-flag strategy captured in `/Users/gz-mac/.claude/plans/this-was-where-we-clever-diffie.md`.

---

## 9. Risks & Open Questions

| Risk | Severity | Mitigation |
|---|---|---|
| **Cross-tenant data leak** at API or DB layer | Catastrophic — would kill trust immediately | Mandatory `getScopedContainer(tenantId, name)` helper + lint rule rejecting direct `getContainer` calls outside the helper + integration test suite that asserts tenant A cannot read tenant B's data on every endpoint |
| **Cosmos 400 RU/s shared throughput** won't scale to N tenants | Medium — hits at ~5–10 tenants | Migrate to provisioned autoscale per-container, or move hot containers to dedicated RU. Budget ~$25/month/tenant at the mid-scale point |
| **Mock store tenant bypass** | Medium — tests pass but prod fails | Update `getMockContainer` (`lib/cosmos.ts:11-75`) to filter on `tenantId` parameter; treat tenant-isolation tests as first-class in CI |
| **`NEXT_PUBLIC_*` build-time baking** blocks per-tenant branding | Medium — runtime workaround exists but pattern must be enforced | Audit all `NEXT_PUBLIC_*` reads during the tenant migration; move branding-relevant values to SSR-injected props |
| **Legacy `'current-session'` fallback** in `getActiveSessionId()` (`lib/cosmos.ts:143`) is BPM-specific | Low — easy fix | Delete during migration; provision a per-tenant default session during onboarding instead |
| **Sport-specific primitives** (birds, ACE matrix) ship to non-badminton tenants as dead UI | Medium — onboarding friction | Sport-type flag on tenant doc; hide / rename badminton-specific UI for other sports; or stay badminton-only at launch |
| **Pricing too cheap to cover per-tenant Cosmos + Clerk + Stripe + email costs** | Medium — need unit economics check | Model a 10-tenant scenario at $15/month each before committing. Cosmos + Clerk + Resend + Stripe fees land at ~$3–5/tenant at that scale; margin is present but thin |
| **ICP advocacy cold-start** — no paying customer until 3+ pilots commit | High — go/no-go gate | Pilot recruitment must precede billing build. 3 LOIs before Clerk work begins |
| **Solo maintainer bandwidth** for support queries from paying customers | Medium — quality of life | Cap pilot tenants at 5 for the first 6 months; set explicit "best-effort support" expectations |
| **WeChat compatibility** for in-app browser behaviour (existing research finding #7) | Medium for zh-CN ICP | Already on the BPM roadmap (R3); ship before SaaS launch, not after |

Open questions the findings doc cannot answer:

1. Does the maintainer actually want to run a SaaS, or is BPM a beloved hobby project that shouldn't become work?
2. Are there 3+ organizers willing to be pilot customers at $0 for 3 months + agree to give real feedback? Without this, every §7 item is speculative.
3. Is Cosmos the right long-term choice, or is the SaaS migration the right moment to switch to Postgres? (Cosmos recommended for this plan — see deployment strategy doc for why.)
4. English + zh-CN coverage is launched; what is the priority order for other locales? (Spanish for paddle-sport US market? French for Canadian bilingual requirement?)

---

## 10. Decision Framework

**Green-light criteria** (all must hold before committing engineering time beyond this document):

- [ ] 3+ unpaid pilot organizers have given verbal commitment with specific league / group context
- [ ] Pricing validated at $15/month tier via at least 10 willingness-to-pay conversations (persona A focus)
- [ ] Maintainer confirmed willingness to give up "BPM as a hobby project" status and accept customer-support obligations for 12 months
- [ ] 4–6 weeks of dedicated dev time available in the next 6 months (cannot be done on evenings-only)
- [ ] Cosmos unit economics modeled at 10 / 50 / 100 tenants; floor pricing justified

**Red-light criteria** (any one triggers "do not pursue"):

- [ ] Maintainer wants BPM to stay frozen as-is for the friend group
- [ ] No pilot interest after 6 weeks of outreach (signal that the ICP isn't pulling the product from the market)
- [ ] Cosmos economics break below $N ARR — if infra + Clerk + Stripe eat more than 40% of revenue at 10 tenants, the model doesn't work without a pricing bump
- [ ] A competitor (Heja, Spond, new entrant) ships invite-list + cost-split + bilingual drop-in UX before launch

**Yellow-light (proceed cautiously):**

- Pilot interest exists but only Persona B (rec-league) — larger deal size but longer sales cycle; rethink pricing and launch focus
- BPM friend group signals fatigue with "my app is a testbed now"; mitigate with stable-vs-next deployment split (already planned)
- Only 1–2 pilots commit — ship a deeply-customized BPM-plus-one-pilot rather than a SaaS, revisit in 6 months

---

## 11. Appendix: Code Change Map

Files and areas affected by a Phase 1 migration (multi-tenancy skeleton + auth + branding — no billing yet). Estimates are rough LOC deltas for a first pass.

| Path | Current behaviour | SaaS behaviour | Est. LOC |
|---|---|---|---|
| `lib/cosmos.ts` | `getContainer(name)` returns raw container; mock store ignores tenant | `getScopedContainer(tenantId, name)` injects tenant filter; mock store filters on tenant | +80 |
| `lib/auth.ts` | PIN-based admin cookie via `timingSafeEqual` | Clerk session → `getUserContext(req)` returning `{ userId, tenantId, role }` | Rewritten ~120 LOC |
| `lib/identity.ts` | localStorage `{ name, token, sessionId }` for guest signup | Retained for guest flow; extend with optional `tenantId` | +10 |
| `app/api/admin/route.ts` | Verifies PIN, sets HTTP-only cookie | Replaced by Clerk hosted sign-in; route becomes redirect or thin wrapper | -40 |
| `app/api/*/route.ts` (all 13) | Call `isAdminAuthed(req)` + `getContainer` | Call `getUserContext(req)` + `getScopedContainer(ctx.tenantId, name)` | +5/route × 13 = +65 |
| `proxy.ts` | Locale cookie resolution only | Add tenant resolution block before locale; parse host header, set `x-tenant-id` | +40 |
| `next.config.js` | `basePath: '/bpm'` | Remove basePath for SaaS deployment; keep on BPM stable deploy via env | ±10 |
| `messages/en.json`, `messages/zh-CN.json` | Hardcoded "BPM Badminton" at key `home.welcome.title` (line 54) | ICU interpolation `"Welcome to {brandName}"` | ±5 per file |
| `components/HomeTab.tsx` | Literal `BPM Badminton` at line 247 | `{tenant.brandName}` via props | -1 / +1 |
| `components/ShuttleLoader.tsx` | Badminton-specific shuttlecock loader | Keep for badminton tenants; gate on `tenant.sport === 'badminton'` or rename to `BrandedLoader` | +15 |
| `app/layout.tsx` | Global splash + theme + locale providers | Add tenant provider that injects `brandName`, `accentColor`, `logoUrl` into SSR context | +30 |
| `lib/birdUsages.ts`, `session.birdUsages` shape | "Birds" (shuttlecocks) specific | Rename to consumables/equipment; preserve data shape, swap labels | ~20 LOC labels, ~40 LOC UI |
| `lib/skills-data.ts` | ACE matrix hardcoded | Either stays as badminton-only rubric, or becomes one of N rubrics keyed by sport | ~0 now / ~200 to generalize |
| `__tests__/helpers.ts` + all 29 test files | 245 tests assume single-tenant | Add tenant fixture helper; retrofit tests to assert tenant isolation; ~30 new tenant-leak tests | +200 |
| `scripts/migrate-to-multitenant.ts` | — | New: backfills `tenantId: 'bpm'` on all existing docs | +100 |
| `docs/tenant-onboarding-runbook.md` | — | New: step-by-step for creating a new tenant manually (pre-automation) | +80 |
| `app/(marketing)/` route group | — | New: landing page, pricing, privacy, terms for public SaaS surface | ~500 |
| `app/sign-in/`, `app/sign-up/` | — | New: Clerk auth pages | ~50 wiring |
| `app/onboarding/` | — | New: post-signup wizard to create tenant + first session | ~300 |
| New container: `tenants` | — | Holds `{ id, slug, brandName, accentColor, logoUrl, sport, plan, createdAt, ownerMemberId }` | Schema change |
| New container: `subscriptions` | — | Deferred to Phase 2 (billing) | — |

**Phase 1 total rough estimate:** ~1,500–2,000 net new/changed LOC, ~30 modified tests, ~30 new tenant-isolation tests, 4–6 weeks of focused dev time assuming the deployment strategy (`.../this-was-where-we-clever-diffie.md`) is already in place.

---

*This document is an internal strategy memo. It does not commit the project to any direction; it exists to make a later yes/no/not-yet decision legible.*
