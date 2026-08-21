# Product

Strategic context: who this is for, what it's for, and what it should feel like.
Visual implementation lives in [`DESIGN.md`](DESIGN.md); copy voice lives in
[`docs/design-system/README.md`](docs/design-system/README.md). Where this file and
those disagree, this one states the *intent* and they describe the *implementation* —
treat the gap as work, not as a contradiction to resolve by rewriting one of them.

## Register

product

Design serves the job. This repo is the app: a bottom-nav shell, four tabs, forms,
and an admin console. The marketing surface lives in the separate `bpm-marketing`
repo — do not import brand-register ambition from there into these screens.

## Users

**Source of record: [`docs/user-research-simulation.md`](docs/user-research-simulation.md) §3**,
which has eight researched personas with their context, language, tech comfort, and
actual frustrations. Read it before designing for "the user" — it is more specific
than anything summarized here, and it is where new user facts belong.

The design lens this file adds on top is **two clocks**:

**The 30-second visit.** Most people open the app once a week, on a phone, usually in
a group-chat moment or standing in a gym. Am I in this week, what do I owe, when and
where. They are not invested in the software and will never explore it. Anything that
costs them a thought is a defect.

**The 20-minute session.** The admin is in the app far more than anyone else, doing
genuinely complex work: opening sign-ups, invite list, waitlist, shuttle usage,
settling costs, covering people, advancing the week, announcements. Consequential —
a wrong number here means someone gets billed wrong.

Every screen belongs to one clock or the other. "Simple for the player" is not
permission to make the admin surface a wall of inputs.

**Language is a first-class user fact, not a feature.** Roughly half the player base
reads Chinese primarily; the research names this the single largest historical gap.
The app is bilingual (`NEXT_LOCALE` cookie, `messages/en.json` + `zh-CN`). Any new
user-facing string is incomplete until it exists in both, and any design that assumes
English-length text is incomplete until it survives the Chinese one.

**Not to be confused with:** the ICP personas in
[`docs/saas-productization-findings.md`](docs/saas-productization-findings.md) §3
(club captains, rec-league coordinators, corporate wellness organizers). Those belong
to a *hypothetical* multi-tenant SaaS pivot and are not this product's users. Do not
design current screens for them.

## Product Purpose

Run a casual weekly badminton session without it becoming someone's part-time job.
Sign-ups, waitlist, per-person cost, and payment state, so the group stops
reconstructing all of it from a group chat every week.

Success is that the weekly ritual takes less effort than texting the group chat, and
that settling up never feels like being invoiced by a company.

## Brand Personality

**Calm, precise, quietly premium** — as a *visual and motion* register.

Not loud, not playful, not performance-athletic. The app should feel like a well-made
instrument that happens to be about badminton, confident enough not to decorate
itself. Restraint is the point: the quality should be legible to someone who looks
closely and invisible to someone who doesn't.

**Voice is not defined here.** Copy tone is owned by
[`docs/design-system/README.md`](docs/design-system/README.md) → "Content
fundamentals": *friendly, direct, and pragmatic — the same tone a neighborhood
organizer uses when they know most of the people in the group by name.* That is
deliberately warmer than "calm and precise", and the two are not in conflict: a
restrained interface can speak plainly. Calm is a property of the surface, not an
instruction to write like a bank. "Send the bill", not "Settle".

**Standing tension worth naming:** the current `DESIGN.md` describes a more energetic
system than this personality implies — breathing aurora blobs, glass material on every
surface, a court pattern behind Sign-Ups, a tempo-dot wordmark. That system was
designed before this personality was stated. The delta is work, not error.

## Anti-references

- **A gamified sports or betting app.** No streak confetti, no neon gradients, no
  dopamine badges, no aggressive progress mechanics. The Stats tab carries streaks and
  kudos and is the surface most at risk; it must stay a record, not a slot machine.
- **Activity- and sport-brand professionalism.** The Strava / Nike / performance-
  tracker register — athletic bravado, hero athletes, motivational voice, data as
  spectacle. This is a group of friends booking a court, not an elite training
  platform. No posturing about performance.
- **Generic component-library default.** The stock Material/shadcn look with no point
  of view: uniform cards everywhere, uniform radii, no committed color. This is the
  "AI made that" failure mode and the reason the repo maintains its own token system
  and ESLint token guardrail.

## Design Principles

Strategic only. Visual rules live in [`DESIGN.md`](DESIGN.md).

1. **Two clocks, one app.** Know which clock a screen belongs to before designing it.
   Optimizing an admin surface for glanceability, or a player surface for
   completeness, is how both get worse.

2. **Motion confirms, never performs.** An animation must answer "what changed and
   where did it go". If the honest answer is "it looks nice", remove it. Frequency
   decides: the more often a user sees a transition, the less it should move.

   **Overshoot easing is rare-surface-only.** `--ease-spring`
   (`cubic-bezier(0.34, 1.56, 0.64, 1)`) overshoots — that is bounce. It is allowed
   only where a user meets it rarely: first-run, celebratory, easter-egg. It is banned
   anywhere on the weekly path. Its one sanctioned call site today is
   `components/PinInput.tsx`'s `baddicon-pop`. Reach for `--ease-glass` or
   `--ease-out-quart` for everything else.

3. **Quiet by default, unmistakable under pressure.** Restraint everywhere, except
   where the user is about to make an irreversible or money-shaped decision — settle,
   cover, purge, advance. Those get unambiguous weight. Calm is not the same as
   understated-when-it-matters.

4. **Never let a failure look like a fact.** A load error must never render as
   confident zero, and an unresolved auth probe must never render as a confirmed no.
   This is a product principle before it is a technical one: the app's whole value is
   that people trust the numbers in it.

5. **The details are the product.** There is no feature moat here — it's a sign-up
   form and a cost split. The reason to use it instead of a group chat is that it is
   unusually well made. Craft is the differentiator, so it is not optional polish
   applied at the end.

## Accessibility & Inclusion

All four are live requirements, not aspirations.

- **WCAG AA contrast, verified.** Body text ≥4.5:1, large text ≥3:1. Needs active
  verification rather than assumption, because translucent glass surfaces let
  effective contrast drift as the backdrop behind them changes. A token that passes
  over one background may fail over the aurora.
- **Color-blind safe status.** The status system is green success / red error / amber
  waitlist — the exact triad deuteranopia collapses, affecting ~8% of men. Status must
  always carry an icon, label, or shape as well as color. Color alone is never the
  signal.
- **Reduced motion: movement dies, comprehension survives.** Under
  `prefers-reduced-motion: reduce`, position and transform animation stops, but
  opacity and color transitions are preserved — a state change must still be legible
  as a change. The GPU-expensive infinite animations (aurora, spinner, shimmer,
  splash) are additionally hard-stopped with their `will-change` hints released; that
  is a thermal fix for mobile, and it is why the blanket rule must not be "kill
  everything". See the comment at `app/globals.css` → reduced-motion block.
- **Readable in a bright gym.** The real usage context is a phone held under harsh
  overhead light or daylight. This argues against low-contrast muted text and thin
  weights regardless of what the palette technically permits, and applies to the light
  theme especially.
