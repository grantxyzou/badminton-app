# Value-Hub Slice-0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a thin end-to-end vertical of the Value-Hub — racket catalog → one-tap "What's your racket?" gear pick → one deterministic recommendation card → full-doubles game logger → partner-frequency Stats card — all behind a single flag, so the engagement kill-criterion can be measured cheaply.

**Architecture:** Three new Cosmos containers (lazy-bootstrapped via `ensureContainer`, same pattern as `skills`). The recommendation engine is a **pure deterministic function** (`lib/recommend.ts`) so the route is a thin wrapper and the logic is unit-testable with synthetic members — no AI in Slice-0 (plan Decision B2: engine only, B1 explainer deferred). The partner card sources from **co-attendance** (`players` rows sharing a `sessionId`), not game results, so it has data on day one independent of logger adoption. Every player-facing surface is gated by `isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')`; the containers bootstrap regardless so they exist before the flag flips.

**Tech Stack:** Next.js 16 (App Router, `force-dynamic` routes), TypeScript, Cosmos DB (mock store for tests), Vitest, the `<BottomSheet>` primitive, `next-intl`.

**Ratified design decisions (from this session):**
- **Recommender fallback = all-rounders.** When `member.stage` is undefined (the common case), return the widest-`skillRange` racket so the card always shows something. Stage-aware fit only kicks in once a member has a stage.
- **Game logger = full doubles.** Pick partner + both opponents (4 names) + numeric `scoreA`/`scoreB`. Matches the full `GameResult` schema.

**Accepted Slice-0 simplifications (flag for plan review):**
- **Gear writes are name-keyed and unauthenticated**, mirroring the anon sign-up trust model. A racket preference is low-sensitivity (not payment/PII). A `TODO(value-hub)` note in the route marks where to bind to PIN/identity if gear later becomes sensitive. If the reviewer wants gear writes auth-gated now, that's a one-task addition (verify `body.pin` against `member.pinHash`, same envelope as `/api/players`).
- **No Claude explainer.** The rec card's reason string is a deterministic template. Decision B1 (Claude polish) is deferred per the plan.

---

## File Structure

