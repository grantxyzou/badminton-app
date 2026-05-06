'use client';

import { useEffect, useState, useCallback } from 'react';
import { renderMarkdown } from '@/lib/miniMarkdown';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Announcement {
  id: string;
  text: string;
  time: string;
}

interface AnnouncementsCardProps {
  refreshKey?: number;
}

export default function AnnouncementsCard({ refreshKey = 0 }: AnnouncementsCardProps) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/announcements`, { cache: 'no-store' });
      if (res.ok) setItems(await res.json());
    } catch {
      // Silent — show no items.
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function handlePost() {
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setDraft('');
        setComposing(false);
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to post');
      }
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return;
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) await load();
    } catch {
      // ignore
    }
  }

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Announcements">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="bpm-h3">Announcements</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {items.length === 0 ? 'No announcements posted' : `${items.length} posted`}
          </p>
        </div>
        {!composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="text-xs px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            Compose
          </button>
        )}
      </header>

      {composing && (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your announcement…"
            rows={3}
            maxLength={800}
            className="w-full text-sm rounded-lg p-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
          />
          {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setComposing(false); setDraft(''); setError(''); }}
              className="text-xs px-3 py-1.5 rounded-full text-gray-300"
              disabled={posting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePost}
              disabled={posting || !draft.trim()}
              className="text-xs px-3 py-1.5 rounded-full disabled:opacity-50"
              style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac' }}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-2" role="list">
          {items.map((a) => (
            <li
              key={a.id}
              className="rounded-lg p-3 text-sm leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <div className="announcement-body">{renderMarkdown(a.text)}</div>
              <div className="flex items-center justify-between mt-2">
                <time className="text-xs text-gray-400">
                  {new Date(a.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </time>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  className="text-xs text-gray-400 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
