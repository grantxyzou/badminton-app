'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
import type { Session, Announcement, Player, Alias, Member } from '@/lib/types';
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
        setPinError(res.status === 429
          ? 'Too many attempts. Try again in 15 minutes.'
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
      <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-label="Loading">
        <span className="material-icons animate-spin text-green-400" aria-hidden="true" style={{ fontSize: 32 }}>refresh</span>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass-card p-6 w-full max-w-xs space-y-5">
          <div className="text-center">
            <span className="material-icons icon-xl text-green-400">lock</span>
            <h2 className="text-lg font-bold text-green-400 mt-2">Admin Access</h2>
            <p className="text-sm text-gray-400 mt-0.5">Enter your PIN to continue</p>
          </div>
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <input
              type="password"
              placeholder="PIN"
              aria-label="Admin PIN"
              aria-describedby={pinError ? 'pin-error' : undefined}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={10}
              inputMode="numeric"
              autoFocus
            />
            {pinError && <p id="pin-error" role="alert" className="text-xs text-red-400">{pinError}</p>}
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
  const [section, setSection] = useState<'session' | 'members' | 'signup' | 'announcements'>('session');

  const SECTIONS = [
    { id: 'session', label: 'Session' },
    { id: 'members', label: 'Members' },
    { id: 'signup', label: 'Sign Up' },
    { id: 'announcements', label: 'Posts' },
  ] as const;

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center justify-between px-1">
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
        role="tablist"
        aria-label="Admin sections"
        className="flex w-full segment-control"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={`flex-1 min-w-0 px-1.5 transition-all truncate ${section === s.id ? 'segment-tab-active' : 'segment-tab-inactive'}`}
            style={{ fontSize: '13.333px', letterSpacing: '-0.08px', lineHeight: '18px' }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'session' && <SessionEditor />}
      {section === 'members' && <MembersPanel />}
      {section === 'signup' && <AdminPlayersPanel />}
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
  endDate: string;
  endTime: string;
  deadlineDate: string;
  deadlineTime: string;
  courts: number;
  maxPlayers: number;
  signupOpen: boolean;

};

