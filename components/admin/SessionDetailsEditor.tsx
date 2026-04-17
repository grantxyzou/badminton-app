'use client';

import { useState, useEffect, useRef } from 'react';
import type { Session, BirdPurchase, Player } from '@/lib/types';
import { normalizeBirdUsages } from '@/lib/birdUsages';
import AdminBackHeader from './AdminBackHeader';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{text}</span>
      {children}
    </label>
  );
}

function CardDescription({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

/* Quarter-tube stepper. Value is clamped to 0+ and rounded to 2 decimals
   each tap to avoid floating-point drift (0.1 + 0.2 ≠ 0.3). Valid values
   are 0, 0.25, 0.5, 0.75, 1.0, … */
function TubeStepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const step = 0.25;
  const canDec = value > 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  // Drop trailing zeros so 0.5 shows as "0.5" not "0.50", while 0.25 stays "0.25"
  const display = value === 0 ? '0' : parseFloat(value.toFixed(2)).toString();
  const btn: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: 'var(--inner-card-bg)',
    border: '1px solid var(--inner-card-border)',
  };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(round(Math.max(0, value - step)))}
        disabled={!canDec}
        aria-label="Decrease tubes"
        className="flex items-center justify-center transition-opacity"
        style={{
          ...btn,
          color: 'var(--text-primary)',
          opacity: canDec ? 1 : 0.35,
          cursor: canDec ? 'pointer' : 'not-allowed',
        }}
      >
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 20 }}>remove</span>
      </button>
      <span
        className="text-base font-semibold tabular-nums"
        style={{ color: 'var(--text-primary)', minWidth: 48, textAlign: 'center' }}
        aria-live="polite"
      >
        {display}
      </span>
      <button
        type="button"
        onClick={() => onChange(round(value + step))}
        aria-label="Increase tubes"
        className="flex items-center justify-center"
        style={{ ...btn, color: 'var(--text-primary)', cursor: 'pointer' }}
      >
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 20 }}>add</span>
      </button>
    </div>
  );
}

type BirdUsageRow = { purchaseId: string; tubes: number };

type DetailsForm = {
  locationName: string;
  locationAddress: string;
  courts: number;
  maxPlayers: number;
  signupOpen: boolean;
  costPerCourt: number | null;
  birdUsages: BirdUsageRow[];
  showCostBreakdown: boolean;
};

function birdUsagesEqual(a: BirdUsageRow[], b: BirdUsageRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].purchaseId !== b[i].purchaseId || a[i].tubes !== b[i].tubes) return false;
  }
  return true;
}

