'use client';

import { useState, useEffect, useRef } from 'react';
import type { Session } from '@/lib/types';
import AdminBackHeader from './AdminBackHeader';
import DatePicker from '../DatePicker';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{text}</span>
      {children}
    </label>
  );
}

type DateTimeForm = {
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  deadlineDate: string;
  deadlineTime: string;
};

function withLocalTz(date: string, time: string): string {
  if (!date || !time) return '';
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

export default function DateTimeEditor({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState<DateTimeForm>({
    date: '',
    time: '',
    endDate: '',
    endTime: '',
    deadlineDate: '',
    deadlineTime: '',
  });
  const [fullSession, setFullSession] = useState<Session | null>(null);
  const initialForm = useRef<DateTimeForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: Session) => {
        const loaded: DateTimeForm = {
          date: data.datetime ? data.datetime.slice(0, 10) : '',
          time: data.datetime ? data.datetime.slice(11, 16) : '',
          endDate: data.endDatetime ? data.endDatetime.slice(0, 10) : '',
          endTime: data.endDatetime ? data.endDatetime.slice(11, 16) : '',
          deadlineDate: data.deadline ? data.deadline.slice(0, 10) : '',
          deadlineTime: data.deadline ? data.deadline.slice(11, 16) : '',
        };
        setForm(loaded);
        initialForm.current = loaded;
        setFullSession(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const s = fullSession;
      const datetime = withLocalTz(form.date, form.time);
      const endDatetime = withLocalTz(form.endDate, form.endTime);
      const deadline = withLocalTz(form.deadlineDate, form.deadlineTime);

      const res = await fetch(`${BASE}/api/session`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: s?.title ?? '',
          locationName: s?.locationName ?? '',
          locationAddress: s?.locationAddress ?? '',
          courts: s?.courts ?? 2,
          maxPlayers: s?.maxPlayers ?? 12,
          signupOpen: s?.signupOpen !== false,
          costPerCourt: s?.costPerCourt ?? 0,
          birdTubesUsed: s?.birdUsage?.tubes ?? 0,
          showCostBreakdown: s?.showCostBreakdown ?? false,
          ...form,
          datetime,
          endDatetime,
          deadline,
          birdUsage: (s?.birdUsage?.tubes ?? 0) > 0 ? { tubes: s!.birdUsage!.tubes } : null,
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
    form.date !== init.date ||
    form.time !== init.time ||
    form.endDate !== init.endDate ||
    form.endTime !== init.endTime ||
    form.deadlineDate !== init.deadlineDate ||
    form.deadlineTime !== init.deadlineTime
  );

  function setStr(key: keyof DateTimeForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  if (loading) {
    return (
      <div className="animate-slideInRight space-y-4">
        <AdminBackHeader onBack={onBack} title="Dates & Times" />
        <div className="glass-card p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-white/10 rounded w-1/3" />
            <div className="h-10 bg-white/10 rounded" />
            <div className="h-10 bg-white/10 rounded" />
            <div className="h-10 bg-white/10 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-slideInRight space-y-4">
      <AdminBackHeader onBack={onBack} title="Dates & Times" />

      <form onSubmit={handleSave}>
        <div className="glass-card p-5 space-y-3">
          <Label text="Session Date & Time">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={form.time} onChange={setStr('time')} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>
          <Label text="Sign-up Deadline">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={form.deadlineDate} onChange={v => setForm(f => ({ ...f, deadlineDate: v }))} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={form.deadlineTime} onChange={setStr('deadlineTime')} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>
          <Label text="Session End">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={form.endDate} onChange={v => setForm(f => ({ ...f, endDate: v }))} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={form.endTime} onChange={setStr('endTime')} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>
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
