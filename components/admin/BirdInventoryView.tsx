'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { BirdPurchase, Session } from '@/lib/types';
import { ShimmerLoader } from '../ShuttleLoader';
import AdminBackHeader from './AdminBackHeader';
import AssignUsageSheet from './AssignUsageSheet';
import { parseBirdName } from '@/lib/birdBrand';
import { avgTubesPerSession, runwayWeeks, tubesUsedAcross } from '@/lib/birdUsages';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{text}</span>
      {children}
    </label>
  );
}

interface BrandGroup {
  brand: string;
  tubesBought: number;
  tubesUsed: number;
  remaining: number;
  totalSpend: number;
  count: number;
}

function groupByBrand(purchases: BirdPurchase[], usedByPurchase: Map<string, number>): BrandGroup[] {
  const groups = new Map<string, BrandGroup>();
  for (const p of purchases) {
    const { brand } = parseBirdName(p.name);
    const key = brand || '—';
    const existing = groups.get(key) ?? {
      brand: key,
      tubesBought: 0,
      tubesUsed: 0,
      remaining: 0,
      totalSpend: 0,
      count: 0,
    };
    const used = usedByPurchase.get(p.id) ?? 0;
    existing.tubesBought += p.tubes;
    existing.tubesUsed += used;
    existing.remaining += Math.max(0, p.tubes - used);
    existing.totalSpend += p.totalCost;
    existing.count += 1;
    groups.set(key, existing);
  }
  return Array.from(groups.values()).sort((a, b) => b.remaining - a.remaining);
}

