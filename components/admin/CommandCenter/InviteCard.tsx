'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import InviteShare from '@/components/onboarding/InviteShare';
import { useInviteLink } from '@/lib/useInviteLink';

interface Props {
  /** Only rendered for an admin of the current club; the endpoint enforces it too. */
  enabled?: boolean;
  groupName?: string;
}

/**
 * The admin's invite card: the club's link and code, and the one way to replace
 * them.
 *
 * REGENERATE IS DESTRUCTIVE AND ASKS FIRST. It is the club's only revocation —
 * there is no TTL and no per-person invite — so replacing the link is the whole
 * mechanism for "that link got out". It is also irreversible and silent: nobody
 * can be told which old links are still circulating, and anyone mid-join is cut
 * off. A one-tap regenerate next to a copy button would be a rake to step on.
 *
 * The confirmation is INLINE rather than a nested sheet: this card already lives
 * inside the Command Center, and a sheet over a sheet is the pattern the back
 * button handles worst.
 *
 * A load failure renders `ErrorState`, not an empty card. An invite card
 * showing nothing reads as "your club has no link", which would send an admin
 * looking for a setting that does not exist.
 */
export default function InviteCard({ enabled = true, groupName }: Props) {
  const t = useTranslations('groups.invite');
  const { invite, loading, error, busy, regenerate } = useInviteLink(enabled);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!enabled) return null;

  async function doRegenerate() {
    setFailed(false);
    const ok = await regenerate();
    if (!ok) setFailed(true);
    setConfirming(false);
  }

  return (
    // `space-y-3` on the CARD, not a margin on the body: `CardHeader` sets no
    // bottom margin by design, so the card owns the gap under it. A hand-typed
    // marginTop here is what `card-spacing-canary` exists to refuse, and the
    // 2026-08-27 bug it was written for shipped ten cards with the button
    // jammed against the subtitle.
    <div className="glass-card space-y-3" style={{ padding: 'var(--space-5)' }}>
      <CardHeader icon="link" title={t('title')} subtitle={t('subtitle')} />

      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        {error ? (
          <ErrorState message={t('loadFailed')} />
        ) : loading ? (
          // Reserve the shape rather than collapsing the card to nothing — the
          // skeleton contract the tabs use, so the card does not jump on load.
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>…</p>
        ) : invite ? (
          <>
            <InviteShare token={invite.token} code={invite.code} groupName={groupName} />

            {failed && <p className="field-error">{t('regenerateFailed')}</p>}

            {confirming ? (
              <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {t('regenerateConfirm')}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                  {t('regenerateWarning')}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    onClick={doRegenerate}
                    disabled={busy}
                    className="cc-btn cc-btn-danger"
                    style={{ flex: 1 }}
                  >
                    {busy ? t('regenerating') : t('regenerateAction')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="cc-btn cc-btn-ghost"
                    style={{ flex: 1 }}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="cc-btn cc-btn-ghost"
                style={{ width: '100%' }}
              >
                {t('regenerate')}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
