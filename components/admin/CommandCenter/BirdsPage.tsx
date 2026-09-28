'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import AssignUsageSheet from '../AssignUsageSheet';
import BirdPurchaseSheet from './BirdPurchaseSheet';
import BirdReconcileSheet from './BirdReconcileSheet';
import { fmtShortDate as fmtDate } from '@/lib/fmt';
import type { BirdPurchase } from '@/lib/types';
import { splitPurchasesByRecency } from '@/lib/birdPurchaseGroups';
import { currentPricePerTube } from '@/lib/birdUsages';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Runway timeline geometry. The "now" and "empty" markers overflow the
// gradient bar above and below — keeping these as named constants means
// changing the bar height (or marker prominence) doesn't desync the markers.
const TIMELINE_BAR_H = 32;
const TIMELINE_NOW_OVERFLOW = 6;
const TIMELINE_EMPTY_OVERFLOW = 10;

interface BirdsPageProps {
  onBack: () => void;
}

interface BrandSummary {
  brand: string;
  bought: number;
  speed: number | null;
  quality: number | null;
}

function Stars({ n }: { n: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--space-05)' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="material-icons"
          style={{ fontSize: 'var(--fs-sm)', color: i <= n ? 'var(--amber)' : 'rgba(var(--glass-tint), 0.18)' }}
        >
          star
        </span>
      ))}
    </span>
  );
}

/**
 * One tappable purchase row (name/date/tubes · cost · rating · tubes-left).
 * Shared by the "recent" and "older" purchase lists so the two can't drift —
 * `index` only drives the top hairline (none on the first row).
 */
