'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import InviteShare from '@/components/onboarding/InviteShare';
import { useInvites, type Invite } from '@/lib/useInvites';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import { useRevealReady } from '@/components/primitives/Reveal';

interface Props {
  /** Only rendered for an admin of the current club; the endpoint enforces it too. */
  enabled?: boolean;
  groupName?: string;
}

/**
 * The admin's invite card (docs/plans/one-time-invites.md): make a link for
 * one person, send it, and see which links are still waiting to be used.
 *
 * Each invite is a link and a code that work ONCE, for seven days. So the
 * card is a verb first — "Create an invite" — and the newest one is shown in
 * full with Copy and Share, because the admin is about to send it. Older
 * unused ones sit in a short list below with a Revoke, which is no longer a
 * rake to step on: revoking one link cuts off one person who has not used it
 * yet, not a season's worth of a group chat.
 *
 * The weekly "Share sign-up link" on the Next session card carries NO invite
 * any more: a one-time link in a chat is used up by the first tap.
 */
export default function InviteCard({ enabled = true, groupName }: Props) {
  const t = useTranslations('groups.invite');
  const tGroups = useTranslations('groups');
  const { invites, loading, error, busy, create, revoke, reload } = useInvites(enabled);
  const [latest, setLatest] = useState<Invite | null>(null);
  const [failed, setFailed] = useState<'create' | 'revoke' | null>(null);

  // The console's RevealSlot holds this place until the list has answered.
  useRevealReady(!enabled || !loading);
  if (!enabled) return null;

  async function doCreate() {
    setFailed(null);
    const made = await create();
    if (made) setLatest(made);
    else setFailed('create');
  }

  async function doRevoke(id: string) {
    setFailed(null);
    const ok = await revoke(id);
    if (!ok) setFailed('revoke');
    if (ok && latest?.id === id) setLatest(null);
  }

  // A failed load tints the whole card (StateCard) and hides its controls, so
  // nothing is written against data that did not load.
  if (error) {
    return (
      <StateCard
        tone="danger"
        icon="link"
        title={t('title')}
        subtitle={t('subtitle')}
        message={<>{t('loadFailed')} <StateLink onClick={() => void reload()}>{tGroups('retry')}</StateLink></>}
      >
        <span className="state-line" style={{ width: '62%', height: 'var(--space-6)' }} />
        <span className="state-line" style={{ width: '40%', height: 'var(--space-6)' }} />
      </StateCard>
    );
  }

  // The one being sent: the newest made in this visit, else the newest live.
  const showing = latest ?? invites[0] ?? null;
  const waiting = invites.filter((i) => i.id !== showing?.id);

  return (
    // `space-y-3` on the CARD, not a margin on the body: `CardHeader` sets no
    // bottom margin by design, so the card owns the gap under it.
    <div className="glass-card space-y-3" style={{ padding: 'var(--space-5)' }}>
      <CardHeader icon="link" title={t('title')} subtitle={t('subtitle')} />

      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        {loading ? (
          // Reserve the shape with a shimmer line where the link will be — not
          // a "…" standing in for content (the loading rule). Seen only on a
          // reload; the first load is held behind the console's skeleton.
          <div className="shimmer-line rounded-lg" style={{ height: 12, width: '55%' }} aria-hidden="true" />
        ) : (
          <>
            <button type="button" onClick={doCreate} disabled={busy} className="cc-btn cc-btn-primary" style={{ width: '100%' }}>
              {busy ? t('creating') : t('create')}
            </button>
            {failed === 'create' && <p className="field-error" role="alert">{t('createFailed')}</p>}

            {showing && (
              <div key={showing.id} className="motion-fade" style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <InviteShare token={showing.token} code={showing.code} groupName={groupName} expiresAt={showing.expiresAt} />
                <button type="button" onClick={() => void doRevoke(showing.id)} disabled={busy} className="cc-btn cc-btn-ghost" style={{ width: '100%' }}>
                  {t('revoke')}
                </button>
              </div>
            )}

            {waiting.length > 0 && (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                <span className="section-label">{t('waiting', { count: waiting.length })}</span>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
                  {waiting.map((i) => (
                    <li key={i.id} className="cc-mini-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{i.code.slice(0, 4)} {i.code.slice(4)}</span>
                        {' · '}
                        {t('expires', { date: new Date(i.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })}
                      </span>
                      <button type="button" onClick={() => setLatest(i)} className="link-quiet" style={{ minHeight: 'auto', padding: 0 }}>
                        {t('show')}
                      </button>
                      <button type="button" onClick={() => void doRevoke(i.id)} disabled={busy} className="link-quiet" style={{ minHeight: 'auto', padding: 0 }}>
                        {t('revoke')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {failed === 'revoke' && <p className="field-error" role="alert">{t('revokeFailed')}</p>}

            {!showing && waiting.length === 0 && (
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('none')}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
