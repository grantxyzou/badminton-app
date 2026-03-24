'use client';

import { useState, useEffect, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
import type { Session, Announcement, Player } from '@/lib/types';
import DatePicker from './DatePicker';

/* ─────────────────────────── PIN Gate ─────────────────────────── */

export default function AdminTab() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null); // null = loading
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/admin`)
      .then((r) => r.json())
      .then((d) => setIsAuthed(d.authed === true))
      .catch(() => setIsAuthed(false));
  }, []);

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setPinError('');
    try {
      const res = await fetch(`${BASE}/api/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setIsAuthed(true);
      } else {
        const data = await res.json();
        setPinError(data.error === 'Too many attempts. Try again later.'
          ? data.error
          : 'Incorrect PIN. Please try again.');
        setPin('');
      }
    } catch {
      setPinError('Network error.');
    } finally {
      setChecking(false);
    }
  }

  async function handleLogout() {
    await fetch(`${BASE}/api/admin`, { method: 'DELETE' });
    setIsAuthed(false);
    setPin('');
  }

  if (isAuthed === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="material-icons animate-spin text-green-400" style={{ fontSize: 32 }}>refresh</span>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass-card p-6 w-full max-w-xs space-y-5">
          <div className="text-center">
            <span className="material-icons text-green-400" style={{ fontSize: 40 }}>lock</span>
            <h2 className="text-lg font-bold text-green-400 mt-2">Admin Access</h2>
            <p className="text-sm text-gray-400 mt-0.5">Enter your PIN to continue</p>
          </div>
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <input
              type="password"
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={10}
              inputMode="numeric"
              autoFocus
            />
            {pinError && <p className="text-xs text-red-400">{pinError}</p>}
            <button
              type="submit"
              disabled={checking || !pin}
              className="btn-primary w-full"
            >
              {checking ? 'Checking…' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <AdminPanel onLogout={handleLogout} />;
}

/* ─────────────────────────── Admin Panel ─────────────────────────── */

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<'session' | 'players' | 'announcements'>('session');

  const SECTIONS = [
    { id: 'session', label: 'Session' },
    { id: 'players', label: 'Players' },
    { id: 'announcements', label: 'Posts' },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-green-400">Admin</h2>
        <button
          onClick={onLogout}
          className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1"
        >
          <span className="material-icons" style={{ fontSize: 16 }}>logout</span>
          Sign out
        </button>
      </div>

      {/* Segment control */}
      <div
        className="flex rounded-lg p-1 gap-1"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(74, 222, 128, 0.1)',
        }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className="flex-1 py-2 text-sm font-medium rounded-md transition-all"
            style={
              section === s.id
                ? { background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80' }
                : { color: 'rgba(255,255,255,0.4)' }
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'session' && <SessionEditor />}
      {section === 'players' && <AdminPlayersPanel />}
      {section === 'announcements' && <AnnouncementsPanel />}
    </div>
  );
}

/* ─────────────────────────── Session Editor ─────────────────────────── */

type SessionForm = {
  title: string;
  locationName: string;
  locationAddress: string;
  date: string;
  time: string;
  deadlineDate: string;
  deadlineTime: string;
  courts: number;
  maxPlayers: number;
};

function SessionEditor() {
  const [form, setForm] = useState<SessionForm>({
    title: '',
    locationName: '',
    locationAddress: '',
    date: '',
    time: '',
    deadlineDate: '',
    deadlineTime: '',
    courts: 2,
    maxPlayers: 12,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    fetch(`${BASE}/api/session`)
      .then((r) => r.json())
      .then((data: Session) => {
        setForm({
          title: data.title ?? '',
          locationName: data.locationName ?? '',
          locationAddress: data.locationAddress ?? '',
          date: data.datetime ? data.datetime.slice(0, 10) : '',
          time: data.datetime ? data.datetime.slice(11, 16) : '',
          deadlineDate: data.deadline ? data.deadline.slice(0, 10) : '',
          deadlineTime: data.deadline ? data.deadline.slice(11, 16) : '',
          courts: data.courts ?? 2,
          maxPlayers: data.maxPlayers ?? 12,
        });
      })
      .catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const datetime = form.date && form.time ? `${form.date}T${form.time}` : '';
      const deadline = form.deadlineDate && form.deadlineTime
        ? `${form.deadlineDate}T${form.deadlineTime}`
        : '';
      const res = await fetch(`${BASE}/api/session`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, datetime, deadline }),
      });
      if (res.ok) {
        setSaved(true);
        setSaveError('');
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? 'Failed to save. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  function setStr(key: keyof SessionForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }
  function setNum(key: keyof SessionForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: parseInt(e.target.value) || 0 }));
  }

  return (
    <form onSubmit={handleSave} className="glass-card p-5 space-y-3">
      <Label text="Title">
        <input type="text" value={form.title} onChange={setStr('title')} />
      </Label>
      <Label text="Establishment Name">
        <input type="text" value={form.locationName} onChange={setStr('locationName')} placeholder="e.g. Smash Sports Centre" />
      </Label>
      <Label text="Address">
        <input type="text" value={form.locationAddress} onChange={setStr('locationAddress')} placeholder="e.g. 123 Main St, City" />
      </Label>
      <Label text="Date & Time">
        <div className="grid grid-cols-2 gap-2">
          <DatePicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} placeholder="Date" />
          <input type="time" value={form.time} onChange={setStr('time')} />
        </div>
      </Label>
      <Label text="Sign-up Deadline">
        <div className="grid grid-cols-2 gap-2">
          <DatePicker value={form.deadlineDate} onChange={v => setForm(f => ({ ...f, deadlineDate: v }))} placeholder="Date" />
          <input type="time" value={form.deadlineTime} onChange={setStr('deadlineTime')} />
        </div>
      </Label>
      <div className="grid grid-cols-2 gap-3">
        <Label text="Courts">
          <input type="number" min={1} value={form.courts} onChange={setNum('courts')} />
        </Label>
        <Label text="Max Players">
          <input type="number" min={1} value={form.maxPlayers} onChange={setNum('maxPlayers')} />
        </Label>
      </div>
      <button type="submit" disabled={saving} className="btn-primary w-full">
        {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Session'}
      </button>
      {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
    </form>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-400">{text}</p>
      {children}
    </div>
  );
}

