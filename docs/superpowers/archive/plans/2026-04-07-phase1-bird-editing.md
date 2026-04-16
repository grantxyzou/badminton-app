# Phase 1: Bird Purchase Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to edit existing bird purchases (all fields), instead of delete-and-recreate.

**Architecture:** Add a PATCH handler to the existing birds API route. Add inline edit UI to BirdInventoryView — tapping an edit icon on a purchase card transforms it into an editable form (same fields as the add form, pre-filled). TDD: write failing tests first, then implement.

**Tech Stack:** Next.js API routes, Cosmos DB (mock store for tests), React, TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/api/birds/route.ts` | Modify | Add PATCH export |
| `__tests__/birds.test.ts` | Modify | Add PATCH test suite |
| `components/admin/BirdInventoryView.tsx` | Modify | Add edit UI per purchase card |

---

### Task 1: Write failing tests for PATCH /api/birds

**Files:**
- Modify: `__tests__/birds.test.ts`

- [ ] **Step 1: Add PATCH import and test suite**

Add `PATCH` to the import on line 9, then add the following test suite after the `DELETE` describe block (after line 123):

```ts
// Update import line 9 to:
import { GET, POST, DELETE, PATCH } from '@/app/api/birds/route';
```

```ts
  describe('PATCH /api/birds', () => {
    it('updates name only', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Old Name', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, name: 'New Name',
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.name).toBe('New Name');
      expect(data.tubes).toBe(4);
      expect(data.costPerTube).toBe(20);
    });

    it('updates tubes and totalCost, recalculates costPerTube', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, tubes: 2, totalCost: 50,
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.tubes).toBe(2);
      expect(data.totalCost).toBe(50);
      expect(data.costPerTube).toBe(25);
    });

    it('updates optional fields', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, speed: 78, qualityRating: 5, notes: 'Updated notes',
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speed).toBe(78);
      expect(data.qualityRating).toBe(5);
      expect(data.notes).toBe('Updated notes');
    });

    it('clears optional fields when set to null', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80, speed: 77, notes: 'Some notes',
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, speed: null, notes: null,
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speed).toBeUndefined();
      expect(data.notes).toBeUndefined();
    });

    it('rejects missing id', async () => {
      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        name: 'Test',
      }));
      expect(res.status).toBe(400);
    });

    it('rejects empty name', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, name: '   ',
      }));
      expect(res.status).toBe(400);
    });

    it('rejects tubes <= 0', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, tubes: 0,
      }));
      expect(res.status).toBe(400);
    });

    it('rejects non-admin', async () => {
      const res = await PATCH(makeRequest('PATCH', 'http://localhost:3000/api/birds', {
        id: 'test', name: 'Hacked',
      }));
      expect(res.status).toBe(401);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- __tests__/birds.test.ts`
Expected: FAIL — `PATCH` is not exported from the birds route.

- [ ] **Step 3: Commit failing tests**

```bash
git add __tests__/birds.test.ts
git commit -m "test: add failing tests for PATCH /api/birds"
```

---

### Task 2: Implement PATCH handler

**Files:**
- Modify: `app/api/birds/route.ts` (add after the DELETE export, line 100)

- [ ] **Step 1: Add the PATCH export**

Add this after line 100 of `app/api/birds/route.ts`:

```ts
export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    const container = getContainer('birds');
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    const updated = { ...existing };

    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 100);
      if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
      updated.name = name;
    }
    if (typeof body.tubes === 'number') {
      if (body.tubes <= 0) return NextResponse.json({ error: 'Tubes must be greater than 0' }, { status: 400 });
      updated.tubes = body.tubes;
    }
    if (typeof body.totalCost === 'number') {
      if (body.totalCost <= 0) return NextResponse.json({ error: 'Cost must be greater than 0' }, { status: 400 });
      updated.totalCost = Math.round(body.totalCost * 100) / 100;
    }
    if (typeof body.date === 'string') {
      updated.date = body.date.slice(0, 10);
    }

    // Recalculate costPerTube
    updated.costPerTube = Math.round((updated.totalCost / updated.tubes) * 100) / 100;

    // Optional fields — set value or clear with null
    if ('speed' in body) {
      updated.speed = (typeof body.speed === 'number' && body.speed > 0) ? body.speed : undefined;
    }
    if ('qualityRating' in body) {
      updated.qualityRating = (typeof body.qualityRating === 'number' && body.qualityRating >= 1 && body.qualityRating <= 5)
        ? Math.round(body.qualityRating) : undefined;
    }
    if ('notes' in body) {
      updated.notes = (typeof body.notes === 'string' && body.notes.trim())
        ? body.notes.trim().slice(0, 500) : undefined;
    }

    const { resource } = await container.items.upsert(updated);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PATCH birds error:', error);
    return NextResponse.json({ error: 'Failed to update purchase' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- __tests__/birds.test.ts`
Expected: All PATCH tests PASS, all existing tests still PASS.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All 60 tests pass (52 existing + 8 new PATCH tests).

- [ ] **Step 4: Commit**

```bash
git add app/api/birds/route.ts
git commit -m "feat: add PATCH /api/birds for editing purchases"
```

---

### Task 3: Add edit UI to BirdInventoryView

**Files:**
- Modify: `components/admin/BirdInventoryView.tsx`

- [ ] **Step 1: Add edit state variables**

Add these after line 32 (`deletingId` state):

```ts
const [editingId, setEditingId] = useState<string | null>(null);
const [editForm, setEditForm] = useState<Partial<BirdPurchase>>({});
const [editError, setEditError] = useState('');
const [savingEdit, setSavingEdit] = useState(false);
```

- [ ] **Step 2: Add startEdit and handleSaveEdit functions**

Add these after the `handleDelete` function (after line 101):

```ts
  function startEdit(p: BirdPurchase) {
    setEditingId(p.id);
    setEditForm({ name: p.name, tubes: p.tubes, totalCost: p.totalCost, date: p.date, speed: p.speed, qualityRating: p.qualityRating, notes: p.notes });
    setEditError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
    setEditError('');
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSavingEdit(true);
    setEditError('');
    try {
      const payload: Record<string, unknown> = { id: editingId };
      if (editForm.name !== undefined) payload.name = editForm.name;
      if (editForm.tubes !== undefined) payload.tubes = editForm.tubes;
      if (editForm.totalCost !== undefined) payload.totalCost = editForm.totalCost;
      if (editForm.date !== undefined) payload.date = editForm.date;
      payload.speed = editForm.speed ?? null;
      payload.qualityRating = editForm.qualityRating ?? null;
      payload.notes = editForm.notes ?? null;

      const res = await fetch(`${BASE}/api/birds`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        cancelEdit();
        loadPurchases();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error ?? 'Failed to save.');
      }
    } catch {
      setEditError('Network error.');
    } finally {
      setSavingEdit(false);
    }
  }
```

- [ ] **Step 3: Replace the purchase card rendering**

Replace the purchase card `div` inside the `purchases.map()` (lines 228-261) with a version that shows the edit form when `editingId === p.id`:

```tsx
            <div key={p.id} className="inner-card p-3">
              {editingId === p.id ? (
                <div className="space-y-3">
                  <Label text="Shuttle">
                    <input
                      type="text"
                      value={editForm.name ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      maxLength={100}
                    />
                  </Label>
                  <div className="grid grid-cols-3 gap-3">
                    <Label text="Tubes">
                      <input
                        type="number"
                        min={1}
                        value={editForm.tubes || ''}
                        onChange={(e) => setEditForm({ ...editForm, tubes: parseInt(e.target.value) || 0 })}
                      />
                    </Label>
                    <Label text="Total ($)">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={editForm.totalCost || ''}
                        onChange={(e) => setEditForm({ ...editForm, totalCost: parseFloat(e.target.value) || 0 })}
                      />
                    </Label>
                    <Label text="Speed">
                      <input
                        type="number"
                        min={1}
                        value={editForm.speed ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, speed: e.target.value ? parseInt(e.target.value) : undefined })}
                      />
                    </Label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Label text="Date">
                      <input
                        type="date"
                        value={editForm.date ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                      />
                    </Label>
                    <Label text="Quality Rating">
                      <div className="flex gap-1 items-center pt-1">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setEditForm({ ...editForm, qualityRating: (editForm.qualityRating === n ? undefined : n) })}
                            className="flex items-center justify-center transition-all"
                            style={{
                              width: 36, height: 36, borderRadius: 8,
                              background: n <= (editForm.qualityRating ?? 0) ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                              border: `1px solid ${n <= (editForm.qualityRating ?? 0) ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
                              color: n <= (editForm.qualityRating ?? 0) ? 'var(--accent)' : 'var(--text-muted)',
                              fontSize: 13, fontWeight: 600,
                            }}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </Label>
                  </div>
                  <Label text="Notes">
                    <textarea
                      value={editForm.notes ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      maxLength={500}
                      rows={2}
                      style={{ resize: 'none' }}
                    />
                  </Label>
                  {editError && <p className="text-red-400 text-xs" role="alert">{editError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit || !editForm.name?.trim() || !editForm.tubes || editForm.tubes <= 0}
                      className="btn-primary flex-1"
                      style={{ minHeight: 44 }}
                    >
                      {savingEdit ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={savingEdit}
                      className="flex-1"
                      style={{ minHeight: 44, borderRadius: 10, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)', color: 'var(--text-secondary)', fontWeight: 500 }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {' · '}
                      {p.tubes} tube{p.tubes !== 1 ? 's' : ''}
                      {p.costPerTube > 0 && ` · $${p.costPerTube.toFixed(2)}/tube`}
                      {p.speed && ` · Spd ${p.speed}`}
                      {p.qualityRating && ` · ${p.qualityRating}/5`}
                    </p>
                    {p.notes && (
                      <p className="text-xs mt-0.5 italic" style={{ color: 'var(--text-muted)' }}>{p.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {p.totalCost > 0 && (
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>${p.totalCost.toFixed(2)}</span>
                    )}
                    <button
                      onClick={() => startEdit(p)}
                      className="hover:opacity-70 transition-opacity"
                      aria-label={`Edit purchase of ${p.name}`}
                      style={{ color: 'var(--text-muted)', minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <span className="material-icons" style={{ fontSize: 16 }}>edit</span>
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={deletingId === p.id}
                      className="hover:text-red-400 transition-colors"
                      aria-label={`Delete purchase of ${p.name}`}
                      style={{ color: 'var(--text-muted)', minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <span className="material-icons" style={{ fontSize: 16 }}>
                        {deletingId === p.id ? 'hourglass_empty' : 'delete'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
```

- [ ] **Step 4: Verify on localhost**

Open http://localhost:3000/bpm → Admin → Birds.
1. You should see an edit (pencil) icon next to the delete icon on each purchase.
2. Tap edit → card transforms to an editable form pre-filled with values.
3. Change a field, tap Save → card returns to read-only with updated values.
4. Tap Cancel → card returns to read-only, no changes.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/admin/BirdInventoryView.tsx
git commit -m "feat: add inline edit UI for bird purchases"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm test` — all tests pass (60 total: 52 existing + 8 new PATCH tests)
- [ ] Localhost: Admin → Birds → Add a purchase → Edit it → Delete it (full CRUD works)
- [ ] Localhost: Home tab, Sign-Ups tab — no visual changes for non-admin users
- [ ] No TypeScript errors (`npx tsc --noEmit`)
