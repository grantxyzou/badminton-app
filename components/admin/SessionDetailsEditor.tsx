'use client';

import { useState, useEffect, useRef } from 'react';
import type { Session, BirdPurchase } from '@/lib/types';
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

type DetailsForm = {
  locationName: string;
  locationAddress: string;
  courts: number;
  maxPlayers: number;
  signupOpen: boolean;
  costPerCourt: number;
  birdTubesUsed: number;
  birdPurchaseId: string;
  showCostBreakdown: boolean;
};

export default function SessionDetailsEditor({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState<DetailsForm>({
    locationName: '',
    locationAddress: '',
    courts: 2,
    maxPlayers: 12,
    signupOpen: true,
    costPerCourt: 0,
    birdTubesUsed: 0,
    birdPurchaseId: '',
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

  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: Session) => {
        const loaded: DetailsForm = {
          locationName: data.locationName ?? '',
          locationAddress: data.locationAddress ?? '',
          courts: data.courts ?? 2,
          maxPlayers: data.maxPlayers ?? 12,
          signupOpen: data.signupOpen !== false,
          costPerCourt: data.costPerCourt ?? 0,
          birdTubesUsed: data.birdUsage?.tubes ?? 0,
          birdPurchaseId: data.birdUsage?.purchaseId ?? '',
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

      const res = await fetch(`${BASE}/api/session`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: s?.title ?? '',
          ...form,
          date: dateStr,
          time: timeStr,
          datetime: withLocalTz(dateStr, timeStr),
          endDate: endDateStr,
          endTime: endTimeStr,
          endDatetime: withLocalTz(endDateStr, endTimeStr),
          deadlineDate: deadlineDateStr,
          deadlineTime: deadlineTimeStr,
          deadline: withLocalTz(deadlineDateStr, deadlineTimeStr),
          // If purchase selected: send tubes + purchaseId. If explicitly cleared: send null.
          // If legacy (tubes > 0 but no purchaseId): omit to preserve existing birdUsage.
          ...(form.birdTubesUsed > 0 && form.birdPurchaseId
            ? { birdUsage: { tubes: form.birdTubesUsed, purchaseId: form.birdPurchaseId } }
            : form.birdTubesUsed === 0 || (!form.birdPurchaseId && !fullSession?.birdUsage)
              ? { birdUsage: null }
              : {}),
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
    form.birdTubesUsed !== init.birdTubesUsed ||
    form.birdPurchaseId !== init.birdPurchaseId ||
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

      <form onSubmit={handleSave}>
        <div className="glass-card p-5 space-y-3">
          <Label text="Venue Name">
            <input type="text" value={form.locationName} onChange={setStr('locationName')} placeholder="e.g. Smash Sports Centre" />
          </Label>
          <Label text="Address">
            <input type="text" value={form.locationAddress} onChange={setStr('locationAddress')} placeholder="e.g. 123 Main St, City" />
          </Label>
          <div className="grid grid-cols-3 gap-3">
            <Label text="Courts">
              <input type="number" min={1} value={form.courts} onChange={setNum('courts')} />
            </Label>
            <Label text="Max Players">
              <input type="number" min={1} value={form.maxPlayers} onChange={setNum('maxPlayers')} />
            </Label>
            <Label text="$/Court">
              <input type="number" min={0} step={0.5} value={form.costPerCourt} onChange={setNum('costPerCourt')} />
            </Label>
          </div>
          <div className="space-y-3">
            <Label text="Bird Source">
              <select
                value={form.birdPurchaseId}
                onChange={(e) => setForm(f => ({ ...f, birdPurchaseId: e.target.value, birdTubesUsed: e.target.value ? f.birdTubesUsed || 1 : 0 }))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)', color: 'var(--text-primary)', fontSize: 14 }}
              >
                <option value="">None</option>
                {purchases.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${p.costPerTube.toFixed(2)}/tube ({new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
                  </option>
                ))}
              </select>
            </Label>
            {form.birdPurchaseId && (
              <div className="grid grid-cols-2 gap-3">
                <Label text="Tubes Used">
                  <input type="number" min={1} value={form.birdTubesUsed || ''} onChange={setNum('birdTubesUsed')} />
                </Label>
                <Label text="Show Cost">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, showCostBreakdown: !f.showCostBreakdown }))}
                    className={`w-full text-sm font-medium py-1.5 rounded-lg transition-all ${form.showCostBreakdown ? 'pill-paid' : 'pill-unpaid'}`}
                  >
                    {form.showCostBreakdown ? 'Visible' : 'Hidden'}
                  </button>
                </Label>
              </div>
            )}
            {form.birdPurchaseId && form.birdTubesUsed > 0 && (() => {
              const selected = purchases.find(p => p.id === form.birdPurchaseId);
              if (!selected) return null;
              const total = form.birdTubesUsed * selected.costPerTube;
              return (
                <p className="text-xs" style={{ color: 'var(--accent)' }}>
                  {form.birdTubesUsed} × ${selected.costPerTube.toFixed(2)} = ${total.toFixed(2)}
                </p>
              );
            })()}
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Sign-ups</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{form.signupOpen ? 'Open — players can sign up' : 'Closed — players cannot sign up'}</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, signupOpen: !f.signupOpen }))}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.signupOpen ? 'bg-green-500' : 'bg-white/20'}`}
              role="switch"
              aria-checked={form.signupOpen}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${form.signupOpen ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={saving || !dirty}
            className="btn-ghost w-full"
            style={{ minHeight: 44 }}
          >
            {saving ? 'Updating...' : saved ? '✓ Updated!' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  );
}
