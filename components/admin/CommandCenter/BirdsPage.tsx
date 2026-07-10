'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import AssignUsageSheet from '../AssignUsageSheet';
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
    <span style={{ display: 'inline-flex', gap: 1.5 }}>
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
        padding: '12px 16px',
        border: 'none',
        borderTop: index ? '1px solid rgba(var(--glass-tint), 0.05)' : 'none',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(var(--glass-tint), 0.03)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 'var(--fs-md)', fontWeight: 600, margin: 0 }}>
            {p.name}
          </p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', margin: 0 }}>
            {fmtDate(p.date)} · {p.tubes} tube{p.tubes === 1 ? '' : 's'}
            {typeof p.speed === 'number' && ` · spd ${p.speed}`}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-base)', fontWeight: 600 }}>
            ${p.totalCost.toFixed(2)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-2xs)', color: 'var(--ink-faint)' }}>
            ${p.costPerTube.toFixed(2)}/t
          </span>
        </div>
      </div>
      {(typeof p.qualityRating === 'number' || p.notes) && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 8, gap: 10 }}>
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

  // Purchase sheet state — used for both Add and Edit. editingId === null
  // means Add mode; non-null means Edit mode for that purchase.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Assign-to-sessions sheet (allows retro-assigning tubes to past sessions).
  const [assignTarget, setAssignTarget] = useState<BirdPurchase | null>(null);
  const [formName, setFormName] = useState('');
  const [formTubes, setFormTubes] = useState<number | ''>('');
  const [formCost, setFormCost] = useState<number | ''>('');
  const [formSpeed, setFormSpeed] = useState<number | ''>('');
  const [formQuality, setFormQuality] = useState<number>(0);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [formError, setFormError] = useState('');

  // Reconcile-count sheet — correct the on-hand total to a physical recount.
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileCount, setReconcileCount] = useState<number | ''>('');
  const [reconcileReason, setReconcileReason] = useState('');
  const [reconcileSaving, setReconcileSaving] = useState(false);
  const [reconcileError, setReconcileError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const birdsRes = await fetch(`${BASE}/api/birds`, { cache: 'no-store' });
      // A non-ok response is a load FAILURE, not an empty inventory — falling
      // back to a zero object here rendered the forbidden lying-empty state
      // (confident "0 tubes" on a broken backend).
      if (!birdsRes.ok) {
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
    } catch {
      // Offline / network failure: fetch() rejects before returning a
      // Response, so the res.ok guards above never run. Flag it explicitly
      // rather than letting the rejection float (it was surfacing as the
      // Next dev overlay) or zeroing the stats (lying-empty).
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openAddSheet() {
    setConfirmingDelete(false);
    setEditingId(null);
    setFormName('');
    setFormTubes('');
    setFormCost('');
    setFormSpeed('');
    setFormQuality(0);
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes('');
    setFormError('');
    setSheetOpen(true);
  }

  function openEditSheet(p: BirdPurchase) {
    setConfirmingDelete(false);
    setEditingId(p.id);
    setFormName(p.name);
    setFormTubes(p.tubes);
    setFormCost(p.totalCost);
    setFormSpeed(typeof p.speed === 'number' ? p.speed : '');
    setFormQuality(typeof p.qualityRating === 'number' ? p.qualityRating : 0);
    setFormDate(p.date.slice(0, 10));
    setFormNotes(p.notes ?? '');
    setFormError('');
    setSheetOpen(true);
  }

  async function handleSave() {
    const name = formName.trim();
    const tubes = typeof formTubes === 'number' ? formTubes : 0;
    const totalCost = typeof formCost === 'number' ? formCost : 0;
    if (!name) { setFormError('Brand / model required.'); return; }
    if (tubes <= 0) { setFormError('Tubes must be > 0.'); return; }
    if (totalCost <= 0) { setFormError('Total cost must be > 0.'); return; }

    setSaving(true);
    setFormError('');
    try {
      const body: Record<string, unknown> = {
        name,
        tubes,
        totalCost,
        date: formDate,
        ...(typeof formSpeed === 'number' ? { speed: formSpeed } : {}),
        ...(formQuality > 0 ? { qualityRating: formQuality } : {}),
        ...(formNotes.trim() ? { notes: formNotes.trim() } : {}),
      };
      const res = await fetch(`${BASE}/api/birds`, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...body } : body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error ?? `Failed to ${editingId ? 'save' : 'add'} purchase.`);
        return;
      }
      setSheetOpen(false);
      await load();
    } catch {
      setFormError('Network error.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    setDeleting(true);
    setFormError('');
    try {
      const res = await fetch(`${BASE}/api/birds`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 409 = referenced by sessions; the server message carries the
        // "move its tubes first" guidance. Drop back out of the confirm row
        // so the error is what the admin reads.
        setFormError(data.error ?? 'Failed to delete.');
        setConfirmingDelete(false);
        return;
      }
      setSheetOpen(false);
      await load();
    } catch {
      setFormError('Network error.');
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  function openReconcileSheet() {
    setReconcileCount(currentStock);
    setReconcileReason('');
    setReconcileError('');
    setReconcileOpen(true);
  }

  async function handleReconcile() {
    const counted = typeof reconcileCount === 'number' ? reconcileCount : NaN;
    if (!Number.isFinite(counted) || counted < 0) { setReconcileError('Enter the number of tubes you counted.'); return; }
    if (counted === currentStock) { setReconcileError('That already matches the current count — nothing to change.'); return; }
    setReconcileSaving(true);
    setReconcileError('');
    try {
      const res = await fetch(`${BASE}/api/birds/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countedTotal: counted, ...(reconcileReason.trim() ? { reason: reconcileReason.trim() } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReconcileError(data.error ?? 'Failed to reconcile.');
        return;
      }
      setReconcileOpen(false);
      await load();
    } catch {
      setReconcileError('Network error.');
    } finally {
      setReconcileSaving(false);
    }
  }

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
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={onBack} title="Birds" />
        <AdminPageSkeleton />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={onBack} title="Birds" />
        <div role="alert" style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontWeight: 600, color: 'var(--text)' }}>Couldn&apos;t load birds</p>
          <p style={{ fontSize: 'var(--fs-base)', marginTop: 6 }}>You may be offline. Reconnect, then retry.</p>
          <button
            type="button"
            className="cc-btn cc-btn-ghost"
            style={{ marginTop: 14 }}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-slideInRight space-y-3">
      <AdminBackHeader onBack={onBack} title="Birds" />

      {/* Runway hero */}
      <div
        className="glass-card"
        style={{
          padding: 18,
          overflow: 'hidden',
          position: 'relative',
          background: 'linear-gradient(160deg, rgba(74,222,128,0.08), rgba(var(--glass-tint), 0.02))',
        }}
      >
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>Runs out in</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
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
                padding: '3px 9px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--fs-xs)',
                fontWeight: 600,
                fontFamily: 'var(--font-display, "Space Grotesk")',
                letterSpacing: '0.02em',
                background: reorderPill.tone === 'green' ? 'rgba(74,222,128,0.13)' : reorderPill.tone === 'amber' ? 'rgba(251,191,36,0.12)' : 'rgba(251,146,60,0.13)',
                color: reorderPill.tone === 'green' ? '#86efac' : reorderPill.tone === 'amber' ? 'var(--amber)' : 'var(--orange)',
                border: `1px solid ${reorderPill.tone === 'green' ? 'rgba(74,222,128,0.25)' : reorderPill.tone === 'amber' ? 'rgba(251,191,36,0.25)' : 'rgba(251,146,60,0.28)'}`,
              }}
            >
              {reorderPill.label}
            </span>
          )}
        </div>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
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
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-faint)', margin: '4px 0 0' }}>
            includes {totalAdjustments > 0 ? '+' : '−'}{Math.abs(totalAdjustments)} from a manual recount
          </p>
        )}
        {stockDrift > 0 && (
          <p role="alert" style={{ fontSize: 'var(--fs-xs)', color: 'var(--amber)', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="material-icons" style={{ fontSize: 'var(--fs-md)' }} aria-hidden="true">warning</span>
            Records show {stockDrift} more tube{stockDrift === 1 ? '' : 's'} used than purchased — run a recount to true up.
          </p>
        )}
        {burnPerSession > 0 && recentSessionCount > 0 && (
          <p
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--ink-faint)',
              margin: '4px 0 0',
              fontFamily: 'var(--font-mono, "JetBrains Mono")',
            }}
            title="Burn rate = recent tubes used ÷ recent sessions (last 60 days)"
          >
            {recentUsedTotal.toFixed(2)} tubes ÷ {recentSessionCount} session{recentSessionCount === 1 ? '' : 's'} (last 60d)
          </p>
        )}

        {/* Timeline */}
        <div style={{ marginTop: 18, position: 'relative' }}>
          <div
            style={{
              height: TIMELINE_BAR_H,
              position: 'relative',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(to right, rgba(74,222,128,0.4) 0%, rgba(251,191,36,0.4) 60%, rgba(248,113,113,0.4) 100%)',
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
                  background: 'rgba(0,0,0,0.18)',
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
                boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
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
              marginTop: 6,
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

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="cc-btn cc-btn-primary"
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            onClick={openAddSheet}
          >
            <span className="material-icons" style={{ fontSize: 'var(--icon-md)' }}>add_shopping_cart</span>
            Log purchase
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
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
          margin: '14px 4px 6px',
        }}
      >
        Brands
      </p>
      {brands.length === 0 && (
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: '0 4px' }}>No purchases yet.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {brands.map((b) => (
          <div key={b.brand} className="glass-card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <p style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 'var(--fs-md)', fontWeight: 600, margin: 0 }}>{b.brand}</p>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
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
          margin: '14px 4px 6px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        Purchase history
        <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-secondary)', fontWeight: 500, fontSize: 'var(--fs-xs)' }}>
          last 60d
        </span>
      </p>
      {recentPurchases.length === 0 ? (
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: '0 4px' }}>No purchases in the last 60 days.</p>
      ) : (
        <div className="glass-card" style={{ padding: '4px 0' }}>
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
              margin: '14px 4px 6px',
            }}
          >
            Older purchases
          </p>
          <div className="glass-card" style={{ padding: '4px 0' }}>
            {olderPurchases.map((p, i) => (
              <PurchaseRow key={p.id} purchase={p} index={i} onEdit={openEditSheet} />
            ))}
          </div>
        </>
      )}

      {/* Add / Edit purchase sheet */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        ariaLabel={editingId ? 'Edit purchase' : 'Log purchase'}
        maxHeight="80vh"
        className="max-w-sm mx-auto"
      >
        <BottomSheetHeader className="flex items-center justify-between p-4">
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{editingId ? 'Edit purchase' : 'Log purchase'}</span>
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody className="p-5 pb-8">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Brand / model">
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Ling-Mei 60"
                maxLength={120}
              />
            </Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Tubes" style={{ flex: 1 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  value={formTubes}
                  onChange={(e) => setFormTubes(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
              <Field label="Total cost" style={{ flex: 1 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.01}
                  value={formCost}
                  onChange={(e) => setFormCost(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Date" style={{ flex: 1 }}>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </Field>
              <Field label="Speed" style={{ flex: 1 }}>
                <input
                  type="number"
                  inputMode="numeric"
                  value={formSpeed}
                  onChange={(e) => setFormSpeed(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 76"
                />
              </Field>
            </div>
            <Field label="Quality (1–5)">
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setFormQuality(formQuality === i ? 0 : i)}
                    aria-label={`${i} stars`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 0,
                    }}
                  >
                    <span
                      className="material-icons"
                      style={{
                        fontSize: 24,
                        color: i <= formQuality ? 'var(--amber)' : 'rgba(var(--glass-tint), 0.18)',
                      }}
                    >
                      star
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Notes (optional)">
              <input
                type="text"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="e.g. Same as last batch"
                maxLength={200}
              />
            </Field>

            {formError && (
              <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: 0 }}>
                {formError}
              </p>
            )}

            {editingId && (() => {
              const target = purchases.find((p) => p.id === editingId);
              if (!target) return null;
              return (
                <button
                  type="button"
                  onClick={() => {
                    setSheetOpen(false);
                    setAssignTarget(target);
                  }}
                  className="cc-btn cc-btn-secondary"
                  style={{ alignSelf: 'flex-start' }}
                >
                  <span className="material-icons" style={{ fontSize: 'var(--fs-lg)' }}>event</span>
                  Assign tubes to sessions
                </button>
              );
            })()}

            {/* Two-step delete confirm — in-sheet (no stacked sheet, no native
                confirm()). A referenced purchase comes back 409 with guidance
                ("move its tubes first"), surfaced via formError above. */}
            {confirmingDelete ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="fs-sm" style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 160 }}>
                  Delete this purchase? This cannot be undone.
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="cc-btn cc-btn-ghost"
                  disabled={deleting}
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="cc-btn cc-btn-danger"
                  aria-label="Confirm delete purchase"
                >
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={saving || deleting}
                    className="cc-btn cc-btn-danger"
                    aria-label="Delete this purchase"
                  >
                    Delete
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="cc-btn cc-btn-ghost"
                  disabled={saving || deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="cc-btn cc-btn-primary"
                  disabled={saving || deleting}
                  style={{ minWidth: 100 }}
                >
                  {saving ? 'Saving…' : editingId ? 'Save' : 'Add'}
                </button>
              </div>
            )}
          </div>
        </BottomSheetBody>
      </BottomSheet>

      {/* Reconcile count */}
      <BottomSheet
        open={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
        ariaLabel="Reconcile count"
        maxHeight="70vh"
        className="max-w-sm mx-auto"
      >
        <BottomSheetHeader className="flex items-center justify-between p-4">
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Reconcile count</span>
          <button
            type="button"
            onClick={() => setReconcileOpen(false)}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody className="p-5 pb-8">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              The app counts <strong style={{ color: 'var(--text-primary)' }}>{currentStock} tubes</strong> on hand
              (purchased − used). If your physical count differs — broken tubes, gifts, miscounts — enter the real
              number and we&apos;ll log the difference.
            </p>
            <Field label="Tubes actually on hand">
              <input
                type="number"
                inputMode="decimal"
                step={0.25}
                min={0}
                value={reconcileCount}
                onChange={(e) => setReconcileCount(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </Field>
            {typeof reconcileCount === 'number' && reconcileCount !== currentStock && (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-faint)', margin: 0, fontFamily: 'var(--font-mono, "JetBrains Mono")' }}>
                adjustment: {reconcileCount - currentStock > 0 ? '+' : '−'}{Math.abs(Math.round((reconcileCount - currentStock) * 100) / 100)} tubes
              </p>
            )}
            <Field label="Reason (optional)">
              <input
                type="text"
                value={reconcileReason}
                onChange={(e) => setReconcileReason(e.target.value)}
                placeholder="e.g. 2 tubes water-damaged"
                maxLength={200}
              />
            </Field>
            {reconcileError && (
              <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: 0 }}>
                {reconcileError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setReconcileOpen(false)}
                className="cc-btn cc-btn-ghost"
                disabled={reconcileSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReconcile}
                className="cc-btn cc-btn-primary"
                disabled={reconcileSaving}
                style={{ minWidth: 100 }}
              >
                {reconcileSaving ? 'Saving…' : 'Reconcile'}
              </button>
            </div>
          </div>
        </BottomSheetBody>
      </BottomSheet>

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

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
