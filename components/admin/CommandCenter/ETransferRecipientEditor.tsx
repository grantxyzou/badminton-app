'use client';

import { useEffect, useState, useCallback } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Recipient {
  name: string;
  email: string;
  memo?: string;
}

const DEFAULT_MEMO = 'BPM {date} - {name}';

export default function ETransferRecipientEditor() {
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  // Edit-form state
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftMemo, setDraftMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { eTransferRecipient?: Recipient | null };
        setRecipient(data.eTransferRecipient ?? null);
      }
    } catch {
      // ignore — null state renders the empty-state copy
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function startEdit() {
    setDraftName(recipient?.name ?? '');
    setDraftEmail(recipient?.email ?? '');
    setDraftMemo(recipient?.memo ?? DEFAULT_MEMO);
    setError('');
    setEditing(true);
  }

  async function save() {
    const name = draftName.trim();
    const email = draftEmail.trim();
    const memo = draftMemo.trim();

    if (!name) {
      setError('Name is required.');
      return;
    }
    if (!email || !email.includes('@')) {
      setError('Valid email is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const body: { eTransferRecipient: Recipient } = {
        eTransferRecipient: {
          name,
          email,
          ...(memo ? { memo } : {}),
        },
      };
      const res = await fetch(`${BASE}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to save.');
        return;
      }
      setRecipient(body.eTransferRecipient);
      setEditing(false);
    } catch {
      setError('Network error.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CardSkeleton height={120} />;

  return (
    <section className="glass-card p-4 space-y-3" aria-label="E-transfer recipient">
      <header>
        <h3 className="bpm-h3">E-transfer recipient</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Used by the Share cost button on the Next Session card.
        </p>
      </header>

      {!editing && (
        <>
          {recipient ? (
            <div className="text-sm space-y-1">
              <p>
                <span className="text-gray-400 text-xs">Name </span>
                <span>{recipient.name}</span>
              </p>
              <p>
                <span className="text-gray-400 text-xs">Email </span>
                <span className="font-mono text-xs">{recipient.email}</span>
              </p>
              <p>
                <span className="text-gray-400 text-xs">Memo </span>
                <span className="font-mono text-xs">{recipient.memo ?? DEFAULT_MEMO}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              Not set — add one to enable cost sharing.
            </p>
          )}
          <button
            type="button"
            onClick={startEdit}
            className="cc-btn cc-btn-secondary self-start"
          >
            {recipient ? 'Edit' : 'Add recipient'}
          </button>
        </>
      )}

      {editing && (
        <div className="space-y-3">
          <Field label="Name">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={100}
              placeholder="Your name (as shown to senders)"
              className="w-full text-sm rounded-lg p-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              maxLength={200}
              placeholder="e-transfer recipient address"
              className="w-full text-sm rounded-lg p-2 font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
          </Field>
          <Field label="Memo template (optional)">
            <input
              type="text"
              value={draftMemo}
              onChange={(e) => setDraftMemo(e.target.value)}
              maxLength={200}
              placeholder={DEFAULT_MEMO}
              className="w-full text-sm rounded-lg p-2 font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
            <p className="text-xs text-gray-500 mt-1">
              Use <code>{'{date}'}</code> for the session date and <code>{'{name}'}</code> for the player name.
            </p>
          </Field>

          {error && <p className="text-xs text-red-400" role="alert">{error}</p>}

          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setEditing(false); setError(''); }}
              className="cc-btn cc-btn-ghost"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="cc-btn cc-btn-primary"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-400">{label}</label>
      {children}
    </div>
  );
}
