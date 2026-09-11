'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { recordEngagement } from '@/lib/engagement';
import type { CheckInSource } from '@/lib/events';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * One stored self-assessment, as `GET /api/assessments` returns it.
 *
 * `overall`, `dimensionScores` and `phase` are frozen onto the doc at write
 * time (`app/api/assessments/route.ts`), so reading a history needs no
 * recompute — and specifically no `getCanonicalLevel`, which does two unbounded
 * container scans and answers with a CURRENT value rather than a series.
 *
 * NOTE `ratings` IS AN ARRAY of `{ skillKey, value }`, not a keyed record. The
 * sheet writes a record internally and the stored doc does not, which is an
 * easy and silent thing to get backwards: treating it as a record yields an
 * empty `previous` map, so the check-in's "then" column renders blank and looks
 * like a member with no prior ratings rather than like a bug.
 */
export interface CheckInSnapshot {
  id?: string;
  takenAt?: string;
  overall?: number | null;
  ratings?: Array<{ skillKey?: string; value?: number }>;
  dimensionScores?: Record<string, number | null>;
  phase?: string | null;
}

export interface UseCheckIn {
  snapshots: CheckInSnapshot[];
  /** TRI-STATE. Never infer emptiness from `snapshots.length` — see below. */
  status: 'loading' | 'ready' | 'error';
  latest: CheckInSnapshot | undefined;
  /** Seeds the sheet's "then" column. Undefined until a snapshot exists. */
  previous: Map<string, number> | undefined;
  open: boolean;
  /** The ONE writer of `checkin_open`. Every door goes through it. */
  openFrom: (source: CheckInSource) => void;
  close: () => void;
  reload: () => void;
  /** Hand straight to `CheckInSheet`'s `onSaved`: reloads and bumps `savedAt`. */
  onSaved: () => void;
  /** Bumped on a successful save, for consumers that hold derived state. */
  savedAt: number;
}

/**
 * Single owner of the check-in: its history, its sheet, and the one beacon
 * that says a door was used.
 *
 * WHY THIS EXISTS. `CheckInSheet` had THREE mount sites across two registers —
 * `SkillTrendCard` twice (its empty branch and its loaded branch, with
 * different props) and `LearnRegister` once — each with its own `open` state
 * and its own post-save refresh. Two of them also fetched `/api/assessments`
 * independently, as did `OverviewStrip`, so the same history was read up to
 * three times per visit and could disagree between cards mid-flight. Same
 * shape, same fix, and same reason as `useGear`: one owner, passed down.
 * `components/stats/CLAUDE.md` records why that invariant was worth
 * establishing for gear; nothing about this history is different.
 *
 * `status` IS TRI-STATE AND THAT IS LOAD-BEARING. A failed read and an empty
 * history both leave `snapshots` at `[]`, and the consumers now make CLAIMS
 * about the difference: the level tile says "Take a check-in", and the trend
 * chart says "One check-in so far". Rendering either of those over a 500 tells
 * a member with years of history that they have none — the lying-empty-state
 * rule, produced by the collapse itself. Gate on `status === 'ready'`, never on
 * a null-coalesced length.
 */
export function useCheckIn(activeName: string | null): UseCheckIn {
  const [snapshots, setSnapshots] = useState<CheckInSnapshot[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  // Monotonic, for the same reason `useGear` carries one: a slow response for
  // the PREVIOUS name must never overwrite a fast one for the current member.
  const opRef = useRef(0);

  const reload = useCallback(() => {
    if (!activeName) {
      setSnapshots([]);
      setStatus('ready');
      return;
    }
    const op = ++opRef.current;
    setStatus('loading');
    fetch(`${BASE}/api/assessments?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (op !== opRef.current) return;
        setSnapshots((d?.assessments ?? []) as CheckInSnapshot[]);
        setStatus('ready');
      })
      .catch(() => {
        if (op !== opRef.current) return;
        // Deliberately NOT `setSnapshots([])`. An error must not masquerade as
        // an empty history, and the last good data is better than nothing while
        // the caller renders its error state.
        setStatus('error');
      });
  }, [activeName]);

  useEffect(() => { reload(); }, [reload]);

  const latest = snapshots[snapshots.length - 1];

  const previous = useMemo(() => {
    if (!Array.isArray(latest?.ratings)) return undefined;
    const m = new Map<string, number>();
    for (const r of latest.ratings) {
      if (typeof r?.skillKey === 'string' && typeof r.value === 'number') m.set(r.skillKey, r.value);
    }
    return m;
  }, [latest]);

  /**
   * The one place `checkin_open` is written.
   *
   * Three doors reach the same sheet, and `source` is the only thing that can
   * say which one a member actually used — which is the question the funnel's
   * `entry` ratio exists to answer. A beacon with three writers drifts; this
   * repo has the receipts (`pick_served` had two writers with their own id
   * mints until `lib/events.ts` became the single one).
   */
  const openFrom = useCallback((source: CheckInSource) => {
    setOpen(true);
    void recordEngagement('checkin_open', { source });
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const onSaved = useCallback(() => {
    reload();
    setSavedAt(Date.now());
  }, [reload]);

  return useMemo(
    () => ({ snapshots, status, latest, previous, open, openFrom, close, reload, onSaved, savedAt }),
    [snapshots, status, latest, previous, open, openFrom, close, reload, onSaved, savedAt],
  );
}
