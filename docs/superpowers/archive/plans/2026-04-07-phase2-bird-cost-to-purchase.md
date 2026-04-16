# Phase 2: Tie Bird Cost to a Specific Purchase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When admin sets bird tubes used for a session, they pick which specific purchase the tubes came from. The cost locks to that purchase's price — no more floating cost from "latest purchase" lookup.

**Architecture:** Add `purchaseId` and `purchaseName` to the `birdUsage` type. Change the session PUT handler from a "latest purchase" query to a point read by purchaseId. Add a purchase dropdown to SessionDetailsEditor. Backward compatible — old sessions without purchaseId still display fine.

**Tech Stack:** Next.js API routes, Cosmos DB, React, TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/types.ts` | Modify | Add purchaseId + purchaseName to birdUsage |
| `app/api/session/route.ts` | Modify | Change PUT handler to look up specific purchase by ID |
| `__tests__/session.test.ts` | Modify | Add tests for bird usage with purchaseId |
| `components/admin/SessionDetailsEditor.tsx` | Modify | Add purchase picker dropdown, show cost preview |

---

### Task 1: Update birdUsage type

**Files:**
- Modify: `lib/types.ts:15-19`

- [ ] **Step 1: Add purchaseId and purchaseName to birdUsage**

Replace lines 15-19 in `lib/types.ts`:

```ts
  birdUsage?: {
    tubes: number;
    costPerTube: number;
    totalBirdCost: number;
  };
```

with:

```ts
  birdUsage?: {
    tubes: number;
    costPerTube: number;
    totalBirdCost: number;
    purchaseId?: string;
    purchaseName?: string;
  };
```

Both fields are optional for backward compatibility with existing sessions that don't have them.

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: No errors (new fields are optional, no existing code breaks).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add purchaseId and purchaseName to birdUsage type"
```

---

### Task 2: Write failing tests for purchase-specific bird usage

**Files:**
- Modify: `__tests__/session.test.ts`

- [ ] **Step 1: Add helper to seed a bird purchase**

Import POST from the birds route and add a helper function. Update the import at top and add helper inside the `PUT /api/session` describe block:

Add to imports (line 1-12 area):
```ts
import { POST as CREATE_BIRD } from '@/app/api/birds/route';
```

- [ ] **Step 2: Add test for bird usage with purchaseId**

Add these tests inside the `PUT /api/session` describe block (after the non-admin test, line 72):

```ts
  it('saves bird usage with specific purchase price', async () => {
    // Create a bird purchase
    const birdRes = await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Victor Master No.3', tubes: 4, totalCost: 80,
    }));
    const bird = await birdRes.json();

    // Update session with bird usage referencing that purchase
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsage: { tubes: 2, purchaseId: bird.id },
    });
    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.birdUsage.tubes).toBe(2);
    expect(data.birdUsage.costPerTube).toBe(20);
    expect(data.birdUsage.totalBirdCost).toBe(40);
    expect(data.birdUsage.purchaseId).toBe(bird.id);
    expect(data.birdUsage.purchaseName).toBe('Victor Master No.3');
  });

  it('rejects bird usage with missing purchaseId', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsage: { tubes: 2 },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('rejects bird usage with unknown purchaseId', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsage: { tubes: 2, purchaseId: 'nonexistent' },
    });
    const res = await PUT(req);
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- __tests__/session.test.ts`
Expected: The first test passes incorrectly (old behavior uses latest purchase), the second fails (no 400 for missing purchaseId), the third fails (no 404 for unknown purchaseId).

- [ ] **Step 4: Commit failing tests**

```bash
git add __tests__/session.test.ts
git commit -m "test: add failing tests for purchase-specific bird usage"
```

---

### Task 3: Update session PUT handler to use purchaseId

**Files:**
- Modify: `app/api/session/route.ts:53-69`

- [ ] **Step 1: Replace the bird usage block**

Replace lines 53-69 in `app/api/session/route.ts`:

```ts
    // Handle bird usage — look up latest purchase price
    let birdUsage = undefined;
    if (body.birdUsage && typeof body.birdUsage.tubes === 'number' && body.birdUsage.tubes > 0) {
      const birdsContainer = getContainer('birds');
      const { resources: purchases } = await birdsContainer.items
        .query({ query: 'SELECT * FROM c ORDER BY c.date DESC' })
        .fetchAll();
      const latestPrice = purchases.length > 0 ? purchases[0].costPerTube : 0;
      const tubes = Math.max(0, Math.min(100, body.birdUsage.tubes));
      birdUsage = {
        tubes,
        costPerTube: latestPrice,
        totalBirdCost: Math.round(tubes * latestPrice * 100) / 100,
      };
    } else if (body.birdUsage === null) {
      birdUsage = null; // explicitly clear
    }
```

with:

```ts
    // Handle bird usage — look up specific purchase by ID
    let birdUsage = undefined;
    if (body.birdUsage && typeof body.birdUsage.tubes === 'number' && body.birdUsage.tubes > 0) {
      const purchaseId = body.birdUsage.purchaseId;
      if (typeof purchaseId !== 'string' || !purchaseId) {
        return NextResponse.json({ error: 'Bird purchase must be selected' }, { status: 400 });
      }
      const birdsContainer = getContainer('birds');
      const { resource: purchase } = await birdsContainer.item(purchaseId, purchaseId).read();
      if (!purchase) {
        return NextResponse.json({ error: 'Selected bird purchase not found' }, { status: 404 });
      }
      const tubes = Math.max(0, Math.min(100, body.birdUsage.tubes));
      birdUsage = {
        tubes,
        costPerTube: purchase.costPerTube,
        totalBirdCost: Math.round(tubes * purchase.costPerTube * 100) / 100,
        purchaseId: purchase.id,
        purchaseName: purchase.name,
      };
    } else if (body.birdUsage === null) {
      birdUsage = null; // explicitly clear
    }
```

