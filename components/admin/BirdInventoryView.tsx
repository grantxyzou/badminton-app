'use client';

import { useState, useEffect, useCallback } from 'react';
import type { BirdPurchase } from '@/lib/types';
import { ShimmerLoader } from '../ShuttleLoader';
import AdminBackHeader from './AdminBackHeader';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{text}</span>
      {children}
    </label>
  );
}

export default function BirdInventoryView({ onBack }: { onBack: () => void }) {
  const [purchases, setPurchases] = useState<BirdPurchase[]>([]);
  const [currentStock, setCurrentStock] = useState(0);
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

  const loadPurchases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/birds`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPurchases(data.purchases ?? []);
        setCurrentStock(data.currentStock ?? 0);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPurchases(); }, [loadPurchases]);

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
        loadPurchases();
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
      loadPurchases();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="animate-slideInRight space-y-4">
      <AdminBackHeader onBack={onBack} title="Bird Inventory" />

      {/* Stock indicator */}
      {!loading && (
        <div className="glass-card p-4">
          <div className="inner-card p-3 flex items-center gap-3">
            <span
              className="material-icons"
              style={{ fontSize: 20, color: currentStock >= 2 ? 'var(--accent)' : '#fbbf24' }}
            >
              inventory_2
            </span>
            <p className="text-sm font-medium" style={{ color: currentStock >= 2 ? 'var(--accent)' : '#fbbf24' }}>
              {currentStock} tube{currentStock !== 1 ? 's' : ''} remaining
            </p>
          </div>
        </div>
      )}

      {/* Add purchase form */}
      <form onSubmit={handleAddPurchase}>
        <div className="glass-card p-5 space-y-3">
          <p className="section-label">ADD PURCHASE</p>
          <Label text="Shuttle">
            <input
              type="text"
              placeholder="e.g. Victor Master No.3"
              value={shuttleName}
              onChange={(e) => setShuttleName(e.target.value)}
              maxLength={100}
            />
          </Label>
          <div className="grid grid-cols-3 gap-3">
            <Label text="Tubes">
              <input
                type="number"
                min={1}
                value={tubes || ''}
                onChange={(e) => setTubes(parseInt(e.target.value) || 0)}
                placeholder="0"
              />
            </Label>
            <Label text="Total ($)">
              <input
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
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Label>
            <Label text="Group Rating">
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

      {/* Purchase list */}
      {loading ? (
        <div className="glass-card p-5">
          <ShimmerLoader lines={3} />
        </div>
      ) : purchases.length > 0 ? (
        <div className="glass-card p-5 space-y-3">
          <p className="section-label">PURCHASE HISTORY</p>
          {purchases.map((p) => (
            <div key={p.id} className="inner-card p-3">
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
                <div className="flex items-center gap-3 shrink-0">
                  {p.totalCost > 0 && (
                    <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>${p.totalCost.toFixed(2)}</span>
                  )}
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
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-5">
          <p className="text-sm text-center py-2" style={{ color: 'var(--text-muted)' }}>No purchases recorded yet.</p>
        </div>
      )}
    </div>
  );
}
