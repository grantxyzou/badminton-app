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

export default function ReleasesView({ onBack }: Props) {
  const t = useTranslations('admin.releases');
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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

      {showForm ? (
        <ReleaseForm
          latestVersion={releases[0]?.version}
          onPublished={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setShowForm(true)}
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
                    <p className="text-xs text-gray-400">{new Date(r.publishedAt).toLocaleDateString()}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="text-red-400 text-xs"
                    aria-label={`Delete ${r.version}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
