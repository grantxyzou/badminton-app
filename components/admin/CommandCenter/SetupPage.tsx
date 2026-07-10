'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import { normalizeBirdUsages, totalTubes, totalBirdCost, currentPricePerTube } from '@/lib/birdUsages';
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
  // True when the session failed to load. Saving from this state would PUT the
  // default form over the real session (wiping fields the form doesn't carry —
  // incl. collapsing birdUsages), so Save is blocked until a reload succeeds.
  const [loadError, setLoadError] = useState(false);

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

  // Bird tubes — pooled model: one "tubes used" count × an editable price/tube.
  const [birdPurchases, setBirdPurchases] = useState<BirdPurchase[]>([]);
  const [tubes, setTubes] = useState(0);
  const [pricePerTube, setPricePerTube] = useState(0);

  // Live data for the Share preview.
  const [activePlayerNames, setActivePlayerNames] = useState<string[]>([]);
  const activePlayerCount = activePlayerNames.length;
  const [recipient, setRecipient] = useState<{ name: string; email: string; memo?: string } | null>(null);

  // Recent costs for chip suggestions
  const [recentCosts, setRecentCosts] = useState<number[]>([]);

  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [sessionRes, birdsRes, playersRes, membersRes, recentCostsRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions/costs`, { cache: 'no-store' }),
      ]);
      // The session is the doc Save overwrites — if it didn't load, the form is
      // showing defaults, not the real session. Flag it so Save stays blocked.
      if (!sessionRes.ok) setLoadError(true);
      const session = sessionRes.ok ? await sessionRes.json() as Session : null;
      const birds = birdsRes.ok ? await birdsRes.json() as { purchases: BirdPurchase[]; currentStock?: number } : null;
      const players = playersRes.ok ? await playersRes.json() as Array<{ name?: string; removed?: boolean; waitlisted?: boolean }> : [];
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

        const existingUsages = normalizeBirdUsages(session);
        const loadedTubes = totalTubes(existingUsages);
        const loadedCost = totalBirdCost(existingUsages);
        setTubes(loadedTubes);
        // Preserve the exact existing cost on load (blended price for legacy
        // multi-batch sessions); fall back to the latest purchase price.
        setPricePerTube(
          loadedTubes > 0
            ? Math.round((loadedCost / loadedTubes) * 100) / 100
            : currentPricePerTube(birds?.purchases ?? []),
        );
      }

      if (birds?.purchases) setBirdPurchases(birds.purchases);

      setActivePlayerNames(
        players.filter((p) => !p.removed && !p.waitlisted).map((p) => p.name).filter((n): n is string => !!n),
      );

      const adminMember = Array.isArray(members) ? members.find((m) => m.role === 'admin') : null;
      const sessionRecipient = (session as Session & { eTransferRecipient?: { name: string; email: string; memo?: string } } | null)?.eTransferRecipient;
      setRecipient(sessionRecipient ?? adminMember?.eTransferRecipient ?? null);

      if (costs?.costs) setRecentCosts(costs.costs);
    } catch (err) {
      // Network drop / parse failure — the form holds defaults, not the session.
      console.warn('SetupPage load failed:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const birdCost = useMemo(() => Math.round(tubes * pricePerTube * 100) / 100, [tubes, pricePerTube]);

  const autoPrice = useMemo(() => currentPricePerTube(birdPurchases), [birdPurchases]);

  const courtCost = useMemo(() => (costPerCourt ?? 0) * courts, [costPerCourt, courts]);
  const totalCost = courtCost + birdCost;
  const perPlayer = activePlayerCount > 0 && totalCost > 0 ? Math.round((totalCost / activePlayerCount) * 100) / 100 : 0;

  const deadlineOffsetHours = useMemo(() => {
    return hoursBetween({ date, time }, { date: deadlineDate, time: deadlineTime });
  }, [date, time, deadlineDate, deadlineTime]);

  function bumpTubes(delta: number) {
    setTubes((prev) => Math.max(0, Math.min(100, Math.round((prev + delta) * 4) / 4)));
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

      body.birdUsages = tubes > 0 ? [{ pooled: true, tubes, pricePerTube }] : [];

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
      playerNames: activePlayerNames,
      recipient: { name: recipient.name, email: recipient.email },
      memoTemplate: recipient.memo,
    };
  }, [recipient, date, time, perPlayer, courts, totalCost, activePlayerNames]);

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

  if (loading) {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={onBack} title="Set up session" />
        <AdminPageSkeleton />
      </div>
    );
  }

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
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '4px 0 0', fontFamily: 'var(--font-mono, "JetBrains Mono")' }}>
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
            <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 'var(--fs-base)', fontWeight: 600 }}>Sign-ups open</span>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Players can join now</span>
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
          background: 'linear-gradient(160deg, rgba(74,222,128,0.06), rgba(var(--glass-tint), 0.02))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 'var(--fs-xs)', color: 'var(--ink-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Per player</span>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-2xs)', color: 'var(--ink-faint)' }}>auto-calc</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 48, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1, color: 'var(--accent)' }}>
            ${perPlayer}
          </span>
          <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-xs)', color: 'var(--ink-faint)' }}>
            ${totalCost.toFixed(2)} ÷ {Math.max(1, activePlayerCount)}
          </span>
        </div>

        <div style={{ height: 1, background: 'rgba(var(--glass-tint), 0.06)' }} />

        {/* Court row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)' }}>{courts} court{courts === 1 ? '' : 's'} × cost</span>
            <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-sm)' }}>${courtCost.toFixed(2)}</span>
          </div>
          <input
            type="number"
            inputMode="decimal"
            step={0.5}
            value={costPerCourt ?? ''}
            onChange={(e) => setCostPerCourt(e.target.value === '' ? null : Math.max(0, Math.min(500, Number(e.target.value))))}
            placeholder="$ per court"
            style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 'var(--fs-base)' }}
          />
          {recentCosts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--ink-faint)' }}>Recent:</span>
              {recentCosts.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCostPerCourt(c)}
                  style={{
                    fontSize: 'var(--fs-xs)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-pill)',
                    background: costPerCourt === c ? 'rgba(74,222,128,0.13)' : 'rgba(var(--glass-tint), 0.04)',
                    color: costPerCourt === c ? '#86efac' : 'var(--text-secondary)',
                    border: `1px solid ${costPerCourt === c ? 'rgba(74,222,128,0.3)' : 'rgba(var(--glass-tint), 0.12)'}`,
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

        {/* Shuttles: pooled tubes used × price per tube */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)' }}>Shuttles used</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-faint)', fontFamily: 'var(--font-mono, "JetBrains Mono")' }}>
                {tubes} tube{tubes === 1 ? '' : 's'} × ${pricePerTube.toFixed(2)} = ${birdCost.toFixed(2)}
              </span>
            </div>
            <Stepper value={tubes} onDec={() => bumpTubes(-0.25)} onInc={() => bumpTubes(0.25)} incDisabled={tubes >= 100} />
          </div>
          <input
            type="number"
            inputMode="decimal"
            step={0.5}
            value={pricePerTube || ''}
            onChange={(e) => setPricePerTube(e.target.value === '' ? 0 : Math.max(0, Math.min(10000, Number(e.target.value))))}
            placeholder="$ per tube"
            style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 'var(--fs-base)' }}
          />
          {autoPrice > 0 && Math.abs(autoPrice - pricePerTube) > 0.005 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--ink-faint)' }}>Latest:</span>
              <button
                type="button"
                onClick={() => setPricePerTube(autoPrice)}
                style={{ fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'rgba(var(--glass-tint), 0.04)', color: 'var(--text-secondary)', border: '1px solid rgba(var(--glass-tint), 0.12)', cursor: 'pointer', fontFamily: 'var(--font-mono, "JetBrains Mono")' }}
              >
                ${autoPrice.toFixed(2)}/tube
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>Show cost on Home announcement</span>
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
              fontSize: 'var(--fs-sm)',
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
            <button type="button" onClick={shareImage} className="cc-btn cc-btn-primary" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span className="material-icons" style={{ fontSize: 'var(--fs-lg)' }}>image</span>
              Share image
            </button>
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
        </>
      )}

      {/* Save bar */}
      {loadError && (
        <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: '6px 4px 0' }}>
          Couldn&apos;t load the current session — saving is disabled to avoid overwriting it. Refresh to retry.
        </p>
      )}
      {saveError && (
        <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: '6px 4px 0' }}>
          {saveError}
        </p>
      )}
      {success ? (
        <div
          style={{
            padding: 14,
            borderRadius: 'var(--radius-lg)',
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
            disabled={saving || loadError}
            className="cc-btn cc-btn-primary"
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
        fontSize: 'var(--fs-xs)',
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
        <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)', fontWeight: 500, fontSize: 'var(--fs-xs)' }}>
          {right}
        </span>
      )}
    </p>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label style={{ fontSize: 'var(--fs-2xs)', color: 'var(--ink-faint)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</label>
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
        background: on ? 'var(--accent)' : 'rgba(var(--glass-tint), 0.1)',
        borderRadius: 'var(--radius-pill)',
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
        background: 'rgba(var(--glass-tint), 0.04)',
        border: '1px solid rgba(var(--glass-tint), 0.12)',
        borderRadius: 'var(--radius-md)',
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
          background: 'rgba(var(--glass-tint), 0.04)',
          border: 0,
          borderRadius: 7,
          color: 'var(--text-primary)',
          cursor: decDisabled || value <= 0 ? 'not-allowed' : 'pointer',
          opacity: decDisabled || value <= 0 ? 0.4 : 1,
        }}
      >
        <span className="material-icons" style={{ fontSize: 'var(--fs-md)' }}>remove</span>
      </button>
      <span style={{ minWidth: 36, textAlign: 'center', fontFamily: 'var(--font-display, "Space Grotesk")', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>
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
          background: 'rgba(var(--glass-tint), 0.04)',
          border: 0,
          borderRadius: 7,
          color: 'var(--text-primary)',
          cursor: incDisabled ? 'not-allowed' : 'pointer',
          opacity: incDisabled ? 0.4 : 1,
        }}
      >
        <span className="material-icons" style={{ fontSize: 'var(--fs-md)' }}>add</span>
      </button>
    </div>
  );
}
