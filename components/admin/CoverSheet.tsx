'use client';

import { useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type CoverSheetMode = 'cover-only' | 'cover-and-remove';
export type CoverChoice = 'absorb' | 'resplit';

interface Props {
  open: boolean;
  mode: CoverSheetMode;
  playerId: string;
  playerName: string;
  amount: number;
  sessionId: string;
  sessionLabel?: string;
  /** True when the session already has a frozen bill. Covering then re-runs
   *  the settle math so everyone's amount reflects the new split immediately
   *  (resplit raises the others; absorb leaves them unchanged). */
  wasSettled?: boolean;
  onClose: () => void;
  onCovered: () => void;
}

/**
 * Unified confirm sheet for the "Cover" workflow.
 *  - cover-only: choose how to cover — "I've got it" (absorb: admin eats the
 *      share, others unchanged) or "Split across everyone else" (resplit: the
 *      share spreads to the remaining payers). PATCHes writtenOff:true + coverMode.
 *  - cover-and-remove: triggered from roster Remove when the player has an unpaid
 *      owedAmount. "Cover & remove" PATCHes { writtenOff:true, coverMode:'absorb',
 *      removed:true } atomically; "Remove without covering" PATCHes removed:true.
 *
 * Friend-voice copy — "I got it" beats "Mark covered."
 */
export default function CoverSheet({
  open,
  mode,
  playerId,
  playerName,
  amount,
  sessionId,
  sessionLabel,
  wasSettled,
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

  // Re-freeze the bill after a cover change so the per-person math reflects it.
  // DELETE preserves paid checkmarks; POST re-stamps owedAmount with the cover
  // flags applied. Only runs when the session was already settled.
  async function resettle() {
    if (!wasSettled) return;
    const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const del = await fetch(`${BASE}/api/session/settle${q}`, { method: 'DELETE' });
    if (!del.ok && del.status !== 404) {
      throw new Error('Could not refresh the bill.');
    }
    const post = await fetch(`${BASE}/api/session/settle${q}`, { method: 'POST' });
    if (!post.ok) {
      throw new Error('Could not refresh the bill.');
    }
  }

  async function doCover(choice: CoverChoice) {
    setSubmitting(true);
    setError('');
    try {
      await patch({ writtenOff: true, coverMode: choice });
      await resettle();
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
      // One atomic PATCH, not two. Removing implies absorbing their share.
      await patch({ writtenOff: true, coverMode: 'absorb', removed: true });
      await resettle();
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
      await resettle();
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
      maxHeight="60vh"
      className="max-w-sm mx-auto"
    >
      <BottomSheetHeader className="p-4">
        <h2 className="bpm-h3" style={{ margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>{subtitle}</p>
      </BottomSheetHeader>
      <BottomSheetBody className="p-4 pb-8" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && (
          <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-red)', margin: 0 }}>
            {error}
          </p>
        )}
        {mode === 'cover-only' ? (
          <>
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              disabled={submitting}
              onClick={() => doCover('absorb')}
            >
              {submitting ? '…' : "I've got it — I'll cover it"}
            </button>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '-2px 2px 4px' }}>
              You absorb their share. Everyone else pays the same.
            </p>
            <button
              type="button"
              className="cc-btn cc-btn-secondary"
              disabled={submitting}
              onClick={() => doCover('resplit')}
            >
              {submitting ? '…' : 'Split it across everyone else'}
            </button>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '-2px 2px 4px' }}>
              Their share is spread over the other players — you pay nothing extra.
            </p>
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
