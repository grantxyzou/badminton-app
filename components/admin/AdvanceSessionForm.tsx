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
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState('');

  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then(r => r.json())
      .then((data: Session) => {
        setTime(data.datetime ? data.datetime.slice(11, 16) : '');
        setEndTime(data.endDatetime ? data.endDatetime.slice(11, 16) : '');
        setDeadlineTime(data.deadline ? data.deadline.slice(11, 16) : '');
        setCourts(data.courts ?? 2);
        setMaxPlayers(data.maxPlayers ?? 12);
      })
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
        }),
      });
      if (res.ok) {
        onBack();
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

          {advanceError && <p className="text-red-400 text-xs">{advanceError}</p>}

          <button
            type="submit"
            disabled={advancing || !date || !time || !deadlineDate}
            className="btn-primary w-full"
          >
            {advancing ? 'Creating...' : 'Create Next Session \u2192'}
          </button>
        </div>
      </form>
    </div>
  );
}