export default function BirdInventoryView({ onBack }: { onBack: () => void }) {
  const [purchases, setPurchases] = useState<BirdPurchase[]>([]);
  const [currentStock, setCurrentStock] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [shuttleName, setShuttleName] = useState('');
  const [tubes, setTubes] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [speed, setSpeed] = useState<number | ''>('');
  const [qualityRating, setGroupRating] = useState<number>(0);
  const [birdNotes, setBirdNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<BirdPurchase>>({});
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [assignPurchase, setAssignPurchase] = useState<BirdPurchase | null>(null);
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [birdsRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
      ]);
      if (birdsRes.ok) {
        const data = await birdsRes.json();
        setPurchases(data.purchases ?? []);
        setCurrentStock(data.currentStock ?? 0);
      }
      if (sessionsRes.ok) {
        setSessions((await sessionsRes.json()) as Session[]);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Derived: tubes used per purchase across all sessions.
  const usedByPurchase = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      const usages = Array.isArray(s.birdUsages) ? s.birdUsages : [];
      for (const u of usages) {
        map.set(u.purchaseId, (map.get(u.purchaseId) ?? 0) + (u.tubes ?? 0));
      }
    }
    return map;
  }, [sessions]);

  const avgPerSession = useMemo(() => avgTubesPerSession(sessions, 8), [sessions]);
  const totalUsed = useMemo(() => tubesUsedAcross(sessions), [sessions]);
  const runway = useMemo(() => runwayWeeks(currentStock, avgPerSession), [currentStock, avgPerSession]);
  const brandGroups = useMemo(() => groupByBrand(purchases, usedByPurchase), [purchases, usedByPurchase]);

  const runwayColor =
    currentStock <= 0 ? '#ef4444' :
    runway < 2 ? '#fbbf24' :
    'var(--accent)';
  const runwayLabel =
    currentStock <= 0 ? 'out of stock' :
    runway === Infinity ? 'unlimited (no usage logged)' :
    `~${runway} week${runway === 1 ? '' : 's'} at current pace`;

  async function handleAddPurchase(e: React.FormEvent) {
    e.preventDefault();
    if (!shuttleName.trim() || tubes <= 0) return;
    setAdding(true);
    setAddError('');
    try {
      const payload: Record<string, unknown> = { name: shuttleName.trim(), tubes, totalCost, date };
      if (speed !== '' && speed > 0) payload.speed = speed;
      if (qualityRating > 0) payload.qualityRating = qualityRating;
      if (birdNotes.trim()) payload.notes = birdNotes.trim();
      const res = await fetch(`${BASE}/api/birds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShuttleName('');
        setTubes(0);
        setTotalCost(0);
        setDate(new Date().toISOString().slice(0, 10));
        setSpeed('');
        setGroupRating(0);
        setBirdNotes('');
        loadAll();
      } else {
        const data = await res.json().catch(() => ({}));
        setAddError(data.error ?? 'Failed to add purchase.');
      }
    } catch {
      setAddError('Network error.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${BASE}/api/birds`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      loadAll();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  }

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
        loadAll();
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

  return (
    <div className="animate-slideInRight space-y-4">
      <AdminBackHeader onBack={onBack} title="Bird Inventory" />

      {/* Hero card — stock, avg per session, runway */}
      {!loading && (
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-baseline gap-2">
            <span
              className="tabular-nums"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 42,
                fontWeight: 700,
                lineHeight: 1,
                color: runwayColor,
              }}
            >
              {currentStock}
            </span>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              tube{currentStock === 1 ? '' : 's'} remaining
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span
              className="material-icons"
              aria-hidden="true"
              style={{ fontSize: 16, color: runwayColor }}
            >
              trending_up
            </span>
            <span style={{ color: runwayColor }}>{runwayLabel}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2" style={{ borderTop: '1px solid var(--inner-card-border)' }}>
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Avg/session</p>
              <p className="text-base font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {avgPerSession || '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Total used</p>
              <p className="text-base font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {totalUsed}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Brands</p>
              <p className="text-base font-semibold tabular-nums" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {brandGroups.length}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Per-brand breakdown */}
      {!loading && brandGroups.length > 0 && (
        <div className="glass-card p-5 space-y-2">
          <p className="section-label">BY BRAND</p>
          {brandGroups.map((g) => {
            const expanded = expandedBrand === g.brand;
            const purchasesOfBrand = purchases.filter((p) => parseBirdName(p.name).brand === (g.brand === '—' ? '' : g.brand));
            return (
              <div key={g.brand} className="inner-card p-3">
                <button
                  type="button"
                  onClick={() => setExpandedBrand(expanded ? null : g.brand)}
                  aria-expanded={expanded}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                    padding: 0,
                    cursor: 'pointer',
                    minHeight: 44,
                  }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <p className="text-sm font-semibold">{g.brand}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                        {g.remaining}
                      </span>
                      {' of '}
                      <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                        {g.tubesBought}
                      </span>
                      {' tubes · $'}
                      <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                        {g.totalSpend.toFixed(2)}
                      </span>
                      {' total'}
                    </p>
                  </div>
                  <span className="material-icons" aria-hidden="true" style={{ fontSize: 20, color: 'var(--text-muted)' }}>
                    {expanded ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
                {expanded && (
                  <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--inner-card-border)' }}>
                    {purchasesOfBrand.map((p) => {
                      const used = usedByPurchase.get(p.id) ?? 0;
                      const remaining = Math.max(0, p.tubes - used);
                      return (
                        <div key={p.id} className="text-xs flex justify-between" style={{ color: 'var(--text-muted)' }}>
                          <span>{parseBirdName(p.name).model || p.name}</span>
                          <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                            {remaining}/{p.tubes}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Purchase list */}
      {loading ? (
        <div className="glass-card p-5">
          <ShimmerLoader lines={3} />
        </div>
      ) : purchases.length > 0 ? (
        <div className="glass-card p-5 space-y-3">
          <p className="section-label">PURCHASE HISTORY</p>
          {purchases.map((p) => {
            const used = usedByPurchase.get(p.id) ?? 0;
            return (
              <div key={p.id} className="inner-card p-3">
                {editingId === p.id ? (
                  <div className="space-y-3">
                    <Label text="Shuttle">
                      <input
                        id="bird-edit-name"
                        name="birdName"
                        type="text"
                        value={editForm.name ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        maxLength={100}
                        autoComplete="off"
                      />
                    </Label>
                    <div className="grid grid-cols-3 gap-3">
                      <Label text="Tubes">
                        <input
                          id="bird-edit-tubes"
                          name="tubes"
                          type="number"
                          min={1}
                          value={editForm.tubes || ''}
                          onChange={(e) => setEditForm({ ...editForm, tubes: parseInt(e.target.value) || 0 })}
                        />
                      </Label>
                      <Label text="Total ($)">
                        <input
                          id="bird-edit-total-cost"
                          name="totalCost"
                          type="number"
                          min={0}
                          step={0.01}
                          value={editForm.totalCost || ''}
                          onChange={(e) => setEditForm({ ...editForm, totalCost: parseFloat(e.target.value) || 0 })}
                        />
                      </Label>
                      <Label text="Speed">
                        <input
                          id="bird-edit-speed"
                          name="speed"
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
                          id="bird-edit-date"
                          name="date"
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
                        id="bird-edit-notes"
                        name="notes"
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
                        disabled={savingEdit || !editForm.name?.trim() || !editForm.tubes || editForm.tubes <= 0 || !editForm.totalCost || editForm.totalCost <= 0}
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
                        {p.tubes} tube{p.tubes !== 1 ? 's' : ''} bought
                        {used > 0 && ` · ${used} used`}
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
                        onClick={() => setAssignPurchase(p)}
                        className="hover:opacity-70 transition-opacity"
                        aria-label={`Assign ${p.name} to a session`}
                        title="Assign to session"
                        style={{ color: 'var(--accent)', minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <span className="material-icons" style={{ fontSize: 18 }}>add</span>
                      </button>
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
            );
          })}
        </div>
      ) : (
        <div className="glass-card p-5">
          <p className="text-sm text-center py-2" style={{ color: 'var(--text-muted)' }}>No purchases recorded yet.</p>
        </div>
      )}

      {/* Add purchase form — placed at the bottom so the submit button is
          in the thumb zone for one-handed use. */}
      <form onSubmit={handleAddPurchase}>
        <div className="glass-card p-5 space-y-3">
          <p className="section-label">ADD PURCHASE</p>
          <Label text="Shuttle">
            <input
              id="bird-add-name"
              name="birdName"
              type="text"
              placeholder="e.g. Victor Master No.3"
              value={shuttleName}
              onChange={(e) => setShuttleName(e.target.value)}
              maxLength={100}
              autoComplete="off"
            />
          </Label>
          <div className="grid grid-cols-3 gap-3">
            <Label text="Tubes">
              <input
                id="bird-add-tubes"
                name="tubes"
                type="number"
                min={1}
                value={tubes || ''}
                onChange={(e) => setTubes(parseInt(e.target.value) || 0)}
                placeholder="0"
              />
            </Label>
            <Label text="Total ($)">
              <input
                id="bird-add-total-cost"
                name="totalCost"
                type="number"
                min={0}
                step={0.01}
                value={totalCost || ''}
                onChange={(e) => setTotalCost(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
            </Label>
            <Label text="Speed">
              <input
                id="bird-add-speed"
                name="speed"
                type="number"
                min={1}
                value={speed}
                onChange={(e) => setSpeed(e.target.value ? parseInt(e.target.value) : '')}
                placeholder="e.g. 77"
              />
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Label text="Date">
              <input
                id="bird-add-date"
                name="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Label>
            <Label text="Quality Rating">
              <div className="flex gap-1 items-center pt-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setGroupRating(qualityRating === n ? 0 : n)}
                    className="flex items-center justify-center transition-all"
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: n <= qualityRating ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                      border: `1px solid ${n <= qualityRating ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
                      color: n <= qualityRating ? 'var(--accent)' : 'var(--text-muted)',
                      fontSize: 13, fontWeight: 600,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Label>
          </div>
          <Label text="Notes (optional)">
            <textarea
              id="bird-add-notes"
              name="notes"
              value={birdNotes}
              onChange={(e) => setBirdNotes(e.target.value)}
              placeholder="e.g. Good for doubles, flies straight"
              maxLength={500}
              rows={2}
              style={{ resize: 'none' }}
            />
          </Label>
          {addError && <p className="text-red-400 text-xs" role="alert">{addError}</p>}
          <button
            type="submit"
            disabled={adding || !shuttleName.trim() || tubes <= 0}
            className="btn-primary w-full"
            style={{ minHeight: 44 }}
          >
            {adding ? 'Adding...' : 'Add Purchase'}
          </button>
        </div>
      </form>

      <AssignUsageSheet
        open={assignPurchase !== null}
        onClose={() => setAssignPurchase(null)}
        purchase={assignPurchase}
        onSaved={loadAll}
      />
    </div>
  );
}
