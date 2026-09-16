'use client';

import { useEffect, useState, useCallback } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import EmptyState from '@/components/primitives/EmptyState';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import CardHeader from '@/components/primitives/CardHeader';

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
  /* 'failed' and 'refused' are NOT "no recipient". Rendering "Not set" off a
     dead fetch was a lying empty state, and its "Add recipient" button opened a
     blank form whose Save would PATCH over the real recipient. While either is
     set, neither the details nor the Edit button render. */
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'refused'>('ok');

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
      if (res.status === 401 || res.status === 403) {
        setLoadState('refused');
        return;
      }
      if (!res.ok) {
        setLoadState('failed');
        return;
      }
      const data = (await res.json()) as { eTransferRecipient?: Recipient | null };
      setRecipient(data.eTransferRecipient ?? null);
      setLoadState('ok');
    } catch {
      setLoadState('failed');
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

  // A failed load tints the whole card (StateCard) and hides its controls, so
  // nothing is written against data that did not load.
  if (loadState === 'failed') {
    return (
      <StateCard
        tone="danger"
        icon="payments"
        title="E-transfer recipient"
        subtitle="Used by the Share cost button on the Next Session card."
        message={<>Couldn&apos;t load your e-transfer recipient. <StateLink onClick={() => void load()}>Try again</StateLink></>}
      >
        <PreviewRow width="40%" value="" />
        <PreviewRow width="58%" value="" />
      </StateCard>
    );
  }

  return (
    <section className="glass-card p-4 space-y-3 motion-fade" aria-label="E-transfer recipient">
      <CardHeader
        icon="payments"
        title="E-transfer recipient"
        subtitle="Used by the Share cost button on the Next Session card."
      />

      {loadState === 'refused' && (
        <EmptyState
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          }
        >
          Sign in as an admin to see the e-transfer recipient.
        </EmptyState>
      )}

      {loadState === 'ok' && !editing && (
        <>
          {recipient ? (
            <div className="fs-md space-y-1">
              <p>
                <span className="text-gray-400 fs-sm">Name </span>
                <span>{recipient.name}</span>
              </p>
              <p>
                <span className="text-gray-400 fs-sm">Email </span>
                <span className="font-mono fs-sm">{recipient.email}</span>
              </p>
              <p>
                <span className="text-gray-400 fs-sm">Memo </span>
                <span className="font-mono fs-sm">{recipient.memo ?? DEFAULT_MEMO}</span>
              </p>
            </div>
          ) : (
            <p className="fs-md text-gray-400">
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

      {loadState === 'ok' && editing && (
        <div className="space-y-3">
          <Field label="Name">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={100}
              placeholder="Your name (as shown to senders)"
              className="w-full fs-md rounded-lg p-2"
              style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              maxLength={200}
              placeholder="e-transfer recipient address"
              className="w-full fs-md rounded-lg p-2 font-mono"
              style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
            />
          </Field>
          <Field label="Memo template (optional)">
            <input
              type="text"
              value={draftMemo}
              onChange={(e) => setDraftMemo(e.target.value)}
              maxLength={200}
              placeholder={DEFAULT_MEMO}
              className="w-full fs-md rounded-lg p-2 font-mono"
              style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
            />
            <p className="fs-sm text-gray-500 mt-1">
              Use <code>{'{date}'}</code> for the session date and <code>{'{name}'}</code> for the player name.
            </p>
          </Field>

          {error && <p className="field-error" role="alert">{error}</p>}

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
      <label className="fs-sm text-gray-400">{label}</label>
      {children}
    </div>
  );
}
