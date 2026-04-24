'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from './AdminBackHeader';
import ReleaseForm from './ReleaseForm';
import type { Release } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface Props {
  onBack: () => void;
}

type FormMode = { kind: 'hidden' } | { kind: 'new' } | { kind: 'edit'; record: Release };

export default function ReleasesView({ onBack }: Props) {
  const t = useTranslations('admin.releases');
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormMode>({ kind: 'hidden' });
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/releases`, { cache: 'no-store' });
      if (res.ok) setReleases(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this release?')) return;
    try {
      const res = await fetch(`${BASE}/api/releases`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) load();
      else setError('Failed to delete');
    } catch {
      setError('Network error');
    }
  }

  return (
    <div className="space-y-4">
      <AdminBackHeader onBack={onBack} title="Releases" />

      {form.kind !== 'hidden' ? (
        <ReleaseForm
          latestVersion={releases[0]?.version}
          initialRecord={form.kind === 'edit' ? form.record : undefined}
          onPublished={() => { setForm({ kind: 'hidden' }); load(); }}
          onCancel={() => setForm({ kind: 'hidden' })}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setForm({ kind: 'new' })}
            className="btn-primary w-full"
          >
            {t('newButton')}
          </button>

          {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : releases.length === 0 ? (
            <p className="text-sm text-gray-400">No releases yet.</p>
          ) : (
            <ul className="space-y-2">
              {releases.map((r) => (
                <li key={r.id} className="glass-card p-3 flex justify-between items-start">
                  <div>
                    <p className="text-sm font-semibold text-white">{r.version} · {r.title.en}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(r.publishedAt).toLocaleDateString()}
                      {r.editedAt && <> · edited {new Date(r.editedAt).toLocaleDateString()}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setForm({ kind: 'edit', record: r })}
                      className="text-gray-300 hover:text-white"
                      style={{ minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      aria-label={`Edit ${r.version}`}
                      title="Edit"
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      className="text-red-400 hover:text-red-300"
                      style={{ minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      aria-label={`Delete ${r.version}`}
                      title="Delete"
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>delete</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
