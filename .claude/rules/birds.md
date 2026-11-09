---
paths:
  - "lib/bird*.ts"
  - "lib/sessionCost.ts"
  - "app/api/birds/**"
  - "app/api/session/bird-usage/**"
  - "app/api/session/route.ts"
  - "app/api/session/advance/**"
  - "components/admin/CommandCenter/Bird*.tsx"
  - "components/admin/CommandCenter/SetupPage.tsx"
  - "components/admin/AdvanceSessionForm.tsx"
  - "components/admin/AssignUsageSheet.tsx"
  - "__tests__/bird*.test.ts"
  - "__tests__/session-bird-usage.test.ts"
  - "__tests__/components/AssignUsageSheet.test.tsx"
---

# Shuttles (birds): pooled usage, stock, the bird-usage route

<!-- Moved word for word from the root CLAUDE.md on 2026-11-09 (step 2 of the trim), to keep the always-loaded file short. -->

- **Bird usages**: `session.birdUsages` is an array of `BirdUsage` objects. Legacy single-object `session.birdUsage` is read-tolerated via `normalizeBirdUsages()` in `lib/birdUsages.ts` but never written. Next admin save promotes legacy docs to array shape.
- **Shuttle cost model is "pooled" (Model B, 2026-07-10)**: a session logs ONE "tubes used" number at a price-per-tube — no per-batch selection. The write shape is a single entry `{ pooled: true, tubes, pricePerTube? }` that `resolveBirdUsages` (`lib/birdWrite.ts`) snapshots to a `BirdUsage` tagged with the sentinel `purchaseId: POOLED_PURCHASE_ID` (`'pool'`, from `lib/birdUsages.ts`) via `snapshotPooledUsage(tubes, price)`. **Price resolution**: a manual `pricePerTube` (validated [0, 10000]) wins; else the AUTO price = `currentPricePerTube(purchases)` (the latest purchase's `costPerTube` by date, 0 if none). Cost still flows through the frozen `totalBirdCost`, so receipts / settle / history / `sessionCostTotals` are unchanged and purchaseId-agnostic. **Why the `'pool'` sentinel (not a real id)**: `remainingByPurchase` iterates real purchases, so it never attributes a pooled tube to a batch (per-batch remaining stays put), but `totalUsed` / `currentStock` sum every usage's `tubes` so overall stock stays correct; the DELETE referential guard and `AssignUsageSheet` (both match a real purchase id) simply ignore pooled entries. Consumers of the pooled control: `SetupPage` (finalize-cost card), `AdvanceSessionForm` (create-next-session). Both load legacy multi-batch sessions losslessly at a BLENDED price (`loadedCost / loadedTubes`) and flatten to a single pooled entry on save. The per-purchase (non-pooled) path in `resolveBirdUsages` is retained for the retro-assign `AssignUsageSheet` flow.
- **Birds container holds two doc kinds**: purchases (no `type` / `'purchase'`) and reconciliation adjustments (`type: 'adjustment'`, see `BirdAdjustment`). `GET /api/birds` splits them by `type`, returns `purchases` (purchases only), `adjustments`, `totalAdjustments`, `remainingByPurchase` (per-purchase `tubes − usedAcrossAllSessions`), and `currentStock = totalPurchased + totalAdjustments − totalUsed`. Any new sum over the birds container MUST filter `type !== 'adjustment'` or adjustment docs (which have no `tubes`) corrupt the math. `POST /api/birds/reconcile` takes `{ countedTotal }`, computes the delta against authoritative current stock, and writes one adjustment doc (undo = `DELETE /api/birds` by id). **`remainingByPurchase` is now misleading under the pooled model** (a pooled tube drops total stock but isn't subtracted from any batch, so batches look fuller than they are) — total numbers (`currentStock`, burn, runway) stay correct, but `BirdsPage` deliberately no longer surfaces per-batch "X left" or per-brand "weeks left" (stage 3b slim-down, #234). Brand cards show total "N bought"; the stock caption shows "$X/tube now" (`currentPricePerTube`). Don't re-add per-batch remaining UI without reconciling it against pooled usage first.
- **`PATCH /api/session/bird-usage` vs `PUT /api/session`**: `/api/session` PUT replaces the entire active-session doc and only targets the active session. `/api/session/bird-usage` PATCH is additive: it upserts a single purchase's entry in a specific session's `birdUsages` array, by `sessionId`, so admins can retro-assign tubes to archived sessions from the bird inventory page. Posting `tubes: 0` removes the entry (undo). Both paths validate tubes ∈ [0, 100] in 0.25 increments and look up the purchase for authoritative cost snapshotting.
