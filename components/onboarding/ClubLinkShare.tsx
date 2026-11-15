'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { shareTextOrCopy } from '@/lib/shareText';
import { clubLinkUrl } from '@/lib/clubLinkUrl';

interface Props {
  /** The club's link (docs/plans/one-way-in.md, step 5). */
  token: string;
  /** Names the club in the share sheet's title. */
  groupName?: string;
}

/**
 * The club's link, with Copy and Share, on the "your club exists" step of
 * Create a club. The same link the console's Club link card shows: anyone
 * who opens it signs in and asks, and the organiser lets each person in.
 * (Until step 5 this showed a one-time invite and its 8-character code.)
 *
 * The URL is built from `window.location.origin` (`clubLinkUrl`) rather than
 * server-side: behind the Azure proxy, in the installed PWA and in the native
 * WebView the origin differs, and a link pointing at the wrong one is worse
 * than none.
 */
export default function ClubLinkShare({ token, groupName }: Props) {
  const t = useTranslations('groups.invite');
  const [copied, setCopied] = useState(false);
  const url = token ? clubLinkUrl(token) : '';

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

  if (!token) return null;

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
            <span key={copied ? 'copied' : 'copy'} className="motion-fade">{copied ? t('copied') : t('copy')}</span>
          </button>
          <button type="button" onClick={share} className="cc-btn cc-btn-secondary" style={{ flex: 1 }}>
            {t('share')}
          </button>
        </div>
      </div>

    </div>
  );
}
