'use client';

import { useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { todayIso } from '@/lib/stringingDue';
import { metresFor, REEL_M, SET_M } from '@/lib/stringStockMath';
import type { CatalogItem, StringPurchase } from '@/lib/types';
import BirdSheetField from './BirdSheetField';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  /** A save landed; the card refetches. */
  onSaved: () => void;
  /** The offered strings, with the catalog row for each linked one. */
  offered: Array<{ label: string; item: CatalogItem | null }>;
}

/**
 * Log one string purchase (docs/plans/string-inventory.md): which offered
 * string, a reel or a pack of sets, how many, what one holds in metres
 * (prefilled from the catalog when the string is linked to it), what it
 * cost, when. Mount it with a fresh `key` per opening, like the bird sheet:
 * the fields are `useState` initialisers.
 */
export default function StringPurchaseSheet({ open, onClose, onSaved, offered }: Props) {
  const [label, setLabel] = useState(offered[0]?.label ?? '');
  const [unit, setUnit] = useState<StringPurchase['unit']>('reel');
  const [units, setUnits] = useState<number | ''>(1);
  const [metresTouched, setMetresTouched] = useState(false);
  const [metres, setMetres] = useState<number | ''>(() => metresFor('reel', offered[0]?.item ?? undefined));
  const [cost, setCost] = useState<number | ''>('');
  const [date, setDate] = useState(() => todayIso());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chosen = offered.find((o) => o.label === label) ?? null;
  const defaultMetres = (u: StringPurchase['unit']) => metresFor(u, chosen?.item ?? undefined);

  function pickLabel(next: string) {
    setLabel(next);
    if (!metresTouched) {
      const row = offered.find((o) => o.label === next);
      setMetres(metresFor(unit, row?.item ?? undefined));
    }
  }
  function pickUnit(next: StringPurchase['unit']) {
    setUnit(next);
    if (!metresTouched) setMetres(defaultMetres(next));
  }

  async function save() {
    const n = typeof units === 'number' ? units : 0;
    const m = typeof metres === 'number' ? metres : 0;
    const c = typeof cost === 'number' ? cost : -1;
    if (!label.trim()) { setError('Pick a string.'); return; }
    if (!Number.isInteger(n) || n <= 0) { setError('How many did you buy?'); return; }
    if (m <= 0) { setError('How many metres does one hold?'); return; }
    if (c < 0) { setError('What did it cost? 0 is fine for a gift.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/stringing/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          ...(chosen?.item ? { catalogId: chosen.item.id } : {}),
          unit, units: n, metresPerUnit: m,
          totalCostCents: Math.round(c * 100),
          date,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? `Couldn't save (${data.error.replace(/_/g, ' ')}).` : "Couldn't save the purchase.");
        return;
      }
      onClose();
      onSaved();
    } catch {
      setError('Network error.');
    } finally {
      setSaving(false);
    }
  }

  const perSet = typeof cost === 'number' && typeof units === 'number' && typeof metres === 'number' && units > 0 && metres > 0
    ? (cost / (units * metres)) * (chosen?.item && typeof chosen.item.attributes?.setLengthM === 'number' ? chosen.item.attributes.setLengthM : SET_M)
    : null;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Log string purchase">
      <BottomSheetHeader onClose={onClose} closeLabel="Close">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Log string purchase</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <BirdSheetField label="String">
            {offered.length > 0 ? (
              <select value={label} onChange={(e) => pickLabel(e.target.value)}>
                {offered.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            ) : (
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. BG65" maxLength={60} />
            )}
          </BirdSheetField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <BirdSheetField label="Bought as">
              <div className="segment-control flex">
                {(['reel', 'set'] as const).map((u) => (
                  <button key={u} type="button" onClick={() => pickUnit(u)} className={`flex-1 flex items-center justify-center fs-sm ${unit === u ? 'segment-tab-active' : 'segment-tab-inactive'}`}>
                    {u === 'reel' ? 'Reel' : 'Sets'}
                  </button>
                ))}
              </div>
            </BirdSheetField>
            <BirdSheetField label={unit === 'reel' ? 'Reels' : 'Sets'}>
              <input type="number" inputMode="numeric" min={1} max={100} value={units} onChange={(e) => setUnits(e.target.value === '' ? '' : Number(e.target.value))} />
            </BirdSheetField>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <BirdSheetField label={unit === 'reel' ? 'Metres per reel' : 'Metres per set'}>
              <input type="number" inputMode="decimal" min={1} max={1000} value={metres} onChange={(e) => { setMetresTouched(true); setMetres(e.target.value === '' ? '' : Number(e.target.value)); }} />
            </BirdSheetField>
            <BirdSheetField label="Total cost ($)">
              <input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.00" />
            </BirdSheetField>
          </div>
          <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
            {`A reel is usually ${REEL_M} m and a set ${SET_M} m; one job uses one set.`}
            {perSet !== null && ` That makes this string about $${perSet.toFixed(2)} a racket.`}
          </p>
          <BirdSheetField label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </BirdSheetField>
          <BirdSheetField label="Notes (optional)">
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Where from, colour…" />
          </BirdSheetField>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Log purchase'}
          </button>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