- [ ] **Step 2: Run session tests**

Run: `npm test -- __tests__/session.test.ts`
Expected: All tests pass including the 3 new ones.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass (64 total).

- [ ] **Step 4: Commit**

```bash
git add app/api/session/route.ts
git commit -m "feat: session bird usage looks up specific purchase by ID"
```

---

### Task 4: Add purchase picker to SessionDetailsEditor

**Files:**
- Modify: `components/admin/SessionDetailsEditor.tsx`

- [ ] **Step 1: Import BirdPurchase type and add state**

Update the import at line 4 to include BirdPurchase:

```ts
import type { Session, BirdPurchase } from '@/lib/types';
```

Add `birdPurchaseId` to the DetailsForm type (after `birdTubesUsed` on line 25):

```ts
  birdPurchaseId: string;
```

Update the initial form state (line 37 area) to include:

```ts
    birdPurchaseId: '',
```

Add purchases state after the existing state declarations (after `sessionLabel` state, line 46):

```ts
  const [purchases, setPurchases] = useState<BirdPurchase[]>([]);
```

- [ ] **Step 2: Fetch purchases on mount**

Add a fetch for purchases inside the existing useEffect (after the session fetch `.finally()`, around line 72). Or add a second useEffect:

```ts
  useEffect(() => {
    fetch(`${BASE}/api/birds`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { purchases: [] })
      .then((data) => setPurchases(data.purchases ?? []))
      .catch(() => {});
  }, []);
```

- [ ] **Step 3: Load birdPurchaseId from session data**

In the existing session fetch `.then()` callback (around line 59), update the `loaded` object to include:

```ts
          birdPurchaseId: data.birdUsage?.purchaseId ?? '',
```

- [ ] **Step 4: Update the birdUsage payload in handleSave**

Replace line 113:

```ts
          birdUsage: form.birdTubesUsed > 0 ? { tubes: form.birdTubesUsed } : null,
```

with:

```ts
          birdUsage: form.birdTubesUsed > 0 && form.birdPurchaseId
            ? { tubes: form.birdTubesUsed, purchaseId: form.birdPurchaseId }
            : null,
```

- [ ] **Step 5: Add birdPurchaseId to dirty check**

Add to the dirty check (around line 138, after `birdTubesUsed`):

```ts
    form.birdPurchaseId !== init.birdPurchaseId ||
```

- [ ] **Step 6: Replace the Bird Tubes Used UI with a purchase picker**

Replace the `grid grid-cols-2 gap-3` div containing "Bird Tubes Used" and "Show Cost" (lines 189-201) with:

```tsx
          <div className="space-y-3">
            <Label text="Bird Source">
              <select
                value={form.birdPurchaseId}
                onChange={(e) => setForm(f => ({ ...f, birdPurchaseId: e.target.value, birdTubesUsed: e.target.value ? f.birdTubesUsed || 1 : 0 }))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)', color: 'var(--text-primary)', fontSize: 14 }}
              >
                <option value="">None</option>
                {purchases.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${p.costPerTube.toFixed(2)}/tube ({new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
                  </option>
                ))}
              </select>
            </Label>
            {form.birdPurchaseId && (
              <div className="grid grid-cols-2 gap-3">
                <Label text="Tubes Used">
                  <input type="number" min={1} value={form.birdTubesUsed || ''} onChange={setNum('birdTubesUsed')} />
                </Label>
                <Label text="Show Cost">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, showCostBreakdown: !f.showCostBreakdown }))}
                    className={`w-full text-sm font-medium py-1.5 rounded-lg transition-all ${form.showCostBreakdown ? 'pill-paid' : 'pill-unpaid'}`}
                  >
                    {form.showCostBreakdown ? 'Visible' : 'Hidden'}
                  </button>
                </Label>
              </div>
            )}
            {form.birdPurchaseId && form.birdTubesUsed > 0 && (() => {
              const selected = purchases.find(p => p.id === form.birdPurchaseId);
              if (!selected) return null;
              const total = form.birdTubesUsed * selected.costPerTube;
              return (
                <p className="text-xs" style={{ color: 'var(--accent)' }}>
                  {form.birdTubesUsed} × ${selected.costPerTube.toFixed(2)} = ${total.toFixed(2)}
                </p>
              );
            })()}
          </div>
```

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 8: Verify on localhost**

Open http://localhost:3000/bpm → Admin → tap the session details edit (pencil icon).
1. "Bird Tubes Used" number input is replaced with a "Bird Source" dropdown
2. Dropdown lists purchases with name, price, and date
3. Selecting a purchase shows "Tubes Used" input + "Show Cost" toggle
4. A cost preview line appears: "2 × $20.00 = $40.00"
5. Selecting "None" hides the tubes input
6. Save works and persists the selection

- [ ] **Step 9: Commit**

```bash
git add components/admin/SessionDetailsEditor.tsx
git commit -m "feat: purchase picker dropdown in session editor"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm test` — all tests pass (64 total: 61 existing + 3 new session tests)
- [ ] `npx tsc --noEmit` — no TypeScript errors
- [ ] Localhost: Admin → Session Details → Bird Source dropdown works
- [ ] Localhost: Home tab cost breakdown shows correct bird cost for players
- [ ] Old sessions without purchaseId still display correctly (backward compat)
