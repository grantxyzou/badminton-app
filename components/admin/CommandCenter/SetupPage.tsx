'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { normalizeBirdUsages } from '@/lib/birdUsages';
import { renderGroupCanvas, renderGroupText, type ReceiptInput } from '@/lib/receiptTemplate';
import { withLocalTz } from '@/lib/fmt';
import type { BirdPurchase, Session } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SetupPageProps {
  onBack: () => void;
}

function splitIso(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function fmtPretty(date: string, time: string): string {
  if (!date || !time) return '—';
  try {
    const d = new Date(`${date}T${time}`);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return `${date} · ${time}`;
  }
}

function fmtTimeOnly(time: string): string {
  if (!time) return '—';
  try {
    const [h, m] = time.split(':');
    const d = new Date();
    d.setHours(parseInt(h, 10), parseInt(m, 10));
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return time;
  }
}

function hoursBetween(a: { date: string; time: string }, b: { date: string; time: string }): number | null {
  if (!a.date || !a.time || !b.date || !b.time) return null;
  try {
    const ta = new Date(`${a.date}T${a.time}`).getTime();
    const tb = new Date(`${b.date}T${b.time}`).getTime();
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
    return (ta - tb) / 3_600_000;
  } catch {
    return null;
  }
}

export default function SetupPage({ onBack }: SetupPageProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState(false);

  // Session fields
  const [title, setTitle] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [courts, setCourts] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [costPerCourt, setCostPerCourt] = useState<number | null>(null);
  const [signupOpen, setSignupOpen] = useState(true);
  const [showCostBreakdown, setShowCostBreakdown] = useState(true);

  // Bird tubes — single-purchase model: pick the most recent purchase with stock.
  const [birdPurchases, setBirdPurchases] = useState<BirdPurchase[]>([]);
  const [birdUsedByPurchase, setBirdUsedByPurchase] = useState<Map<string, number>>(new Map());
  const [tubePurchaseId, setTubePurchaseId] = useState<string | null>(null);
  const [tubes, setTubes] = useState(0);
  // Snapshot of what THIS session had logged at load time, keyed by
  // purchaseId. Lets the cap math credit back the session's own existing
  // allocation when computing "how many more can I take from this
  // purchase right now?" — without double-counting it.
  const [originalSessionTubes, setOriginalSessionTubes] = useState<Map<string, number>>(new Map());

  // Live data for the Share preview.
  const [activePlayerCount, setActivePlayerCount] = useState(0);
  const [recipient, setRecipient] = useState<{ name: string; email: string; memo?: string } | null>(null);

  // Recent costs for chip suggestions
  const [recentCosts, setRecentCosts] = useState<number[]>([]);

  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, birdsRes, sessionsRes, playersRes, membersRes, recentCostsRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions/costs`, { cache: 'no-store' }),
      ]);
      const session = sessionRes.ok ? await sessionRes.json() as Session : null;
      const birds = birdsRes.ok ? await birdsRes.json() as { purchases: BirdPurchase[]; currentStock?: number } : null;
      const allSessions = sessionsRes.ok ? await sessionsRes.json() as Session[] : [];
      const players = playersRes.ok ? await playersRes.json() as Array<{ removed?: boolean; waitlisted?: boolean }> : [];
      const members = membersRes.ok ? await membersRes.json() as Array<{ role?: string; eTransferRecipient?: { name: string; email: string; memo?: string } }> : [];
      const costs = recentCostsRes.ok ? await recentCostsRes.json() as { costs: number[] } : null;

      if (session) {
        setTitle(session.title ?? '');
        setLocationName(session.locationName ?? '');
        setLocationAddress(session.locationAddress ?? '');
        const start = splitIso(session.datetime);
        setDate(start.date); setTime(start.time);
        const end = splitIso(session.endDatetime);
        setEndDate(end.date); setEndTime(end.time);
        const dd = splitIso(session.deadline);
        setDeadlineDate(dd.date); setDeadlineTime(dd.time);
        setCourts(session.courts ?? 2);
        setMaxPlayers(session.maxPlayers ?? 12);
        setCostPerCourt(typeof session.costPerCourt === 'number' ? session.costPerCourt : null);
        setSignupOpen(session.signupOpen !== false);
        setShowCostBreakdown(session.showCostBreakdown !== false);

        // Pre-set birdUsage from current session if any
        const existingUsages = normalizeBirdUsages(session);
        if (existingUsages.length > 0) {
          setTubePurchaseId(existingUsages[0].purchaseId);
          setTubes(existingUsages[0].tubes);
        }
        const orig = new Map<string, number>();
        for (const u of existingUsages) orig.set(u.purchaseId, u.tubes);
        setOriginalSessionTubes(orig);
      }

      if (birds?.purchases) {
        setBirdPurchases(birds.purchases);
        // Build usage map from all sessions to know remaining per purchase
        const used = new Map<string, number>();
        for (const s of allSessions) {
          const usages = normalizeBirdUsages(s);
          for (const u of usages) used.set(u.purchaseId, (used.get(u.purchaseId) ?? 0) + u.tubes);
        }
        setBirdUsedByPurchase(used);

        // If session didn't have a tubePurchaseId, default to most recent purchase with stock.
        if (!tubePurchaseId && birds.purchases.length > 0) {
          const sortedByDate = [...birds.purchases].sort((a, b) => (a.date < b.date ? 1 : -1));
          const target = sortedByDate.find((p) => p.tubes - (used.get(p.id) ?? 0) > 0) ?? sortedByDate[0];
          if (target) setTubePurchaseId(target.id);
        }
      }

      setActivePlayerCount(players.filter((p) => !p.removed && !p.waitlisted).length);

      const adminMember = Array.isArray(members) ? members.find((m) => m.role === 'admin') : null;
      const sessionRecipient = (session as Session & { eTransferRecipient?: { name: string; email: string; memo?: string } } | null)?.eTransferRecipient;
      setRecipient(sessionRecipient ?? adminMember?.eTransferRecipient ?? null);

      if (costs?.costs) setRecentCosts(costs.costs);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tubePurchase = useMemo(
    () => birdPurchases.find((p) => p.id === tubePurchaseId) ?? null,
    [birdPurchases, tubePurchaseId],
  );

  const birdCost = useMemo(() => {
    if (!tubePurchase) return 0;
    return Math.round(tubes * tubePurchase.costPerTube * 100) / 100;
  }, [tubes, tubePurchase]);

  const courtCost = useMemo(() => (costPerCourt ?? 0) * courts, [costPerCourt, courts]);
  const totalCost = courtCost + birdCost;
  const perPlayer = activePlayerCount > 0 && totalCost > 0 ? Math.round((totalCost / activePlayerCount) * 100) / 100 : 0;

  const deadlineOffsetHours = useMemo(() => {
    return hoursBetween({ date, time }, { date: deadlineDate, time: deadlineTime });
  }, [date, time, deadlineDate, deadlineTime]);

  // Max tubes this session can take from the selected purchase:
  //   purchase.tubes - (used across all OTHER sessions for this purchase)
  // Where "other" = total used minus whatever THIS session originally had
  // for this purchase (so editing in place doesn't artificially shrink the
  // ceiling).
  const maxTubesForThisSession = useMemo(() => {
    if (!tubePurchase) return 0;
    const totalUsed = birdUsedByPurchase.get(tubePurchase.id) ?? 0;
    const ownOriginal = originalSessionTubes.get(tubePurchase.id) ?? 0;
    const usedElsewhere = Math.max(0, totalUsed - ownOriginal);
    return Math.max(0, tubePurchase.tubes - usedElsewhere);
  }, [tubePurchase, birdUsedByPurchase, originalSessionTubes]);

  const remainingAfter = useMemo(() => {
    if (!tubePurchase) return null;
    return Math.max(0, maxTubesForThisSession - tubes);
  }, [tubePurchase, maxTubesForThisSession, tubes]);

  const atMax = tubePurchase !== null && tubes >= maxTubesForThisSession;

  function bumpTubes(delta: number) {
    setTubes((prev) => {
      const next = Math.round((prev + delta) * 4) / 4;
      return Math.max(0, Math.min(maxTubesForThisSession, next));
    });
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    try {
      const datetime = withLocalTz(date, time);
      const endDatetime = withLocalTz(endDate, endTime);
      const deadline = withLocalTz(deadlineDate, deadlineTime);

      const body: Record<string, unknown> = {
        title,
        locationName,
        locationAddress,
        datetime,
        endDatetime,
        deadline,
        courts,
        maxPlayers,
        signupOpen,
        showCostBreakdown,
        ...(costPerCourt !== null ? { costPerCourt } : {}),
      };

      if (tubePurchase && tubes > 0) {
        body.birdUsages = [{ purchaseId: tubePurchase.id, tubes }];
      } else {
        body.birdUsages = [];
      }

      const res = await fetch(`${BASE}/api/session`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? 'Failed to save.');
        return;
      }
      setSuccess(true);
      setTimeout(() => onBack(), 900);
    } catch {
      setSaveError('Network error.');
    } finally {
      setSaving(false);
    }
  }

  const receiptInput: ReceiptInput | null = useMemo(() => {
    if (!recipient || !date || !time) return null;
    return {
      datetime: withLocalTz(date, time) || `${date}T${time}`,
      costPerPerson: perPlayer,
      courts,
      totalCost,
      playerNames: [],
      recipient: { name: recipient.name, email: recipient.email },
      memoTemplate: recipient.memo,
    };
  }, [recipient, date, time, perPlayer, courts, totalCost]);

  const previewText = receiptInput ? renderGroupText(receiptInput) : '';

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  async function copyText() {
    if (!previewText) return;
    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function shareImage() {
    if (!receiptInput) return;
    // Render to a transient canvas (off-DOM is fine) and grab data URL.
    const canvas = canvasRef.current ?? document.createElement('canvas');
    const url = renderGroupCanvas(receiptInput, canvas);
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], 'bpm-receipt.png', { type: 'image/png' });
      const navAny = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[] }) => Promise<void> };
      if (navAny.canShare?.({ files: [file] }) && navAny.share) {
        await navAny.share({ files: [file] });
        return;
      }
    } catch {
      // fall through to download
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bpm-receipt.png';
    a.click();
  }

  if (loading) return null;

  return (
    <div className="animate-slideInRight" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <AdminBackHeader onBack={onBack} title={`Set up ${date ? new Date(`${date}T${time || '00:00'}`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'session'}`} />

      {/* WHEN */}
      <SecLabel>When</SecLabel>
      <div className="glass-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Title">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Weekly Badminton Session" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Date" style={{ flex: 2 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start" style={{ flex: 1 }}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="End date" style={{ flex: 2 }}>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="End" style={{ flex: 1 }}>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Sign-up deadline">
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} style={{ flex: 2 }} />
            <input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} style={{ flex: 1 }} />
          </div>
          {deadlineOffsetHours !== null && deadlineOffsetHours > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', fontFamily: 'var(--font-mono, "JetBrains Mono")' }}>
              {Math.round(deadlineOffsetHours)}h before session
            </p>
          )}
        </Field>
      </div>

      {/* WHERE */}
      <SecLabel>Where</SecLabel>
      <div className="glass-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Venue">
          <input type="text" value={locationName} onChange={(e) => setLocationName(e.target.value)} maxLength={200} placeholder="e.g. Wing's badminton" />
        </Field>
        <Field label="Address">
          <input type="text" value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} maxLength={300} placeholder="Street + city" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Courts" style={{ flex: 1 }}>
            <input type="number" inputMode="numeric" value={courts} onChange={(e) => setCourts(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))} />
          </Field>
          <Field label="Max players" style={{ flex: 1 }}>
            <input type="number" inputMode="numeric" value={maxPlayers} onChange={(e) => setMaxPlayers(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 12)))} />
          </Field>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 13, fontWeight: 600 }}>Sign-ups open</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Players can join now</span>
          </div>
          <Toggle on={signupOpen} onChange={setSignupOpen} />
        </div>
      </div>

      {/* COST */}
      <SecLabel right={`${activePlayerCount} signed up`}>Cost</SecLabel>
      <div
        className="glass-card"
        style={{
          padding: '18px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          background: 'linear-gradient(160deg, rgba(74,222,128,0.06), rgba(255,255,255,0.02))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Per player</span>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 10, color: 'var(--ink-faint)' }}>auto-calc</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 48, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1, color: 'var(--accent)' }}>
            ${perPlayer}
          </span>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 11, color: 'var(--ink-faint)' }}>
            ${totalCost.toFixed(2)} ÷ {Math.max(1, activePlayerCount)}
          </span>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

        {/* Court row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{courts} court{courts === 1 ? '' : 's'} × cost</span>
            <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 12 }}>${courtCost.toFixed(2)}</span>
          </div>
          <input
            type="number"
            inputMode="decimal"
            step={0.5}
            value={costPerCourt ?? ''}
            onChange={(e) => setCostPerCourt(e.target.value === '' ? null : Math.max(0, Math.min(500, Number(e.target.value))))}
            placeholder="$ per court"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
          />
          {recentCosts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Recent:</span>
              {recentCosts.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCostPerCourt(c)}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: costPerCourt === c ? 'rgba(74,222,128,0.13)' : 'rgba(255,255,255,0.04)',
                    color: costPerCourt === c ? '#86efac' : 'var(--text-secondary)',
                    border: `1px solid ${costPerCourt === c ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.12)'}`,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono, "JetBrains Mono")',
                  }}
                >
                  ${c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tubes row */}
        {tubePurchase && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{tubes} tubes {tubePurchase.name}</span>
              <span style={{ fontSize: 10.5, color: atMax ? 'var(--amber)' : 'var(--ink-faint)' }}>
                at ${tubePurchase.costPerTube.toFixed(2)}/tube
                {remainingAfter !== null && ` · ${remainingAfter} left after`}
                {atMax && ' · max for this purchase'}
              </span>
            </div>
            <Stepper
              value={tubes}
              onDec={() => bumpTubes(-0.25)}
              onInc={() => bumpTubes(0.25)}
              incDisabled={atMax}
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Show cost on Home announcement</span>
          <Toggle on={showCostBreakdown} onChange={setShowCostBreakdown} />
        </div>
      </div>

      {/* SHARE PREVIEW */}
      {receiptInput && (
        <>
          <SecLabel>Share preview</SecLabel>
          <div
            className="glass-card"
            style={{
              padding: '14px 16px',
              fontFamily: 'var(--font-mono, "JetBrains Mono")',
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {previewText}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={copyText} className="cc-btn cc-btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button type="button" onClick={shareImage} className="btn-primary" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span className="material-icons" style={{ fontSize: 16 }}>image</span>
              Share image
            </button>
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
        </>
      )}

      {/* Save bar */}
      {saveError && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--color-red, #ef4444)', margin: '6px 4px 0' }}>
          {saveError}
        </p>
      )}
      {success ? (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: 'rgba(74,222,128,0.13)',
            border: '1px solid rgba(74,222,128,0.3)',
            color: '#86efac',
            textAlign: 'center',
            fontWeight: 600,
            marginTop: 6,
          }}
        >
          Saved
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={onBack}
            className="cc-btn cc-btn-ghost"
            disabled={saving}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary"
            style={{ flex: 2, justifyContent: 'center' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

/* Helpers */

function SecLabel({ children, right }: { children: React.ReactNode; right?: string }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-display, "Space Grotesk")',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        margin: '14px 4px 6px',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <span>{children}</span>
      {right && (
        <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>
          {right}
        </span>
      )}
    </p>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</label>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 44,
        height: 26,
        background: on ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
        borderRadius: 999,
        position: 'relative',
        border: 0,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'white',
          top: 2,
          left: on ? 20 : 2,
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

function Stepper({
  value,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onDec}
        disabled={decDisabled || value <= 0}
        aria-label="Decrease"
        style={{
          width: 28,
          height: 28,
          background: 'rgba(255,255,255,0.04)',
          border: 0,
          borderRadius: 7,
          color: 'var(--text-primary)',
          cursor: decDisabled || value <= 0 ? 'not-allowed' : 'pointer',
          opacity: decDisabled || value <= 0 ? 0.4 : 1,
        }}
      >
        <span className="material-icons" style={{ fontSize: 14 }}>remove</span>
      </button>
      <span style={{ minWidth: 36, textAlign: 'center', fontFamily: 'var(--font-display, "Space Grotesk")', fontWeight: 600, fontSize: 12 }}>
        {value}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={incDisabled}
        aria-label="Increase"
        style={{
          width: 28,
          height: 28,
          background: 'rgba(255,255,255,0.04)',
          border: 0,
          borderRadius: 7,
          color: 'var(--text-primary)',
          cursor: incDisabled ? 'not-allowed' : 'pointer',
          opacity: incDisabled ? 0.4 : 1,
        }}
      >
        <span className="material-icons" style={{ fontSize: 14 }}>add</span>
      </button>
    </div>
  );
}
