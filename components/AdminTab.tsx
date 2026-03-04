'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Announcement } from '@/lib/types';

/* ─────────────────────────── PIN Gate ─────────────────────────── */

export default function AdminTab() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null); // null = loading
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch('/api/admin')
      .then((r) => r.json())
      .then((d) => setIsAuthed(d.authed === true))
      .catch(() => setIsAuthed(false));
  }, []);

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setPinError('');
    try {
      const res = await fetch('/api/admin', {
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
    await fetch('/api/admin', { method: 'DELETE' });
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
  const [section, setSection] = useState<'session' | 'announcements'>('session');

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
        {(['session', 'announcements'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className="flex-1 py-2 text-sm font-medium rounded-md transition-all"
            style={
              section === s
                ? { background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80' }
                : { color: 'rgba(255,255,255,0.4)' }
            }
          >
            {s === 'session' ? 'Session Info' : 'Announcements'}
          </button>
        ))}
      </div>

      {section === 'session' ? <SessionEditor /> : <AnnouncementsPanel />}
    </div>
  );
}

/* ─────────────────────────── Session Editor ─────────────────────────── */

type SessionForm = {
  title: string;
  location: string;
  datetime: string;
  deadline: string;
  cost: string;
  courts: number;
  maxPlayers: number;
};

function SessionEditor() {
  const [form, setForm] = useState<SessionForm>({
    title: '',
    location: '',
    datetime: '',
    deadline: '',
    cost: '',
    courts: 2,
    maxPlayers: 12,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((data: Session) => {
        setForm({
          title: data.title ?? '',
          location: data.location ?? '',
          datetime: data.datetime ? data.datetime.slice(0, 16) : '',
          deadline: data.deadline ? data.deadline.slice(0, 16) : '',
          cost: data.cost ?? '',
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
      const res = await fetch('/api/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
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
      <Label text="Location">
        <input type="text" value={form.location} onChange={setStr('location')} />
      </Label>
      <Label text="Date & Time">
        <input type="datetime-local" value={form.datetime} onChange={setStr('datetime')} />
      </Label>
      <Label text="Sign-up Deadline">
        <input type="datetime-local" value={form.deadline} onChange={setStr('deadline')} />
      </Label>
      <Label text="Cost">
        <input type="text" value={form.cost} onChange={setStr('cost')} placeholder="e.g. $5 per person" />
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

/* ─────────────────────────── Announcements Panel ─────────────────────────── */

function AnnouncementsPanel() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [draft, setDraft] = useState('');
  const [polished, setPolished] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [posting, setPosting] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    const res = await fetch('/api/announcements');
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
      const res = await fetch('/api/claude', {
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
      const res = await fetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setDraft('');
        setPolished('');
        loadAnnouncements();
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
                <p className="text-sm text-gray-200">{a.text}</p>
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
