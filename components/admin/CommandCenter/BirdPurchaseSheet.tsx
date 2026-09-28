'use client';

import { useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { todayIso } from '@/lib/stringingDue';
import type { BirdPurchase } from '@/lib/types';
import BirdSheetField from './BirdSheetField';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  /** `null` logs a new purchase; a purchase edits (and may delete) it. */
  editing: BirdPurchase | null;
  onClose: () => void;
  /** A save or delete landed; the page refetches. */
  onSaved: () => void;
  /** "Assign tubes to sessions" — the page closes this sheet and opens that one. */
  onAssign: (purchase: BirdPurchase) => void;
}

/**
 * Log / edit one shuttle purchase. Owns its own form state, so the page
 * that opens it holds nothing about the form. MOUNT IT WITH A FRESH `key`
 * PER OPENING (the page keys it on an opening counter): the fields are
 * `useState` initialisers read from `editing`, which is what lets Add and
 * Edit share one component with no reset-on-open effect — and keying on a
 * counter rather than on `open` keeps the same instance through the close
 * so the slide-out still plays.
 */
export default function BirdPurchaseSheet({ open, editing, onClose, onSaved, onAssign }: Props) {
  const [formName, setFormName] = useState(editing?.name ?? '');
  const [formTubes, setFormTubes] = useState<number | ''>(editing?.tubes ?? '');
  const [formCost, setFormCost] = useState<number | ''>(editing?.totalCost ?? '');
  const [formSpeed, setFormSpeed] = useState<number | ''>(typeof editing?.speed === 'number' ? editing.speed : '');
  const [formQuality, setFormQuality] = useState<number>(typeof editing?.qualityRating === 'number' ? editing.qualityRating : 0);
  /* `todayIso()`, not `toISOString().slice(0,10)`. The latter is UTC, and
     Vancouver is 7-8 hours behind it — so every purchase logged after 5pm
     local defaulted to TOMORROW'S date, silently, on the screen that decides
     which week a shuttle spend lands in. (The Add path used to reset to the
     UTC form after the initial state had been fixed; one initialiser now.) */
  const [formDate, setFormDate] = useState(() => (editing ? editing.date.slice(0, 10) : todayIso()));
  const [formNotes, setFormNotes] = useState(editing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [formError, setFormError] = useState('');
  const editingId = editing?.id ?? null;

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
      onClose();
      onSaved();
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
      onClose();
      onSaved();
    } catch {
      setFormError('Network error.');
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={editingId ? 'Edit purchase' : 'Log purchase'}
    >
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{editingId ? 'Edit purchase' : 'Log purchase'}</span>
        <button
          type="button"
          onClick={onClose}
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
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <BirdSheetField label="Brand / model">
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Ling-Mei 60"
              maxLength={120}
            />
          </BirdSheetField>
          <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
            <BirdSheetField label="Tubes" style={{ flex: 1 }}>
              <input
                type="number"
                inputMode="decimal"
                step={0.5}
                value={formTubes}
                onChange={(e) => setFormTubes(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </BirdSheetField>
            <BirdSheetField label="Total cost" style={{ flex: 1 }}>
              <input
                type="number"
                inputMode="decimal"
                step={0.01}
                value={formCost}
                onChange={(e) => setFormCost(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </BirdSheetField>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
            <BirdSheetField label="Date" style={{ flex: 1 }}>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </BirdSheetField>
            <BirdSheetField label="Speed" style={{ flex: 1 }}>
              <input
                type="number"
                inputMode="numeric"
                value={formSpeed}
                onChange={(e) => setFormSpeed(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 76"
              />
            </BirdSheetField>
          </div>
          <BirdSheetField label="Quality (1–5)">
            <div style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
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
                    padding: '0',
                    lineHeight: 0,
                  }}
                >
                  <span
                    className="material-icons"
                    style={{
                      fontSize: 'var(--icon-lg)',
                      color: i <= formQuality ? 'var(--amber)' : 'rgba(var(--glass-tint), 0.18)',
                    }}
                  >
                    star
                  </span>
                </button>
              ))}
            </div>
          </BirdSheetField>
          <BirdSheetField label="Notes (optional)">
            <input
              type="text"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="e.g. Same as last batch"
              maxLength={200}
            />
          </BirdSheetField>

          {formError && (
            <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: '0' }}>
              {formError}
            </p>
          )}

          {editing && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onAssign(editing);
              }}
              className="cc-btn cc-btn-secondary"
              style={{ alignSelf: 'flex-start' }}
            >
              <span className="material-icons" style={{ fontSize: 'var(--fs-lg)' }}>event</span>
              Assign tubes to sessions
            </button>
          )}

          {/* Two-step delete confirm — in-sheet (no stacked sheet, no native
              confirm()). A referenced purchase comes back 409 with guidance
              ("move its tubes first"), surfaced via formError above. */}
          {confirmingDelete ? (
            // Fades in: a confirm that appears in one frame reads as a mis-tap.
            <div className="motion-fade" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
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
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
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
                onClick={onClose}
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
  );
}
