# Stringing Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Intent:** `docs/plans/stringing-audit-fixes.md` · **Audit:** `.impeccable/critique/2026-10-11T08-08-31Z__components-stringing-stringingcard-tsx.md`

**Goal:** Close the nine role-level defects and three light-theme accessibility failures the 2026-10-11 stringing audit measured, in the order Grant chose: sheet + card, notification, copy, tokens, dates, bench layout, tap targets.

**Architecture:** Every change rides existing seams. The player card and sheet are component-local fixes; the request push reuses `sendPushToMembers` + `rosterMembers`; the new `requested` stage is one more member of `PlayerStage` with every consumer updated; the bench reorder moves JSX blocks inside `StringingPage`; tokens change in `globals.css` only. No new container, route shape or flag.

**Tech Stack:** Next.js 16 / React 19, next-intl, vitest + jsdom component tests, the in-memory mock store.

**Spec:** `docs/plans/stringing-audit-fixes.md` (Decisions section is the spec; this plan argues from it).

## Global Constraints

- Every new user-facing string exists in BOTH `messages/en.json` and `messages/zh-CN.json` (PRODUCT.md; `scripts/check-i18n-keys.mjs` runs on edit).
- Admin surfaces (`components/admin/**`) stay hard-coded English; member surfaces go through `t()` (CLAUDE.md "admin surfaces are English-only").
- No push payload carries money (CLAUDE.md "The push carries no money").
- Player-facing job data goes only through `toPlayerJob` (strip canary).
- Inline styles use spacing/size tokens, never raw numbers except the sanctioned 44px tap floor (spacing-canary; `minHeight: 44` is the documented exception shape).
- Run `npm test` AND `npm run lint` between tasks (CLAUDE.md "per-task review scoped to its own diff").
- Commit per task, locally; no push until Grant has verified on localhost (memory: `feedback_local_verify_before_push`).

## Review Focus