**Create:**
- `lib/recommend.ts` — pure `recommendRacket()` scoring fn + `topPartners()` aggregation. One responsibility: deterministic ranking. No I/O.
- `app/api/equipment/catalog/route.ts` — public GET (read/search catalog by category). Admin POST/PATCH/DELETE deferred to Track 2.
- `app/api/equipment/gear/route.ts` — GET (read a member's gear) + PUT (set/replace a gear item).
- `app/api/games/route.ts` — GET (list a session's results) + POST (log a result).
- `app/api/recommend/route.ts` — GET (one deterministic racket rec for a name).
- `app/api/stats/partners/route.ts` — GET (partner frequency from co-attendance).
- `components/profile/GearSheet.tsx` — BottomSheet: catalog autocomplete, PUT gear.
- `components/profile/RacketRecCard.tsx` — the single rec card on Profile.
- `components/stats/cards/PartnerFrequencyCard.tsx` — partner card on Stats.
- `components/stats/GameLoggerSheet.tsx` — full-doubles logger BottomSheet.
- `__tests__/recommend.test.ts`, `__tests__/partners.test.ts` — pure-fn unit tests.
- `__tests__/equipment-catalog.test.ts`, `__tests__/equipment-gear.test.ts`, `__tests__/games.test.ts`, `__tests__/recommend-route.test.ts`, `__tests__/stats-partners.test.ts` — route tests (flag on + off).

**Modify:**
- `lib/cosmos.ts` — extend `SEED_DEV_SCENARIO=fresh-thursday` with a seeded gear + game (for e2e). (Container registration is per-route via `ensureContainer`, not central.)
- `components/ProfileTab.tsx` — mount `<RacketRecCard>` + a "My racket" row that opens `<GearSheet>`, gated by the flag.
- `components/SkillsTab.tsx` (the Stats tab) / `components/stats/StatsPlaceholder.tsx` — mount `<PartnerFrequencyCard>` + the 48h game-logger entry, gated by the flag.
- `.github/workflows/deploy-next.yml` — add `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE: 'true'` (the `check-flag-sync.mjs` PostToolUse hook will otherwise warn of drift).
- `messages/en.json` + `messages/zh-CN.json` — new `valueHub.*` namespace (restart dev server after adding — new top-level namespace, per CLAUDE.md next-intl HMR gotcha).

**Reference (read before writing, do not modify):**
- `app/api/skills/route.ts` — the `ensureContainer` lazy-promise pattern + handler shape.
- `app/api/members/me/route.ts` — member-by-name lookup (`SELECT ... WHERE LOWER(c.name) = LOWER(@name) AND c.active = true`), `getClientIp`, `checkRateLimit`.
- `app/api/players/route.ts` — the `pinHash`/`deleteToken` strip-canary destructure (search `pinHash: _ph`).
- `components/stats/cards/AttendanceCardLive.tsx` — identity → `badminton_stats_preview_name` → picker resolution chain to mirror in PartnerFrequencyCard.
- `components/BottomSheet/` — the sheet primitive (portal, scroll lock, focus trap).
- `__tests__/helpers.ts` — test helpers; each test uses a unique `X-Client-IP` to dodge the rate limiter.
- `__tests__/flags.test.ts` — the `process.env` mutate-in-`beforeEach` pattern for flag tests.

---

## Task 1: Pure recommendation + partner functions

**Files:**
- Create: `lib/recommend.ts`
- Test: `__tests__/recommend.test.ts`, `__tests__/partners.test.ts`

- [ ] **Step 1: Write the failing recommend test**

`__tests__/recommend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { recommendRacket } from '@/lib/recommend';
import type { CatalogItem } from '@/lib/types';

function racket(id: string, range: [number, number], msrp = 100): CatalogItem {
  return { id, category: 'racket', brand: 'B', model: id, msrp, skillRange: range };
}

describe('recommendRacket', () => {
  const catalog: CatalogItem[] = [
    racket('wide', [1, 6], 120),   // widest span = all-rounder
    racket('beginner', [1, 2], 80),
    racket('advanced', [5, 6], 200),
    racket('mid', [3, 4], 140),
  ];

  it('returns the widest-range racket when stage is undefined', () => {
    const rec = recommendRacket({ catalog });
    expect(rec?.id).toBe('wide');
  });

  it('returns a stage-appropriate racket when stage is set', () => {
    const rec = recommendRacket({ stage: 2, catalog });
    // eligible: wide [1,6], beginner [1,2]; closest-centered to stage 2 is beginner (center 1.5) vs wide (center 3.5)
    expect(rec?.id).toBe('beginner');
  });

  it('falls back to all rackets (never null) when stage matches nothing exactly', () => {
    const narrow: CatalogItem[] = [racket('a', [1, 1]), racket('b', [6, 6], 90)];
    const rec = recommendRacket({ stage: 3, catalog: narrow });
    expect(rec).not.toBeNull();
    expect(['a', 'b']).toContain(rec?.id);
  });

  it('returns null only when there are no rackets at all', () => {
    expect(recommendRacket({ catalog: [] })).toBeNull();
    expect(recommendRacket({ catalog: [{ id: 's', category: 'string', brand: 'B', model: 's', skillRange: [1, 6] }] })).toBeNull();
  });

  it('is deterministic — same input yields same output', () => {
    const a = recommendRacket({ stage: 4, catalog });
    const b = recommendRacket({ stage: 4, catalog });
    expect(a?.id).toBe(b?.id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- recommend.test.ts`
Expected: FAIL — `Cannot find module '@/lib/recommend'` (or `recommendRacket is not a function`).

- [ ] **Step 3: Write the failing partners test**

`__tests__/partners.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { topPartners } from '@/lib/recommend';

describe('topPartners', () => {
  const sessions = [
    { sessionId: 's1', names: ['Me', 'Alice', 'Bob'] },
    { sessionId: 's2', names: ['Me', 'Alice'] },
    { sessionId: 's3', names: ['Alice', 'Bob'] }, // Me absent — ignored
  ];

  it('counts co-attendance only for sessions the viewer attended', () => {
    expect(topPartners({ me: 'Me', sessions })).toEqual([
      { name: 'Alice', count: 2 },
      { name: 'Bob', count: 1 },
    ]);
  });

  it('is case-insensitive on the viewer name', () => {
    expect(topPartners({ me: 'me', sessions })[0]).toEqual({ name: 'Alice', count: 2 });
  });

  it('returns [] when the viewer attended nothing', () => {
    expect(topPartners({ me: 'Ghost', sessions })).toEqual([]);
  });

  it('breaks count ties alphabetically and respects limit', () => {
    const tied = [{ sessionId: 'x', names: ['Me', 'Zoe', 'Amy'] }];
    expect(topPartners({ me: 'Me', sessions: tied, limit: 1 })).toEqual([{ name: 'Amy', count: 1 }]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- partners.test.ts`
Expected: FAIL — `topPartners is not a function`.

- [ ] **Step 5: Implement `lib/recommend.ts`**

```typescript
import type { CatalogItem } from '@/lib/types';

/**
 * Deterministic racket recommendation for Value-Hub Slice-0.
 *
 * Decision (2026-05-22): when `stage` is undefined — the common case, since
 * `Member.stage` is optional and rarely set — fall back to the widest-range
 * "all-rounder" racket so the card always shows something. Stage-aware fit
 * only applies once a member has a stage. No AI here (plan Decision B2).
 *
 * Pure: given inputs, returns the same racket every time. Unit-tested.
 */
export function recommendRacket(input: {
  stage?: number;
  /** Member's recent games-played count — minor tiebreak signal. */
  gamesPlayed?: number;
  catalog: CatalogItem[];
}): CatalogItem | null {
  const rackets = input.catalog.filter((c) => c.category === 'racket');
  if (rackets.length === 0) return null;

  const stage = input.stage;
  const span = (r: CatalogItem) => r.skillRange[1] - r.skillRange[0];
  const center = (r: CatalogItem) => (r.skillRange[0] + r.skillRange[1]) / 2;

  let eligible = rackets;
  if (typeof stage === 'number') {
    const inRange = rackets.filter((r) => stage >= r.skillRange[0] && stage <= r.skillRange[1]);
    // Never strand the user with an empty card — fall back to all rackets.
    eligible = inRange.length > 0 ? inRange : rackets;
  }

  const investedPlayer = (input.gamesPlayed ?? 0) >= 8;

  const sorted = [...eligible].sort((a, b) => {
    if (typeof stage === 'number') {
      // Closest-centered fit first.
      const fit = Math.abs(stage - center(a)) - Math.abs(stage - center(b));
      if (fit !== 0) return fit;
    } else {
      // No stage: widest span = most all-rounder.
      const bySpan = span(b) - span(a);
      if (bySpan !== 0) return bySpan;
    }
    // Invested players skew premium; newcomers skew affordable.
    const am = a.msrp ?? 0;
    const bm = b.msrp ?? 0;
    const byPrice = investedPlayer ? bm - am : am - bm;
    if (byPrice !== 0) return byPrice;
    // Final deterministic tiebreak.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0] ?? null;
}

/**
 * Partner-frequency from co-attendance. For each session the viewer attended,
 * every OTHER attendee gets +1. Pure; case-insensitive on the viewer name;
 * preserves the first-seen display casing of each partner.
 */
export function topPartners(input: {
  me: string;
  sessions: { sessionId: string; names: string[] }[];
  limit?: number;
}): { name: string; count: number }[] {
  const meLower = input.me.trim().toLowerCase();
  const counts = new Map<string, { name: string; count: number }>();

  for (const session of input.sessions) {
    const attended = session.names.some((n) => n.trim().toLowerCase() === meLower);
    if (!attended) continue;
    for (const raw of session.names) {
      const lower = raw.trim().toLowerCase();
      if (lower === meLower) continue;
      const prior = counts.get(lower);
      if (prior) prior.count += 1;
      else counts.set(lower, { name: raw.trim(), count: 1 });
    }
  }

  const out = [...counts.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });
  return typeof input.limit === 'number' ? out.slice(0, input.limit) : out;
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npm test -- recommend.test.ts partners.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 7: Commit**

```bash
git add lib/recommend.ts __tests__/recommend.test.ts __tests__/partners.test.ts
git commit -m "feat(value-hub): deterministic racket recommender + partner aggregation (pure)"
```

---

## Task 2: Equipment catalog read API

**Files:**
- Create: `app/api/equipment/catalog/route.ts`
- Test: `__tests__/equipment-catalog.test.ts`
- Reference: `app/api/skills/route.ts` (ensureContainer pattern), `scripts/data/equipment-catalog.json` (15-racket seed)

- [ ] **Step 1: Write the failing test**

`__tests__/equipment-catalog.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/equipment/catalog/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

function req(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'));
}

describe('GET /api/equipment/catalog', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });

  it('returns only rackets for category=racket', async () => {
    const container = getContainer('equipmentCatalog');
    // upsert (not create) — mock-store state persists across tests in a file; create would id-conflict.
    await container.items.upsert({ id: 'r1', category: 'racket', brand: 'Yonex', model: 'Astrox 88', skillRange: [3, 6] });
    await container.items.upsert({ id: 's1', category: 'string', brand: 'Yonex', model: 'BG65', skillRange: [1, 6] });

    const res = await GET(req('/api/equipment/catalog?category=racket'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items.every((i: { category: string }) => i.category === 'racket')).toBe(true);
    expect(body.items.find((i: { id: string }) => i.id === 's1')).toBeUndefined();
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(req('/api/equipment/catalog?category=racket'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- equipment-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

`app/api/equipment/catalog/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import type { EquipmentCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID: EquipmentCategory[] = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];

let ready: Promise<void> | null = null;
function ensureCatalog(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('equipmentCatalog', '/category').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureCatalog();
    const raw = new URL(req.url).searchParams.get('category');
    const category = (VALID as string[]).includes(raw ?? '') ? raw : 'racket';
    const container = getContainer('equipmentCatalog');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.category = @category',
        parameters: [{ name: '@category', value: category }],
      })
      .fetchAll();
    return NextResponse.json({ items: resources });
  } catch (error) {
    // Legible-fail: surface the failure, do NOT pretend an empty catalog.
    console.error('GET equipment/catalog error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- equipment-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/equipment/catalog/route.ts __tests__/equipment-catalog.test.ts
git commit -m "feat(value-hub): GET /api/equipment/catalog (flag-gated, racket read)"
```

---

## Task 3: Player gear read/write API

**Files:**
- Create: `app/api/equipment/gear/route.ts`
- Test: `__tests__/equipment-gear.test.ts`
- Reference: `app/api/members/me/route.ts` (member-by-name lookup)

- [ ] **Step 1: Write the failing test**

`__tests__/equipment-gear.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PUT } from '@/app/api/equipment/gear/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'));
}
function put(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/equipment/gear', 'http://localhost/bpm'), {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/equipment/gear', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-lin', name: 'Lin', active: true, stage: 4 });
  });

  it('PUT sets a member racket, GET reads it back', async () => {
    const putRes = await PUT(put({ name: 'Lin', item: { catalogId: 'r1', category: 'racket', label: 'Yonex Astrox 88' } }));
    expect(putRes.status).toBe(200);

    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    expect(body.gear.items).toHaveLength(1);
    expect(body.gear.items[0].label).toBe('Yonex Astrox 88');
    expect(body.gear.memberId).toBe('m-lin');
  });

  it('PUT replaces the existing racket rather than duplicating', async () => {
    await PUT(put({ name: 'Lin', item: { catalogId: 'r1', category: 'racket', label: 'Astrox 88' } }));
    await PUT(put({ name: 'Lin', item: { catalogId: 'r2', category: 'racket', label: 'Nanoflare 800' } }));
    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    const rackets = body.gear.items.filter((i: { category: string }) => i.category === 'racket');
    expect(rackets).toHaveLength(1);
    expect(rackets[0].label).toBe('Nanoflare 800');
  });

  it('GET returns empty gear for an unknown member (loaded-empty, not error)', async () => {
    const res = await GET(get('/api/equipment/gear?name=Nobody'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.gear).toBeNull();
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/equipment/gear?name=Lin'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- equipment-gear.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

`app/api/equipment/gear/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import type { PlayerGear, GearItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

let ready: Promise<void> | null = null;
function ensureGear(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('playerGear', '/memberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

async function resolveMemberId(name: string): Promise<string | null> {
  const members = getContainer('members');
  const { resources } = await members.items
    .query({
      query: 'SELECT c.id FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  return resources[0]?.id ?? null;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
    if (!name) return NextResponse.json({ gear: null });
    const memberId = await resolveMemberId(name);
    if (!memberId) return NextResponse.json({ gear: null });

    const container = getContainer('playerGear');
    const { resource } = await container.item(`gear-${memberId}`, memberId).read();
    return NextResponse.json({ gear: (resource as PlayerGear | undefined) ?? null });
  } catch (error) {
    console.error('GET equipment/gear error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}

// TODO(value-hub): gear writes are name-keyed and unauthenticated for Slice-0
// (a racket preference is low-sensitivity, same trust as anon sign-up). Bind to
// PIN/identity here if gear later carries sensitive data — verify body.pin
// against member.pinHash, same envelope as POST /api/players.
export async function PUT(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (!body.item || typeof body.item !== 'object') {
      return NextResponse.json({ error: 'item_required' }, { status: 400 });
    }
    const memberId = await resolveMemberId(name);
    if (!memberId) return NextResponse.json({ error: 'member_not_found' }, { status: 404 });

    const incoming: GearItem = {
      id: typeof body.item.id === 'string' ? body.item.id : randomBytes(12).toString('hex'),
      catalogId: typeof body.item.catalogId === 'string' ? body.item.catalogId : null,
      category: body.item.category,
      label: String(body.item.label ?? '').slice(0, 80),
      acquiredAt: body.item.acquiredAt,
      tensionLbs: typeof body.item.tensionLbs === 'number' ? body.item.tensionLbs : undefined,
      notes: typeof body.item.notes === 'string' ? body.item.notes.slice(0, 200) : undefined,
    };

    const container = getContainer('playerGear');
    const { resource: existing } = await container.item(`gear-${memberId}`, memberId).read();
    const prior = existing as PlayerGear | undefined;

    // One racket at a time in Slice-0: replace any existing item of the same category.
    const keptItems = (prior?.items ?? []).filter((i) => i.category !== incoming.category);
    const doc: PlayerGear = {
      id: `gear-${memberId}`,
      memberId,
      items: [...keptItems, incoming],
      stringLog: prior?.stringLog,
      shoesMileageSessions: prior?.shoesMileageSessions,
      updatedAt: new Date().toISOString(),
    };
    const { resource } = await container.items.upsert(doc);
    return NextResponse.json({ gear: resource });
  } catch (error) {
    console.error('PUT equipment/gear error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- equipment-gear.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/equipment/gear/route.ts __tests__/equipment-gear.test.ts
git commit -m "feat(value-hub): GET/PUT /api/equipment/gear (name-keyed, one racket per category)"
```

---

## Task 4: Game results logger API (full doubles)

**Files:**
- Create: `app/api/games/route.ts`
- Test: `__tests__/games.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/games.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/games/route';
import { NextRequest } from 'next/server';

function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'));
}
function post(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/games', 'http://localhost/bpm'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-client-ip': `games-${Math.random()}` },
  });
}

const validGame = {
  sessionId: 'session-2026-05-21',
  teamA: ['Lin', 'Viktor'],
  teamB: ['Carolina', 'Akane'],
  scoreA: 21,
  scoreB: 18,
  loggedBy: 'Lin',
};

describe('/api/games', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });

  it('POST logs a full-doubles result, GET lists it for the session', async () => {
    const postRes = await POST(post(validGame));
    expect(postRes.status).toBe(201);

    const getRes = await GET(get('/api/games?sessionId=session-2026-05-21'));
    const body = await getRes.json();
    expect(body.games.length).toBeGreaterThanOrEqual(1);
    const mine = body.games.find((g: { loggedBy: string }) => g.loggedBy === 'Lin');
    expect(mine.teamA).toEqual(['Lin', 'Viktor']);
    expect(mine.scoreA).toBe(21);
  });

  it('rejects a result missing a team', async () => {
    const res = await POST(post({ ...validGame, teamB: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric scores', async () => {
    const res = await POST(post({ ...validGame, scoreA: 'lots' }));
    expect(res.status).toBe(400);
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await POST(post(validGame));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- games.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

`app/api/games/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { GameResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

let ready: Promise<void> | null = null;
function ensureGames(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('gameResults', '/sessionId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

function names(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.map((n) => (typeof n === 'string' ? n.trim().slice(0, 50) : '')).filter(Boolean);
  return out.length > 0 ? out : null;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGames();
    const override = new URL(req.url).searchParams.get('sessionId');
    const sessionId = override || (await getActiveSessionId());
    const container = getContainer('gameResults');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    // JS-side newest-first sort — mock store doesn't honor ORDER BY.
    resources.sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)));
    return NextResponse.json({ games: resources });
  } catch (error) {
    console.error('GET games error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rate limit before any work — same posture as the rest of the API.
  const ip = getClientIp(req);
  if (!checkRateLimit(`games:${ip}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  try {
    await ensureGames();
    const body = await req.json();
    const teamA = names(body.teamA);
    const teamB = names(body.teamB);
    if (!teamA || !teamB) return NextResponse.json({ error: 'both_teams_required' }, { status: 400 });
    if (typeof body.scoreA !== 'number' || typeof body.scoreB !== 'number'
      || !Number.isFinite(body.scoreA) || !Number.isFinite(body.scoreB)) {
      return NextResponse.json({ error: 'numeric_scores_required' }, { status: 400 });
    }
    const loggedBy = typeof body.loggedBy === 'string' ? body.loggedBy.trim().slice(0, 50) : '';
    if (!loggedBy) return NextResponse.json({ error: 'loggedBy_required' }, { status: 400 });

    const sessionId = typeof body.sessionId === 'string' && body.sessionId
      ? body.sessionId
      : await getActiveSessionId();

    const record: GameResult = {
      id: randomBytes(16).toString('hex'),
      sessionId,
      teamA,
      teamB,
      scoreA: Math.round(body.scoreA),
      scoreB: Math.round(body.scoreB),
      loggedBy,
      loggedAt: new Date().toISOString(),
    };
    const container = getContainer('gameResults');
    const { resource } = await container.items.create(record);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST games error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- games.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/games/route.ts __tests__/games.test.ts
git commit -m "feat(value-hub): GET/POST /api/games full-doubles logger (flag-gated, rate-limited)"
```

---

## Task 5: Recommendation route (thin wrapper over lib/recommend)

**Files:**
- Create: `app/api/recommend/route.ts`
- Test: `__tests__/recommend-route.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/recommend-route.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

// Unique IP per request — recommend is rate-limited 10/min; convention per helpers.ts.
function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'), {
    headers: { 'x-client-ip': `rec-${Math.random()}` },
  });
}

describe('GET /api/recommend', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    const catalog = getContainer('equipmentCatalog');
    await catalog.items.upsert({ id: 'wide', category: 'racket', brand: 'Y', model: 'All-Round', skillRange: [1, 6], msrp: 120 });
    await catalog.items.upsert({ id: 'beg', category: 'racket', brand: 'Y', model: 'Starter', skillRange: [1, 2], msrp: 80 });
  });

  it('returns an all-rounder for a member with no stage', async () => {
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-anon', name: 'Anon', active: true });
    const res = await GET(get('/api/recommend?name=Anon'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.item.id).toBe('wide');
    expect(typeof body.reason).toBe('string');
  });

  it('returns a stage-appropriate racket for a rated member', async () => {
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-beg', name: 'Newbie', active: true, stage: 2 });
    const res = await GET(get('/api/recommend?name=Newbie'));
    const body = await res.json();
    expect(body.item.id).toBe('beg');
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/recommend?name=Anon'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- recommend-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

`app/api/recommend/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { recommendRacket } from '@/lib/recommend';
import type { CatalogItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

let ready: Promise<void> | null = null;
function ensureCatalog(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('equipmentCatalog', '/category').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

function reasonFor(item: CatalogItem, stage?: number): string {
  if (typeof stage === 'number') {
    return `Players around your level often reach for the ${item.brand} ${item.model}.`;
  }
  return `A solid all-rounder lots of players start with: the ${item.brand} ${item.model}.`;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Probes by name — rate-limit like /api/members/me so it can't enumerate members + stages.
  const ip = getClientIp(req);
  if (!checkRateLimit(`recommend:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ item: null, reason: null });
  }
  try {
    await ensureCatalog();
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';

    let stage: number | undefined;
    if (name) {
      const members = getContainer('members');
      const { resources } = await members.items
        .query({
          query: 'SELECT c.stage FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
          parameters: [{ name: '@name', value: name }],
        })
        .fetchAll();
      const raw = resources[0]?.stage;
      stage = typeof raw === 'number' ? raw : undefined;
    }

    const catalog = getContainer('equipmentCatalog');
    const { resources: items } = await catalog.items
      .query({
        query: 'SELECT * FROM c WHERE c.category = @category',
        parameters: [{ name: '@category', value: 'racket' }],
      })
      .fetchAll();

    const item = recommendRacket({ stage, catalog: items as CatalogItem[] });
    if (!item) return NextResponse.json({ item: null, reason: null });
    return NextResponse.json({ item, reason: reasonFor(item, stage) });
  } catch (error) {
    console.error('GET recommend error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- recommend-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/recommend/route.ts __tests__/recommend-route.test.ts
git commit -m "feat(value-hub): GET /api/recommend (thin wrapper over deterministic engine)"
```

---

## Task 6: Partner-frequency stats route

**Files:**
- Create: `app/api/stats/partners/route.ts`
- Test: `__tests__/stats-partners.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/stats-partners.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/stats/partners/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

// Unique IP per request — partners is rate-limited 10/min; convention per helpers.ts.
function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'), {
    headers: { 'x-client-ip': `partners-${Math.random()}` },
  });
}

describe('GET /api/stats/partners', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    const players = getContainer('players');
    // Two sessions; Lin co-attends with Viktor twice, Carolina once.
    await players.items.upsert({ id: 'p1', sessionId: 'session-2026-05-14', name: 'Lin' });
    await players.items.upsert({ id: 'p2', sessionId: 'session-2026-05-14', name: 'Viktor' });
    await players.items.upsert({ id: 'p3', sessionId: 'session-2026-05-21', name: 'Lin' });
    await players.items.upsert({ id: 'p4', sessionId: 'session-2026-05-21', name: 'Viktor' });
    await players.items.upsert({ id: 'p5', sessionId: 'session-2026-05-21', name: 'Carolina' });
  });

  it('ranks partners by co-attendance count', async () => {
    const res = await GET(get('/api/stats/partners?name=Lin&weeks=52'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.partners[0]).toEqual({ name: 'Viktor', count: 2 });
    expect(body.partners.find((p: { name: string }) => p.name === 'Carolina').count).toBe(1);
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/stats/partners?name=Lin'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- stats-partners.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

`app/api/stats/partners/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { topPartners } from '@/lib/recommend';

export const dynamic = 'force-dynamic';

// session id format is `session-YYYY-MM-DD`; derive a cutoff date from `weeks`.
function cutoffSessionId(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  return `session-${d.toISOString().slice(0, 10)}`;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Probes by name — rate-limit like /api/members/me.
  const ip = getClientIp(req);
  if (!checkRateLimit(`partners:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ partners: [] });
  }
  try {
    const url = new URL(req.url);
    const name = url.searchParams.get('name')?.trim().slice(0, 50) ?? '';
    const weeksRaw = Number(url.searchParams.get('weeks'));
    const weeks = Number.isFinite(weeksRaw) ? Math.min(Math.max(weeksRaw, 1), 260) : 12;
    if (!name) return NextResponse.json({ partners: [] });

    const cutoff = cutoffSessionId(weeks);
    const players = getContainer('players');
    // Pull recent player rows; string compare works because the id is ISO-dated.
    // Exclude removed players. JS-side grouping (mock store SQL gaps).
    const { resources } = await players.items
      .query({
        query: 'SELECT c.sessionId, c.name FROM c WHERE c.sessionId >= @cutoff AND (NOT IS_DEFINED(c.removed) OR c.removed = false)',
        parameters: [{ name: '@cutoff', value: cutoff }],
      })
      .fetchAll();

    const bySession = new Map<string, string[]>();
    for (const row of resources) {
      if (typeof row.sessionId !== 'string' || typeof row.name !== 'string') continue;
      const arr = bySession.get(row.sessionId) ?? [];
      arr.push(row.name);
      bySession.set(row.sessionId, arr);
    }
    const sessions = [...bySession.entries()].map(([sessionId, names]) => ({ sessionId, names }));

    return NextResponse.json({ partners: topPartners({ me: name, sessions, limit: 5 }) });
  } catch (error) {
    console.error('GET stats/partners error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
```

> **Note on the legacy `'current-session'` id:** it does not sort after the ISO cutoff, so co-attendance from the pre-date-keyed era is excluded from the window. Acceptable for Slice-0 (12-week default window is all recent date-keyed sessions). If older history matters later, special-case it.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- stats-partners.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/stats/partners/route.ts __tests__/stats-partners.test.ts
git commit -m "feat(value-hub): GET /api/stats/partners (co-attendance frequency)"
```

---

## Task 7: i18n strings + flag wiring

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Modify: `.github/workflows/deploy-next.yml`

- [ ] **Step 1: Add the `valueHub` namespace to `messages/en.json`**

Add this top-level key (alphabetical placement not required; match file style):

```json
"valueHub": {
  "myRacket": "My racket",
  "addRacket": "Pick your racket",
  "racketSheetTitle": "What's your racket?",
  "racketSheetHint": "Search the catalog or type your own.",
  "save": "Save",
  "recTitle": "Players like you often use",
  "recCta": "See gear",
  "recEmpty": "Add your racket to get a pick.",
  "recError": "Couldn't load — refresh to retry",
  "partnersTitle": "Your regular partners",
  "partnersEmpty": "Play a few sessions to see your regulars.",
  "partnersError": "Couldn't load — refresh to retry",
  "logGameTitle": "Log Thursday",
  "logGameHint": "How did the games go?",
  "you": "You",
  "partner": "Partner",
  "opponents": "Opponents",
  "yourScore": "Your score",
  "theirScore": "Their score",
  "logGameSubmit": "Log it",
  "logGameThanks": "Logged — thanks!"
}
```

- [ ] **Step 2: Add the same keys to `messages/zh-CN.json`**

Provide zh-CN translations (mirror the structure; a missing key falls back to English per `i18n/request.ts`, but parity is the convention). Use:

```json
"valueHub": {
  "myRacket": "我的球拍",
  "addRacket": "选择你的球拍",
  "racketSheetTitle": "你用什么球拍？",
  "racketSheetHint": "搜索目录或自行输入。",
  "save": "保存",
  "recTitle": "和你水平相近的球友常用",
  "recCta": "查看装备",
  "recEmpty": "添加你的球拍以获得推荐。",
  "recError": "加载失败 — 刷新重试",
  "partnersTitle": "你的常约搭档",
  "partnersEmpty": "多打几场就能看到你的常约搭档。",
  "partnersError": "加载失败 — 刷新重试",
  "logGameTitle": "记录本场",
  "logGameHint": "今天打得怎么样？",
  "you": "你",
  "partner": "搭档",
  "opponents": "对手",
  "yourScore": "你的得分",
  "theirScore": "对方得分",
  "logGameSubmit": "记录",
  "logGameThanks": "已记录 — 谢谢！"
}
```

- [ ] **Step 3: Wire the flag on in `deploy-next.yml`**

Find the `env:` block of the build/deploy step where `NEXT_PUBLIC_FLAG_LEDGER` etc. are set, and add:

```yaml
          NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE: 'true'
```

(The `scripts/check-flag-sync.mjs` PostToolUse hook compares `lib/flags.ts` against this file — adding the flag here clears the drift warning.)

- [ ] **Step 4: Verify i18n parity test still passes**

Run: `npm test -- i18n`
Expected: PASS (en/zh-CN key parity holds).

- [ ] **Step 5: Restart dev server (new namespace) + commit**

Per CLAUDE.md next-intl HMR gotcha — adding a brand-new top-level namespace needs a hard restart:

```bash
ps aux | grep next-server   # find PID
kill -9 <pid>
npm run dev                 # background, then smoke-load /bpm
```

```bash
git add messages/en.json messages/zh-CN.json .github/workflows/deploy-next.yml
git commit -m "chore(value-hub): valueHub i18n namespace + enable flag on bpm-next"
```

---

## Task 8: GearSheet + RacketRecCard on Profile

**Files:**
- Create: `components/profile/GearSheet.tsx`, `components/profile/RacketRecCard.tsx`
- Modify: `components/ProfileTab.tsx`
- Reference: `components/BottomSheet/`, an existing card for class names (`cc-mini-card`, `cc-pill`), `components/HomeTab.tsx` `NameAutocompleteInput` for the autocomplete pattern.

> **Read `components/ProfileTab.tsx` first** to find the signed-in render branch and the identity accessor (`getIdentity()` / the `name` in scope). Mount both new components inside the signed-in branch, wrapped in `isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')`.

- [ ] **Step 1: Implement `RacketRecCard.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function RacketRecCard({ name }: { name: string }) {
  const t = useTranslations('valueHub');
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [reason, setReason] = useState<string>('');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    if (!name) return;
    fetch(`${BASE}/api/recommend?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) { setItem(d.item); setReason(d.reason ?? ''); setLoadError(false); } })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [name]);

  // Legible-fail: distinct error pill, never a confidently-empty card.
  if (loadError) return <p className="text-red-400 text-xs" role="alert">{t('recError')}</p>;
  if (!item) return null; // loaded-empty: no rec yet, render nothing rather than a skeleton

  return (
    <div className="cc-mini-card">
      <p className="text-xs opacity-70">{t('recTitle')}</p>
      <p className="font-display text-base">{item.brand} {item.model}</p>
      <p className="text-xs opacity-70">{reason}</p>
    </div>
  );
}
```

- [ ] **Step 2: Implement `GearSheet.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import BottomSheet from '@/components/BottomSheet';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function GearSheet({
  name, open, onClose, onSaved,
}: { name: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('valueHub');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => setCatalog(d.items ?? []))
      .catch(() => setErr(true));
  }, [open]);

  const matches = catalog.filter((c) =>
    `${c.brand} ${c.model}`.toLowerCase().includes(query.trim().toLowerCase()),
  ).slice(0, 8);

  async function pick(item: CatalogItem) {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/equipment/gear`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, item: { catalogId: item.id, category: 'racket', label: `${item.brand} ${item.model}` } }),
      });
      if (!res.ok) throw new Error();
      onSaved();
      onClose();
    } catch {
      setErr(true);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <BottomSheet onClose={onClose} title={t('racketSheetTitle')}>
      <p className="text-xs opacity-70 mb-2">{t('racketSheetHint')}</p>
      <input
        className="cc-input w-full"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Yonex Astrox…"
        autoFocus
      />
      {err && <p className="text-red-400 text-xs mt-2" role="alert">{t('recError')}</p>}
      <ul className="mt-3 space-y-1">
        {matches.map((c) => (
          <li key={c.id}>
            <button className="cc-btn cc-btn-ghost w-full justify-start" disabled={saving} onClick={() => pick(c)}>
              {c.brand} {c.model}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
```

> If `BottomSheet`'s prop names differ (e.g. `isOpen`, `header`), adapt to the real signature found in `components/BottomSheet/`. The `cc-input` class: confirm it exists in `globals.css`; if not, use the same input class the adaptive sign-up form uses.

- [ ] **Step 3: Mount both in `ProfileTab.tsx` (flag-gated, signed-in branch)**

In the signed-in render, inside the settings/content area, add (using the in-scope identity `name` and `isFlagOn` imported from `@/lib/flags`):

```tsx
{isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE') && name && (
  <>
    <RacketRecCard name={name} key={gearVersion} />
    <button className="cc-btn cc-btn-secondary w-full" onClick={() => setGearOpen(true)}>
      {tVH('myRacket')}
    </button>
    <GearSheet
      name={name}
      open={gearOpen}
      onClose={() => setGearOpen(false)}
      onSaved={() => setGearVersion((v) => v + 1)}
    />
  </>
)}
```

Add the state at the top of the component: `const [gearOpen, setGearOpen] = useState(false); const [gearVersion, setGearVersion] = useState(0);` and the imports for `RacketRecCard`, `GearSheet`, `isFlagOn`. The `gearVersion` key forces the rec card to refetch after a gear save.

**Important — namespace:** `ProfileTab` already calls `useTranslations(<its-own-namespace>)`, so its `t` is bound to that namespace. Add a **second** hook for the new strings near the top of the component: `const tVH = useTranslations('valueHub');` and use `tVH('myRacket')` as shown above. Calling `t('valueHub.myRacket')` on a namespaced `t` throws `MISSING_MESSAGE` at runtime.

- [ ] **Step 4: Verify build + manual smoke**

Run: `npx tsc --noEmit`
Expected: no new errors.

Manual (dev server with `SEED_DEV_SCENARIO=fresh-thursday`): open Profile signed in as Lin → tap "My racket" → pick a racket → confirm it saves and the rec card shows a pick.

- [ ] **Step 5: Commit**

```bash
git add components/profile/GearSheet.tsx components/profile/RacketRecCard.tsx components/ProfileTab.tsx
git commit -m "feat(value-hub): Profile racket pick (GearSheet) + recommendation card"
```

---

## Task 9: PartnerFrequencyCard + GameLoggerSheet on Stats

**Files:**
- Create: `components/stats/cards/PartnerFrequencyCard.tsx`, `components/stats/GameLoggerSheet.tsx`
- Modify: `components/SkillsTab.tsx` and/or `components/stats/StatsPlaceholder.tsx`
- Reference: `components/stats/cards/AttendanceCardLive.tsx` (identity → preview-name → picker chain), `components/BottomSheet/`

> **Read `AttendanceCardLive.tsx` first** for the exact identity-resolution helper it uses (`badminton_identity` → `badminton_stats_preview_name` → picker). PartnerFrequencyCard must resolve the active name the same way so admin/incognito browsing works.

- [ ] **Step 1: Implement `PartnerFrequencyCard.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function PartnerFrequencyCard({ name }: { name: string }) {
  const t = useTranslations('valueHub');
  const [partners, setPartners] = useState<{ name: string; count: number }[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    if (!name) { setPartners([]); return; }
    fetch(`${BASE}/api/stats/partners?name=${encodeURIComponent(name)}&weeks=12`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) { setPartners(d.partners ?? []); setLoadError(false); } })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [name]);

  if (loadError) return <p className="text-red-400 text-xs" role="alert">{t('partnersError')}</p>;
  if (partners === null) return null; // loading
  return (
    <div className="cc-mini-card">
      <p className="text-xs opacity-70">{t('partnersTitle')}</p>
      {partners.length === 0
        ? <p className="text-xs opacity-60">{t('partnersEmpty')}</p>
        : (
          <ul className="mt-1 space-y-1">
            {partners.map((p) => (
              <li key={p.name} className="flex justify-between text-sm">
                <span>{p.name}</span>
                <span className="font-mono opacity-70">×{p.count}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `GameLoggerSheet.tsx` (full doubles)**

```tsx
'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import BottomSheet from '@/components/BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function GameLoggerSheet({
  you, sessionId, open, onClose, onLogged,
}: { you: string; sessionId: string; open: boolean; onClose: () => void; onLogged: () => void }) {
  const t = useTranslations('valueHub');
  const [partner, setPartner] = useState('');
  const [opp1, setOpp1] = useState('');
  const [opp2, setOpp2] = useState('');
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const valid = partner && opp1 && opp2 && scoreA !== '' && scoreB !== '';

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          teamA: [you, partner],
          teamB: [opp1, opp2],
          scoreA: Number(scoreA),
          scoreB: Number(scoreB),
          loggedBy: you,
        }),
      });
      if (!res.ok) throw new Error();
      onLogged();
      onClose();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <BottomSheet onClose={onClose} title={t('logGameTitle')}>
      <p className="text-xs opacity-70 mb-2">{t('logGameHint')}</p>
      <label className="text-xs opacity-70">{t('partner')}</label>
      <input className="cc-input w-full mb-2" value={partner} onChange={(e) => setPartner(e.target.value)} />
      <label className="text-xs opacity-70">{t('opponents')}</label>
      <div className="flex gap-2 mb-2">
        <input className="cc-input w-full" value={opp1} onChange={(e) => setOpp1(e.target.value)} />
        <input className="cc-input w-full" value={opp2} onChange={(e) => setOpp2(e.target.value)} />
      </div>
      <div className="flex gap-2 mb-3">
        <div className="w-full">
          <label className="text-xs opacity-70">{t('yourScore')}</label>
          <input className="cc-input w-full" inputMode="numeric" value={scoreA} onChange={(e) => setScoreA(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="w-full">
          <label className="text-xs opacity-70">{t('theirScore')}</label>
          <input className="cc-input w-full" inputMode="numeric" value={scoreB} onChange={(e) => setScoreB(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      {err && <p className="text-red-400 text-xs mb-2" role="alert">{t('recError')}</p>}
      <button className="cc-btn cc-btn-primary w-full" disabled={!valid || busy} onClick={submit}>
        {t('logGameSubmit')}
      </button>
    </BottomSheet>
  );
}
```

> Autocomplete polish (suggesting names from the session roster) is deferred — Slice-0 uses plain inputs. If `NameAutocompleteInput` is trivially reusable, prefer it for `partner`/`opp1`/`opp2`.

- [ ] **Step 3: Mount in the Stats tab (flag-gated)**

In `StatsPlaceholder.tsx` (or `SkillsTab.tsx` where the live cards mount), add `<PartnerFrequencyCard name={activeName} />` to the live-content area, gated by `isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')`.

**Active-name resolution:** `activeName` must come from the same chain `AttendanceCardLive` uses — `badminton_identity` → `badminton_stats_preview_name` → autocomplete picker, in that order. Read `AttendanceCardLive.tsx` and reuse whatever helper it calls (do not reimplement ad hoc). If the tab already computes this for the attendance card, reuse that value rather than resolving twice.

**48h logger gate (from the spec):** the "Log Thursday" entry button + `<GameLoggerSheet>` appear only when **both** (a) the active user attended the active (or most-recent) session, and (b) `now < session.datetime + 48h`. The 48h window is the spec's "30-second, post-session" friction model — without it the logger is always visible, which isn't the design. Compute:

```tsx
const sessionEnd = session?.datetime ? new Date(session.datetime).getTime() + 48 * 60 * 60 * 1000 : 0;
const withinLogWindow = sessionEnd > Date.now();
const showLogger = isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE') && withinLogWindow && attendedActive && !!activeName;
```

`attendedActive` = the active user's name is in the active session's player roster (the tab likely already has the roster for the attendance card; reuse it). Pass the active `sessionId` to `<GameLoggerSheet>`.

- [ ] **Step 4: Verify build + manual smoke**

Run: `npx tsc --noEmit`
Expected: no new errors.

Manual: on Stats as Lin (seeded), confirm Partner card lists co-attendees; open the logger, fill 4 names + 2 scores, submit, confirm 201 + "Logged — thanks!".

- [ ] **Step 5: Commit**

```bash
git add components/stats/cards/PartnerFrequencyCard.tsx components/stats/GameLoggerSheet.tsx components/SkillsTab.tsx components/stats/StatsPlaceholder.tsx
git commit -m "feat(value-hub): Stats partner card + full-doubles game logger"
```

---

## Task 10: Flag-off branch tests + e2e seed

**Files:**
- Modify: `lib/cosmos.ts` (extend `seedDevScenarioIfRequested`)
- Create: `__tests__/value-hub-legible-fail.test.tsx` (component-level off branch)

- [ ] **Step 1: Write a flag-off route test (already covered per-route, add a component off test)**

`__tests__/value-hub-legible-fail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import RacketRecCard from '@/components/profile/RacketRecCard';

function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

describe('RacketRecCard', () => {
  afterEach(cleanup);
  beforeEach(() => {
    // jsdom has no fetch by default; stub a never-resolving one so the card stays in loading (null) state.
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
  });

  it('renders nothing while loading (no confidently-empty card)', () => {
    const { container } = render(wrap(<RacketRecCard name="Lin" />));
    expect(container).toBeEmptyDOMElement();
  });
});
```

> The route-level off branches (404 when flag off) are already asserted in Tasks 2–6. This component test guards the legible-fail contract: the card renders nothing (not a fake-empty pick) before data arrives.

- [ ] **Step 2: Run it to verify it passes**

Run: `npm test -- value-hub-legible-fail.test.tsx`
Expected: PASS.

- [ ] **Step 3: Extend the dev seed for e2e**

In `lib/cosmos.ts` `seedDevScenarioIfRequested`, when the requested container is `equipmentCatalog`, seed the 15 rackets from `scripts/data/equipment-catalog.json` (`items` array). When `gameResults`, seed one sample game for the seeded session so the logger/partner flow has prior data. Mirror the existing guard (refuse when real Cosmos is configured) and the existing per-container `switch`/`if` structure already in that function.

Concretely, add a branch (adapt to the function's real shape):

```typescript
if (containerName === 'equipmentCatalog') {
  // Lazy import to avoid bundling JSON into prod paths.
  const seed = require('@/scripts/data/equipment-catalog.json');
  for (const item of seed.items as unknown[]) {
    store.set((item as { id: string }).id, item);
  }
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — all prior tests plus the ~12 new value-hub tests green. Note the new total in the commit message.

- [ ] **Step 5: Commit**

```bash
git add lib/cosmos.ts __tests__/value-hub-legible-fail.test.tsx
git commit -m "test(value-hub): flag-off legible-fail guard + e2e dev seed for Slice-0"
```

---

## Task 11: Verification before completion

- [ ] **Step 1: Full type + test gate**

```bash
npx tsc --noEmit && npm test
```
Expected: clean tsc, full suite green. Record the test count.

- [ ] **Step 2: Manual e2e on the mock store**

```bash
COSMOS_CONNECTION_STRING= SEED_DEV_ADMIN=Lin:2468 SEED_DEV_SCENARIO=fresh-thursday npm run dev
```
Walk: Profile (signed in as Lin) → pick racket → rec card updates → Stats → partner card populated → Log Thursday → submit a doubles result → confirm 201. Toggle `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE` off (rebuild) → confirm all four surfaces vanish and the routes 404.

- [ ] **Step 3: Push (after local verify per feedback rule)**

```bash
git push origin main
```
bpm-next auto-deploys with the flag on. Add a soak entry to `.claude/soak.local.md` (`release: value-hub-slice-0`, 5-7 day window) so the SessionStart hook tracks it.

- [ ] **Step 4: Update memory**

Update `project_status.md` (Slice-0 shipped to bpm-next, test count) and `project_value_hub_initiative.md` (Slice-0 implementation landed; kill-criterion clock starts at deploy date; correct the stale "not merged to main" line about PR #95).

---

## Self-Review

**Spec coverage** (against `docs/plans/value-hub-slice-0.md` Slice-0 section):
- ✅ Catalog seeded, rackets only (~15) — Task 2 reads it; Task 10 seeds it for dev. (Seed JSON already exists from PR #95.)
- ✅ Gear: single "What's your racket?" on Profile — Task 8.
- ✅ Game results: 30s post-session sheet — Task 9 (full-doubles per ratified decision, not the plan's minimal "you vs partner"; richer data, user's call).
- ✅ Recommend: one deterministic card, filter by stage, top-1 — Tasks 1 + 5 + 8. All-rounder fallback for the (common) no-stage case.
- ✅ Stats: partner-frequency card — Tasks 1 + 6 + 9.
- ✅ Single flag `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE` gates every surface — every route + component.
- ✅ Kill criterion preserved (not implemented in code — it's a measurement decision): 4 weeks live, ≥40% rec-card repeat AND ≥30% log a game.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Each code step has complete code. UI tasks carry a "read the host component first" note because exact prop names of `BottomSheet`/`ProfileTab`/`StatsPlaceholder` must be confirmed against the real files — the integration snippets are complete but may need prop-name adaptation, which is called out explicitly rather than left vague.

**Type consistency:** `recommendRacket({ stage?, gamesPlayed?, catalog })` and `topPartners({ me, sessions, limit? })` signatures match between Task 1 (definition + tests) and Tasks 5/6 (callers). `GameResult` fields (`teamA`/`teamB`/`scoreA`/`scoreB`/`loggedBy`/`loggedAt`) match `lib/types.ts` and are used identically in Task 4 (route), Task 9 (logger), and the seed. `PlayerGear`/`GearItem` fields match `lib/types.ts` in Task 3 + Task 8. Container names + partition keys (`equipmentCatalog`/`category`, `playerGear`/`memberId`, `gameResults`/`sessionId`) are consistent across Tasks 2–6 and the seed.

**Known adaptation points (not failures, flagged for the executor):**
1. `BottomSheet` prop names (`onClose`/`title` vs `isOpen`/`header`) — confirm in `components/BottomSheet/`.
2. `cc-input` class existence — confirm in `globals.css`; fall back to the sign-up form's input class if absent.
3. `ProfileTab`/`StatsPlaceholder`/`SkillsTab` exact mount points + identity accessors — read first.
4. `seedDevScenarioIfRequested` internal structure (the `store.set` vs array-push shape) — adapt to the real function.
