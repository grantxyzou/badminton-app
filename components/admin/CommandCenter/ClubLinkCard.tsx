'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import ActionRow from '@/components/primitives/ActionRow';
import InvitePosterButton from '@/components/admin/CommandCenter/InvitePosterButton';
import { useRevealReady } from '@/components/primitives/Reveal';
import { useOnline } from '@/lib/useOnline';
import { isRefused } from '@/lib/apiFetch';
import { shareTextOrCopy } from '@/lib/shareText';
import { clubLinkUrl } from '@/lib/clubLinkUrl';
import { qrPath } from '@/lib/qr';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface LinkState {
  link: { token: string; createdAt: string } | null;
  unclaimed: number;
}

interface Props {
  groupName?: string | null;
  /** On a page or in a sheet that already names it: the card keeps only its subtitle. */
  bare?: boolean;
}

/**
 * THE CLUB LINK (docs/plans/one-way-in.md, step 5): the one way anybody joins
 * a club, in place of the one-time invites and the door poster card.
 *
 * One link, no expiry, for the group chat, a printed poster, a sticker or the
 * phone handed to someone at the court. Whoever opens it signs in (Apple,
 * Google or an email code) and asks; an organiser lets each person in from
 * Sign-in requests, as a regular or a drop-in, or links them to their name on
 * the list. So the link is safe to post anywhere: it admits nobody by itself.
 *
 * The QR is on the card itself, for the person standing next to the
 * organiser (Grant, 2026-11-05: "on the page itself, don't make it a sheet").
 * "New link" retires the old one at once; people already asking keep their
 * place, because their asks belong to their accounts, not to the link.
 */
export default function ClubLinkCard({ groupName, bare = false }: Props) {
  const t = useTranslations('groups.clubLink');
  const online = useOnline();
  const [state, setState] = useState<LinkState | null>(null);
  const [loadError, setLoadError] = useState<'refused' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/claim-link`, { cache: 'no-store' });
      if (isRefused(res)) return setLoadError('refused');
      if (!res.ok) return setLoadError('failed');
      setState((await res.json()) as LinkState);
    } catch {
      setLoadError('failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRevealReady(state !== null || loadError !== null);

  async function makeNew() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/claim-link`, { method: 'POST' });
      if (!res.ok) throw new Error(`claim-link ${res.status}`);
      const data = (await res.json()) as { link: LinkState['link'] };
      setState((s) => ({ link: data.link, unclaimed: s?.unclaimed ?? 0 }));
      setConfirmingNew(false);
      setCopied(false);
    } catch {
      setError(t('makeFailed'));
    } finally {
      setBusy(false);
    }
  }

  const url = state?.link ? clubLinkUrl(state.link.token) : '';
  const qr = useMemo(() => (url ? qrPath(url) : null), [url]);

  async function share() {
    if (!url) return;
    const club = groupName?.trim() || t('ourClub');
    const outcome = await shareTextOrCopy({ title: t('shareTitle', { club }), text: t('shareText', { club }), url });
    if (outcome === 'copied') {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else if (outcome === 'error') {
      setError(t('shareFailed'));
    }
  }

  if (loadError) {
    return (
      <StateCard
        tone={loadError === 'refused' ? undefined : 'danger'}
        icon="link"
        title={t('title')}
        message={
          loadError === 'refused' ? (
            t('refused')
          ) : (
            <>
              {t('loadFailed')} <StateLink onClick={() => void load()}>{t('retry')}</StateLink>
            </>
          )
        }
      >
        <span className="state-line" style={{ width: '62%', height: 'var(--space-6)' }} />
      </StateCard>
    );
  }

  const body = (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {!bare && <CardHeader icon="link" title={t('title')} subtitle={t('subtitle')} />}
      {bare && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('subtitle')}</p>}
      {!state ? (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }} aria-hidden="true">
          <div className="shimmer-line rounded-lg" style={{ aspectRatio: '1', width: '60%', justifySelf: 'center' }} />
          <div className="shimmer-line rounded-lg" style={{ height: 'var(--space-7)' }} />
        </div>
      ) : !state.link ? (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <button type="button" onClick={() => void makeNew()} disabled={busy || !online} className="cc-btn cc-btn-primary cc-btn-lg">
            {busy ? t('making') : t('make')}
          </button>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      ) : (
        <div key={state.link.token} className="motion-fade" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {qr && (
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <svg className="invite-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={t('qrAria')}>
                <path d={qr.d} />
              </svg>
              <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('qrHint')}</p>
            </div>
          )}
          <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span className="section-label-muted">{t('linkLabel')}</span>
            {/* Read-only and selectable: the fallback when sharing is refused. */}
            <input type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'var(--font-mono)' }} />
          </label>
          <button type="button" onClick={() => void share()} disabled={busy} className="cc-btn cc-btn-primary cc-btn-lg">
            <span key={String(copied)} className="motion-fade">{copied ? t('copied') : t('share')}</span>
          </button>
          <InvitePosterButton token={state.link.token} groupName={groupName ?? undefined} label={t('poster')} />
          {state.unclaimed > 0 && (
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('unclaimed', { count: state.unclaimed })}</p>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          {/* Retiring a live link is a second, deliberate tap, as the bench's "Remove" is. */}
          {!confirmingNew ? (
            <ActionRow icon="link" label={t('newLink')} hint={t('newLinkHint')} onClick={() => setConfirmingNew(true)} disabled={busy || !online} />
          ) : (
            <div className="motion-fade" style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('newLinkConfirm')}</p>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button type="button" className="cc-btn cc-btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmingNew(false)}>
                  {t('keep')}
                </button>
                <button type="button" className="cc-btn cc-btn-primary" style={{ flex: 1 }} onClick={() => void makeNew()} disabled={busy || !online}>
                  {busy ? t('making') : t('makeNew')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="glass-card" style={{ padding: 'var(--space-5)' }} aria-label={t('title')}>
      {body}
    </section>
  );
}