export default function SessionDetailsEditor({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState<DetailsForm>({
    locationName: '',
    locationAddress: '',
    courts: 2,
    maxPlayers: 12,
    signupOpen: true,
    costPerCourt: null,
    birdUsages: [],
    showCostBreakdown: false,
  });
  const [fullSession, setFullSession] = useState<Session | null>(null);
  const initialForm = useRef<DetailsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [sessionLabel, setSessionLabel] = useState('');
  const [purchases, setPurchases] = useState<BirdPurchase[]>([]);
  const [activePlayerCount, setActivePlayerCount] = useState(0);

  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: Session) => {
        const existing = normalizeBirdUsages(data).map((u) => ({
          purchaseId: u.purchaseId,
          tubes: u.tubes,
        }));
        const loaded: DetailsForm = {
          locationName: data.locationName ?? '',
          locationAddress: data.locationAddress ?? '',
          courts: data.courts ?? 2,
          maxPlayers: data.maxPlayers ?? 12,
          signupOpen: data.signupOpen !== false,
          costPerCourt: data.costPerCourt ?? null,
          birdUsages: existing,
          showCostBreakdown: data.showCostBreakdown ?? false,
        };
        setForm(loaded);
        initialForm.current = loaded;
        setFullSession(data);
        if (data.datetime) {
          const d = new Date(data.datetime);
          setSessionLabel(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase());
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${BASE}/api/birds`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { purchases: [] })
      .then((data) => setPurchases(data.purchases ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Fetch the player roster just to count active signups for the
    // per-person preview in the Cost Details card.
    fetch(`${BASE}/api/players`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : [])
      .then((players: Player[]) => {
        const active = players.filter((p) => !p.waitlisted && !p.removed).length;
        setActivePlayerCount(active);
      })
      .catch(() => {});
  }, []);

  function withLocalTz(date: string, time: string): string {
    if (!date || !time) return '';
    const offset = new Date().getTimezoneOffset();
    const sign = offset <= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${date}T${time}:00${sign}${hh}:${mm}`;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const s = fullSession;
      const dateStr = s?.datetime ? s.datetime.slice(0, 10) : '';
      const timeStr = s?.datetime ? s.datetime.slice(11, 16) : '';
      const endDateStr = s?.endDatetime ? s.endDatetime.slice(0, 10) : '';
      const endTimeStr = s?.endDatetime ? s.endDatetime.slice(11, 16) : '';
      const deadlineDateStr = s?.deadline ? s.deadline.slice(0, 10) : '';
      const deadlineTimeStr = s?.deadline ? s.deadline.slice(11, 16) : '';

      const validUsages = form.birdUsages
        .filter((u) => u.purchaseId && u.tubes > 0)
        .map((u) => ({ purchaseId: u.purchaseId, tubes: u.tubes }));

      const res = await fetch(`${BASE}/api/session`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: s?.title ?? '',
          ...form,
          costPerCourt: form.costPerCourt ?? 0,
          date: dateStr,
          time: timeStr,
          datetime: withLocalTz(dateStr, timeStr),
          endDate: endDateStr,
          endTime: endTimeStr,
          endDatetime: withLocalTz(endDateStr, endTimeStr),
          deadlineDate: deadlineDateStr,
          deadlineTime: deadlineTimeStr,
          deadline: withLocalTz(deadlineDateStr, deadlineTimeStr),
          birdUsages: validUsages,
          showCostBreakdown: form.showCostBreakdown,
        }),
      });
      if (res.ok) {
        initialForm.current = { ...form };
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to save. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  const init = initialForm.current;
  const dirty = init !== null && (
    form.locationName !== init.locationName ||
    form.locationAddress !== init.locationAddress ||
    form.courts !== init.courts ||
    form.maxPlayers !== init.maxPlayers ||
    form.signupOpen !== init.signupOpen ||
    form.costPerCourt !== init.costPerCourt ||
    !birdUsagesEqual(form.birdUsages, init.birdUsages) ||
    form.showCostBreakdown !== init.showCostBreakdown
  );

  function setStr(key: keyof DetailsForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }
  function setNum(key: keyof DetailsForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: parseInt(e.target.value) || 0 }));
  }
  function setFloat(key: keyof DetailsForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value === '' ? null : (parseFloat(e.target.value) || 0) }));
  }

  /* ── Cost computation for the preview ── */
  const courtTotal = (form.costPerCourt ?? 0) * form.courts;
  const birdTotal = form.birdUsages.reduce((sum, row) => {
    const selected = purchases.find((p) => p.id === row.purchaseId);
    return sum + (selected ? row.tubes * selected.costPerTube : 0);
  }, 0);
  const totalCost = courtTotal + birdTotal;
  const perPerson = activePlayerCount > 0 ? totalCost / activePlayerCount : null;

  if (loading) {
    return (
      <div className="animate-slideInRight space-y-4">
        <AdminBackHeader onBack={onBack} title="Session Details" sessionLabel={sessionLabel} />
        <div className="glass-card p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-white/10 rounded w-1/3" />
            <div className="h-10 bg-white/10 rounded" />
            <div className="h-10 bg-white/10 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-slideInRight space-y-4">
      <AdminBackHeader onBack={onBack} title="Session Details" sessionLabel={sessionLabel} />

      <form onSubmit={handleSave} className="space-y-4">
        {/* ── Card 1: Session Details ── */}
        <div className="glass-card p-5 space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Session Details
            </h3>
            <CardDescription>Venue, capacity, and sign-up controls.</CardDescription>
          </div>

          <Label text="Venue Name">
            <input type="text" value={form.locationName} onChange={setStr('locationName')} placeholder="e.g. Smash Sports Centre" />
          </Label>
          <Label text="Address">
            <input type="text" value={form.locationAddress} onChange={setStr('locationAddress')} placeholder="e.g. 123 Main St, City" />
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <Label text="Courts">
              <input type="number" min={1} value={form.courts} onChange={setNum('courts')} />
            </Label>
            <Label text="Max Players">
              <input type="number" min={1} value={form.maxPlayers} onChange={setNum('maxPlayers')} />
            </Label>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Sign-ups</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {form.signupOpen ? 'Open — players can sign up' : 'Closed — players cannot sign up'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, signupOpen: !f.signupOpen }))}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.signupOpen ? 'bg-green-500' : 'bg-white/20'}`}
              role="switch"
              aria-checked={form.signupOpen}
              aria-label="Toggle sign-ups"
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${form.signupOpen ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        {/* ── Card 2: Cost Details ── */}
        <div className="glass-card p-5 space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Cost Details
            </h3>
            <CardDescription>How much each player pays per session.</CardDescription>
          </div>

          <Label text="Cost per court">
            <div className="relative">
              {form.costPerCourt !== null && form.costPerCourt > 0 && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--text-muted)' }}>$</span>
              )}
              <input
                type="number"
                min={0}
                step={0.5}
                value={form.costPerCourt ?? ''}
                onChange={setFloat('costPerCourt')}
                placeholder="None"
                style={form.costPerCourt !== null && form.costPerCourt > 0 ? { paddingLeft: '1.5rem' } : undefined}
              />
            </div>
          </Label>

          {/* ── Bird usage — divider separates from cost-per-court above.
               mt-2 + pt-6 widens the breathing room on both sides of the
               rule so Cost-per-court doesn't feel jammed against it and
               the "Bird usage" header doesn't hug the line. ── */}
          <div
            className="space-y-4 mt-2 pt-6"
            style={{ borderTop: '1px solid var(--glass-border)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Bird usage
              </span>
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    birdUsages: [...f.birdUsages, { purchaseId: '', tubes: 0 }],
                  }))
                }
                className="text-xs font-medium px-2 py-1 rounded-md"
                style={{ color: 'var(--accent)', background: 'var(--inner-card-bg)' }}
              >
                + Add from inventory
              </button>
            </div>

            {form.birdUsages.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No bird usage recorded.
              </p>
            )}

            {form.birdUsages.length > 0 && (
              <div>
                {form.birdUsages.map((row, idx) => {
                  const selected = purchases.find((p) => p.id === row.purchaseId);
                  const rowTotal = selected ? row.tubes * selected.costPerTube : 0;
                  const isLast = idx === form.birdUsages.length - 1;
                  return (
                    <div
                      key={idx}
                      className="py-3 space-y-3"
                      style={
                        isLast
                          ? undefined
                          : { borderBottom: '1px solid var(--glass-border)' }
                      }
                    >
                      <Label text="Brand">
                        {/* Native browser chevron varies across macOS/iOS/
                            Android and doesn't match the app's icon set.
                            Suppress with appearance:none and render our own
                            material-icons chevron positioned absolutely. */}
                        <div className="relative">
                          <select
                            value={row.purchaseId}
                            onChange={(e) =>
                              setForm((f) => {
                                const next = [...f.birdUsages];
                                next[idx] = { ...next[idx], purchaseId: e.target.value };
                                return { ...f, birdUsages: next };
                              })
                            }
                            style={{
                              appearance: 'none',
                              WebkitAppearance: 'none',
                              MozAppearance: 'none',
                              paddingRight: 40,
                            }}
                          >
                            <option value="">Select brand…</option>
                            {purchases.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — ${p.costPerTube.toFixed(2)}/tube (
                                {new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
                              </option>
                            ))}
                          </select>
                          <span
                            className="material-icons absolute top-1/2 pointer-events-none"
                            aria-hidden="true"
                            style={{
                              right: 10,
                              transform: 'translateY(-50%)',
                              fontSize: 20,
                              color: 'var(--text-muted)',
                            }}
                          >
                            expand_more
                          </span>
                        </div>
                      </Label>
                      <Label text="Tubes used">
                        <TubeStepper
                          value={row.tubes}
                          onChange={(next) =>
                            setForm((f) => {
                              const rows = [...f.birdUsages];
                              rows[idx] = { ...rows[idx], tubes: next };
                              return { ...f, birdUsages: rows };
                            })
                          }
                        />
                      </Label>
                      {/* Footer row: equation reads in plain English. Unset
                          slots show their label (Tube usage / Cost per tube /
                          Bird cost); filled slots show the value inline. Color
                          shifts from muted → accent when fully complete. */}
                      {(() => {
                        const complete = !!selected && row.tubes > 0;
                        const tubesSlot = row.tubes > 0
                          ? `${parseFloat(row.tubes.toFixed(2))} ${row.tubes === 1 ? 'tube' : 'tubes'}`
                          : 'Tube usage';
                        const costSlot = selected
                          ? `$${selected.costPerTube.toFixed(2)} per tube`
                          : 'Cost per tube';
                        const totalSlot = complete ? `$${rowTotal.toFixed(2)}` : 'Bird cost';
                        return (
                          <div className="flex items-center justify-between gap-2 min-h-8">
                            <p
                              className="text-xs"
                              style={{ color: complete ? 'var(--accent)' : 'var(--text-muted)' }}
                            >
                              {tubesSlot} × {costSlot} = {totalSlot}
                            </p>
                        <button
                          type="button"
                          aria-label="Remove bird usage"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              birdUsages: f.birdUsages.filter((_, i) => i !== idx),
                            }))
                          }
                          className="rounded-md flex items-center justify-center shrink-0 -mr-2"
                          style={{
                            color: 'var(--text-muted)',
                            height: 32,
                            width: 32,
                          }}
                        >
                          <span className="material-icons" aria-hidden="true" style={{ fontSize: 20 }}>delete_outline</span>
                        </button>
                      </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}

            {form.birdUsages.length > 0 && (
              <div
                className="flex items-center justify-between pt-3"
                style={{ borderTop: '1px solid var(--glass-border)' }}
              >
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Total bird cost
                </span>
                <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                  ${birdTotal.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* ── Per-person preview ── */}
          {form.showCostBreakdown && totalCost > 0 && (
            <div
              className="pt-3 space-y-1"
              style={{ borderTop: '1px solid var(--glass-border)' }}
            >
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Per person preview
              </p>
              {activePlayerCount > 0 && perPerson !== null ? (
                <>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    (${courtTotal.toFixed(2)} courts + ${birdTotal.toFixed(2)} birds) ÷ {activePlayerCount}
                  </p>
                  <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                    ${perPerson.toFixed(2)} per player
                  </p>
                </>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  No players signed up yet.
                </p>
              )}
            </div>
          )}

          {/* ── Show cost toggle (now a real switch) ── */}
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Show cost to players
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {form.showCostBreakdown ? 'Visible on the Home announcement' : 'Hidden from players'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, showCostBreakdown: !f.showCostBreakdown }))}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.showCostBreakdown ? 'bg-green-500' : 'bg-white/20'}`}
              role="switch"
              aria-checked={form.showCostBreakdown}
              aria-label="Toggle cost visibility"
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${form.showCostBreakdown ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        {/* ── Error + Update ── */}
        {error && <p className="text-red-400 text-xs px-1" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={saving || !dirty}
          className="btn-ghost w-full"
          style={{ minHeight: 44 }}
        >
          {saving ? 'Updating...' : saved ? '✓ Updated!' : 'Update'}
        </button>
      </form>
    </div>
  );
}
