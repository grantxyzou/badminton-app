'use client';

import { useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type CoverSheetMode = 'cover-only' | 'cover-and-remove';

interface Props {
  open: boolean;
  mode: CoverSheetMode;
  playerId: string;
  playerName: string;
  amount: number;
  sessionId: string;
  sessionLabel?: string;
  onClose: () => void;
  onCovered: () => void;
}

/**
 * Unified confirm sheet for the v1.5 "Cover" workflow. Two modes:
 *  - cover-only: one primary button ("I got it") → PATCH writtenOff:true
 *  - cover-and-remove: triggered from roster Remove when player has unpaid
 *      owedAmount. Primary "Cover & remove" PATCHes writtenOff:true then
 *      removed:true. Secondary "Remove without covering" PATCHes removed:true
 *      only.
 *
 * Friend-voice copy per design §3 — "I got it" beats "Mark covered."
 */
export default function CoverSheet({
  open,
  mode,
  playerId,
  playerName,
  amount,
  sessionId,
  sessionLabel,
  onClose,
  onCovered,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`${BASE}/api/players`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: playerId, sessionId, ...body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `PATCH failed with ${res.status}`);
    }
    return res.json();
  }

  async function handleCover() {
    setSubmitting(true);
    setError('');
    try {
      await patch({ writtenOff: true });
      onCovered();
      onClose();
    } catch {
      setError("Couldn't cover — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCoverAndRemove() {
    setSubmitting(true);
    setError('');
    try {
      await patch({ writtenOff: true });
      await patch({ removed: true });
      onCovered();
      onClose();
    } catch {
      setError("Couldn't cover — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveOnly() {
    setSubmitting(true);
    setError('');
    try {
      await patch({ removed: true });
      onCovered();
      onClose();
    } catch {
      setError("Couldn't remove — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const title =
    mode === 'cover-only'
      ? `Cover ${playerName}'s $${amount}?`
      : `${playerName} owes $${amount}`;
  const subtitle =
    mode === 'cover-only'
      ? `${sessionLabel ? `From ${sessionLabel}. ` : ''}Shows on the ledger as covered by you.`
      : 'What should we do with their debt?';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="Cover confirmation"
      maxHeight="50vh"
      className="max-w-sm mx-auto"
    >
      <BottomSheetHeader className="p-4">
        <h2 className="bpm-h3" style={{ margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>{subtitle}</p>
      </BottomSheetHeader>
      <BottomSheetBody className="p-4 pb-8" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && (
          <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
            {error}
          </p>
        )}
        {mode === 'cover-only' ? (
          <>
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              disabled={submitting}
              onClick={handleCover}
            >
              {submitting ? '…' : 'I got it'}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              disabled={submitting}
              onClick={handleCoverAndRemove}
            >
              {submitting ? '…' : 'Cover & remove'}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-secondary"
              disabled={submitting}
              onClick={handleRemoveOnly}
            >
              Remove without covering
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </button>
          </>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
