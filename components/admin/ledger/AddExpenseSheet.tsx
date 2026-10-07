'use client';

import { useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import BirdSheetField from '@/components/admin/CommandCenter/BirdSheetField';
import { useOnline } from '@/lib/useOnline';
import { todayIso } from '@/lib/stringingDue';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type ExpenseCategory = 'court' | 'shuttles' | 'strings' | 'other';
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = { court: 'Courts', shuttles: 'Shuttles', strings: 'Strings', other: 'Other' };
const CATEGORIES: ExpenseCategory[] = ['court', 'shuttles', 'strings', 'other'];

const ERROR: Record<string, string> = {
  invalid_amount: 'Enter an amount up to $10,000.',
  invalid_note: 'Say what it was for, in 80 characters or fewer.',
  invalid_date: 'Pick the day it was spent.',
  invalid_category: 'Pick a category.',
};

/**
 * One club expense the app cannot see on its own. Owns its form state;
 * MOUNT WITH A FRESH `key` PER OPENING (the page keys it on a counter), the
 * `BirdPurchaseSheet` pattern. No edit: the ledger is append-only, so a
 * wrong expense is removed from the page and entered again.
 */
export default function AddExpenseSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const online = useOnline();
  const [amount, setAmount] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => todayIso());
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const amountCents = typeof amount === 'number' ? Math.round(amount * 100) : 0;
    if (amountCents <= 0) { setError(ERROR.invalid_amount); return; }
    if (!note.trim()) { setError(ERROR.invalid_note); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents, note: note.trim(), date, category }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(ERROR[data.error as string] ?? "Couldn't save — try again.");
        return;
      }
      onClose();
      onSaved();
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Add expense">
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Add expense</span>
        <button type="button" onClick={onClose} aria-label="Close" className="cc-btn cc-btn-ghost">
          <span className="material-icons" style={{ fontSize: 'var(--icon-md)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Something the club paid for that isn&apos;t a court booking or a shuttle purchase already logged.
          </p>
          <div className="flex" style={{ gap: 'var(--space-4)' }}>
            <BirdSheetField label="Amount" style={{ flex: 1 }}>
              <input
                type="number"
                inputMode="decimal"
                step={0.01}
                min={0}
                value={amount}
                placeholder="0.00"
                aria-label="Amount"
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </BirdSheetField>
            <BirdSheetField label="Date" style={{ flex: 1 }}>
              <input type="date" value={date} aria-label="Date" onChange={(e) => setDate(e.target.value)} />
            </BirdSheetField>
          </div>
          <BirdSheetField label="What for">
            <input type="text" value={note} maxLength={80} placeholder="e.g. Court booking fee" aria-label="What for" onChange={(e) => setNote(e.target.value)} />
          </BirdSheetField>
          <BirdSheetField label="Category">
            <div className="segment-control flex" role="tablist" aria-label="Category">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={category === c}
                  onClick={() => setCategory(c)}
                  className={`flex-1 flex items-center justify-center fs-sm rounded-full ${category === c ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </BirdSheetField>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
            <div style={{ flex: 1 }} />
            <button type="button" className="cc-btn cc-btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="cc-btn cc-btn-primary" onClick={() => void save()} disabled={!online || saving}>
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
