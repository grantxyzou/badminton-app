'use client';

import { useEffect, useState, useCallback } from 'react';
import { fmtSessionLabel as fmtDate } from '@/lib/fmt';
import { isFlagOn } from '@/lib/flags';
import type { SettledSnapshot } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Session {
  id: string;
  title?: string;
  datetime?: string;
  deadline?: string;
  courts?: number;
  maxPlayers?: number;
  signupOpen?: boolean;
  costPerCourt?: number;
  settled?: SettledSnapshot;
}

interface Player {
  id: string;
  removed?: boolean;
  waitlisted?: boolean;
}

interface NextSessionCardProps {
  refreshKey?: number;
  onEdit?: () => void;
  onAdvance?: () => void;
  /** Opens the receipt sheet in group mode — the "share cost breakdown
   *  to the group chat" action. Belongs alongside session details since
   *  it's about the session, not about whose payment has come in. */
  onShareCost?: () => void;
}

function fmtCountdown(deadline: string | undefined): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'closed';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days} days`;
  if (hours >= 1) return `${hours}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m`;
}

export default function NextSessionCard({ refreshKey = 0, onEdit, onAdvance, onShareCost }: NextSessionCardProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [waitlistCount, setWaitlistCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  // Advancing archives the week and is hard to reverse; a single stray tap
  // (it used to sit next to "Edit details") shouldn't trigger it.
  const [confirmingAdvance, setConfirmingAdvance] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const settleFlagOn = isFlagOn('NEXT_PUBLIC_FLAG_SETTLE');

  // Build a ready-to-paste sign-up invite and share it (native share sheet on
  // mobile, clipboard fallback elsewhere). Lets the admin blast "sign-up is
  // open, here's the link" to the group chat without hand-writing it.
  const shareSignupLink = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}${BASE}`;
    let dateLabel = '';
    if (session?.datetime) {
      try {
        dateLabel = ` (${new Date(session.datetime).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })})`;
      } catch { /* ignore */ }
    }
    const text = `🏸 BPM Badminton — next session sign-up is open${dateLabel}! Tap to sign up: ${url}`;
    const navAny = navigator as Navigator & { share?: (d: { text: string; url: string; title?: string }) => Promise<void> };
    try {
      if (navAny.share) {
        await navAny.share({ title: 'BPM Badminton', text, url });
        return;
      }
    } catch {
      // dismissed / failed — fall through to copy
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch { /* nothing more we can do */ }
  }, [session?.datetime]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, playersRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
      ]);
      const s = sessionRes.ok ? ((await sessionRes.json()) as Session) : null;
      const players = playersRes.ok ? ((await playersRes.json()) as Player[]) : [];
      setSession(s);
      setActiveCount(players.filter((p) => !p.removed && !p.waitlisted).length);
      setWaitlistCount(players.filter((p) => !p.removed && p.waitlisted).length);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // "Send the bill" — single action that locks the math AND opens the
  // share sheet. Mirrors the social act ("I told the group what they
  // owe"); the lock is invisible plumbing. If sharing happens later
  // (admin presses again to share to a different chat), only the
  // share-sheet step runs.
  const sendBill = useCallback(async () => {
    setSettleError(null);
    setSettling(true);
    try {
      const res = await fetch(`${BASE}/api/session/settle`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSettleError(data?.error ?? `Couldn't send the bill (HTTP ${res.status}).`);
        return;
      }
      await load();
      onShareCost?.();
    } catch {
      setSettleError("Couldn't reach server. Try again.");
    } finally {
      setSettling(false);
    }
  }, [load, onShareCost]);

  const editBill = useCallback(async () => {
    if (!confirm("Edit the bill? This clears what each person owes (paid checkmarks stay).")) return;
    setSettleError(null);
    setSettling(true);
    try {
      const res = await fetch(`${BASE}/api/session/settle`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSettleError(data?.error ?? `Couldn't edit the bill (HTTP ${res.status}).`);
        return;
      }
      await load();
    } catch {
      setSettleError("Couldn't reach server. Try again.");
    } finally {
      setSettling(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return null;
  if (!session) {
    return (
      <section className="glass-card p-4 space-y-1 opacity-60" aria-label="Next session">
        <h3 className="bpm-h3">Next session</h3>
        <p className="text-xs text-gray-400">No active session.</p>
      </section>
    );
  }

  const cap = session.maxPlayers ?? 0;
  const capacityPct = cap > 0 ? Math.min(100, Math.round((activeCount / cap) * 100)) : 0;
  const countdown = fmtCountdown(session.deadline);
  const open = session.signupOpen === true;
  const isSettled = settleFlagOn && !!session.settled;

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Next session">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="bpm-h3">{fmtDate(session.datetime)}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{session.title ?? 'Session'}</p>
        </div>
        <div className="flex items-center gap-2">
          {isSettled && (
            <span
              className="cc-pill cc-pill-purple"
              title={`Bill sent — $${session.settled?.costPerPerson} each`}
            >
              Sent · ${session.settled?.costPerPerson}
            </span>
          )}
          <span className={open ? 'cc-pill cc-pill-success' : 'cc-pill cc-pill-muted'}>
            {open ? 'Signup open' : 'Signup closed'}
          </span>
        </div>
      </header>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-300">{activeCount} / {cap} signed up</span>
          {waitlistCount > 0 && (
            <span className="text-xs text-gray-400">+{waitlistCount} waitlist</span>
          )}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden cc-progress-track">
          <div
            className="h-full transition-all"
            style={{
              width: `${capacityPct}%`,
              background: capacityPct >= 100 ? '#fca5a5' : capacityPct >= 80 ? '#fcd34d' : '#86efac',
            }}
          />
        </div>
      </div>

      {countdown && (
        <p className="text-xs text-gray-400">
          Deadline: <span className="text-gray-200">{countdown === 'closed' ? 'Passed' : countdown + ' left'}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {settleFlagOn ? (
          // Unified "Send the bill" flow. One primary action — pre-send it
          // settles + opens share; post-send it just opens share again.
          !isSettled ? (
            <button
              type="button"
              onClick={sendBill}
              disabled={settling}
              className="cc-btn cc-btn-primary"
              title="Locks tonight's cost and opens the share sheet for the group chat."
            >
              <span className="material-icons text-base align-middle">send</span>
              {settling ? 'Sending…' : 'Send the bill'}
            </button>
          ) : (
            onShareCost && (
              <button
                type="button"
                onClick={onShareCost}
                className="cc-btn cc-btn-primary"
              >
                <span className="material-icons text-base align-middle">share</span>
                Share again — ${session.settled?.costPerPerson} each
              </button>
            )
          )
        ) : (
          // Pre-flag stable users keep the simple "Share cost" affordance.
          onShareCost && (
            <button type="button" onClick={onShareCost} className="cc-btn cc-btn-primary">
              <span className="material-icons text-base align-middle">request_quote</span>
              Share cost
            </button>
          )
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} className="cc-btn cc-btn-secondary">
            Edit details
          </button>
        )}
        <button
          type="button"
          onClick={shareSignupLink}
          className="cc-btn cc-btn-secondary"
          title="Copy/share a sign-up invite link for the group chat."
        >
          <span className="material-icons text-base align-middle">share</span>
          {shareCopied ? 'Copied ✓' : 'Share sign-up'}
        </button>
        {isSettled && (
          <button
            type="button"
            onClick={editBill}
            disabled={settling}
            className="cc-btn cc-btn-ghost text-xs"
            title="Made a typo? Clears the bill so you can re-send. Paid checkmarks stay."
          >
            {settling ? 'Editing…' : 'Edit bill'}
          </button>
        )}
      </div>

      {/* Advance lives apart from the action row: a stray tap meant for
          "Edit details" must not start a new week. Ghost-weight + a
          two-step inline confirm (heavy, hard-to-reverse action). */}
      {onAdvance && (
        <div
          className="flex justify-end items-center gap-2 pt-3 mt-1"
          style={{ borderTop: '1px solid var(--divider)' }}
        >
          {confirmingAdvance ? (
            <>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Can&apos;t go back to the previous week once you advance.
              </span>
              <button
                type="button"
                onClick={() => setConfirmingAdvance(false)}
                className="cc-btn cc-btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingAdvance(false);
                  onAdvance();
                }}
                className="cc-btn cc-btn-danger text-xs"
              >
                Confirm advance →
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingAdvance(true)}
              className="cc-btn cc-btn-ghost text-xs"
            >
              Advance to next week
            </button>
          )}
        </div>
      )}

      {settleError && (
        <p role="alert" className="text-xs" style={{ color: 'var(--color-red, #ef4444)' }}>
          {settleError}
        </p>
      )}
    </section>
  );
}