function PurchaseRow({
  purchase: p,
  index,
  onEdit,
}: {
  purchase: BirdPurchase;
  index: number;
  onEdit: (p: BirdPurchase) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onEdit(p)}
      aria-label={`Edit purchase: ${p.name} on ${fmtDate(p.date)}`}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        cursor: 'pointer',
        padding: 'var(--space-4) var(--space-5)',
        border: 'none',
        borderTop: index ? '1px solid rgba(var(--glass-tint), 0.05)' : 'none',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(var(--glass-tint), 0.03)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 'var(--fs-md)', fontWeight: 600, margin: '0' }}>
            {p.name}
          </p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: '0' }}>
            {fmtDate(p.date)} · {p.tubes} tube{p.tubes === 1 ? '' : 's'}
            {typeof p.speed === 'number' && ` · spd ${p.speed}`}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-05)' }}>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-base)', fontWeight: 600 }}>
            ${p.totalCost.toFixed(2)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-2xs)', color: 'var(--ink-faint)' }}>
            ${p.costPerTube.toFixed(2)}/t
          </span>
        </div>
      </div>
      {(typeof p.qualityRating === 'number' || p.notes) && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 'var(--space-3)', gap: 'var(--space-4)' }}>
          {typeof p.qualityRating === 'number' && <Stars n={p.qualityRating} />}
          {p.notes && (
            <span
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-faint)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {p.notes}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export default function BirdsPage({ onBack }: BirdsPageProps) {
  const [purchases, setPurchases] = useState<BirdPurchase[]>([]);
  const [currentStock, setCurrentStock] = useState(0);
  const [stockDrift, setStockDrift] = useState(0);
  const [totalAdjustments, setTotalAdjustments] = useState(0);
  const [burnPerSession, setBurnPerSession] = useState(0);
  const [recentSessionCount, setRecentSessionCount] = useState(0);
  const [recentUsedTotal, setRecentUsedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Distinct from "loaded but empty": a failed fetch must not render the
  // same UI as a real zero-state (the forbidden lying-empty pattern).
  const [loadError, setLoadError] = useState(false);
  const loadedRef = useRef(false);

  // Both sheets own their forms (`BirdPurchaseSheet`, `BirdReconcileSheet`);
  // the page holds only what is open, and an opening counter used as the
  // sheet's `key` so each opening starts from a fresh form while the close
  // animation still plays on the instance that is closing.
  const [purchaseSheet, setPurchaseSheet] = useState<{ nonce: number; open: boolean; editing: BirdPurchase | null }>({ nonce: 0, open: false, editing: null });
  const [reconcileSheet, setReconcileSheet] = useState<{ nonce: number; open: boolean }>({ nonce: 0, open: false });
  // Assign-to-sessions sheet (allows retro-assigning tubes to past sessions).
  const [assignTarget, setAssignTarget] = useState<BirdPurchase | null>(null);

  const load = useCallback(async () => {
    // Skeleton on the first load only: a save or cover used to blink this
    // whole surface back to a skeleton (and resize the page) before showing
    // the change it made. A refetch that fails still sets loadError, which
    // replaces the stale content with the error card.
    if (!loadedRef.current) setLoading(true);
    setLoadError(false);
    try {
      const birdsRes = await fetch(`${BASE}/api/birds`, { cache: 'no-store' });
      // A non-ok response is a load FAILURE, not an empty inventory — falling
      // back to a zero object here rendered the forbidden lying-empty state
      // (confident "0 tubes" on a broken backend).
      if (!birdsRes.ok) {
        loadedRef.current = false;
        setLoadError(true);
        return;
      }
      const birds = await birdsRes.json() as {
        purchases: BirdPurchase[];
        currentStock: number;
        stockDrift?: number;
        totalAdjustments?: number;
        remainingByPurchase: Record<string, number>;
        burnPerSession: number;
        recentSessionsLast60d: number;
        recentUsedLast60d: number;
      };
      // burnPerSession, remainingByPurchase, and the 60d window stats are
      // now computed server-side in GET /api/birds — no need to re-fetch
      // /api/sessions and recompute them on the client.
      setPurchases(birds.purchases ?? []);
      setCurrentStock(birds.currentStock ?? 0);
      setStockDrift(birds.stockDrift ?? 0);
      setTotalAdjustments(birds.totalAdjustments ?? 0);
      setBurnPerSession(birds.burnPerSession ?? 0);
      setRecentSessionCount(birds.recentSessionsLast60d ?? 0);
      setRecentUsedTotal(birds.recentUsedLast60d ?? 0);
      loadedRef.current = true;
    } catch {
      // Offline / network failure: fetch() rejects before returning a
      // Response, so the res.ok guards above never run. Flag it explicitly
      // rather than letting the rejection float (it was surfacing as the
      // Next dev overlay) or zeroing the stats (lying-empty).
      loadedRef.current = false;
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openAddSheet = () => setPurchaseSheet((prev) => ({ nonce: prev.nonce + 1, open: true, editing: null }));
  const openEditSheet = (p: BirdPurchase) => setPurchaseSheet((prev) => ({ nonce: prev.nonce + 1, open: true, editing: p }));
  const closePurchaseSheet = () => setPurchaseSheet((prev) => ({ ...prev, open: false }));
  const openReconcileSheet = () => setReconcileSheet((prev) => ({ nonce: prev.nonce + 1, open: true }));
  const closeReconcileSheet = () => setReconcileSheet((prev) => ({ ...prev, open: false }));

  const weeksRunway = burnPerSession > 0 ? currentStock / burnPerSession : null;
  const currentPrice = useMemo(() => currentPricePerTube(purchases), [purchases]);

  // Brand summaries — grouped by FULL name (e.g. 'Ling-Mei 60' stays
  // distinct from 'Ling-Mei 76'). Under the pooled shuttle model per-batch
  // "remaining" is no longer meaningful, so this is a purchased-totals +
  // speed/quality digest per brand (no per-brand runway).
  const brands = useMemo<BrandSummary[]>(() => {
    const map = new Map<string, BrandSummary & { speedSum: number; speedCount: number; qualitySum: number; qualityCount: number }>();
    for (const p of purchases) {
      const key = p.name?.trim() || '—';
      const existing = map.get(key) ?? {
        brand: key,
        bought: 0,
        speed: null,
        quality: null,
        speedSum: 0,
        speedCount: 0,
        qualitySum: 0,
        qualityCount: 0,
      };
      existing.bought += p.tubes;
      if (typeof p.speed === 'number') { existing.speedSum += p.speed; existing.speedCount++; }
      if (typeof p.qualityRating === 'number') { existing.qualitySum += p.qualityRating; existing.qualityCount++; }
      map.set(key, existing);
    }
    const out: BrandSummary[] = Array.from(map.values())
      .filter((v) => v.bought > 0)
      .map((v) => {
        const speed = v.speedCount > 0 ? Math.round(v.speedSum / v.speedCount) : null;
        const quality = v.qualityCount > 0 ? Math.round(v.qualitySum / v.qualityCount) : null;
        return { brand: v.brand, bought: v.bought, speed, quality };
      });
    return out.sort((a, b) => b.bought - a.bought);
  }, [purchases]);

  // Split purchases into the last-60d list and everything older (each
  // newest-first). Older purchases stay selectable below the recent list so
  // their tubes can still be retro-assigned to sessions. The pure split lives
  // in lib/birdPurchaseGroups so it's unit-testable.
  const { recent: recentPurchases, older: olderPurchases } = useMemo(
    () => splitPurchasesByRecency(purchases),
    [purchases],
  );

  // Runway timeline math: clamp at 8 weeks for the bar; "empty" marker
  // sits at runway/8 of the bar width.
  const runwayPct = useMemo(() => {
    if (weeksRunway === null) return 100;
    return Math.max(0, Math.min(100, (weeksRunway / 8) * 100));
  }, [weeksRunway]);

  const heroLabelColor = weeksRunway === null
    ? 'var(--text-muted)'
    : weeksRunway < 2 ? 'var(--orange)' : weeksRunway < 4 ? 'var(--amber)' : 'var(--accent)';
  const reorderPill = weeksRunway === null
    ? null
    : weeksRunway < 2
      ? { tone: 'orange', label: 'Reorder now' }
      : weeksRunway < 4
        ? { tone: 'amber', label: 'Reorder soon' }
        : { tone: 'green', label: 'Healthy' };

  if (loading) {
    return (
      <div className="motion-fade space-y-3">
        <AdminBackHeader onBack={onBack} title="Birds" />
        <AdminPageSkeleton />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="motion-fade space-y-3">
        <AdminBackHeader onBack={onBack} title="Birds" />
        <div style={{ padding: 'var(--space-9) var(--space-7)' }}>
          <ErrorState
            message="Couldn't load birds."
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
                Try again
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="motion-fade space-y-3">
      <AdminBackHeader onBack={onBack} title="Birds" />

      {/* Runway hero */}
      <div
        className="glass-card"
        style={{
          padding: 'var(--space-6)',
          overflow: 'hidden',
          position: 'relative',
          background: 'linear-gradient(160deg, var(--banner-green-bg), rgba(var(--glass-tint), 0.02))',
        }}
      >
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: '0' }}>Runs out in</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', marginTop: 'var(--space-05)' }}>
          <span
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk")',
              fontSize: 54,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              lineHeight: 1,
              color: heroLabelColor,
            }}
          >
            {weeksRunway === null ? '—' : weeksRunway.toFixed(1)}
          </span>
          <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 18, color: 'var(--text-secondary)', fontWeight: 600 }}>
            {weeksRunway === null ? 'no data' : 'weeks'}
          </span>
          {reorderPill && (
            <span
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--fs-xs)',
                fontWeight: 600,
                fontFamily: 'var(--font-display, "Space Grotesk")',
                letterSpacing: '0.02em',
                background: reorderPill.tone === 'green' ? 'var(--tone-green-bg)' : reorderPill.tone === 'amber' ? 'var(--tone-amber-bg)' : 'var(--tone-orange-bg)',
                color: reorderPill.tone === 'green' ? 'var(--accent)' : reorderPill.tone === 'amber' ? 'var(--amber)' : 'var(--orange)',
                border: `1px solid ${reorderPill.tone === 'green' ? 'var(--tone-green-border)' : reorderPill.tone === 'amber' ? 'var(--tone-amber-border)' : 'var(--tone-orange-border)'}`,
              }}
            >
              {reorderPill.label}
            </span>
          )}
        </div>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 'var(--space-2) 0 0' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{currentStock} tubes</strong> on hand
          {currentPrice > 0 && (
            <>{' · '}<strong style={{ color: 'var(--text-primary)' }}>${currentPrice.toFixed(2)}/tube</strong> now</>
          )}
          {burnPerSession > 0 && (
            <>
              {' '}· burning <strong style={{ color: 'var(--text-primary)' }}>{burnPerSession.toFixed(2)}/session</strong>
            </>
          )}
        </p>
        {totalAdjustments !== 0 && (
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-faint)', margin: 'var(--space-1) 0 0' }}>
            includes {totalAdjustments > 0 ? '+' : '−'}{Math.abs(totalAdjustments)} from a manual recount
          </p>
        )}
        {stockDrift > 0 && (
          <p role="alert" style={{ fontSize: 'var(--fs-xs)', color: 'var(--amber)', margin: 'var(--space-1) 0 0', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className="material-icons" style={{ fontSize: 'var(--fs-md)' }} aria-hidden="true">warning</span>
            Records show {stockDrift} more tube{stockDrift === 1 ? '' : 's'} used than purchased — run a recount to true up.
          </p>
        )}
        {burnPerSession > 0 && recentSessionCount > 0 && (
          <p
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--ink-faint)',
              margin: 'var(--space-1) 0 0',
              fontFamily: 'var(--font-mono, "JetBrains Mono")',
            }}
            title="Burn rate = recent tubes used ÷ recent sessions (last 60 days)"
          >
            {recentUsedTotal.toFixed(2)} tubes ÷ {recentSessionCount} session{recentSessionCount === 1 ? '' : 's'} (last 60d)
          </p>
        )}

        {/* Timeline */}
        <div style={{ marginTop: 'var(--space-6)', position: 'relative' }}>
          <div
            style={{
              height: TIMELINE_BAR_H,
              position: 'relative',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(to right, var(--tone-green-strong) 0%, var(--tone-amber-strong) 60%, var(--tone-red-strong) 100%)',
              overflow: 'hidden',
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(i / 8) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: 'var(--ink-tick)',
                }}
              />
            ))}
            {/* "now" marker — white, left edge */}
            <div
              style={{
                position: 'absolute',
                left: '0%',
                top: -TIMELINE_NOW_OVERFLOW,
                bottom: -TIMELINE_NOW_OVERFLOW,
                width: 3,
                background: 'var(--text-primary)',
                borderRadius: 2,
                boxShadow: '0 0 0 2px var(--ink-shadow)',
              }}
              aria-label="now"
            />
            {/* "empty" marker — red, at runway position */}
            {weeksRunway !== null && (
              <div
                style={{
                  position: 'absolute',
                  left: `${runwayPct}%`,
                  top: -TIMELINE_EMPTY_OVERFLOW,
                  bottom: -TIMELINE_EMPTY_OVERFLOW,
                  width: 2,
                  background: 'var(--red-soft)',
                }}
                aria-label="empty"
              >
                <span
                  style={{
                    position: 'absolute',
                    top: -14,
                    left: -22,
                    fontFamily: 'var(--font-mono, "JetBrains Mono")',
                    fontSize: 'var(--fs-2xs)',
                    color: 'var(--red-soft)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  empty
                </span>
              </div>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 'var(--space-2)',
              fontFamily: 'var(--font-mono, "JetBrains Mono")',
              fontSize: 'var(--fs-xs)',
              color: 'var(--ink-faint)',
            }}
          >
            <span>now</span>
            <span>2 wks</span>
            <span>4 wks</span>
            <span>6 wks</span>
            <span>8 wks</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
          <button
            type="button"
            className="cc-btn cc-btn-primary"
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
            onClick={openAddSheet}
          >
            <span className="material-icons" style={{ fontSize: 'var(--icon-md)' }}>add_shopping_cart</span>
            Log purchase
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
            onClick={openReconcileSheet}
          >
            <span className="material-icons" style={{ fontSize: 'var(--icon-md)' }}>fact_check</span>
            Reconcile
          </button>
        </div>
      </div>

      {/* In stock */}
      <p
        style={{
          fontFamily: 'var(--font-display, "Space Grotesk")',
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          margin: 'var(--space-4) var(--space-1) var(--space-2)',
        }}
      >
        Brands
      </p>
      {brands.length === 0 && (
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: '0 var(--space-1)' }}>No purchases yet.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {brands.map((b) => (
          <div key={b.brand} className="glass-card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-05)', minWidth: 0 }}>
                <p style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 'var(--fs-md)', fontWeight: 600, margin: '0' }}>{b.brand}</p>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', margin: '0' }}>
                  {b.speed !== null && <>spd {b.speed}</>}
                  {b.speed !== null && b.quality !== null && ' · '}
                  {b.quality !== null && <Stars n={b.quality} />}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {b.bought}
                  <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--fs-sm)', fontWeight: 500 }}> bought</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Purchase history */}
      <p
        style={{
          fontFamily: 'var(--font-display, "Space Grotesk")',
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint)',
          margin: 'var(--space-4) var(--space-1) var(--space-2)',
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-3)',
        }}
      >
        Purchase history
        <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-secondary)', fontWeight: 500, fontSize: 'var(--fs-xs)' }}>
          last 60d
        </span>
      </p>
      {recentPurchases.length === 0 ? (
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: '0 var(--space-1)' }}>No purchases in the last 60 days.</p>
      ) : (
        <div className="glass-card is-flush" style={{ padding: 'var(--space-1) 0' }}>
          {recentPurchases.map((p, i) => (
            <PurchaseRow key={p.id} purchase={p} index={i} onEdit={openEditSheet} />
          ))}
        </div>
      )}

      {/* Older purchases — always rendered so purchases >60 days old can be retro-assigned */}
      {olderPurchases.length > 0 && (
        <>
          <p
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk")',
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              margin: 'var(--space-4) var(--space-1) var(--space-2)',
            }}
          >
            Older purchases
          </p>
          <div className="glass-card is-flush" style={{ padding: 'var(--space-1) 0' }}>
            {olderPurchases.map((p, i) => (
              <PurchaseRow key={p.id} purchase={p} index={i} onEdit={openEditSheet} />
            ))}
          </div>
        </>
      )}

      <BirdPurchaseSheet
        key={`purchase-${purchaseSheet.nonce}`}
        open={purchaseSheet.open}
        editing={purchaseSheet.editing}
        onClose={closePurchaseSheet}
        onSaved={() => { void load(); }}
        onAssign={setAssignTarget}
      />

      <BirdReconcileSheet
        key={`reconcile-${reconcileSheet.nonce}`}
        open={reconcileSheet.open}
        currentStock={currentStock}
        onClose={closeReconcileSheet}
        onSaved={() => { void load(); }}
      />

      {/* Retro-assign tubes to past sessions */}
      <AssignUsageSheet
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        purchase={assignTarget}
        onSaved={() => { void load(); }}
      />
    </div>
  );
}
