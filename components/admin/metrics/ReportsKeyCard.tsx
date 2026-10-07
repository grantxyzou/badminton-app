'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Status {
  configured: boolean;
  keyCreatedAt: string | null;
  lastUsedAt: string | null;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/**
 * The weekly-report key (docs/plans/usage-metrics.md): a read-only secret the
 * scheduled report helper sends to read these same totals. Shown once, at
 * creation; the server keeps only its hash. "Last used" is how the admin can
 * tell the helper is actually reading.
 */
export default function ReportsKeyCard() {
  const online = useOnline();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/reports/key`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint() {
    if (status?.configured && !window.confirm('A new key stops the old one working. The report helper will need the new key. Continue?')) return;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const res = await fetch(`${BASE}/api/admin/reports/key`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      setKey(((await res.json()) as { key: string }).key);
      void load();
    } catch {
      setError("Couldn't create a key — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(key ?? '');
      setCopied(true);
    } catch {
      setError("Couldn't copy — long-press the key to select it.");
    }
  }

  const caption = { margin: '0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' } as const;

  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label="Weekly report key">
      <CardHeader icon="key" title="Weekly report key" subtitle="Lets the report helper read these totals" />
      {loadError && !status ? (
        <ErrorState
          message="Couldn't load the key status."
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          }
        />
      ) : (
        <>
          <p style={caption}>
            {status === null
              ? ' '
              : status.configured
                ? `Created ${when(status.keyCreatedAt)}. ${status.lastUsedAt ? `Last used ${when(status.lastUsedAt)}.` : 'Not used yet.'}`
                : 'No key yet. It reads totals only — never names — and can be replaced at any time.'}
          </p>
          {key ? (
            <div className="inner-card flex flex-col gap-2" style={{ padding: 'var(--space-3)' }}>
              <code className="fs-sm" style={{ wordBreak: 'break-all', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {key}
              </code>
              <p style={caption}>
                Shown once. Add it to the report helper&apos;s environment as <code>BPM_REPORTS_KEY</code> — never paste
                it into a chat.
              </p>
              <button type="button" className="cc-btn cc-btn-secondary" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy key'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="cc-btn cc-btn-secondary"
              disabled={busy || !online || status === null}
              onClick={() => void mint()}
            >
              {status?.configured ? 'Create a new key' : 'Create key'}
            </button>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
