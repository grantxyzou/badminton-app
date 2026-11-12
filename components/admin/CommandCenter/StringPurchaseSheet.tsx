'use client';

import { useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import { todayIso } from '@/lib/stringingDue';
import { metresFor, REEL_M, SET_M } from '@/lib/stringStockMath';
import type { CatalogItem, StringPurchase } from '@/lib/types';
import DatePicker from '@/components/DatePicker';
import MoneyInput from '@/components/primitives/MoneyInput';
import { ColourDot } from '@/components/stringing/StringColours';
import { stringColours } from '@/lib/stringShelf';
import { colourIdOf, PALETTE_EN, STRING_PALETTE, type StringColourId } from '@/lib/stringPalette';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * A labelled field, in the label the rest of the bench's forms use. A `div`
 * for a group of buttons: a wrapping <label> would send a tap on its text to
 * the first button inside it.
 */
function Field({ label, children, group = false }: { label: string; children: React.ReactNode; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span className="section-label-muted">{label}</span>
      {children}
    </Tag>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** A save landed; the card refetches. */
  onSaved: () => void;
  /** The offered strings, with the catalog row for each linked one and the
   *  reel colours the stringer set for it (empty when none are said). */
  offered: Array<{ label: string; item: CatalogItem | null; colours?: StringColourId[] }>;
  /** Preselect a string: the sheet is opened from that string's own sheet. */
  initialLabel?: string;
}

/**
 * Log one string purchase (docs/plans/string-inventory.md): which offered
 * string, a reel or a pack of sets, how many, what one holds in metres
 * (prefilled from the catalog when the string is linked to it), what it
 * cost, when. Mount it with a fresh `key` per opening, like the bird sheet:
 * the fields are `useState` initialisers.
 */
export default function StringPurchaseSheet({ open, onClose, onSaved, offered, initialLabel }: Props) {
  const first = offered.find((o) => o.label === initialLabel) ?? offered[0];
  const [label, setLabel] = useState(first?.label ?? '');
  const [unit, setUnit] = useState<StringPurchase['unit']>('reel');
  const [units, setUnits] = useState<number | ''>(1);
  const [metresTouched, setMetresTouched] = useState(false);
  const [metres, setMetres] = useState<number | ''>(() => metresFor('reel', first?.item ?? undefined));
  const [costDraft, setCostDraft] = useState('');
  // Empty is unanswered; anything else must read as a number.
  const cost: number | '' = costDraft.trim() === '' ? '' : Number.isFinite(Number(costDraft)) ? Number(costDraft) : NaN;
  const [date, setDate] = useState(() => todayIso());
  const [notes, setNotes] = useState('');
  /** `null` is "Mixed / not sure": the purchase stores no colour. */
  const [color, setColor] = useState<StringColourId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chosen = offered.find((o) => o.label === label) ?? null;
  /* The colours this reel could be (docs/plans/string-stock-by-colour.md):
     the stringer's reel colours for the string, else the maker's (single
     colours only — a two-tone is no palette colour), else the whole palette
     for a string nothing describes. */
  const colourChoices: StringColourId[] = (() => {
    if (chosen?.colours && chosen.colours.length > 0) return chosen.colours;
    const fromCatalog = stringColours(chosen?.item ?? null).map((c) => colourIdOf(c.name)).filter((id): id is StringColourId => id !== null);
    return fromCatalog.length > 0 ? STRING_PALETTE.filter((id) => fromCatalog.includes(id)) : [...STRING_PALETTE];
  })();
  const defaultMetres = (u: StringPurchase['unit']) => metresFor(u, chosen?.item ?? undefined);

  function pickLabel(next: string) {
    setLabel(next);
    // Another string's colours are another list; start again at "Mixed".
    setColor(null);
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
    const c = typeof cost === 'number' && Number.isFinite(cost) ? cost : -1;
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
          ...(color ? { color } : {}),
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
    && Number.isFinite(cost)
    ? (cost / (units * metres)) * (chosen?.item && typeof chosen.item.attributes?.setLengthM === 'number' ? chosen.item.attributes.setLengthM : SET_M)
    : null;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Log string purchase">
      <BottomSheetHeader onClose={onClose} closeLabel="Close">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Log string purchase</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Field label="String">
            {offered.length > 0 ? (
              <select value={label} onChange={(e) => pickLabel(e.target.value)}>
                {offered.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            ) : (
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. BG65" maxLength={60} />
            )}
          </Field>
          <Field label="Colour" group>
            {/* One pick, as a radio row of the app's chips. "Mixed / not
                sure" first and the default: a stringer who skips it logs what
                he always did, and the reel counts in the string's mixed pool. */}
            <div role="radiogroup" aria-label="Colour" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-2)' }}>
              {([null, ...colourChoices] as Array<StringColourId | null>).map((id) => {
                const on = color === id;
                return (
                  <button
                    key={id ?? 'mixed'}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setColor(id)}
                    style={{ minHeight: 44, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'inherit' }}
                  >
                    <span className={on ? 'filter-chip filter-chip--applied' : 'filter-chip'} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      {id && <ColourDot id={id} size="sm" />}
                      {id ? PALETTE_EN[id] : 'Mixed / not sure'}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Field label="Bought as" group>
              <div className="segment-control flex">
                {(['reel', 'set'] as const).map((u) => (
                  <button key={u} type="button" onClick={() => pickUnit(u)} className={`flex-1 flex items-center justify-center fs-sm ${unit === u ? 'segment-tab-active' : 'segment-tab-inactive'}`}>
                    {u === 'reel' ? 'Reel' : 'Sets'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={unit === 'reel' ? 'Reels' : 'Sets'}>
              <input type="number" inputMode="numeric" min={1} max={100} value={units} onChange={(e) => setUnits(e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Field label={unit === 'reel' ? 'Metres per reel' : 'Metres per set'}>
              <input type="number" inputMode="decimal" min={1} max={1000} value={metres} onChange={(e) => { setMetresTouched(true); setMetres(e.target.value === '' ? '' : Number(e.target.value)); }} />
            </Field>
            <Field label="Total cost">
              <MoneyInput value={costDraft} onChange={setCostDraft} placeholder="0.00" ariaLabel="Total cost" />
            </Field>
          </div>
          <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
            {`A reel is usually ${REEL_M} m and a set ${SET_M} m; one job uses one set.`}
            {perSet !== null && ` That makes this string about $${perSet.toFixed(2)} a racket.`}
          </p>
          {/* The bench's own date picker, as on New job's "Ready by". */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span className="section-label-muted">Date</span>
            <DatePicker value={date} onChange={(d) => setDate(d || todayIso())} placeholder="Date" />
          </div>
          <Field label="Notes (optional)">
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Where from…" />
          </Field>
        </div>
      </BottomSheetBody>
      <BottomSheetFooter className="flex flex-col gap-3">
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Log purchase'}
        </button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