function SessionEditor() {
  const [form, setForm] = useState<SessionForm>({
    title: '',
    locationName: '',
    locationAddress: '',
    date: '',
    time: '',
    endDate: '',
    endTime: '',
    deadlineDate: '',
    deadlineTime: '',
    courts: 2,
    maxPlayers: 12,
    signupOpen: true,
  });
  const initialForm = useRef<SessionForm | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savedDetails, setSavedDetails] = useState(false);
  const [saveDetailsError, setSaveDetailsError] = useState('');
  const [savingDates, setSavingDates] = useState(false);
  const [savedDates, setSavedDates] = useState(false);
  const [saveDatesError, setSaveDatesError] = useState('');
  const [advanceForm, setAdvanceForm] = useState<SessionForm>({
    title: '',
    locationName: '',
    locationAddress: '',
    date: '',
    time: '',
    endDate: '',
    endTime: '',
    deadlineDate: '',
    deadlineTime: '',
    courts: 2,
    maxPlayers: 12,
    signupOpen: true,
  });
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState('');
  const [advanceDone, setAdvanceDone] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/session`)
      .then((r) => r.json())
      .then((data: Session) => {
        const loaded: SessionForm = {
          title: data.title ?? '',
          locationName: data.locationName ?? '',
          locationAddress: data.locationAddress ?? '',
          date: data.datetime ? data.datetime.slice(0, 10) : '',
          time: data.datetime ? data.datetime.slice(11, 16) : '',
          endDate: data.endDatetime ? data.endDatetime.slice(0, 10) : '',
          endTime: data.endDatetime ? data.endDatetime.slice(11, 16) : '',
          deadlineDate: data.deadline ? data.deadline.slice(0, 10) : '',
          deadlineTime: data.deadline ? data.deadline.slice(11, 16) : '',
          courts: data.courts ?? 2,
          maxPlayers: data.maxPlayers ?? 12,
          signupOpen: data.signupOpen !== false,
        };
        setForm(loaded);
        initialForm.current = loaded;
        setAdvanceForm({
          title: data.title ?? '',
          locationName: data.locationName ?? '',
          locationAddress: data.locationAddress ?? '',
          date: '',
          time: data.datetime ? data.datetime.slice(11, 16) : '',
          endDate: '',
          endTime: data.endDatetime ? data.endDatetime.slice(11, 16) : '',
          deadlineDate: '',
          deadlineTime: data.deadline ? data.deadline.slice(11, 16) : '',
          courts: data.courts ?? 2,
          maxPlayers: data.maxPlayers ?? 12,
          signupOpen: true,
              });
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

  async function saveSession(onStart: () => void, onSuccess: () => void, onError: (msg: string) => void, onFinally: () => void) {
    onStart();
    try {
      const datetime = withLocalTz(form.date, form.time);
      const endDatetime = withLocalTz(form.endDate, form.endTime);
      const deadline = withLocalTz(form.deadlineDate, form.deadlineTime);
      const res = await fetch(`${BASE}/api/session`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, datetime, endDatetime, deadline }),
      });
      if (res.ok) {
        initialForm.current = { ...form };
        onSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        onError(data.error ?? 'Failed to save. Please try again.');
      }
    } finally {
      onFinally();
    }
  }

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    await saveSession(
      () => { setSavingDetails(true); setSavedDetails(false); setSaveDetailsError(''); },
      () => { setSavedDetails(true); setTimeout(() => setSavedDetails(false), 3000); },
      (msg) => setSaveDetailsError(msg),
      () => setSavingDetails(false),
    );
  }

  async function handleSaveDates(e: React.FormEvent) {
    e.preventDefault();
    await saveSession(
      () => { setSavingDates(true); setSavedDates(false); setSaveDatesError(''); },
      () => { setSavedDates(true); setTimeout(() => setSavedDates(false), 3000); },
      (msg) => setSaveDatesError(msg),
      () => setSavingDates(false),
    );
  }

  async function handleAdvance(e: React.FormEvent) {
    e.preventDefault();
    setAdvancing(true);
    setAdvanceError('');
    setAdvanceDone(false);
    try {
      const datetime = withLocalTz(advanceForm.date, advanceForm.time);
      const endDatetime = withLocalTz(advanceForm.endDate, advanceForm.endTime);
      const deadline = withLocalTz(advanceForm.deadlineDate, advanceForm.deadlineTime);
      const res = await fetch(`${BASE}/api/session/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...advanceForm, datetime, endDatetime, deadline }),
      });
      if (res.ok) {
        setAdvanceDone(true);
        const sRes = await fetch(`${BASE}/api/session`);
        if (sRes.ok) {
          const data: Session = await sRes.json();
          const loaded: SessionForm = {
            title: data.title ?? '',
            locationName: data.locationName ?? '',
            locationAddress: data.locationAddress ?? '',
            date: data.datetime ? data.datetime.slice(0, 10) : '',
            time: data.datetime ? data.datetime.slice(11, 16) : '',
            endDate: data.endDatetime ? data.endDatetime.slice(0, 10) : '',
            endTime: data.endDatetime ? data.endDatetime.slice(11, 16) : '',
            deadlineDate: data.deadline ? data.deadline.slice(0, 10) : '',
            deadlineTime: data.deadline ? data.deadline.slice(11, 16) : '',
            courts: data.courts ?? 2,
            maxPlayers: data.maxPlayers ?? 12,
            signupOpen: data.signupOpen !== false,
            };
          setForm(loaded);
          initialForm.current = loaded;
          setAdvanceForm(f => ({ ...f, date: '', endDate: '', deadlineDate: '' }));
        }
        setTimeout(() => setAdvanceDone(false), 4000);
      } else {
        const data = await res.json().catch(() => ({}));
        setAdvanceError(data.error ?? 'Failed to advance. Please try again.');
      }
    } finally {
      setAdvancing(false);
    }
  }

  const init = initialForm.current;
  const detailsDirty = init !== null && (
    form.locationName !== init.locationName ||
    form.locationAddress !== init.locationAddress ||
    form.courts !== init.courts ||
    form.maxPlayers !== init.maxPlayers ||
    form.signupOpen !== init.signupOpen
  );
  const datesDirty = init !== null && (
    form.date !== init.date ||
    form.time !== init.time ||
    form.deadlineDate !== init.deadlineDate ||
    form.deadlineTime !== init.deadlineTime ||
    form.endDate !== init.endDate ||
    form.endTime !== init.endTime
  );

  function setStr(key: keyof SessionForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }
  function setNum(key: keyof SessionForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: parseInt(e.target.value) || 0 }));
  }
  function setAdvStr(key: keyof SessionForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setAdvanceForm((f) => ({ ...f, [key]: e.target.value }));
  }
  function setAdvNum(key: keyof SessionForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setAdvanceForm((f) => ({ ...f, [key]: parseInt(e.target.value) || 0 }));
  }

  return (
    <div className="space-y-3">
      {/* Card 1: Badminton Details */}
      <form onSubmit={handleSaveDetails}>
        <div className="glass-card p-5 space-y-3">
          <p className="section-label">BADMINTON DETAILS</p>
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
              <p className="text-sm font-medium text-white">Sign-ups</p>
              <p className="text-xs text-gray-400">{form.signupOpen ? 'Open — players can sign up' : 'Closed — players cannot sign up'}</p>
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
          {saveDetailsError && <p className="text-red-400 text-xs">{saveDetailsError}</p>}
          <button type="submit" disabled={savingDetails || !detailsDirty} className="btn-ghost w-full">
            {savingDetails ? 'Updating…' : savedDetails ? '✓ Updated!' : 'Update'}
          </button>
        </div>
      </form>

      {/* Card 2: Date & Time */}
      <form onSubmit={handleSaveDates}>
        <div className="glass-card p-5 space-y-3">
          <p className="section-label">DATE & TIME</p>
          <Label text="Date & Time">
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
          {saveDatesError && <p className="text-red-400 text-xs">{saveDatesError}</p>}
          <button type="submit" disabled={savingDates || !datesDirty} className="btn-ghost w-full">
            {savingDates ? 'Updating…' : savedDates ? '✓ Updated!' : 'Update'}
          </button>
        </div>
      </form>

      {/* Card 3: Create Session for Next Week */}
      <form onSubmit={handleAdvance}>
        <div className="glass-card p-5 space-y-3">
          <p className="section-label">NEXT WEEK'S SESSION</p>
          <p className="text-xs text-gray-400">Creates a new session. The current session will be archived.</p>
          <Label text="Date & Time">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={advanceForm.date} onChange={v => setAdvanceForm(f => ({ ...f, date: v }))} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={advanceForm.time} onChange={setAdvStr('time')} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>
          <Label text="Sign-up Deadline">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={advanceForm.deadlineDate} onChange={v => setAdvanceForm(f => ({ ...f, deadlineDate: v }))} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={advanceForm.deadlineTime} onChange={setAdvStr('deadlineTime')} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>
          <Label text="Session End">
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker value={advanceForm.endDate} onChange={v => setAdvanceForm(f => ({ ...f, endDate: v }))} placeholder="Date" />
              </div>
              <div className="flex-1">
                <input type="time" value={advanceForm.endTime} onChange={setAdvStr('endTime')} style={{ height: '42px' }} />
              </div>
            </div>
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <Label text="Courts">
              <input type="number" min={1} value={advanceForm.courts} onChange={setAdvNum('courts')} />
            </Label>
            <Label text="Max Players">
              <input type="number" min={1} value={advanceForm.maxPlayers} onChange={setAdvNum('maxPlayers')} />
            </Label>
          </div>
          {advanceError && <p className="text-red-400 text-xs">{advanceError}</p>}
          <button
            type="submit"
            disabled={advancing || !advanceForm.date || !advanceForm.time || !advanceForm.deadlineDate}
            className="btn-primary w-full"
          >
            {advancing ? 'Creating…' : advanceDone ? '✓ Created!' : 'Create Next Session →'}
          </button>
        </div>
      </form>
    </div>
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

function fmtSessionLabel(datetime: string | undefined): string {
  if (!datetime) return '';
  const d = new Date(datetime);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((sessionStart.getTime() - todayStart.getTime()) / 86_400_000);
  if (diffDays === 0) return 'TODAY';
  if (diffDays > 0 && diffDays <= 7)
    return d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

function AdminPlayersPanel() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [waitlistPlayers, setWaitlistPlayers] = useState<Player[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [removedPlayers, setRemovedPlayers] = useState<Player[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [confirmingPurgeId, setConfirmingPurgeId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearMode, setClearMode] = useState<'soft' | 'hard'>('soft');
  const [clearError, setClearError] = useState('');
  const [cancelledCollapsed, setCancelledCollapsed] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState('');

  // Session history navigation
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const isViewingActive = !viewedSessionId || viewedSessionId === activeSessionId;
  const viewedIndex = allSessions.findIndex(s => s.id === (viewedSessionId ?? activeSessionId));
  const canGoPrev = viewedIndex < allSessions.length - 1;
  const canGoNext = viewedIndex > 0;

  const viewedSession = allSessions.find(s => s.id === (viewedSessionId ?? activeSessionId));

  function fmtSessionNav(datetime: string) {
    if (!datetime) return '—';
    try {
      return new Date(datetime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch { return datetime; }
  }

  const loadPlayers = useCallback(async (sessionIdOverride?: string) => {
    setLoading(true);
    try {
      const sessionParam = sessionIdOverride ? `&sessionId=${encodeURIComponent(sessionIdOverride)}` : '';
      const [pRes, sRes, aRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/players?all=true${sessionParam}`),
        fetch(`${BASE}/api/session`),
        fetch(`${BASE}/api/aliases`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
      ]);
      if (pRes.ok) {
        const all: Player[] = await pRes.json();
        setPlayers(all.filter(p => !p.removed && !p.waitlisted));
        setWaitlistPlayers(all.filter(p => !p.removed && !!p.waitlisted));
        setRemovedPlayers(all.filter(p => p.removed));
      }
      if (sRes.ok) {
        const activeSession: Session = await sRes.json();
        setSession(activeSession);
        if (!sessionIdOverride) setActiveSessionId(activeSession.id);
      }
      if (aRes.ok) setAliases(await aRes.json());
      if (sessionsRes.ok) {
        const sessions: Session[] = await sessionsRes.json();
        setAllSessions(sessions.sort((a, b) => b.datetime.localeCompare(a.datetime)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  function navigateSession(direction: 'prev' | 'next') {
    const idx = viewedIndex;
    const newIdx = direction === 'prev' ? idx + 1 : idx - 1;
    if (newIdx >= 0 && newIdx < allSessions.length) {
      const newSession = allSessions[newIdx];
      setViewedSessionId(newSession.id);
      loadPlayers(newSession.id === activeSessionId ? undefined : newSession.id);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add player.');
      } else {
        setName('');
        loadPlayers(!isViewingActive && viewedSessionId ? viewedSessionId : undefined);
      }
    } catch {
      setAddError('Network error.');
    } finally {
      setAdding(false);
    }
  }

  async function handleTogglePaid(player: Player) {
    setTogglingId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, paid: !player.paid, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, paid: !player.paid } : p));
        setSavedId(player.id);
        setTimeout(() => setSavedId(null), 1200);
      }
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRemove(player: Player) {
    setRemovingId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: player.name, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setPlayers(prev => prev.filter(p => p.id !== player.id));
        setRemovedPlayers(prev => [...prev, { ...player, removed: true }]);
      } else {
        setAddError('Failed to remove player. Please try again.');
      }
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRestore(player: Player) {
    setRestoreError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, removed: false, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setRemovedPlayers(prev => prev.filter(p => p.id !== player.id));
        loadPlayers();
      } else {
        const data = await res.json().catch(() => ({}));
        setRestoreError(data.error === 'Session is full' ? 'Session is full — cannot restore.' : 'Failed to restore. Please try again.');
      }
    } catch {
      setRestoreError('Failed to restore. Please try again.');
    }
  }

  async function handlePromote(player: Player) {
    setPromoteError('');
    setPromotingId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, waitlisted: false, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        loadPlayers();
      } else {
        const data = await res.json().catch(() => ({}));
        setPromoteError(data.error === 'Session is full' ? 'Session is full — cannot promote.' : 'Failed to promote. Please try again.');
      }
    } catch {
      setPromoteError('Failed to promote. Please try again.');
    } finally {
      setPromotingId(null);
    }
  }

  async function handlePurgeSingle(player: Player) {
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeOne: player.id, name: player.name, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setRemovedPlayers(prev => prev.filter(p => p.id !== player.id));
      }
    } catch { /* silent */ }
  }

  function handleExportCSV() {
    const aliasMap = new Map(aliases.map(a => [a.appName.toLowerCase(), a.etransferName]));
    const allForExport = [
      ...players.map(p => ({ ...p, onWaitlist: false })),
      ...waitlistPlayers.map(p => ({ ...p, onWaitlist: true })),
    ];
    const rows = [
      ['#', 'Name', 'E-Transfer Name', 'Waitlisted', 'Signed Up', 'Paid'],
      ...allForExport.map((p, i) => [
        String(i + 1),
        p.name,
        aliasMap.get(p.name.toLowerCase()) ?? '',
        p.onWaitlist ? 'Yes' : 'No',
        new Date(p.timestamp).toLocaleString(),
        p.paid ? 'Yes' : 'No',
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const dateStr = session?.datetime ? session.datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
    a.download = `players-${dateStr}.csv`;
    a.click();
  }

  async function handleClearSession() {
    setClearError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      });
      if (res.ok) {
        setConfirmingClear(false);
        loadPlayers();
      } else {
        setClearError('Failed to clear. Please try again.');
      }
    } catch {
      setClearError('Failed to clear. Please try again.');
    }
  }

  async function handlePurgeAll() {
    setClearError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeAll: true }),
      });
      if (res.ok) {
        setConfirmingClear(false);
        loadPlayers();
      } else {
        setClearError('Failed to purge. Please try again.');
      }
    } catch {
      setClearError('Failed to purge. Please try again.');
    }
  }

  return (
    <div className="space-y-3">
      {/* Session navigator */}
      {allSessions.length > 1 && (
        <div className="glass-card p-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigateSession('prev')}
            disabled={!canGoPrev}
            className="text-white disabled:opacity-20 transition-opacity p-1"
            aria-label="Previous session"
          >
            <span className="material-icons" style={{ fontSize: 24 }}>chevron_left</span>
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">
              {viewedSession ? fmtSessionNav(viewedSession.datetime) : '—'}
            </p>
            {isViewingActive ? (
              <p className="text-xs text-green-400 font-medium">Current session</p>
            ) : (
              <p className="text-xs text-gray-400">Past session</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigateSession('next')}
            disabled={!canGoNext}
            className="text-white disabled:opacity-20 transition-opacity p-1"
            aria-label="Next session"
          >
            <span className="material-icons" style={{ fontSize: 24 }}>chevron_right</span>
          </button>
        </div>
      )}

      {/* Add player form */}
      <form onSubmit={handleAdd} className="glass-card p-5 space-y-3">
        <h3 className="section-label">ADD PLAYER</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Player name"
            aria-label="Player name"
            aria-describedby={addError ? 'add-error' : undefined}
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={50}
          />
          <button type="submit" disabled={adding || !name.trim()} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
            {adding ? '…' : 'Add'}
          </button>
        </div>
        {addError && <p id="add-error" role="alert" className="text-red-400 text-xs">{addError}</p>}
      </form>

      {/* Player list */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-24" role="status" aria-label="Loading">
            <span className="material-icons icon-lg animate-spin text-green-400" aria-hidden="true">refresh</span>
          </div>
        ) : players.length === 0 ? (
          <p className="text-center text-gray-500 text-sm p-8">No players signed up yet.</p>
        ) : (
          <div>
            <div className="list-header-green flex items-center justify-between">
              <span>
                {players.length} PLAYER{players.length !== 1 ? 'S' : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="text-xs font-normal hover:text-green-300 transition-colors flex items-center gap-1"
                >
                  <span className="material-icons" style={{ fontSize: 13 }}>download</span>
                  Export CSV
                </button>
                <div className="relative">
                  <button
                    onClick={() => setMoreMenuOpen(o => !o)}
                    className="hover:text-green-300 transition-colors p-0.5"
                    aria-label="More actions"
                  >
                    <span className="material-icons" style={{ fontSize: 18 }}>more_vert</span>
                  </button>
                  {moreMenuOpen && (
                    <>
                      <div onClick={() => setMoreMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl overflow-hidden border border-white/10" style={{ background: 'rgba(30,40,30,0.97)', backdropFilter: 'blur(12px)' }}>
                        <button
                          onClick={() => { setMoreMenuOpen(false); setClearMode('soft'); setClearError(''); setConfirmingClear(true); }}
                          className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-3"
                        >
                          <span className="material-icons text-gray-500" style={{ fontSize: 18 }}>delete_sweep</span>
                          Clear Session
                        </button>
                        <button
                          onClick={() => { setMoreMenuOpen(false); setClearMode('hard'); setClearError(''); setConfirmingClear(true); }}
                          className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-white/10 transition-colors flex items-center gap-3"
                        >
                          <span className="material-icons" style={{ fontSize: 18 }}>delete_forever</span>
                          Purge All Records
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {players.map((player, i) => (
                <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{i + 1}</span>
                  <span className="flex-1 text-sm text-gray-200 font-medium">{player.name}</span>
                  <button
                    onClick={() => handleTogglePaid(player)}
                    disabled={togglingId === player.id}
                    className={`text-xs font-medium transition-colors px-2 py-0.5 rounded-full ${player.paid ? 'pill-paid' : 'pill-unpaid'}`}
                  >
                    {savedId === player.id ? '✓' : togglingId === player.id ? '…' : player.paid ? 'Paid' : 'Pending'}
                  </button>
                  <button
                    onClick={() => handleRemove(player)}
                    disabled={removingId === player.id}
                    className="text-xs text-gray-500 hover:text-amber-400 transition-colors p-1 flex items-center gap-1"
                    title={`Remove ${player.name}`}
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>person_remove</span>
                    <span className="hidden sm:inline">Remove</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Waitlisted players card */}
      {promoteError && (
        <p role="alert" className="text-xs text-red-400 px-1">{promoteError}</p>
      )}
      {waitlistPlayers.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="list-header-amber">
            {waitlistPlayers.length} WAITLISTED
          </div>
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            {waitlistPlayers.map((player, i) => (
              <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{players.length + i + 1}</span>
                <span className="flex-1 text-sm text-gray-300 font-medium">{player.name}</span>
                <button
                  onClick={() => handlePromote(player)}
                  disabled={promotingId === player.id}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors py-2 px-1"
                >
                  {promotingId === player.id ? '…' : 'Promote'}
                </button>
                <button
                  onClick={() => handleRemove(player)}
                  disabled={removingId === player.id}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors p-1 flex items-center gap-1"
                  title={`Remove ${player.name}`}
                >
                  <span className="material-icons" style={{ fontSize: 16 }}>person_remove</span>
                  <span className="hidden sm:inline">Remove</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancelled players card */}
      {restoreError && (
        <p role="alert" className="text-xs text-red-400 px-1">{restoreError}</p>
      )}
      {removedPlayers.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div
            className="list-header-amber flex items-center justify-between"
            style={cancelledCollapsed ? { borderBottom: 'none' } : undefined}
          >
            <span>
              {removedPlayers.length} REMOVED
              {session?.datetime ? <span style={{ fontWeight: 400, opacity: 0.6 }}> · {fmtSessionLabel(session.datetime)}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => setCancelledCollapsed(c => !c)}
              aria-label={cancelledCollapsed ? 'Expand cancelled list' : 'Collapse cancelled list'}
              className="bg-transparent border-0 cursor-pointer text-amber-400/65 p-0 flex items-center"
            >
              <span className="material-icons icon-md">
                {cancelledCollapsed ? 'expand_more' : 'expand_less'}
              </span>
            </button>
          </div>
          {!cancelledCollapsed && (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            {[...removedPlayers]
              .sort((a, b) => {
                const at = a.removedAt ? new Date(a.removedAt).getTime() : 0;
                const bt = b.removedAt ? new Date(b.removedAt).getTime() : 0;
                return bt - at;
              })
              .map((player, i) => (
              <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-500 font-medium line-through">{player.name}</span>
                  {player.removedAt && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {player.cancelledBySelf ? 'Cancelled' : 'Removed'} · {new Date(player.removedAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleRestore(player)}
                  className="text-xs text-amber-400 hover:text-amber-300 transition-colors p-1 flex items-center gap-1"
                  title={`Restore ${player.name}`}
                >
                  <span className="material-icons" style={{ fontSize: 16 }}>restore</span>
                  <span className="hidden sm:inline">Restore</span>
                </button>
                {confirmingPurgeId === player.id ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400">Delete?</span>
                    <button onClick={() => { handlePurgeSingle(player); setConfirmingPurgeId(null); }} className="text-red-400 hover:text-red-300 transition-colors">Yes</button>
                    <button onClick={() => setConfirmingPurgeId(null)} className="text-gray-400 hover:text-white transition-colors">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingPurgeId(player.id)}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors p-1 flex items-center gap-1"
                    title={`Permanently delete ${player.name}`}
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>delete_forever</span>
                    <span className="hidden sm:inline">Delete</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* Clear session action sheet (portal) */}
      {confirmingClear && typeof document !== 'undefined' && createPortal(
        <>
          {/* Overlay */}
          <div
            onClick={() => { setConfirmingClear(false); setClearError(''); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 100 }}
          />
          {/* Sheet */}
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101, padding: '0 16px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)' }}>
            <div className="glass-card p-5 space-y-3 max-w-lg mx-auto">
              <div className="text-center space-y-1.5">
                <p className="font-semibold text-white">
                  {clearMode === 'soft' ? 'Clear session for new week?' : 'Permanently delete all records?'}
                </p>
                <p className="text-sm text-gray-400">
                  {clearMode === 'soft' ? (
                    <>All <span className="text-white font-semibold">{players.length}</span> player{players.length !== 1 ? 's' : ''} will be moved to Cancelled. Data stays in the database.</>
                  ) : (
                    <><span className="text-white font-semibold">{players.length + waitlistPlayers.length + removedPlayers.length}</span> record{(players.length + waitlistPlayers.length + removedPlayers.length) !== 1 ? 's' : ''} will be permanently deleted — active, waitlisted, and cancelled. <span className="text-red-400">This cannot be undone.</span></>
                  )}
                </p>
              </div>
              {clearMode === 'soft' && (
                <button
                  onClick={() => { handleExportCSV(); }}
                  className="btn-ghost w-full flex items-center justify-center gap-2"
                >
                  <span className="material-icons icon-sm" aria-hidden="true">download</span>
                  Export CSV first
                </button>
              )}
              <button
                onClick={clearMode === 'soft' ? handleClearSession : handlePurgeAll}
                className="btn-primary w-full"
                style={clearMode === 'soft'
                  ? { background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
                  : { background: 'rgba(239,68,68,0.30)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.45)' }
                }
              >
                {clearMode === 'soft'
                  ? 'Clear Session'
                  : 'Delete Everything'
                }
              </button>
              <button
                onClick={() => { setConfirmingClear(false); setClearError(''); }}
                className="w-full text-sm text-gray-400 hover:text-white transition-colors py-2"
              >
                Cancel
              </button>
              {clearError && <p role="alert" className="text-xs text-red-400 text-center">{clearError}</p>}
            </div>
          </div>
        </>,
        document.body
      )}
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
  const [deletePostError, setDeletePostError] = useState('');
  const [editingAnnoId, setEditingAnnoId] = useState<string | null>(null);
  const [editAnnoText, setEditAnnoText] = useState('');
  const [editAnnoError, setEditAnnoError] = useState('');
  const [savingAnno, setSavingAnno] = useState(false);

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
    setPostError('');
    try {
      const res = await fetch(`${BASE}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Polish this badminton club announcement. Keep it concise, friendly, and clear. Return only the improved text with no explanation:\n\n${draft}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPostError(data.error ?? 'AI polish failed. Please try again.');
      } else {
        setPolished(data.text ?? '');
      }
    } catch {
      setPostError('Network error. Please try again.');
    } finally {
      setPolishing(false);
    }
  }

  async function handleDeleteAnnouncement(id: string) {
    setDeletePostError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        loadAnnouncements();
      } else {
        setDeletePostError('Failed to delete. Please try again.');
      }
    } catch {
      setDeletePostError('Failed to delete. Please try again.');
    }
  }

  function startEditAnno(a: Announcement) {
    setEditingAnnoId(a.id);
    setEditAnnoText(a.text);
    setEditAnnoError('');
  }

  async function handleSaveAnno(id: string) {
    setSavingAnno(true);
    setEditAnnoError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, text: editAnnoText }),
      });
      if (res.ok) {
        setEditingAnnoId(null);
        loadAnnouncements();
      } else {
        const d = await res.json().catch(() => ({}));
        setEditAnnoError(d.error ?? 'Failed to save');
      }
    } catch {
      setEditAnnoError('Network error');
    } finally {
      setSavingAnno(false);
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
        <h3 className="section-label">NEW ANNOUNCEMENT</h3>
        <textarea
          rows={3}
          placeholder="Type your announcement…"
          aria-label="Announcement text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
        />
        <p className="text-right text-xs text-gray-500">{draft.length}/500</p>
        <button
          onClick={handlePolish}
          disabled={polishing || !draft.trim()}
          className="btn-ghost w-full"
        >
          <span className="material-icons icon-sm">auto_fix_high</span>
          {polishing ? 'Improving…' : 'Improve with AI'}
        </button>

        {/* AI result */}
        {polished && (
          <div className="inner-card-green p-3 space-y-2">
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
          <h3 className="section-label-muted">ACTIVE ANNOUNCEMENTS</h3>
          <div className="space-y-2">
            {deletePostError && <p className="text-xs text-red-400 mb-1">{deletePostError}</p>}
            {announcements.map((a) =>
              editingAnnoId === a.id ? (
                <div key={a.id} className="inner-card p-3 space-y-2">
                  <textarea
                    rows={3}
                    value={editAnnoText}
                    onChange={(e) => setEditAnnoText(e.target.value)}
                    maxLength={500}
                    className="w-full text-sm"
                  />
                  <p className="text-right text-xs text-gray-500">{editAnnoText.length}/500</p>
                  {editAnnoError && <p className="text-red-400 text-xs">{editAnnoError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveAnno(a.id)}
                      disabled={savingAnno || !editAnnoText.trim()}
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      {savingAnno ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingAnnoId(null)} className="btn-ghost text-xs px-3 py-1.5">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={a.id} className="inner-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-gray-200 flex-1">{a.text}</p>
                    <div className="flex gap-3 shrink-0">
                      <button
                        onClick={() => startEditAnno(a)}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteAnnouncement(a.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                    <span>
                      {new Date(a.time).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {a.editedAt && (
                      <span className="text-gray-600">· edited</span>
                    )}
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Members Panel ─────────────────────────── */

function MembersPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [inviteCollapsed, setInviteCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/members`);
      if (res.ok) setMembers(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  async function handleAdd() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setNameInput('');
        loadMembers();
      } else {
        const data = await res.json().catch(() => ({}));
        setAddError(data.error ?? 'Failed to add');
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveMember(member: Member) {
    await fetch(`${BASE}/api/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: member.id }),
    });
    loadMembers();
  }

  return (
    <div className="space-y-3">
      {/* Invite List */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-label">INVITE LIST</p>
            {inviteCollapsed && <p className="text-xs text-gray-500 mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''}</p>}
          </div>
          <button
            type="button"
            onClick={() => setInviteCollapsed(c => !c)}
            aria-label={inviteCollapsed ? 'Expand invite list' : 'Collapse invite list'}
            className="bg-transparent border-0 cursor-pointer text-green-400/65 p-0 flex items-center"
          >
            <span className="material-icons icon-md">{inviteCollapsed ? 'expand_more' : 'expand_less'}</span>
          </button>
        </div>
        {!inviteCollapsed && <p className="text-xs text-gray-400">Only people on this list can sign up. Leave empty to allow anyone.</p>}
        {!inviteCollapsed && (<>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add a name…"
            value={nameInput}
            onChange={(e) => { setNameInput(e.target.value); setAddError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            maxLength={50}
            className="flex-1"
          />
          <button type="button" className="btn-ghost px-4 shrink-0" onClick={handleAdd} disabled={adding}>
            {adding ? '…' : 'Add'}
          </button>
        </div>
        {addError && <p className="text-red-400 text-xs">{addError}</p>}
        {loading ? (
          <p className="text-center text-gray-500 text-xs py-2">Loading…</p>
        ) : members.length > 0 ? (
          <div className="space-y-1">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-1.5 px-3 rounded-xl bg-white/5">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white">{member.name}</span>
                  {member.sessionCount > 0 && (
                    <span className="text-xs text-gray-500 ml-2">{member.sessionCount} session{member.sessionCount !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveMember(member)}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                  aria-label={`Remove ${member.name}`}
                >
                  <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
        </>)}
      </div>

      {/* Aliases */}
      <AliasesPanel />
    </div>
  );
}

/* ─────────────────────────── Aliases Panel ─────────────────────────── */

function AliasesPanel() {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);
  const [appName, setAppName] = useState('');
  const [etransferName, setEtransferName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAppName, setEditAppName] = useState('');
  const [editEtransferName, setEditEtransferName] = useState('');
  const [editError, setEditError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAliases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/aliases`, { cache: 'no-store' });
      if (res.ok) setAliases(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAliases(); }, [loadAliases]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!appName.trim() || !etransferName.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName: appName.trim(), etransferName: etransferName.trim() }),
      });
      if (res.ok) {
        setAppName('');
        setEtransferName('');
        await loadAliases();
      } else {
        const d = await res.json();
        setAddError(d.error ?? 'Failed to add alias');
      }
    } catch {
      setAddError('Network error');
    } finally {
      setAdding(false);
    }
  }

  function startEdit(alias: Alias) {
    setEditingId(alias.id);
    setEditAppName(alias.appName);
    setEditEtransferName(alias.etransferName);
    setEditError('');
  }

  async function handleSaveEdit(id: string) {
    setEditError('');
    try {
      const res = await fetch(`${BASE}/api/aliases`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, appName: editAppName.trim(), etransferName: editEtransferName.trim() }),
      });
      if (res.ok) {
        setEditingId(null);
        await loadAliases();
      } else {
        const d = await res.json();
        setEditError(d.error ?? 'Failed to save');
      }
    } catch {
      setEditError('Network error');
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${BASE}/api/aliases`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await loadAliases();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24">
        <span className="material-icons icon-spin-lg animate-spin text-green-400">refresh</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="glass-card p-5 space-y-3">
        <p className="section-label">ADD ALIAS</p>
        <p className="text-xs text-gray-400">Link each player's app name to their e-transfer name for payment tracking.</p>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="App name (e.g. Jon)"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              maxLength={50}
              required
              className="flex-1"
            />
            <input
              type="text"
              placeholder="E-transfer name (e.g. Jonathan Smith)"
              value={etransferName}
              onChange={(e) => setEtransferName(e.target.value)}
              maxLength={50}
              required
              className="flex-1"
            />
          </div>
          {addError && <p className="text-red-400 text-xs">{addError}</p>}
          <button type="submit" disabled={adding} className="btn-primary w-full">
            {adding ? 'Adding…' : 'Add Alias'}
          </button>
        </form>
      </div>

      {/* Alias list */}
      {aliases.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="list-header-green px-4 pt-3 pb-2">
            {aliases.length} alias{aliases.length !== 1 ? 'es' : ''}
          </div>
          <div className="divide-y divide-white/5">
            {aliases.map((alias) =>
              editingId === alias.id ? (
                <div key={alias.id} className="px-4 py-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editAppName}
                      onChange={(e) => setEditAppName(e.target.value)}
                      maxLength={50}
                      className="flex-1 text-sm"
                    />
                    <input
                      type="text"
                      value={editEtransferName}
                      onChange={(e) => setEditEtransferName(e.target.value)}
                      maxLength={50}
                      className="flex-1 text-sm"
                    />
                  </div>
                  {editError && <p className="text-red-400 text-xs">{editError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => handleSaveEdit(alias.id)} className="btn-primary text-xs px-3 py-1.5">Save</button>
                    <button onClick={() => setEditingId(null)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={alias.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-sm font-medium text-white flex-1">{alias.appName}</span>
                  <span className="material-icons icon-sm text-gray-500">arrow_back</span>
                  <span className="text-sm text-gray-300 flex-1">{alias.etransferName}</span>
                  <button onClick={() => startEdit(alias)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Edit</button>
                  <button
                    onClick={() => handleDelete(alias.id)}
                    disabled={deletingId === alias.id}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    {deletingId === alias.id ? '…' : 'Delete'}
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {aliases.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">No aliases yet.</p>
      )}
    </div>
  );
}
