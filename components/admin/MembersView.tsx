'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Member, Alias } from '@/lib/types';
import { ShimmerLoader } from '../ShuttleLoader';
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

export default function MembersView({ onBack }: { onBack: () => void }) {
  // Members state
  const [members, setMembers] = useState<Member[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [inviteCollapsed, setInviteCollapsed] = useState(false);
  const [membersLoading, setMembersLoading] = useState(true);

  // Aliases state
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [aliasesLoading, setAliasesLoading] = useState(true);
  const [appName, setAppName] = useState('');
  const [etransferName, setEtransferName] = useState('');
  const [aliasAdding, setAliasAdding] = useState(false);
  const [aliasAddError, setAliasAddError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAppName, setEditAppName] = useState('');
  const [editEtransferName, setEditEtransferName] = useState('');
  const [editError, setEditError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/members`, { cache: 'no-store' });
      if (res.ok) setMembers(await res.json());
    } finally {
      setMembersLoading(false);
    }
  }, []);

  const loadAliases = useCallback(async () => {
    setAliasesLoading(true);
    try {
      const res = await fetch(`${BASE}/api/aliases`, { cache: 'no-store' });
      if (res.ok) setAliases(await res.json());
    } catch {
      /* ignore */
    } finally {
      setAliasesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
    loadAliases();
  }, [loadMembers, loadAliases]);

  // Member handlers
  async function handleAddMember() {
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

  async function handleToggleRole(member: Member) {
    const newRole = (member.role ?? 'member') === 'admin' ? 'member' : 'admin';
    await fetch(`${BASE}/api/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: member.id, role: newRole }),
    });
    loadMembers();
  }

  // Alias handlers
  async function handleAddAlias(e: React.FormEvent) {
    e.preventDefault();
    if (!appName.trim() || !etransferName.trim()) return;
    setAliasAdding(true);
    setAliasAddError('');
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
        setAliasAddError(d.error ?? 'Failed to add alias');
      }
    } catch {
      setAliasAddError('Network error');
    } finally {
      setAliasAdding(false);
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

  async function handleDeleteAlias(id: string) {
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

  return (
    <div className="animate-slideInRight space-y-4">
      <AdminBackHeader onBack={onBack} title="Members & Invites" />

      {/* Invite List */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-label">INVITE LIST</p>
            {inviteCollapsed && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{members.length} member{members.length !== 1 ? 's' : ''}</p>}
          </div>
          <button
            type="button"
            onClick={() => setInviteCollapsed(c => !c)}
            aria-label={inviteCollapsed ? 'Expand invite list' : 'Collapse invite list'}
            className="bg-transparent border-0 cursor-pointer p-0 flex items-center"
            style={{ color: 'var(--accent)', opacity: 0.65 }}
          >
            <span className="material-icons icon-md">{inviteCollapsed ? 'expand_more' : 'expand_less'}</span>
          </button>
        </div>
        {!inviteCollapsed && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Only people on this list can sign up. Leave empty to allow anyone.</p>}
        {!inviteCollapsed && (<>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add a name..."
              value={nameInput}
              onChange={(e) => { setNameInput(e.target.value); setAddError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddMember(); } }}
              maxLength={50}
              className="flex-1"
            />
            <button
              type="button"
              className="btn-ghost px-4 shrink-0"
              onClick={handleAddMember}
              disabled={adding}
              style={{ minHeight: 44 }}
            >
              {adding ? '...' : 'Add'}
            </button>
          </div>
          {addError && <p className="text-red-400 text-xs" role="alert">{addError}</p>}
          {membersLoading ? (
            <ShimmerLoader lines={3} />
          ) : members.length > 0 ? (
            <div className="space-y-1">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between py-1.5 px-3 rounded-xl bg-white/5">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{member.name}</span>
                    {member.sessionCount > 0 && (
                      <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{member.sessionCount} session{member.sessionCount !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleRole(member)}
                    className="transition-colors mr-1"
                    style={{ color: (member.role ?? 'member') === 'admin' ? 'var(--accent)' : 'var(--text-muted)', minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    aria-label={`${(member.role ?? 'member') === 'admin' ? 'Remove admin role from' : 'Make admin'} ${member.name}`}
                    title={(member.role ?? 'member') === 'admin' ? 'Admin' : 'Make admin'}
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>shield</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member)}
                    className="hover:text-red-400 transition-colors"
                    style={{ color: 'var(--text-muted)', minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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

      {/* Alias list */}
      {aliasesLoading ? (
        <ShimmerLoader lines={3} />
      ) : aliases.length > 0 ? (
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
                  {editError && <p className="text-red-400 text-xs" role="alert">{editError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => handleSaveEdit(alias.id)} className="btn-primary text-xs px-3 py-1.5" style={{ minHeight: 44 }}>Save</button>
                    <button onClick={() => setEditingId(null)} className="btn-ghost text-xs px-3 py-1.5" style={{ minHeight: 44 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={alias.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{alias.appName}</span>
                  <span className="material-icons icon-sm" style={{ color: 'var(--text-muted)' }}>arrow_back</span>
                  <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{alias.etransferName}</span>
                  <button onClick={() => startEdit(alias)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>Edit</button>
                  {confirmingDeleteId === alias.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span style={{ color: 'var(--text-muted)' }}>Delete?</span>
                      <button
                        onClick={() => { handleDeleteAlias(alias.id); setConfirmingDeleteId(null); }}
                        disabled={deletingId === alias.id}
                        className="text-red-400 hover:text-red-300 transition-colors px-2 py-1"
                        style={{ minHeight: 32 }}
                      >
                        {deletingId === alias.id ? '...' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(null)}
                        className="transition-colors px-2 py-1"
                        style={{ color: 'var(--text-muted)', minHeight: 32 }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDeleteId(alias.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>No aliases yet — add one to map names for e-transfer.</p>
      )}

      {/* Add alias form — below the list so the submit button is in the
          thumb zone for one-handed use. */}
      <div className="glass-card p-5 space-y-3">
        <p className="section-label">ADD ALIAS</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Link each player's app name to their e-transfer name for payment tracking.</p>
        <form onSubmit={handleAddAlias} className="space-y-3">
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
          {aliasAddError && <p className="text-red-400 text-xs" role="alert">{aliasAddError}</p>}
          <button type="submit" disabled={aliasAdding} className="btn-primary w-full" style={{ minHeight: 44 }}>
            {aliasAdding ? 'Adding...' : 'Add Alias'}
          </button>
        </form>
      </div>
    </div>
  );
}