1. A player with one job AND a pending edit on an older job: the banner must point at the job that has the edit, not the newest — Task 2 tests `pendingEdit` on the second row.
2. A `requested` job that the admin moves straight to `strung`: the player stage jumps two steps and the strip must not claim "Drop off" is still current — Task 5 maps `strung` → index 2 as before.
3. Push recipients when the requester is themselves `canString` (Lin after Task 3's seed): they must not be pushed about their own request — Task 3 tests the exclusion.
4. Undo on the stringer card after a job was moved by someone else in between: the PATCH sends the remembered previous status; the route accepts any status, so the row simply reflects the server's answer — Task 7 tests Undo sends `status: from`.
5. Light tokens: the new `--segment-active-text` is read by every segment control in the app (Mine/All, Stats registers); Task 6 asserts the ratio numerically so a later tint change cannot silently fail again.

---

### Task 1: Request sheet resets when it opens

**Files:**
- Modify: `components/stringing/RequestStringingSheet.tsx:62-104`
- Test: `__tests__/components/RequestStringingSheet.test.tsx`

**Interfaces:**
- Consumes: `open: boolean` prop (existing).
- Produces: nothing new; the sheet simply starts blank on every open.

- [ ] **Step 1: Write the failing test** (append inside the file's existing `describe` block, or a new one)

```tsx
describe('reopening the sheet', () => {
  it('starts a fresh form after a send, not the old "Sent." screen', async () => {
    const fetchMock = mockApi(['BG80 white']);
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open onClose={() => {}} onRequested={() => {}} gear={null} />
      </NextIntlClientProvider>,
    );
    await fillRacket();
    fireEvent.change(await screen.findByLabelText('Which string?'), { target: { value: 'BG80 white' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByRole('status')).toBeDefined();
    expect(fetchMock).toHaveBeenCalled();

    // Close, then open again — the same mounted component, as HomeShell does.
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open={false} onClose={() => {}} onRequested={() => {}} gear={null} />
      </NextIntlClientProvider>,
    );
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open onClose={() => {}} onRequested={() => {}} gear={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect((await screen.findByLabelText('Which racket?') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Send the request' })).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/components/RequestStringingSheet.test.tsx` → FAIL: `queryByRole('status')` is not null.

- [ ] **Step 3: Implement** — in `RequestStringingSheet`, after the state declarations:

```tsx
  /* A fresh form every time the sheet opens. `done` and the fields are
     component state and the sheet stays MOUNTED between opens (StringingCard
     renders it unconditionally), so without this a second "Submit a request"
     reopened onto the previous "Sent." screen with no form — a second racket
     needed a page reload (audit 2026-10-11, finding 02). */
  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    setBusy(false);
    setRacketLabel('');
    setCustomRacket(false);
    setPickedString('');
    setCustomString('');
    setTension(26);
    setCrosses(28);
    setCustom(false);
  }, [open]);
```

(Place it below the `useState` block so every setter is in scope; `useEffect` is already imported.)

- [ ] **Step 4: Run** the file again → PASS. Then `npm run lint` (the `react-hooks/set-state-in-effect` rule: these are synchronous resets keyed on a prop transition, the documented allowed shape; if it flags, wrap the body in `queueMicrotask` is NOT acceptable — instead move the reset into the `onClose` handler path AND an `open` effect guarded by a `wasOpen` ref).

- [ ] **Step 5: Commit** — `git commit -am "fix(stringing): the request sheet starts blank on every open"`

---

### Task 2: The player card lists every open racket

**Files:**
- Modify: `components/stringing/StringingCard.tsx:199-390`
- Test: `__tests__/components/StringingCard.test.tsx`

**Interfaces:**
- Consumes: `PlayerStringingJob[]` from `GET /api/stringing/jobs?view=player` (unchanged).
- Produces: `openJobs` (every job whose stage is known and not `done`, server order: pinned first then newest), `lead = openJobs[0]` (drives the strip and the restring reminder), banners per job.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('every open racket is listed', () => {
  const two = [
    { id: 'j2', jobNo: 'J-0002', stage: 'with_stringer', stageIndex: 0, racketLabel: 'Nanoflare 800 Pro', stringLabel: 'Exbolt 63', tensionMains: 27, tensionCrosses: 29, method: '', priceRange: null, amountDue: null, readyBy: null, paid: false, pendingEdit: null, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'j1', jobNo: 'J-0001', stage: 'ready_for_you', stageIndex: 2, racketLabel: 'Astrox 88D Pro', stringLabel: 'BG80 white', tensionMains: 26, tensionCrosses: 28, method: '', priceRange: '$28–32', amountDue: 30, readyBy: null, paid: false, pendingEdit: { proposedAt: '2026-10-03T00:00:00Z', priceFrom: null, priceTo: 30 }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' },
  ];

  it('renders a row per open job, not only the first', async () => {
    mockApi(true, two);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /Stringing service/ }));
    expect(await screen.findByText('Nanoflare 800 Pro')).toBeDefined();
    expect(screen.getByText('Astrox 88D Pro')).toBeDefined();
  });

  it('shows the ready banner and the confirm banner for the job that has them, even when it is not the newest', async () => {
    mockApi(true, two);
    wrap();
    expect(await screen.findByText('Your racket is ready')).toBeDefined();
    expect(screen.getByText(/Astrox 88D Pro \(J-0001\) is strung/)).toBeDefined();
    expect(screen.getByText(/please confirm/)).toBeDefined();
  });

  it('hides nothing when there is one job (unchanged behaviour)', async () => {
    mockApi(true, [two[0]]);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /Stringing service/ }));
    expect(await screen.findByText('Nanoflare 800 Pro')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run** → FAIL (second racket missing; banners attach to the newest only).

- [ ] **Step 3: Implement.** Replace the `active` derivation and every `active` use:

```tsx
  // Every open job, server order (pinned first, then newest). Guarded on the
  // stage being one this card has copy for: `t()` throws on a missing key.
  const openJobs = (jobs ?? []).filter(
    (j) => KNOWN_STAGES.includes(j?.stage as string) && j.stage !== 'done',
  );
  // The racket the strip and the restring line talk about. One strip, not one
  // per row: the strip is the glance answer, the rows are the detail.
  const lead = openJobs[0] ?? null;
  const pendingJob = openJobs.find((j) => j.pendingEdit) ?? null;
  const readyJobs = openJobs.filter((j) => j.stage === 'ready_for_you');
  const collapsible = lead !== null;
  const restringWeeks =
    jobs !== null && lead === null ? restringDueWeeks(shopStrungAt, new Date()) : null;
```

Then:
- the confirm banner renders when `pendingJob` is set and its text uses `pendingJob.racketLabel`; `setConfirming(true)` opens `ConfirmChangeSheet` with `job={pendingJob}`;
- the ready banner becomes `readyJobs.map((j) => <StatusBanner key={j.id} … body={t('ready.body', { racket: j.racketLabel, jobNo: j.jobNo })} />)`;
- the strip uses `stepForStage(lead?.stage ?? null)`;
- the collapsed `cc-mini-card` row becomes a `flex-col gap-3` list of one row per `openJobs` entry (same markup, keyed by `j.id`, each with its own stage line and `amountDue ?? priceRange`).

- [ ] **Step 4: Run** the file and `npm test` → PASS. `npm run lint`.

- [ ] **Step 5: Commit** — `git commit -am "fix(stringing): the player card lists every open racket, with banners on the job that has them"`

---

### Task 3: A new request notifies every stringer and admin of the group

**Files:**
- Create: `lib/stringingRequestNotify.ts`
- Modify: `lib/pushMessages.ts` (append `buildRequestPayload`), `app/api/stringing/requests/route.ts:599-603`
- Test: `__tests__/stringing-request-notify.test.ts` (new)

**Interfaces:**
- Produces: `buildRequestPayload(job: { jobNo: string; memberName: string; racketLabel?: string | null }): PushPayload`; `notifyStringersOfRequest(job: StringingJob, groupId: string): Promise<{ recipients: number; sent: number }>` — never throws.
- Consumes: `rosterMembers(groupId)` from `lib/roster.ts` (`RosterEntry.member.canString`, `.member.role`, `.member.id`), `sendPushToMembers` from `lib/push.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '../app/api/stringing/requests/route';
import { PATCH as SHOP } from '../app/api/stringing/shop/route';
import { PATCH as MEMBERS } from '../app/api/members/route';
import { resetMockStore, setupAdminPin, seedTestAdminMember, makeRequest, makeAdminRequest, memberCookieValue, getStore } from './helpers';
import { buildRequestPayload } from '../lib/pushMessages';

const sendPushToMembers = vi.fn(async (_ids: string[], _p: unknown) => ({ configured: true, sent: 1, failed: 0, removed: 0 }));
vi.mock('@/lib/push', async (orig) => ({ ...(await orig<typeof import('@/lib/push')>()), sendPushToMembers: (ids: string[], p: unknown) => sendPushToMembers(ids, p) }));

const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const before = process.env[FLAG];
const VALID = { racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80 white', tensionMains: 26, tensionCrosses: 28 };

beforeEach(async () => {
  resetMockStore(); setupAdminPin(); await seedTestAdminMember(); process.env[FLAG] = 'true';
  sendPushToMembers.mockClear();
  await SHOP(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
});
afterEach(() => { if (before === undefined) delete process.env[FLAG]; else process.env[FLAG] = before; });

async function seedMember(id: string, name: string, extra: Record<string, unknown> = {}) {
  await getStore().container('members').items.create({ id, name, role: 'member', active: true, createdAt: new Date().toISOString(), ...extra });
}

describe('a new request reaches the people who string', () => {
  it('pushes every canString member and every admin, never the requester', async () => {
    await seedMember('m-wei', 'wei');
    await seedMember('m-zach', 'zach', { canString: true });
    await seedMember('m-lin', 'lin', { canString: true });
    await seedMember('m-sam', 'sam');
    const res = await POST(makeRequest('POST', 'http://x/api/stringing/requests', VALID, { Cookie: `member_session=${memberCookieValue('lin')}` }));
    expect(res.status).toBe(201);
    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    const [ids, payload] = sendPushToMembers.mock.calls[0] as [string[], { title: string; body: string }];
    expect(new Set(ids)).toEqual(new Set(['m-zach', (await seedAdminId())]));
    expect(ids).not.toContain('m-lin');
    expect(ids).not.toContain('m-sam');
    expect(payload.body).not.toMatch(/\$|lb|BG80/);
    expect(payload.body).toContain('Astrox 99 Pro');
  });

  it('the request still succeeds when push throws', async () => {
    await seedMember('m-lin', 'lin');
    sendPushToMembers.mockRejectedValueOnce(new Error('push down'));
    const res = await POST(makeRequest('POST', 'http://x/api/stringing/requests', VALID, { Cookie: `member_session=${memberCookieValue('lin')}` }));
    expect(res.status).toBe(201);
  });
});

describe('buildRequestPayload', () => {
  it('names the player and racket, carries no spec and opens the bench', () => {
    const p = buildRequestPayload({ jobNo: 'J-0007', memberName: 'Lin', racketLabel: 'Astrox 88D Pro' });
    expect(p.title).toBe('New stringing request');
    expect(p.body).toBe("Lin's Astrox 88D Pro is waiting on the bench.");
    expect(p.url).toMatch(/tab=admin/);
    expect(p.tag).toBe('str-J-0007-request');
  });
});
```

(`seedAdminId` = read the admin member's id from `getStore().container('members')` by the name `seedTestAdminMember` uses — check `__tests__/helpers.ts` for the constant and inline it.)

- [ ] **Step 2: Run** → FAIL: `buildRequestPayload` is not exported; `sendPushToMembers` not called.

- [ ] **Step 3: Implement.** `lib/pushMessages.ts`, after `buildPendingEditPayload`:

```ts
/**
 * "Somebody wants a restring" — to the people who string, not the club.
 *
 * Player and racket only. No string, no tension, no price: the spec is on the
 * bench one tap away, and a lock screen is not the place for it. Opens the
 * admin tab; `AdminDashboard` reads `?tab=admin` and the bench is one row in.
 */
export function buildRequestPayload(job: { jobNo: string; memberName: string; racketLabel?: string | null }): PushPayload {
  const racket = job.racketLabel?.trim() || 'racket';
  return {
    title: 'New stringing request',
    body: `${job.memberName}'s ${racket} is waiting on the bench.`,
    url: `${BASE}/?tab=admin`,
    tag: safeTag(`str-${job.jobNo}-request`),
  };
}
```

`lib/stringingRequestNotify.ts`:

```ts
/**
 * Tell the stringers a request came in (docs/plans/stringing-audit-fixes.md).
 *
 * RECIPIENTS: every `canString` member AND every admin of the GROUP, minus the
 * requester (Grant, 2026-10-11: "All stringer"). Resolved through the roster
 * so a second club's stringers never hear about this club's rackets —
 * `pushSubscriptions` is person-scoped and nothing on the row could separate
 * them.
 *
 * Same contract as the player notices: never throws, never fails the request.
 */
import { rosterMembers } from './roster';
import { sendPushToMembers } from './push';
import { buildRequestPayload } from './pushMessages';
import type { StringingJob } from './types';

export async function requestRecipients(groupId: string, requesterId: string): Promise<string[]> {
  const roster = await rosterMembers(groupId);
  return roster
    .filter(({ member }) => member.id !== requesterId && (member.canString === true || member.role === 'admin'))
    .map(({ member }) => member.id);
}

export async function notifyStringersOfRequest(job: StringingJob, groupId: string): Promise<{ recipients: number; sent: number }> {
  try {
    const ids = await requestRecipients(groupId, job.memberId);
    if (ids.length === 0) return { recipients: 0, sent: 0 };
    const { sent } = await sendPushToMembers(ids, buildRequestPayload(job));
    return { recipients: ids.length, sent };
  } catch (err) {
    console.error('[stringing] request notify failed (the request stands):', err);
    return { recipients: 0, sent: 0 };
  }
}
```

`app/api/stringing/requests/route.ts`, after `await scope.create('stringingJobs', job);`:

```ts
    // Best-effort, awaited, never able to fail the request — the same posture
    // as the player notices on the bench PATCH.
    await notifyStringersOfRequest(job, groupId);
```

with `import { notifyStringersOfRequest } from '@/lib/stringingRequestNotify';`.

- [ ] **Step 4: Run** the new test, then `__tests__/stringing-requests.test.ts` and `__tests__/stringing-push.test.ts` (the latter mocks `@/lib/push` wholesale — confirm it still passes), then `npm test` → PASS. `npm run lint`.

- [ ] **Step 5: Commit** — `git commit -am "feat(stringing): a new request pushes every stringer and admin of the group"`

---

### Task 4: Requests and late jobs count as "need you"; the bench row comes first with its count

**Files:**
- Modify: `lib/useAdminNeedsYou.ts:47-80`, `components/admin/CommandCenter/CommandCenter.tsx:209-224`
- Test: `__tests__/components/AdminNeedsYou.test.tsx` if it exists (`grep -l useAdminNeedsYou __tests__ -r`), else a new `__tests__/components/AdminNeedsYouStringing.test.tsx`

**Interfaces:**
- Consumes: `GET /api/stringing/jobs` (bench projection, admin cookie) — rows have `stringerId`, `status`, `readyBy`, `paidAt`.
- Produces: `AdminNeedsYou` gains `stringing: { waiting: number; late: number } | null`; `needsYou` counts a fourth signal when `waiting + late > 0`.

- [ ] **Step 1: Write the failing test** — render a probe component that calls `useAdminNeedsYou(true)`, with `fetch` stubbed to answer `/api/players` `[]`, `/api/birds` `{}`, `/api/members` `[]` and `/api/stringing/jobs` `{ jobs: [ {stringerId: null, status: 'requested', readyBy: null, paidAt: null}, {stringerId: 'g', status: 'received', readyBy: '2000-01-01', paidAt: null} ] }`; assert `needsYou === 1` and `stringing` equals `{ waiting: 1, late: 1 }`. A second case: `/api/stringing/jobs` answers 404 (flag off) → `needsYou` unchanged by stringing and `stringing === null`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Add the fetch to the `Promise.all` (a 404 is "flag off", not a failure: `stringingRes.status === 404 ? null : …`), compute with `dueFor` from `lib/stringingDue`:

```ts
const waiting = jobs.filter((j) => j.stringerId === null && j.status === 'requested').length;
const late = jobs.filter((j) => dueFor(j, todayIso()).tone === 'overdue').length;
```

and `setNeedsYou([unpaid > 0, birdsLow, dormant > 0, waiting + late > 0].filter(Boolean).length)`.

In `CommandCenter.tsx`, move the `Stringing bench` entry to the FRONT of the rows array and give it a trailing count read from the same hook (`const { stringing } = useAdminNeedsYou(true)` already exists in Profile; the console reads it via a prop or its own call — follow whichever `CommandCenter` already has; if none, call the hook here). Row label: `'Stringing bench'`; add an optional `trailing?: string` to the row shape rendered as `<span className="fs-sm" style={{ color: 'var(--text-muted)' }}>` before the chevron: `"3 waiting · 1 late"` (omit a zero half; omit entirely when both are zero or unknown).

- [ ] **Step 4: Run** tests + lint → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(admin): unclaimed and late stringing jobs count as need-you; the bench row leads with the count"`

---

### Task 5: Copy pass — a `requested` player stage, intake fallbacks, stringer status words, sheet subtitle, "Grant"

**Files:**
- Modify: `lib/stringing.ts:65-96`, `components/stringing/StringingSteps.tsx:21-35`, `components/stringing/StringingCard.tsx:28`, `components/stringing/StringerJobsCard.tsx:796`, `components/admin/CommandCenter/StringingIntake.tsx` (none — keys only), `messages/en.json`, `messages/zh-CN.json`
- Test: `__tests__/stringing-rules.test.ts:77`, `__tests__/components/StringerJobsCard.test.tsx`, `__tests__/i18n/canary-strings.test.tsx` (add the new keys)

**Interfaces:**
- Produces: `PlayerStage = 'requested' | 'with_stringer' | 'being_strung' | 'ready_for_you' | 'done'`; `PLAYER_TRACK` gains `'requested'` first; `playerStageFor('requested') === 'requested'`; `stepForStage('requested') === 1`, `stepForStage('with_stringer') === 2`.

- [ ] **Step 1: Failing tests.** In `stringing-rules.test.ts` replace the "collapses requested and received" case with:

```ts
  it('keeps requested apart from received: a racket still in the bag is not "with" anybody', () => {
    expect(playerStageFor('requested')).toBe('requested');
    expect(playerStageFor('received')).toBe('with_stringer');
    expect(playerStageIndex('requested')).toBeLessThan(playerStageIndex('received'));
  });
```

In `StringerJobsCard.test.tsx` add: the advance button for a `received` job reads `Mark strung`, and for a `ready` job `Mark picked up`, rendered from the status words rather than the raw key (assert against `enMessages.admin.stringing.status.strung.toLowerCase()`).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`lib/stringing.ts`: add `'requested'` to `PlayerStage` and to the front of `PLAYER_TRACK`; `playerStageFor`: `case 'requested': return 'requested'; case 'received': return 'with_stringer';`. Rewrite the docblock above it: the fold was argued from an in-person hand-over; the remote request sheet is now the main way a job starts, so "with the stringer" is only true from `received`.

`StringingSteps.tsx`: `case 'requested': return 1; case 'with_stringer': case 'being_strung': return 2; case 'ready_for_you': case 'done': return 3; default: return 0;`.

`StringingCard.tsx`: `KNOWN_STAGES = ['requested', 'with_stringer', 'being_strung', 'ready_for_you', 'done']`.

`StringerJobsCard.tsx`: `const tStatus = useTranslations('admin.stringing');` and the button label `t('stringerAdvance', { status: t(\`next.${nextStatus}\`) })`.

`messages/en.json` `home.stringing`:
- `stage.requested`: `"Waiting for your racket"`; `stage.with_stringer`: `"With the stringer"`
- `next`: `{ "received": "received", "strung": "strung", "ready": "ready", "picked_up": "picked up" }`
- `requestSubtitle`: `"Tell the stringer what you'd like, then hand over the racket at the session."`; delete `requestBody`
- `requestSent`: `"Sent. Hand over the racket at the session and the price gets confirmed then."`
- `needName`: `"Sign in first, so the request has a name on it."`
- `pricingEmpty`: `"No prices posted yet — the price is confirmed when the racket is taken."`
- `noStringsYet`: `"No string list yet, so type the one you'd like."`
- `confirm.banner`: `"Something changed — please confirm"`; `confirm.intro`: `"Your {racket} has an update. Nothing changes on your bill until you say yes."`
- `error.shop_closed`: `"The stringing service isn't taking rackets right now. Try again another week."`; `error.too_many_open`: `"You've already got a few rackets in — collect those first."`
- `admin.stringing.playerStage.requested`: `"Waiting for their racket"`; `admin.stringing.theyFallback`: `"The player"`; `admin.stringing.saveAndTell`: `"Save job"` (the POST sends nothing; the label stops claiming it does — `docs/plans/stringing-audit-fixes.md`).

`messages/zh-CN.json` the same keys:
- `stage.requested`: `"等你送拍"`; `stage.with_stringer`: `"穿线师已收到"`
- `next`: `{ "received": "已收到", "strung": "已穿好", "ready": "可取", "picked_up": "已取走" }`
- `requestSubtitle`: `"告诉穿线师你的要求，场次上把拍子交过去。"`; delete `requestBody`
- `requestSent`: `"已发送。场次上把拍子交过去，到时确认价格。"`
- `needName`: `"先登录，申请才有名字。"`
- `pricingEmpty`: `"还没公布价格，收拍时会跟你确认。"`
- `noStringsYet`: `"还没有拍线列表，直接写你想要的。"`
- `confirm.banner`: `"有改动，请确认"`; `confirm.intro`: `"你的 {racket} 有更新。你点确认之前，账单不会变。"`
- `error.shop_closed`: `"穿线服务现在不收拍子，改天再来。"`; `error.too_many_open`: `"你已经有几支拍子在排队了，先取回来再说。"`
- `admin.stringing.playerStage.requested`: `"等对方送拍"`; `theyFallback`: `"对方"` (unchanged); `saveAndTell`: `"保存"`

Grep for every remaining `Grant` under `home.stringing` in both files after editing; the count must be 0 (`node -e` one-liner from the audit).

- [ ] **Step 4: Run** `node scripts/check-i18n-keys.mjs`, `npm test`, `npm run lint` → PASS. Update `__tests__/stringing-notify.test.ts` if it asserts the `PLAYER_TRACK` length.

- [ ] **Step 5: Commit** — `git commit -am "copy(stringing): a requested stage of its own; intake, stringer and sheet copy stop lying"`

---

### Task 6: Light-theme ink tokens

**Files:**
- Modify: `app/globals.css:359, 469-470, 4562-4566`
- Test: `__tests__/design-canary.test.ts` (append a numeric contrast pin)

- [ ] **Step 1: Failing test** — append to `design-canary.test.ts` a `describe('light-theme ink on tints clears 4.5:1')` that parses `globals.css` for the three values and computes WCAG contrast with a 20-line helper (relative luminance from hex; alpha-composite the tint over `#faf8f5`):

```ts
expect(contrast(light('--segment-active-text'), composite('rgba(21,128,61,0.14)', '#faf8f5'))).toBeGreaterThanOrEqual(4.5);
expect(contrast(lightRule('.cc-btn-primary', 'color'), composite('rgba(22,163,74,0.12)', '#faf8f5'))).toBeGreaterThanOrEqual(4.5);
expect(contrast(lightRule('.text-amber-300', 'color'), '#fcefdc')).toBeGreaterThanOrEqual(4.5);
```

- [ ] **Step 2: Run** → FAIL on all three (3.55, 4.16, 4.43).

- [ ] **Step 3: Implement.** `--segment-active-text: #166534;` (light block, line 359). `[data-theme="light"] .cc-btn-primary { color: #166534; }`. `[data-theme="light"] .text-amber-300 { color: #9a4408; }` and the matching `.text-amber-400` line; leave the `hover:` variants as they are. Add a one-line comment at each: the measured failing ratio and the date.

- [ ] **Step 4: Run** the canary + `npm test` + lint → PASS.

- [ ] **Step 5: Commit** — `git commit -am "design(light): accent ink on tints clears 4.5:1 (segment, cc-btn-primary, amber banner)"`

---

### Task 7: Dates — ready-by on the detail screen, due on the stringer card, and Undo

**Files:**
- Modify: `components/admin/CommandCenter/StringingJobDetail.tsx:450-463`, `components/stringing/StringerJobsCard.tsx`
- Test: `__tests__/components/StringingBench.test.tsx`, `__tests__/components/StringerJobsCard.test.tsx`
- i18n: `home.stringing.stringerDue` → `"Ready by {date}"` / `"要在 {date} 前完成"`, `home.stringing.stringerUndo` → `"Undo"` / `"撤销"`

- [ ] **Step 1: Failing tests.** Bench test: render `StringingJobDetail` with `readyBy: null`, change the date input (`DatePicker` renders an input with `placeholder` from `admin.stringing.readyByPlaceholder`; use `screen.getByPlaceholderText`), assert `fetch` PATCH body contains `readyBy: '2026-10-20'` and no `propose` key. Stringer test: a job with `readyBy: '2000-01-01'` renders a line matching `/late/`; after clicking `Mark strung` the row shows `Undo`, and clicking it PATCHes `{ memberId, status: 'received' }`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Detail: under the `readyBy` line in the price card render `<DatePicker value={local.readyBy ?? ''} onChange={(d) => patch({ readyBy: d || null })} placeholder={t('readyByPlaceholder')} />` (import `DatePicker`), keeping the formatted line for legacy free-text rows. Stringer card: `const tAdmin = useTranslations('admin.stringing'); const due = dueFor(job, todayIso());` render under the spec line, coloured by the same `DUE_FG` map the bench uses (copy the four-entry map; it is tokens, not pixels); keep `lastMove` state `{ jobId: string; from: StringingStatus } | null`, set in `advance` before the PATCH, cleared on the next advance; render `<button className="cc-btn cc-btn-ghost" onClick={() => advance(job, lastMove.from)}>{t('stringerUndo')}</button>` beside the advance button when `lastMove?.jobId === job.id`. Comment: a push already sent is not retracted.

- [ ] **Step 4: Run** tests + lint → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(stringing): ready-by on the detail screen; the stringer sees the date and can undo a tap"`

---

### Task 8: Bench lists first; set-up folds

**Files:**
- Modify: `components/admin/CommandCenter/StringingPage.tsx:548-690`
- Test: `__tests__/components/StringingBench.test.tsx`

- [ ] **Step 1: Failing test** — render `StringingPage` with one job; assert `screen.getByText('J-0042').compareDocumentPosition(screen.getByText('Strings you stock')) & Node.DOCUMENT_POSITION_FOLLOWING` is truthy (the job row precedes the stock card), and that `Strings you stock` is inside a collapsed section (`getByRole('button', { name: /Set-up/ })` has `aria-expanded="false"`).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Order inside the bench `div`: shop sign card (unchanged) → Mine/All → error/skeleton/empty/list → Add job → Archived → a `glass-card p-5` with a full-width toggle button (`section-label` "Set-up", `motion-chevron`, `aria-expanded`, `minHeight: 44`) over `<Collapse open={setupOpen} spaceAbove="var(--space-3)">` containing `<OfferedStringsCard />`, `<StringStockCard />`, `<PricingCard />` in a `flex flex-col gap-4`. `setupOpen` state defaults `false`. Update the comment block that explains why the sign sits with the set-up cards: the sign stays up top because closing the shop is the admin's most consequential action; the rest folds (Grant, 2026-10-11: "bench first").

- [ ] **Step 4: Run** tests + lint → PASS. Then LOOK (verify-ui): bench at 430 wide, the first job row must be inside the first screen.

- [ ] **Step 5: Commit** — `git commit -am "design(bench): the list first; strings, stock and prices fold under Set-up"`

---

### Task 9: Tap-target minimums

**Files:**
- Modify: `components/admin/CommandCenter/PricingCard.tsx:1248`, `StringingPage.tsx:336`, `StringingJobDetail.tsx:506`, `components/stringing/StringingCard.tsx:243`
- Test: none runnable in jsdom (layout); verify with the probe in the browser.

- [ ] **Step 1:** PricingCard arrows: `style={{ padding: '0 var(--space-2)', minHeight: 24, minWidth: 28, lineHeight: 1 }}` (24 is the WCAG 2.5.8 floor, the same documented exception as 44). Bench ⋮: `minWidth: 44, minHeight: 44, margin: 'calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) 0'` so the hit area grows without moving the glyph. Detail "CHANGE THIS JOB" toggle: `minHeight: 44`. Player card header button: `minHeight: 44`.

- [ ] **Step 2:** `npm test`, `npm run lint`, then boot `PORT=3105 npm run dev:next:mock` and re-run `probe-core.js` on the bench: `tapTargets.tooSmall` must be `[]`.

- [ ] **Step 3: Commit** — `git commit -am "design(stringing): every bench and card control clears the 24px floor"`

---

### Task 10: Docs and hand-off

- [ ] Update `docs/plans/stringing-audit-fixes.md` Status to `shipped <date>` once merged (not now).
- [ ] Update the CLAUDE.md stringing bullets: the "two vocabularies" comment in `lib/stringing.ts` now has five player stages; the request route notifies; the bench order. Keep to the existing bullets, no new section.
- [ ] Run the full suite and lint once more; boot the mock on :3105 and leave it up for Grant to verify on localhost (memory: `feedback_local_verify_before_push`). Do not push.
