'use client';

import { useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import BirdSheetField from './BirdSheetField';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  /** The app's own count, which the physical recount is measured against. */
  currentStock: number;
  onClose: () => void;
  /** The adjustment landed; the page refetches. */
  onSaved: () => void;
}

/**
 * Correct the on-hand total to a physical recount. Same contract as
 * `BirdPurchaseSheet`: owns its form, and the page mounts it with a fresh
 * `key` per opening so the count starts from `currentStock` each time.
 */
export default function BirdReconcileSheet({ open, currentStock, onClose, onSaved }: Props) {
  const [reconcileCount, setReconcileCount] = useState<number | ''>(currentStock);
  const [reconcileReason, setReconcileReason] = useState('');
  const [reconcileSaving, setReconcileSaving] = useState(false);
  const [reconcileError, setReconcileError] = useState('');

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
      onClose();
      onSaved();
    } catch {
      setReconcileError('Network error.');
    } finally {
      setReconcileSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Reconcile count">
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Reconcile count</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: '0', lineHeight: 1.5 }}>
            The app counts <strong style={{ color: 'var(--text-primary)' }}>{currentStock} tubes</strong> on hand
            (purchased − used). If your physical count differs — broken tubes, gifts, miscounts — enter the real
            number and we&apos;ll log the difference.
          </p>
          <BirdSheetField label="Tubes actually on hand">
            <input
              type="number"
              inputMode="decimal"
              step={0.25}
              min={0}
              value={reconcileCount}
              onChange={(e) => setReconcileCount(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </BirdSheetField>
          {typeof reconcileCount === 'number' && reconcileCount !== currentStock && (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-faint)', margin: '0', fontFamily: 'var(--font-mono, "JetBrains Mono")' }}>
              adjustment: {reconcileCount - currentStock > 0 ? '+' : '−'}{Math.abs(Math.round((reconcileCount - currentStock) * 100) / 100)} tubes
            </p>
          )}
          <BirdSheetField label="Reason (optional)">
            <input
              type="text"
              value={reconcileReason}
              onChange={(e) => setReconcileReason(e.target.value)}
              placeholder="e.g. 2 tubes water-damaged"
              maxLength={200}
            />
          </BirdSheetField>
          {reconcileError && (
            <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: '0' }}>
              {reconcileError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
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
  );
}
