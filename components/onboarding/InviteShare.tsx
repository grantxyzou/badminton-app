'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { shareTextOrCopy } from '@/lib/shareText';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  token: string;
  code: string;
  /** Names the club in the share sheet's title. */
  groupName?: string;
}

/**
 * The link and the code, with one way to send each.
 *
 * Shared by the create-group success step and the admin `InviteCard` so the two
 * cannot drift — they are the same object shown at two moments, and a club that
 * saw one format on day one and another in March would reasonably wonder which
 * link is real.
 *
 * THE CODE IS NOT A FALLBACK FOR A BROKEN LINK, it is for the cases a link
 * cannot reach: read aloud in a gym, written on a whiteboard, typed by someone
 * whose messaging app mangles URLs. It is shown in mono and spaced in the
 * middle, because eight characters read back to someone across a court is the
 * job it has to do.
 *
 * The URL is built here from `window.location.origin` rather than server-side:
 * behind the Azure proxy, in the installed PWA and in the native WebView the
 * origin differs, and a link pointing at the wrong one is worse than none.
 */
export default function InviteShare({ token, code, groupName }: Props) {
  const t = useTranslations('groups.invite');
  const [copied, setCopied] = useState(false);

  const url = typeof window !== 'undefined' && token ? `${window.location.origin}${BASE}/?join=${token}` : '';

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be refused (permissions, an insecure origin). The link is
      // on screen and selectable, so this is a degraded success, not a failure
      // worth an alarming message.
    }
  }

  async function share() {
    if (!url) return;
    // `shareTextOrCopy` marks the excursion itself on both the native and the
    // web branch — iOS evicts the PWA while a share sheet is open, so returning
    // looks like a cold start — and falls back to the clipboard when there is
    // no share sheet at all.
    await shareTextOrCopy({ title: groupName || 'Badminton', text: url, url });
  }

  if (!token || !code) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <span className="section-label">{t('linkLabel')}</span>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--fs-sm)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            wordBreak: 'break-all',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-3)',
          }}
        >
          {url}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" onClick={copy} className="cc-btn cc-btn-secondary" style={{ flex: 1 }}>
            {copied ? t('copied') : t('copy')}
          </button>
          <button type="button" onClick={share} className="cc-btn cc-btn-secondary" style={{ flex: 1 }}>
            {t('share')}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <span className="section-label">{t('codeLabel')}</span>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-stat)',
            letterSpacing: '0.12em',
            color: 'var(--text-primary)',
          }}
        >
          {/* Split in the middle: eight unbroken characters read aloud is a
              guessing game about where the halves are. */}
          {code.slice(0, 4)} {code.slice(4)}
        </p>
      </div>
    </div>
  );
}