/* ─────────────────────────── Admin Players Panel ─────────────────────────── */

function AdminPlayersPanel() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/players`);
      if (res.ok) setPlayers(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add player.');
      } else {
        setName('');
        loadPlayers();
      }
    } catch {
      setAddError('Network error.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(player: Player) {
    setRemovingId(player.id);
    try {
      await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: player.name }),
      });
      loadPlayers();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Add player form */}
      <form onSubmit={handleAdd} className="glass-card p-5 space-y-3">
        <h3 className="text-xs font-bold tracking-widest text-green-400">ADD PLAYER</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Player name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={50}
          />
          <button type="submit" disabled={adding || !name.trim()} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
            {adding ? '…' : 'Add'}
          </button>
        </div>
        {addError && <p className="text-red-400 text-xs">{addError}</p>}
      </form>

      {/* Player list */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <span className="material-icons animate-spin text-green-400" style={{ fontSize: 24 }}>refresh</span>
          </div>
        ) : players.length === 0 ? (
          <p className="text-center text-gray-500 text-sm p-8">No players signed up yet.</p>
        ) : (
          <div>
            <div
              className="px-4 py-2 text-xs font-bold tracking-widest"
              style={{ background: 'rgba(74,222,128,0.06)', color: 'rgba(74,222,128,0.65)', borderBottom: '1px solid rgba(74,222,128,0.1)' }}
            >
              {players.length} PLAYER{players.length !== 1 ? 'S' : ''}
            </div>
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {players.map((player, i) => (
                <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{i + 1}</span>
                  <span className="flex-1 text-sm text-gray-200 font-medium">{player.name}</span>
                  <button
                    onClick={() => handleRemove(player)}
                    disabled={removingId === player.id}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    {removingId === player.id ? '…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Announcements Panel ─────────────────────────── */

function AnnouncementsPanel() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [draft, setDraft] = useState('');
  const [polished, setPolished] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');

  const loadAnnouncements = useCallback(async () => {
    const res = await fetch(`${BASE}/api/announcements`);
    if (res.ok) setAnnouncements(await res.json());
  }, []);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  async function handlePolish() {
    if (!draft.trim()) return;
    setPolishing(true);
    setPolished('');
    try {
      const res = await fetch(`${BASE}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Polish this badminton club announcement. Keep it concise, friendly, and clear. Return only the improved text with no explanation:\n\n${draft}`,
        }),
      });
      const { text } = await res.json();
      setPolished(text ?? '');
    } finally {
      setPolishing(false);
    }
  }

  async function handlePost(text: string) {
    if (!text.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setDraft('');
        setPolished('');
        setPostError('');
        loadAnnouncements();
      } else {
        const data = await res.json().catch(() => ({}));
        setPostError(data.error ?? 'Failed to post. Please try again.');
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Compose */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-xs font-bold tracking-widest text-green-400">NEW ANNOUNCEMENT</h3>
        <textarea
          rows={3}
          placeholder="Type your announcement…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          onClick={handlePolish}
          disabled={polishing || !draft.trim()}
          className="btn-ghost w-full"
        >
          <span className="material-icons" style={{ fontSize: 16 }}>auto_fix_high</span>
          {polishing ? 'Polishing…' : 'Polish with AI'}
        </button>

        {/* AI result */}
        {polished && (
          <div
            className="rounded-lg p-3 space-y-2"
            style={{
              background: 'rgba(74, 222, 128, 0.06)',
              border: '1px solid rgba(74, 222, 128, 0.15)',
            }}
          >
            <p className="text-xs font-semibold text-green-400">AI Result</p>
            <p className="text-sm text-gray-200 leading-relaxed">{polished}</p>
            <button
              onClick={() => handlePost(polished)}
              disabled={posting}
              className="btn-primary w-full text-sm"
            >
              {posting ? 'Posting…' : 'Post to Home'}
            </button>
          </div>
        )}

        {/* Post draft directly if not polished */}
        {!polished && draft.trim() && (
          <button
            onClick={() => handlePost(draft)}
            disabled={posting}
            className="btn-primary w-full"
          >
            {posting ? 'Posting…' : 'Post to Home'}
          </button>
        )}
        {postError && <p className="text-red-400 text-xs">{postError}</p>}
      </div>

      {/* Posted announcements */}
      {announcements.length > 0 && (
        <div className="glass-card p-5 space-y-3">
          <h3 className="text-xs font-bold tracking-widest text-gray-500">POSTED</h3>
          <div className="space-y-2">
            {announcements.map((a) => (
              <div
                key={a.id}
                className="rounded-lg p-3"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-200 flex-1">{a.text}</p>
                  <button
                    onClick={async () => {
                      await fetch(`${BASE}/api/announcements`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: a.id }),
                      });
                      loadAnnouncements();
                    }}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(a.time).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
