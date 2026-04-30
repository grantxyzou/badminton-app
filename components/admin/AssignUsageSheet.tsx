'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import type { BirdPurchase, Session } from '@/lib/types';
import { normalizeBirdUsages } from '@/lib/birdUsages';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  purchase: BirdPurchase | null;
  /** Called after at least one successful PATCH so parent can refresh hero stats. */
  onSaved: () => void;
}

interface Row {
  sessionId: string;
  datetime?: string;
  title?: string;
  tubes: number; // current value in form state
  initial: number; // server-side value at load time
}

function fmtSessionDate(datetime?: string): string {
  if (!datetime) return '—';
  try {
    return new Date(datetime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return datetime;
  }
}

export default function AssignUsageSheet({ open, onClose, purchase, onSaved }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
    if (!purchase) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/sessions`, { cache: 'no-store' });
      if (!res.ok) {
        setError('Failed to load sessions');
        return;
      }
      const list = (await res.json()) as Session[];
      const top = list.slice(0, 10);
      setRows(
        top.map((s) => {
          const match = normalizeBirdUsages(s).find((u) => u.purchaseId === purchase.id);
          const tubes = match?.tubes ?? 0;
          return {
            sessionId: s.id,
            datetime: s.datetime,
            title: s.title,
            tubes,
            initial: tubes,
          };
        }),
      );
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [purchase]);

  useEffect(() => {
    if (open) loadSessions();
  }, [open, loadSessions]);

  const dirty = useMemo(() => rows.some((r) => r.tubes !== r.initial), [rows]);

  function bump(sessionId: string, delta: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.sessionId === sessionId
          ? { ...r, tubes: Math.max(0, Math.min(20, Math.round((r.tubes + delta) * 4) / 4)) }
          : r,
      ),
    );
  }

  async function handleSave() {
    if (!purchase) return;
    const changed = rows.filter((r) => r.tubes !== r.initial);
    if (changed.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const row of changed) {
        const res = await fetch(`${BASE}/api/session/bird-usage`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: row.sessionId,
            purchaseId: purchase.id,
            tubes: row.tubes,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to update ${row.sessionId}`);
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Assign tubes to sessions">
      <BottomSheetHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Assign to session
            </h2>
            {purchase && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {purchase.name} · ${purchase.costPerTube.toFixed(2)}/tube
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              minHeight: 44,
              minWidth: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
            }}
          >
            <span className="material-icons">close</span>
          </button>
        </div>
      </BottomSheetHeader>

      <BottomSheetBody>
        {loading && <p className="text-sm text-gray-400 p-3">Loading sessions…</p>}

        {!loading && rows.length === 0 && (
          <p className="text-sm text-gray-400 p-3">No sessions yet.</p>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.sessionId} className="glass-card-soft p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {r.title ?? 'Session'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {fmtSessionDate(r.datetime)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => bump(r.sessionId, -0.5)}
                    aria-label="Decrease tubes"
                    disabled={r.tubes <= 0}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      borderRadius: 10,
                      border: '1px solid var(--inner-card-border)',
                      background: 'var(--inner-card-bg)',
                      color: 'var(--text-primary)',
                      fontSize: 18,
                      opacity: r.tubes <= 0 ? 0.4 : 1,
                    }}
                  >
                    −
                  </button>
                  <span
                    className="tabular-nums"
                    style={{
                      minWidth: 48,
                      textAlign: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 600,
                      color: r.tubes > 0 ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {r.tubes}
                  </span>
                  <button
                    type="button"
                    onClick={() => bump(r.sessionId, 0.5)}
                    aria-label="Increase tubes"
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      borderRadius: 10,
                      border: '1px solid var(--inner-card-border)',
                      background: 'var(--inner-card-bg)',
                      color: 'var(--text-primary)',
                      fontSize: 18,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-red-400 text-xs mt-2" role="alert">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1"
            style={{
              minHeight: 44,
              borderRadius: 10,
              background: 'var(--inner-card-bg)',
              border: '1px solid var(--inner-card-border)',
              color: 'var(--text-secondary)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="btn-primary flex-1"
            style={{ minHeight: 44 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
