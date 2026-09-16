'use client';

import { useEffect, useState, useCallback } from 'react';
import { renderMarkdown } from '@/lib/miniMarkdown';
import { useReportFetchFailure } from '@/lib/useOnline';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import CardHeader from '@/components/primitives/CardHeader';
import Collapse from '@/components/primitives/Collapse';

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
  const [polished, setPolished] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const reportFetchFailure = useReportFetchFailure();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/announcements`, { cache: 'no-store' });
      // Don't swallow a failed load as "No announcements posted" (lying empty
      // state — CLAUDE.md). Surface it so the admin knows the list is unknown.
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setItems(await res.json());
      // Cleared on success rather than on entry, so a Try again in flight
      // keeps saying "couldn't load" instead of flashing "No announcements
      // posted" over a list nobody has read yet.
      setLoadError(false);
    } catch {
      setLoadError(true);
      reportFetchFailure();
    }
  }, [reportFetchFailure]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function handlePolish() {
    if (!draft.trim()) return;
    setPolishing(true);
    setPolished('');
    setError('');
    try {
      const res = await fetch(`${BASE}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `persona: true` prepends VOICE_PERSONA server-side — this text goes on
        // Home for every player, so it speaks in the app's voice, not this call
        // site's idea of one. The tone words that used to live in this string
        // ("concise, friendly, and clear") are the persona's job now.
        body: JSON.stringify({
          prompt: `Polish this badminton club announcement. Return only the improved text with no explanation:\n\n${draft}`,
          persona: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'AI polish failed');
      } else {
        setPolished(data.text ?? '');
      }
    } catch {
      setError('Network error');
    } finally {
      setPolishing(false);
    }
  }

  async function handlePost(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPosting(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.ok) {
        setDraft('');
        setPolished('');
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
    setError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await load();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to delete announcement');
    } catch {
      setError('Network error — announcement not deleted');
    }
  }

  function startEdit(a: Announcement) {
    setEditingId(a.id);
    setEditText(a.text);
    setEditError('');
  }

  async function saveEdit() {
    if (!editingId) return;
    setSavingEdit(true);
    setEditError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, text: editText }),
      });
      if (res.ok) {
        setEditingId(null);
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error ?? 'Failed to save');
      }
    } catch {
      setEditError('Network error');
    } finally {
      setSavingEdit(false);
    }
  }

  // A failed load tints the whole card (StateCard) and hides its controls, so
  // nothing is written against data that did not load.
  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="campaign"
        title="Announcements"
        message={<>Couldn&apos;t load announcements. <StateLink onClick={() => void load()}>Try again</StateLink></>}
      >
        <PreviewRow width="70%" value="" />
        <PreviewRow width="52%" value="" />
      </StateCard>
    );
  }

  return (
    <section className="glass-card p-4 space-y-3 flex flex-col" aria-label="Announcements">
      {/* The count is a claim about the list; a failed load never reaches this
          render (it returns the tinted StateCard above). */}
      <CardHeader
        icon="campaign"
        title="Announcements"
        subtitle={items.length === 0 ? 'No announcements posted' : `${items.length} posted`}
      />


      <Collapse open={composing} spaceAbove="var(--space-3)">
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your announcement…"
            rows={3}
            maxLength={800}
            className="w-full fs-md rounded-lg p-3"
            style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
          />

          {polished && (
            <div className="rounded-lg p-3 fs-md" style={{ background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.3)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="fs-sm font-medium" style={{ color: 'var(--violet)' }}>AI polished version</span>
                <button
                  type="button"
                  onClick={() => setDraft(polished)}
                  className="fs-sm underline-offset-2 hover:underline"
                  style={{ color: 'var(--violet)' }}
                >
                  Use this
                </button>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{polished}</p>
            </div>
          )}

          {error && <p className="field-error" role="alert">{error}</p>}

          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setComposing(false); setDraft(''); setPolished(''); setError(''); }}
              className="cc-btn cc-btn-ghost"
              disabled={posting || polishing}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePolish}
              disabled={polishing || posting || !draft.trim()}
              className="cc-btn cc-btn-secondary disabled:opacity-50"
              title="Use AI to polish the wording"
            >
              {polishing ? 'Polishing…' : '✨ AI polish'}
            </button>
            <button
              type="button"
              onClick={() => handlePost(draft)}
              disabled={posting || polishing || !draft.trim()}
              className="cc-btn cc-btn-primary disabled:opacity-50"
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </Collapse>

      {items.length > 0 && (
        <ul className="space-y-2" role="list">
          {items.map((a) => (
            <li
              key={a.id}
              className="rounded-lg p-3 fs-md leading-relaxed"
              style={{ background: 'rgba(var(--glass-tint), 0.04)' }}
            >
              {editingId === a.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    maxLength={800}
                    className="w-full fs-md rounded-lg p-3"
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
                  />
                  {editError && <p className="field-error">{editError}</p>}
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setEditError(''); }}
                      className="cc-btn cc-btn-ghost"
                      disabled={savingEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={savingEdit || !editText.trim()}
                      className="cc-btn cc-btn-primary disabled:opacity-50"
                    >
                      {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="announcement-body">{renderMarkdown(a.text)}</div>
                  <div className="flex items-center justify-between mt-2">
                    <time className="fs-sm text-gray-400">
                      {new Date(a.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </time>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="fs-sm text-gray-400 hover:text-gray-200"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        className="fs-sm text-gray-400 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!composing && (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="cc-btn cc-btn-secondary self-start"
        >
          Compose
        </button>
      )}
    </section>
  );
}
