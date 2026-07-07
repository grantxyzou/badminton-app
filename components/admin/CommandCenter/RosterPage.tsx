'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ResetAccessSheet from '../ResetAccessSheet';
import { fmtShortDate } from '@/lib/fmt';
import { avatarColors } from '@/lib/avatar';
import type { Member, Alias } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface RosterPageProps {
  onBack: () => void;
}

interface RowData {
  member: Member;
  presence: Array<1 | null>;     // length-8 sparkline, 1 = attended that session
  recentCount: number;            // sum of presence
  lastSession: string | null;     // YYYY-MM-DD of most recent session attended
  status: 'regular' | 'casual' | 'dormant';
  hasAlias: boolean;
  isYou: boolean;
}

type FilterKey = 'all' | 'recent' | 'regulars' | 'casual' | 'dormant';

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const c = avatarColors(name);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: c.bg,
        color: c.fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display, "Space Grotesk")',
        fontWeight: 600,
        fontSize: size * 0.42,
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Sparkline({ presence }: { presence: Array<1 | null> }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {presence.map((v, i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 2,
            background: v === 1 ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
          }}
        />
      ))}
    </span>
  );
}


export default function RosterPage({ onBack }: RosterPageProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [presence, setPresence] = useState<Map<string, Array<1 | null>>>(new Map());
  const [lastSessions, setLastSessions] = useState<Map<string, string>>(new Map());
  const [adminName, setAdminName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  // SSR-safe portal mount guard
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState<'member' | 'admin'>('member');
  const [formActive, setFormActive] = useState(true);
  const [formAlias, setFormAlias] = useState('');
  const [savingForm, setSavingForm] = useState(false);
  const [deletingForm, setDeletingForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [resettingPin, setResettingPin] = useState(false);
  // Reset-access code sheet — issued against the member by name, so it works
  // for anyone in the roster whether or not they're signed up this week.
  const [resetSheet, setResetSheet] = useState<{
    open: boolean; playerName: string; code: string; expiresAt: number;
  }>({ open: false, playerName: '', code: '', expiresAt: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, aliasesRes, recentRes, adminRes] = await Promise.all([
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
        fetch(`${BASE}/api/aliases`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions/recent?limit=8`, { cache: 'no-store' }),
        fetch(`${BASE}/api/admin`, { cache: 'no-store' }),
      ]);
      const m = membersRes.ok ? await membersRes.json() as Member[] : [];
      const a = aliasesRes.ok ? await aliasesRes.json() as Alias[] : [];
      const recent = recentRes.ok ? await recentRes.json() as Array<{ sessionId: string; date: string }> : [];
      const adminInfo = adminRes.ok ? await adminRes.json() as { authed?: boolean; name?: string } : null;
      setMembers(Array.isArray(m) ? m : []);
      setAliases(Array.isArray(a) ? a : []);
      setAdminName(adminInfo?.authed && typeof adminInfo.name === 'string' ? adminInfo.name : null);

      // Recent sessions sorted newest first; pad to 8 slots if fewer.
      const sorted = [...recent].sort((x, y) => (x.sessionId < y.sessionId ? 1 : -1)).slice(0, 8);

      // Fetch players for each recent session in parallel.
      const playersBySession = await Promise.all(
        sorted.map(async (s) => {
          const r = await fetch(`${BASE}/api/players?sessionId=${encodeURIComponent(s.sessionId)}&all=true`, { cache: 'no-store' });
          if (!r.ok) return { sessionId: s.sessionId, date: s.date, players: [] as Array<{ memberId?: string; removed?: boolean; waitlisted?: boolean; name?: string }> };
          const p = await r.json();
          return { sessionId: s.sessionId, date: s.date, players: Array.isArray(p) ? p : [] };
        })
      );

      const map = new Map<string, Array<1 | null>>();
      const lastMap = new Map<string, string>();
      // Build a name→id lookup for fallback when memberId is missing.
      const nameToId = new Map<string, string>();
      for (const member of m) nameToId.set(member.name.toLowerCase(), member.id);

      // Layout: presence[i] corresponds to sorted[i]. Index 0 = newest.
      // Pad to length 8.
      for (const member of m) {
        const arr: Array<1 | null> = Array.from({ length: 8 }, () => null);
        let mostRecent: string | null = null;
        for (let i = 0; i < sorted.length; i++) {
          const slotPlayers = playersBySession[i].players;
          const matched = slotPlayers.some((p) => {
            if (p.removed === true) return false;
            if (p.memberId === member.id) return true;
            if (!p.memberId && typeof p.name === 'string' && p.name.toLowerCase() === member.name.toLowerCase()) return true;
            return false;
          });
          if (matched) {
            arr[i] = 1;
            if (!mostRecent && playersBySession[i].date) mostRecent = playersBySession[i].date;
          }
        }
        // Reverse so the oldest sits leftmost — matches how sparklines feel "left to right".
        map.set(member.id, arr.slice().reverse());
        if (mostRecent) lastMap.set(member.id, mostRecent);
      }
      setPresence(map);
      setLastSessions(lastMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const aliasNamesLower = useMemo(() => {
    const set = new Set<string>();
    for (const a of aliases) {
      if (a.appName) set.add(a.appName.toLowerCase());
    }
    return set;
  }, [aliases]);

  const rows = useMemo<RowData[]>(() => {
    return members.filter((m) => m.active !== false).map((m) => {
      const p = presence.get(m.id) ?? Array.from({ length: 8 }, () => null);
      const recentCount = p.filter((v) => v === 1).length;
      const status: RowData['status'] =
        recentCount >= 5 ? 'regular' : recentCount >= 1 ? 'casual' : 'dormant';
      const hasAlias = aliasNamesLower.has(m.name.toLowerCase());
      const isYou = adminName !== null && m.name.toLowerCase() === adminName.toLowerCase();
      return {
        member: m,
        presence: p,
        recentCount,
        lastSession: lastSessions.get(m.id) ?? null,
        status,
        hasAlias,
        isYou,
      };
    });
  }, [members, presence, aliasNamesLower, adminName, lastSessions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.member.name.toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      if (filter === 'recent') return r.recentCount > 0;
      if (filter === 'regulars') return r.status === 'regular';
      if (filter === 'casual') return r.status === 'casual';
      if (filter === 'dormant') return r.status === 'dormant';
      return true;
    }).sort((a, b) => a.member.name.localeCompare(b.member.name));
  }, [rows, search, filter]);

  const counts = useMemo(() => {
    const c = { all: rows.length, recent: 0, regulars: 0, casual: 0, dormant: 0 };
    for (const r of rows) {
      if (r.recentCount > 0) c.recent++;
      if (r.status === 'regular') c.regulars++;
      if (r.status === 'casual') c.casual++;
      if (r.status === 'dormant') c.dormant++;
    }
    return c;
  }, [rows]);

  const groups = useMemo(() => {
    const g = new Map<string, RowData[]>();
    for (const r of filtered) {
      const k = r.member.name[0]?.toUpperCase() ?? '?';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    }
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  /* ── Sheet handlers ── */
  function openAddSheet() {
    setEditingId(null);
    setFormName('');
    setFormRole('member');
    setFormActive(true);
    setFormAlias('');
    setFormError('');
    setSheetOpen(true);
  }

  function openEditSheet(r: RowData) {
    setEditingId(r.member.id);
    setFormName(r.member.name);
    setFormRole(r.member.role === 'admin' ? 'admin' : 'member');
    setFormActive(r.member.active !== false);
    const alias = aliases.find((a) => a.appName.toLowerCase() === r.member.name.toLowerCase());
    setFormAlias(alias?.etransferName ?? '');
    setFormError('');
    setSheetOpen(true);
  }

  async function handleSave() {
    const name = formName.trim();
    if (!name) { setFormError('Name required.'); return; }

    setSavingForm(true);
    setFormError('');
    try {
      if (editingId) {
        // PATCH the member
        const res = await fetch(`${BASE}/api/members`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, name, role: formRole, active: formActive }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setFormError(data.error ?? 'Failed to save.');
          return;
        }
        // Sync alias: if formAlias non-empty, ensure an alias row exists; if
        // empty, delete it. Aliases are payment-data (CLAUDE.md security
        // rule 10) — failed writes here cause receipts to go to the wrong
        // person, so we surface the error rather than fire-and-forget.
        const existing = aliases.find((a) => a.appName.toLowerCase() === name.toLowerCase());
        const aliasValue = formAlias.trim();
        let aliasOk = true;
        if (aliasValue && !existing) {
          const r = await fetch(`${BASE}/api/aliases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appName: name, etransferName: aliasValue }),
          });
          aliasOk = r.ok;
        } else if (aliasValue && existing && existing.etransferName !== aliasValue) {
          const r = await fetch(`${BASE}/api/aliases`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: existing.id, appName: name, etransferName: aliasValue }),
          });
          aliasOk = r.ok;
        } else if (!aliasValue && existing) {
          const r = await fetch(`${BASE}/api/aliases`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: existing.id }),
          });
          aliasOk = r.ok;
        }
        if (!aliasOk) {
          setFormError('Saved member, but alias update failed — please retry.');
          await load();
          return;
        }
      } else {
        // POST new member
        const res = await fetch(`${BASE}/api/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setFormError(data.error ?? 'Failed to add.');
          return;
        }
        // Optional: also save alias on creation. Same payment-data rules.
        const aliasValue = formAlias.trim();
        if (aliasValue) {
          const r = await fetch(`${BASE}/api/aliases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appName: name, etransferName: aliasValue }),
          });
          if (!r.ok) {
            setFormError('Member added, but alias save failed — please add it from the edit sheet.');
            await load();
            return;
          }
        }
      }
      setSheetOpen(false);
      await load();
    } catch {
      setFormError('Network error.');
    } finally {
      setSavingForm(false);
    }
  }

  async function handleResetPin() {
    const name = formName.trim();
    if (!name) { setFormError('Name required.'); return; }
    if (!confirm(`Generate a PIN-reset code for ${name}?\n\nThey can use it to set a new PIN — no need to be signed up. The code expires in 15 minutes.`)) return;
    setResettingPin(true);
    setFormError('');
    try {
      const res = await fetch(`${BASE}/api/players/reset-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error ?? `Failed to generate code (${res.status}).`);
        return;
      }
      const body = await res.json();
      setSheetOpen(false);
      setResetSheet({ open: true, playerName: name, code: body.code, expiresAt: body.expiresAt });
    } catch {
      setFormError('Network error.');
    } finally {
      setResettingPin(false);
    }
  }

  async function handleDeactivate() {
    if (!editingId) return;
    if (!confirm('Mark this member inactive? They can be reactivated later by re-adding them.')) return;
    setDeletingForm(true);
    setFormError('');
    try {
      const res = await fetch(`${BASE}/api/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error ?? 'Failed to deactivate.');
        return;
      }
      setSheetOpen(false);
      await load();
    } catch {
      setFormError('Network error.');
    } finally {
      setDeletingForm(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={onBack} title="Roster" />
        <AdminPageSkeleton />
      </div>
    );
  }

  const chipDefs: Array<[FilterKey, string, number]> = [
    ['all', 'All', counts.all],
    ['recent', 'Recent', counts.recent],
    ['regulars', 'Regulars', counts.regulars],
    ['casual', 'Casual', counts.casual],
    ['dormant', 'Dormant', counts.dormant],
  ];

  return (
    <div className="animate-slideInRight" style={{ position: 'relative', minHeight: '60vh' }}>
      <AdminBackHeader onBack={onBack} title="Roster" />

      {/* Search */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 'var(--radius-lg)',
          color: 'var(--text-muted)',
        }}
      >
        <span className="material-icons" style={{ fontSize: 18 }}>search</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${rows.length} ${rows.length === 1 ? 'person' : 'people'}…`}
          style={{
            flex: 1,
            background: 'transparent',
            border: 0,
            outline: 0,
            color: 'var(--text-primary)',
            fontSize: 13.5,
          }}
        />
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 6px' }}>
        {chipDefs.map(([k, label, count]) => {
          const on = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 11px',
                borderRadius: 'var(--radius-pill)',
                background: on ? 'rgba(74,222,128,0.13)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${on ? 'rgba(74,222,128,0.35)' : 'rgba(255,255,255,0.12)'}`,
                fontFamily: 'var(--font-display, "Space Grotesk")',
                fontSize: 11.5,
                fontWeight: 500,
                color: on ? '#c5f5d3' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {label}
              <span
                style={{
                  fontFamily: 'var(--font-mono, "JetBrains Mono")',
                  fontSize: 'var(--fs-2xs)',
                  marginLeft: 2,
                  color: on ? '#86efac' : 'var(--ink-faint)',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Groups */}
      <div style={{ margin: '12px -16px 0' }}>
        {groups.length === 0 && (
          <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>
            No matches.
          </p>
        )}
        {groups.map(([letter, people]) => (
          <div key={letter}>
            <div
              style={{
                padding: '10px 24px 4px',
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                position: 'sticky',
                top: 0,
                background: 'rgba(16,15,15,0.85)',
                backdropFilter: 'blur(10px)',
                zIndex: 1,
              }}
            >
              <span style={{ fontFamily: 'var(--font-display, "Space Grotesk")', fontSize: 'var(--fs-base)', fontWeight: 700 }}>{letter}</span>
              <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono")', fontSize: 'var(--fs-2xs)', color: 'var(--ink-faint)' }}>{people.length}</span>
            </div>
            {people.map((r) => (
              <button
                key={r.member.id}
                type="button"
                onClick={() => openEditSheet(r)}
                style={{
                  display: 'flex',
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: '10px 24px',
                  alignItems: 'center',
                  gap: 12,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                aria-label={`Edit ${r.member.name}`}
              >
                <Avatar name={r.member.name} />
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-display, "Space Grotesk")',
                        fontSize: 'var(--fs-md)',
                        fontWeight: 600,
                        color: r.status === 'dormant' ? 'var(--text-muted)' : 'var(--text-primary)',
                      }}
                    >
                      {r.member.name}
                    </span>
                    {r.isYou && (
                      <span
                        style={{
                          background: 'rgba(74,222,128,0.13)',
                          color: '#86efac',
                          border: '1px solid rgba(74,222,128,0.25)',
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                        }}
                      >
                        YOU
                      </span>
                    )}
                    {r.member.role === 'admin' && !r.isYou && (
                      <span
                        style={{
                          background: 'rgba(167,139,250,0.13)',
                          color: '#a78bfa',
                          border: '1px solid rgba(167,139,250,0.28)',
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                        }}
                      >
                        ADMIN
                      </span>
                    )}
                    {r.hasAlias && (
                      <span className="material-icons" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-faint)' }} title="E-transfer alias linked">
                        article_person
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontFamily: 'var(--font-mono, "JetBrains Mono")',
                      fontSize: 'var(--fs-2xs)',
                      color: 'var(--ink-faint)',
                    }}
                  >
                    <Sparkline presence={r.presence} />
                    {r.recentCount > 0 ? (
                      <span>
                        {r.recentCount} ses{r.lastSession ? ` · ${fmtShortDate(r.lastSession)}` : ''}
                      </span>
                    ) : (
                      <span>never played</span>
                    )}
                  </div>
                </div>
                <span className="material-icons" style={{ fontSize: 18, color: 'var(--ink-faint)' }}>more_vert</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* FAB — add new member. Rendered via portal so the page-level
          translateX animation (which creates a containing block) doesn't
          turn `position: fixed` into "scrolls with the page". */}
      {portalReady && createPortal(
        <button
          type="button"
          onClick={openAddSheet}
          aria-label="Add member"
          style={{
            position: 'fixed',
            // 96px clears the bottom nav (~68px) + breathing room. Add the
            // iOS home-indicator inset so devices with a home bar don't
            // clip the FAB. Closes #61.
            bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
            right: 22,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: '#0a1f10',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 28px rgba(74,222,128,0.4), 0 2px 6px rgba(0,0,0,0.4)',
            border: 0,
            cursor: 'pointer',
            zIndex: 6,
          }}
        >
          <span className="material-icons" style={{ fontSize: 26 }}>person_add</span>
        </button>,
        document.body,
      )}

      {/* Add / Edit sheet */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        ariaLabel={editingId ? 'Edit member' : 'Add member'}
        maxHeight="80vh"
        className="max-w-sm mx-auto"
      >
        <BottomSheetHeader className="flex items-center justify-between p-4">
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{editingId ? 'Edit member' : 'Add member'}</span>
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
          </button>
        </BottomSheetHeader>

        <BottomSheetBody className="p-5 pb-8">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Name">
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                maxLength={50}
                placeholder="Player name"
              />
            </Field>

            <Field label="E-transfer alias (optional)">
              <input
                type="text"
                value={formAlias}
                onChange={(e) => setFormAlias(e.target.value)}
                maxLength={100}
                placeholder="Name on e-transfers, if different"
              />
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Used to match incoming payments when the e-transfer name doesn&apos;t match the in-app name.
              </p>
            </Field>

            {editingId && (
              <>
                <Field label="Role">
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    {(['member', 'admin'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setFormRole(r)}
                        className={formRole === r ? 'cc-btn cc-btn-primary' : 'cc-btn cc-btn-secondary'}
                      >
                        {r === 'member' ? 'Member' : 'Admin'}
                      </button>
                    ))}
                  </div>
                </Field>

                <label className="cc-checkbox">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                  />
                  <span>Active</span>
                </label>

                <Field label="PIN reset">
                  <button
                    type="button"
                    onClick={handleResetPin}
                    disabled={savingForm || deletingForm || resettingPin}
                    className="cc-btn cc-btn-secondary"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {resettingPin ? 'Generating…' : 'Generate reset code'}
                  </button>
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    For a player who forgot their PIN. Give them the code — they enter it under
                    Profile → &ldquo;Have a recovery code?&rdquo; to set a new PIN. No signup needed.
                  </p>
                </Field>
              </>
            )}

            {formError && (
              <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: 0 }}>
                {formError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {editingId && (
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={savingForm || deletingForm}
                  className="cc-btn cc-btn-danger"
                  aria-label="Mark inactive"
                >
                  {deletingForm ? 'Removing…' : 'Deactivate'}
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="cc-btn cc-btn-ghost"
                disabled={savingForm || deletingForm}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="cc-btn cc-btn-primary"
                disabled={savingForm || deletingForm}
                style={{ minWidth: 100 }}
              >
                {savingForm ? 'Saving…' : editingId ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </BottomSheetBody>
      </BottomSheet>

      <ResetAccessSheet
        open={resetSheet.open}
        onClose={() => setResetSheet((r) => ({ ...r, open: false }))}
        playerName={resetSheet.playerName}
        code={resetSheet.code}
        expiresAt={resetSheet.expiresAt}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
