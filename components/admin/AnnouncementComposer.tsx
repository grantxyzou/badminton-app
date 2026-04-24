'use client';

import { useRef, useState } from 'react';
import { renderMarkdown } from '@/lib/miniMarkdown';

interface Props {
  draft: string;
  setDraft: (value: string) => void;
  maxLength?: number;
}

type WrapKind = 'bold' | 'italic' | 'ul' | 'ol' | 'br';

const PLACEHOLDER = [
  "Type your announcement…",
  '',
  'Try formatting it:',
  '  **bold**   *italic*',
  '  - a list item',
  '  1. numbered',
].join('\n');

function applyFormat(text: string, start: number, end: number, kind: WrapKind): { next: string; nextStart: number; nextEnd: number } {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);

  if (kind === 'bold' || kind === 'italic') {
    const marker = kind === 'bold' ? '**' : '*';
    const content = selected || (kind === 'bold' ? 'bold text' : 'italic text');
    const next = `${before}${marker}${content}${marker}${after}`;
    const markerLen = marker.length;
    return {
      next,
      nextStart: before.length + markerLen,
      nextEnd: before.length + markerLen + content.length,
    };
  }

  if (kind === 'br') {
    const next = `${before}\n\n${after}`;
    const pos = before.length + 2;
    return { next, nextStart: pos, nextEnd: pos };
  }

  const lines = (selected || 'list item').split('\n');
  const prefixed = lines
    .map((line, i) => (kind === 'ul' ? `- ${line}` : `${i + 1}. ${line}`))
    .join('\n');
  const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const next = `${before}${prefix}${prefixed}${after}`;
  const startPos = before.length + prefix.length;
  return {
    next,
    nextStart: startPos,
    nextEnd: startPos + prefixed.length,
  };
}

export default function AnnouncementComposer({ draft, setDraft, maxLength = 800 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const isPreview = mode === 'preview';

  function handleFormat(kind: WrapKind) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const { next, nextStart, nextEnd } = applyFormat(draft, start, end, kind);
    if (next.length > maxLength) return;
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextStart, nextEnd);
    });
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    minHeight: 36,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.02em',
    background: active ? 'var(--inner-card-green-bg, rgba(34,197,94,0.15))' : 'transparent',
    color: active ? 'var(--accent, #22c55e)' : 'var(--text-muted)',
    border: `1px solid ${active ? 'var(--accent, #22c55e)' : 'var(--inner-card-border, rgba(255,255,255,0.08))'}`,
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  const formatBtnStyle: React.CSSProperties = {
    minHeight: 44,
    minWidth: 44,
    padding: '0 10px',
    borderRadius: 10,
    border: '1px solid var(--inner-card-border, rgba(255,255,255,0.08))',
    background: 'var(--inner-card-bg, rgba(255,255,255,0.03))',
    color: 'var(--text-primary, #fff)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div className="space-y-2">
      {/* Write / Preview tabs */}
      <div role="tablist" aria-label="Composer mode" style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          role="tab"
          aria-selected={!isPreview}
          onClick={() => setMode('write')}
          style={tabStyle(!isPreview)}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isPreview}
          onClick={() => setMode('preview')}
          style={tabStyle(isPreview)}
        >
          Preview
        </button>
      </div>

      {/* Formatting toolbar — only in Write mode */}
      {!isPreview && (
        <div
          role="toolbar"
          aria-label="Formatting"
          style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
        >
          <button type="button" onClick={() => handleFormat('bold')} aria-label="Bold (**text**)" title="Bold — wraps selection in **" style={{ ...formatBtnStyle, fontWeight: 700 }}>
            B
          </button>
          <button type="button" onClick={() => handleFormat('italic')} aria-label="Italic (*text*)" title="Italic — wraps selection in *" style={{ ...formatBtnStyle, fontStyle: 'italic' }}>
            I
          </button>
          <button type="button" onClick={() => handleFormat('ul')} aria-label="Bulleted list (- item)" title="Bulleted list — prefixes each line with -" style={formatBtnStyle}>
            <span className="material-icons" style={{ fontSize: 20 }}>format_list_bulleted</span>
          </button>
          <button type="button" onClick={() => handleFormat('ol')} aria-label="Numbered list (1. item)" title="Numbered list — prefixes each line with 1. 2. …" style={formatBtnStyle}>
            <span className="material-icons" style={{ fontSize: 20 }}>format_list_numbered</span>
          </button>
          <button type="button" onClick={() => handleFormat('br')} aria-label="Paragraph break (blank line)" title="Paragraph break — inserts a blank line" style={formatBtnStyle}>
            <span className="material-icons" style={{ fontSize: 20 }}>subdirectory_arrow_left</span>
          </button>
        </div>
      )}

      {/* Editor / Preview pane */}
      {isPreview ? (
        <div
          className="announcement-body text-sm text-gray-200 leading-relaxed glass-card p-4"
          style={{ minHeight: '5rem' }}
          aria-label="Announcement preview"
        >
          {draft.trim() ? renderMarkdown(draft) : <p className="text-gray-500">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          id="admin-announcement-draft"
          name="announcementDraft"
          rows={6}
          placeholder={PLACEHOLDER}
          aria-label="Announcement text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={maxLength}
        />
      )}
      <p className="text-right text-xs text-gray-500">{draft.length}/{maxLength}</p>
    </div>
  );
}
