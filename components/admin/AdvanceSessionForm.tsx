'use client';

import { useState, useEffect } from 'react';
import type { Session, BirdPurchase } from '@/lib/types';
import { normalizeBirdUsages } from '@/lib/birdUsages';
import AdminBackHeader from './AdminBackHeader';
import DatePicker from '../DatePicker';
import StatusBanner from '../primitives/StatusBanner';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function withLocalTz(date: string, time: string): string {
  if (!date || !time) return '';
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-400">{text}</p>
      {children}
    </div>
  );
}

interface Props {
  onBack: () => void;
}

export default function AdvanceSessionForm({ onBack }: Props) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('');
  const [courts, setCourts] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [costPerCourt, setCostPerCourt] = useState<number | null>(null);
  const [recentCosts, setRecentCosts] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [recentLocations, setRecentLocations] = useState<{ locationName: string; locationAddress: string }[]>([]);
  const [recentTitles, setRecentTitles] = useState<string[]>([]);
  // Bird inventory + the tubes the admin chooses to load into the new session
  // at creation time. Keyed by purchaseId so different-priced brands cost right.
  const [purchases, setPurchases] = useState<BirdPurchase[]>([]);
  const [birdTubes, setBirdTubes] = useState<Record<string, number>>({});
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState('');
  const [success, setSuccess] = useState(false);
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [showSkipBlock, setShowSkipBlock] = useState(false);
  const [prefillFailed, setPrefillFailed] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`session fetch ${r.status}`);
        return r.json();
      })
      .then((data: Session) => {
        setTime(data.datetime ? data.datetime.slice(11, 16) : '');
        setEndTime(data.endDatetime ? data.endDatetime.slice(11, 16) : '');
        setDeadlineTime(data.deadline ? data.deadline.slice(11, 16) : '');
        setCourts(data.courts ?? 2);
        setMaxPlayers(data.maxPlayers ?? 12);
        setCostPerCourt(data.costPerCourt ?? null);
        // Carry the venue + title forward — the common case is the same place
        // week after week, so prefilling means one tap instead of retyping.
        setTitle(data.title ?? '');
        setLocationName(data.locationName ?? '');
        setLocationAddress(data.locationAddress ?? '');
        // Carry last week's bird selection forward so lingering inventory
        // doesn't get stranded — admin can adjust before creating.
        const prevTubes: Record<string, number> = {};
        for (const u of normalizeBirdUsages(data)) {
          if (u.tubes > 0) prevTubes[u.purchaseId] = u.tubes;
        }
        setBirdTubes(prevTubes);
      })
      .catch(() => {
        // Critical fetch — without it the form shows generic defaults
        // (2 courts / 12 / no cost) and admin advances thinking the
        // form was prefilled from current state.
        setPrefillFailed(true);
      });
    fetch(`${BASE}/api/sessions/costs`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { costs: [] })
      .then((data: { costs: number[] }) => setRecentCosts(data.costs ?? []))
      .catch(() => {});
    // Recent venues + titles for the autosuggest chips.
    fetch(`${BASE}/api/sessions/locations`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { locations: [], titles: [] })
      .then((data: { locations?: { locationName: string; locationAddress: string }[]; titles?: string[] }) => {
        setRecentLocations(Array.isArray(data.locations) ? data.locations : []);
        setRecentTitles(Array.isArray(data.titles) ? data.titles : []);
      })
      .catch(() => {});
    // Bird inventory so the admin can load tubes into the new session at creation.
    fetch(`${BASE}/api/birds`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { purchases: [] })
      .then((data: { purchases?: BirdPurchase[] }) => setPurchases(Array.isArray(data.purchases) ? data.purchases : []))
      .catch(() => {});
    // Skip dates from the auth-gated admin endpoint (not the public
    // /api/members list, which leaks admin attributes if the response
    // shape ever loosens).
    fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { skipDates?: string[] } | null) => {
        setSkipDates(Array.isArray(data?.skipDates) ? data!.skipDates! : []);
      })
      .catch(() => {});
  }, []);

  async function handleAdvance(e: React.FormEvent) {
    e.preventDefault();
    // Blocking-anomaly check: if the chosen date is on the skip list,
    // surface a confirmation sheet before submitting. Lets a user override
    // ("advance anyway") but prevents accidental advances on holidays
    // or known-bad dates.
    if (date && skipDates.includes(date)) {
      setShowSkipBlock(true);
      return;
    }
    await performAdvance();
  }

  const [shareCopied, setShareCopied] = useState(false);

  async function shareSignupLink() {
    const url = `${window.location.origin}${BASE}`;
    let dateLabel = '';
    if (date) {
      try {
        dateLabel = ` (${new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })})`;
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
      // User dismissed the native sheet, or it failed — fall through to copy.
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      setAdvanceError('Couldn’t copy the link — copy it manually from the address bar.');
    }
  }

  function bumpTubes(purchaseId: string, delta: number) {
    setBirdTubes(prev => {
      const next = Math.max(0, Math.min(20, Math.round(((prev[purchaseId] ?? 0) + delta) * 4) / 4));
      const updated = { ...prev };
      if (next > 0) updated[purchaseId] = next;
      else delete updated[purchaseId];
      return updated;
    });
  }

  async function performAdvance() {
    setAdvancing(true);
    setAdvanceError('');
    try {
      const res = await fetch(`${BASE}/api/session/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datetime: withLocalTz(date, time),
          endDatetime: withLocalTz(endDate, endTime),
          deadline: withLocalTz(deadlineDate, deadlineTime),
          courts,
          maxPlayers,
          ...(title.trim() ? { title: title.trim() } : {}),
          locationName: locationName.trim(),
          locationAddress: locationAddress.trim(),
          birdUsages: Object.entries(birdTubes)
            .filter(([, t]) => t > 0)
            .map(([purchaseId, tubes]) => ({ purchaseId, tubes })),
          ...(costPerCourt !== null ? { costPerCourt } : {}),
        }),
      });
      if (res.ok) {
        // Stay on the success screen (no auto-onBack) so the admin can share
        // the sign-up link right away — the whole point of creating it. They
        // dismiss explicitly via "Done".
        setSuccess(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setAdvanceError(data.error ?? 'Failed to advance. Please try again.');
      }
    } catch {
      // Network failures used to fall through silently — the button got
      // re-enabled by `finally` but no error appeared. Surface so the
      // admin doesn't think the click was a no-op.
      setAdvanceError('Network error. Please try again.');
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div className="space-y-4 w-full">
      <AdminBackHeader onBack={onBack} title="Next Session" />

      {prefillFailed && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: 'var(--color-red, #ef4444)',
            fontSize: 13,
          }}
        >
          Couldn&apos;t load current session — fields below show defaults, not your last week&apos;s settings. Refresh before advancing.
        </div>
      )}

      <form onSubmit={handleAdvance}>
        <div className="glass-card p-5 space-y-3">
          <p className="text-xs text-gray-400">Creates a new session. The current session will be archived.</p>

          <Label text="Session Name">
            <input
              id="advance-title"
              name="title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Weekly Badminton Session"
              maxLength={100}
            />
            {recentTitles.filter(t => t !== title).length > 0 && (
              <div className="flex gap-1.5 flex-wrap pt-1">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Recent:</span>
                {recentTitles.filter(t => t !== title).slice(0, 4).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTitle(t)}
                    className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/5 hover:bg-white/10 transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </Label>

          <Label text="Venue">
            <div className="space-y-2">
              <input
                id="advance-location-name"
                name="locationName"
                type="text"
                value={locationName}
                onChange={e => setLocationName(e.target.value)}
                placeholder="Location name"
                maxLength={200}
              />
              <input
                id="advance-location-address"
                name="locationAddress"
                type="text"
                value={locationAddress}
                onChange={e => setLocationAddress(e.target.value)}
                placeholder="Address"
                maxLength={300}
              />
            </div>
            {recentLocations.filter(l => l.locationName !== locationName || l.locationAddress !== locationAddress).length > 0 && (
              <div className="flex gap-1.5 flex-wrap pt-1">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Recent:</span>
                {recentLocations
                  .filter(l => l.locationName !== locationName || l.locationAddress !== locationAddress)
                  .slice(0, 4)
                  .map((l, i) => (
                    <button
                      key={`${l.locationName}|${l.locationAddress}|${i}`}
                      type="button"
                      onClick={() => { setLocationName(l.locationName); setLocationAddress(l.locationAddress); }}
                      className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/5 hover:bg-white/10 transition-colors max-w-[180px] truncate"
                      style={{ color: 'var(--text-secondary)' }}
                      title={l.locationAddress || l.locationName}
                    >
                      {l.locationName || l.locationAddress}
                    </button>
                  ))}
              </div>
            )}
          </Label>

          <Label text="Date & Time">
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <DatePicker value={date} onChange={v => setDate(v)} placeholder="Date" />
              </div>
              <div className="flex-1 min-w-0">
                <input id="advance-start-time" name="startTime" type="time" value={time} onChange={e => setTime(e.target.value)} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>

          <Label text="Sign-up Deadline">
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <DatePicker value={deadlineDate} onChange={v => setDeadlineDate(v)} placeholder="Date" />
              </div>
              <div className="flex-1 min-w-0">
                <input id="advance-deadline-time" name="deadlineTime" type="time" value={deadlineTime} onChange={e => setDeadlineTime(e.target.value)} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>

          <Label text="Session End">
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <DatePicker value={endDate} onChange={v => setEndDate(v)} placeholder="Date" />
              </div>
              <div className="flex-1 min-w-0">
                <input id="advance-end-time" name="endTime" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>

          <div className="grid grid-cols-2 gap-3">
            <Label text="Courts">
              <input id="advance-courts" name="courts" type="number" min={1} value={courts} onChange={e => setCourts(parseInt(e.target.value) || 0)} />
            </Label>
            <Label text="Max Players">
              <input id="advance-max-players" name="maxPlayers" type="number" min={1} value={maxPlayers} onChange={e => setMaxPlayers(parseInt(e.target.value) || 0)} />
            </Label>
          </div>

          <Label text="Cost per court">
            <div className="relative">
              {costPerCourt !== null && costPerCourt > 0 && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--text-muted)' }}>$</span>
              )}
              <input
                id="advance-cost-per-court"
                name="costPerCourt"
                type="number"
                min={0}
                step={0.5}
                value={costPerCourt ?? ''}
                onChange={e => setCostPerCourt(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
                placeholder="None"
                style={costPerCourt !== null && costPerCourt > 0 ? { paddingLeft: '1.5rem' } : undefined}
              />
            </div>
            {recentCosts.length > 0 && (
              <div className="flex gap-1.5 flex-wrap pt-1">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Recent:</span>
                {recentCosts.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCostPerCourt(c)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${costPerCourt === c ? 'bg-green-500/20 text-green-400' : 'bg-white/5 hover:bg-white/10'}`}
                    style={costPerCourt !== c ? { color: 'var(--text-secondary)' } : undefined}
                  >
                    ${c}
                  </button>
                ))}
              </div>
            )}
          </Label>

          {purchases.length > 0 && (
            <Label text="Birds for this session">
              <div className="space-y-2">
                {purchases.map(p => {
                  const tubes = birdTubes[p.id] ?? 0;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl p-3"
                      style={{ background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>${p.costPerTube.toFixed(2)}/tube</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => bumpTubes(p.id, -0.5)}
                          aria-label={`Decrease ${p.name} tubes`}
                          disabled={tubes <= 0}
                          style={{ minWidth: 40, minHeight: 40, borderRadius: 'var(--radius-md)', border: '1px solid var(--inner-card-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 18, opacity: tubes <= 0 ? 0.4 : 1 }}
                        >
                          −
                        </button>
                        <span
                          className="tabular-nums"
                          style={{ minWidth: 44, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: tubes > 0 ? 'var(--accent)' : 'var(--text-muted)' }}
                        >
                          {tubes}
                        </span>
                        <button
                          type="button"
                          onClick={() => bumpTubes(p.id, 0.5)}
                          aria-label={`Increase ${p.name} tubes`}
                          style={{ minWidth: 40, minHeight: 40, borderRadius: 'var(--radius-md)', border: '1px solid var(--inner-card-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 18 }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] pt-1" style={{ color: 'var(--text-muted)' }}>
                Carried over from last session — adjust which tubes go into this one.
              </p>
            </Label>
          )}

          {advanceError && <p className="text-red-400 text-xs">{advanceError}</p>}

          {success ? (
            <div className="space-y-3">
              <StatusBanner
                tone="success"
                icon="check_circle"
                title="Session created!"
                body="Previous session archived. Sign-up is closed by default — open it, then share the link."
              />
              <button
                type="button"
                onClick={shareSignupLink}
                className="cc-btn cc-btn-primary cc-btn-lg"
              >
                {shareCopied ? 'Link copied ✓' : 'Share sign-up link'}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="cc-btn cc-btn-secondary"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={advancing || !date || !time || !deadlineDate}
              className="cc-btn cc-btn-primary cc-btn-lg"
            >
              {advancing ? 'Creating...' : 'Create Next Session \u2192'}
            </button>
          )}
        </div>
      </form>

      <BottomSheet
        open={showSkipBlock}
        onClose={() => setShowSkipBlock(false)}
        ariaLabel="Skip date warning"
        maxHeight="50vh"
        className="max-w-sm mx-auto"
      >
        <BottomSheetHeader>
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="bpm-h3" style={{ color: '#fca5a5' }}>Date is on your skip list</h2>
            <button
              type="button"
              onClick={() => setShowSkipBlock(false)}
              className="text-gray-400 hover:text-gray-200"
              aria-label="Close"
            >
              <span className="material-icons">close</span>
            </button>
          </div>
        </BottomSheetHeader>
        <BottomSheetBody>
          <div className="space-y-4 pb-6">
            <p className="text-sm text-gray-200">
              <strong>{date}</strong> is on your skip list — typically a holiday, travel date, or
              known venue closure.
            </p>
            <p className="text-xs text-gray-400">
              You can advance anyway if this is intentional. The skip date stays on the list.
            </p>
            <div className="flex flex-wrap gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowSkipBlock(false)}
                className="cc-btn cc-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowSkipBlock(false);
                  await performAdvance();
                }}
                className="cc-btn cc-btn-danger"
              >
                Advance anyway
              </button>
            </div>
          </div>
        </BottomSheetBody>
      </BottomSheet>
    </div>
  );
}
