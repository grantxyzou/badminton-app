'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Release } from '@/lib/types';

function nextPatchVersion(current: string | undefined): string {
  if (!current) return 'v0.1.0';
  const m = current.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return 'v0.1.0';
  const [, major, minor, patch] = m;
  return `v${major}.${minor}.${parseInt(patch, 10) + 1}`;
}

interface ReleaseFormProps {
  latestVersion?: string;
  initialRecord?: Release;
  onPublished: (release: Release) => void;
  onCancel: () => void;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface ChangelogUnreleased {
  suggestedVersion: string;
  generatedAt: string;
  text: string;
  /**
   * Where the pre-fill content came from:
   *   - "unreleased"          — Unreleased section had bullets; standard flow
   *   - "published-fallback"  — Unreleased was empty; using the most recent
   *                              published version's notes (post-cut scenario)
   *   - "empty"               — neither has content; form starts blank
   */
  source?: 'unreleased' | 'published-fallback' | 'empty';
}

export default function ReleaseForm({ latestVersion, initialRecord, onPublished, onCancel }: ReleaseFormProps) {
  const t = useTranslations('admin.releases');
  const isEdit = !!initialRecord;
  const [version, setVersion] = useState(() => initialRecord?.version ?? nextPatchVersion(latestVersion));
  const [rawNotes, setRawNotes] = useState('');
  // Tracks when the Unreleased section was baked at build time, so the admin
  // can see at a glance whether the pre-filled bullets are current.
  const [changelogMeta, setChangelogMeta] = useState<{
    generatedAt: string;
    source?: 'unreleased' | 'published-fallback' | 'empty';
  } | null>(null);

  // Pull the CHANGELOG Unreleased section baked by scripts/extract-unreleased.mjs
  // and pre-fill the form. Admin can edit before running the AI draft.
  // Skipped in edit mode — editing existing copy shouldn't be overwritten by the changelog.
  const loadFromChangelog = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/changelog-unreleased.json`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as ChangelogUnreleased;
      if (data.suggestedVersion) setVersion(data.suggestedVersion);
      if (data.text) setRawNotes(data.text);
      if (data.generatedAt) setChangelogMeta({ generatedAt: data.generatedAt, source: data.source });
    } catch {
      /* swallow — changelog is optional */
    }
  }, []);

  useEffect(() => {
    if (!isEdit) loadFromChangelog();
  }, [loadFromChangelog, isEdit]);
  const [titleEn, setTitleEn] = useState(initialRecord?.title.en ?? '');
  const [titleZh, setTitleZh] = useState(initialRecord?.title['zh-CN'] ?? '');
  const [bodyEn, setBodyEn] = useState(initialRecord?.body.en ?? '');
  const [bodyZh, setBodyZh] = useState(initialRecord?.body['zh-CN'] ?? '');
  const [drafting, setDrafting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  async function draftWithAI() {
    if (!rawNotes.trim()) {
      setError('Paste some raw notes first.');
      return;
    }
    setDrafting(true);
    setError('');
    try {
      const prompt = `You are drafting a release note for a badminton session app.
Given these raw notes, produce a JSON object with:
  - title_en: short friendly title in English (max 8 words)
  - title_zh: same meaning in Simplified Chinese
  - body_en: bullet list in English (one bullet per line, prefix each with "• "), friendly tone, player-focused (not dev jargon)
  - body_zh: same meaning in Simplified Chinese
Output ONLY valid JSON, no prose, no markdown code fences.

Raw notes:
${rawNotes}`;

      const res = await fetch(`${BASE}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'AI request failed');
        return;
      }
      const cleaned = data.text.trim().replace(/^```json\n?|\n?```$/g, '');
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.title_en !== 'string' || typeof parsed.title_zh !== 'string' ||
          typeof parsed.body_en !== 'string' || typeof parsed.body_zh !== 'string') {
        setError('AI response was missing required fields.');
        return;
      }
      setTitleEn(parsed.title_en);
      setTitleZh(parsed.title_zh);
      setBodyEn(parsed.body_en);
      setBodyZh(parsed.body_zh);
    } catch {
      setError("AI response couldn't be parsed. Please try again or type manually.");
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!version.trim() || !titleEn.trim() || !titleZh.trim() || !bodyEn.trim() || !bodyZh.trim()) {
      setError('All fields required before publish.');
      return;
    }
    setPublishing(true);
    setError('');
    try {
      const payload = {
        version: version.trim(),
        title: { en: titleEn.trim(), 'zh-CN': titleZh.trim() },
        body: { en: bodyEn.trim(), 'zh-CN': bodyZh.trim() },
        ...(isEdit && initialRecord ? { id: initialRecord.id } : {}),
      };
      const res = await fetch(`${BASE}/api/releases`, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? (isEdit ? 'Save failed' : 'Publish failed'));
        return;
      }
      onPublished(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPublishing(false);
    }
  }

  const changelogFreshness = changelogMeta
    ? new Date(changelogMeta.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="space-y-4">
      {!isEdit && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('howItWorks')}
        </p>
      )}
      <div>
        <label htmlFor="release-version" className="block text-xs text-gray-400 mb-1">Version</label>
        <input
          id="release-version"
          name="version"
          type="text"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="input w-full"
        />
      </div>

      {!isEdit && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="release-raw-notes" className="block text-xs text-gray-400">Raw notes</label>
            <button
              type="button"
              onClick={loadFromChangelog}
              className="text-[11px]"
              style={{ color: 'var(--accent)', background: 'transparent', border: 'none', padding: '2px 6px', cursor: 'pointer' }}
              aria-label="Refresh from CHANGELOG.md Unreleased section"
              title="Re-pull the Unreleased bullets from CHANGELOG.md"
            >
              ↻ from CHANGELOG
            </button>
          </div>
          <textarea
            id="release-raw-notes"
            name="rawNotes"
            value={rawNotes}
            onChange={(e) => setRawNotes(e.target.value)}
            className="input w-full min-h-[120px]"
            placeholder="Paste commit messages, rough notes, bullet points..."
          />
          {changelogFreshness && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              {changelogMeta?.source === 'published-fallback'
                ? `Pre-filled from the most recent published version (Unreleased section was empty; baked ${changelogFreshness}). Override the version above if you're drafting the next release instead.`
                : `Pre-filled from CHANGELOG.md Unreleased (baked ${changelogFreshness}). Edit freely — AI will polish on next step.`}
            </p>
          )}
        </div>
      )}

      {!isEdit && (
        <button
          type="button"
          onClick={draftWithAI}
          disabled={drafting}
          className="btn-ghost w-full"
        >
          {drafting ? 'Drafting…' : t('draftWithAI')}
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="release-title-en" className="block text-xs text-gray-400 mb-1">Title (EN)</label>
          <input id="release-title-en" name="titleEn" type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label htmlFor="release-title-zh" className="block text-xs text-gray-400 mb-1">Title (中文)</label>
          <input id="release-title-zh" name="titleZh" type="text" value={titleZh} onChange={(e) => setTitleZh(e.target.value)} className="input w-full" />
        </div>
      </div>

      <div>
        <label htmlFor="release-body-en" className="block text-xs text-gray-400 mb-1">Body (EN)</label>
        <textarea id="release-body-en" name="bodyEn" value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} className="input w-full min-h-[100px]" />
      </div>

      <div>
        <label htmlFor="release-body-zh" className="block text-xs text-gray-400 mb-1">Body (中文)</label>
        <textarea id="release-body-zh" name="bodyZh" value={bodyZh} onChange={(e) => setBodyZh(e.target.value)} className="input w-full min-h-[100px]" />
      </div>

      {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
        <button type="button" onClick={save} disabled={publishing} className="btn-primary flex-1">
          {publishing ? (isEdit ? 'Saving…' : 'Publishing…') : (isEdit ? 'Save changes' : t('publish'))}
        </button>
      </div>
    </div>
  );
}
