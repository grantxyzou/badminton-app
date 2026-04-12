'use client';

import { useState, useEffect } from 'react';
import type { Session } from '@/lib/types';
import AdminBackHeader from './AdminBackHeader';
import DatePicker from '../DatePicker';

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
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then(r => r.json())
      .then((data: Session) => {
        setTime(data.datetime ? data.datetime.slice(11, 16) : '');
        setEndTime(data.endDatetime ? data.endDatetime.slice(11, 16) : '');
        setDeadlineTime(data.deadline ? data.deadline.slice(11, 16) : '');
        setCourts(data.courts ?? 2);
        setMaxPlayers(data.maxPlayers ?? 12);
        setCostPerCourt(data.costPerCourt ?? null);
      })
      .catch(() => {});
    fetch(`${BASE}/api/sessions/costs`, { cache: 'no-store' })
      .then(r => r.json())
      .then((data: { costs: number[] }) => setRecentCosts(data.costs ?? []))
      .catch(() => {});
  }, []);

  async function handleAdvance(e: React.FormEvent) {
    e.preventDefault();
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
          ...(costPerCourt !== null ? { costPerCourt } : {}),
        }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => onBack(), 1200);
      } else {
        const data = await res.json().catch(() => ({}));
        setAdvanceError(data.error ?? 'Failed to advance. Please try again.');
      }
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div className="space-y-4 w-full">
      <AdminBackHeader onBack={onBack} title="Next Session" />

      <form onSubmit={handleAdvance}>
        <div className="glass-card p-5 space-y-3">
          <p className="text-xs text-gray-400">Creates a new session. The current session will be archived.</p>

          <Label text="Date & Time">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={date} onChange={v => setDate(v)} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>

          <Label text="Sign-up Deadline">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={deadlineDate} onChange={v => setDeadlineDate(v)} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={deadlineTime} onChange={e => setDeadlineTime(e.target.value)} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>

          <Label text="Session End">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={endDate} onChange={v => setEndDate(v)} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>

          <div className="grid grid-cols-2 gap-3">
            <Label text="Courts">
              <input type="number" min={1} value={courts} onChange={e => setCourts(parseInt(e.target.value) || 0)} />
            </Label>
            <Label text="Max Players">
              <input type="number" min={1} value={maxPlayers} onChange={e => setMaxPlayers(parseInt(e.target.value) || 0)} />
            </Label>
          </div>

          <Label text="Cost per court">
            <div className="relative">
              {costPerCourt !== null && costPerCourt > 0 && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--text-muted)' }}>$</span>
              )}
              <input
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

          {advanceError && <p className="text-red-400 text-xs">{advanceError}</p>}

          {success ? (
            <div className="status-banner-green">
              <span className="material-icons icon-status text-green-400">check_circle</span>
              <div>
                <p className="font-semibold text-green-400 text-sm">Session created!</p>
                <p className="text-xs text-gray-400 mt-0.5">Previous session archived.</p>
              </div>
            </div>
          ) : (
            <button
              type="submit"
              disabled={advancing || !date || !time || !deadlineDate}
              className="btn-primary w-full"
            >
              {advancing ? 'Creating...' : 'Create Next Session \u2192'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
