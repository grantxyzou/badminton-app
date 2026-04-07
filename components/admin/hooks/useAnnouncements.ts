'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Announcement } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function useAnnouncements(refreshKey: number) {
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
  }, [loadAnnouncements, refreshKey]);

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

  function cancelEditAnno() {
    setEditingAnnoId(null);
  }

  return {
    announcements,
    draft, setDraft,
    polished,
    polishing,
    posting,
    postError,
    deletePostError,
    editingAnnoId,
    editAnnoText, setEditAnnoText,
    editAnnoError,
    savingAnno,
    handlePolish,
    handlePost,
    handleDeleteAnnouncement,
    startEditAnno,
    handleSaveAnno,
    cancelEditAnno,
  };
}
