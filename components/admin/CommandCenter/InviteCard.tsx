'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import InviteShare from '@/components/onboarding/InviteShare';
import InviteQr from '@/components/admin/CommandCenter/InviteQr';
import InvitePosterButton from '@/components/admin/CommandCenter/InvitePosterButton';
import ListRow from '@/components/primitives/ListRow';
import { useInvites, type Invite } from '@/lib/useInvites';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import { useRevealReady } from '@/components/primitives/Reveal';

interface Props {
  /** Only rendered for an admin of the current club; the endpoint enforces it too. */
  enabled?: boolean;
  groupName?: string;
  /** On its own page the page header names it; the card keeps only its subtitle. */
  bare?: boolean;
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
 *
 * THE INVITE SHOWN IS ALSO A QR CODE, right on the page (Grant, 2026-11-05:
 * "on the page itself, don't make it a sheet"), for the person standing next
 * to the organiser, and "Save as image" turns it into a poster
 * (`InvitePosterButton`). When the shown invite is used the card says so and
 * offers "Next person" in its place (`InviteQr` watches for it), so a used
 * code never stays on screen.
 */
export default function InviteCard({ enabled = true, groupName, bare = false }: Props) {
  const t = useTranslations('groups.invite');
  const tGroups = useTranslations('groups');
  const { invites, loading, error, busy, create, revoke, reload } = useInvites(enabled);
  const [latest, setLatest] = useState<Invite | null>(null);
  const [failed, setFailed] = useState<'create' | 'revoke' | null>(null);
  // Invites seen used while on screen. The list behind the card catches up
  // on its next read; until then these are dead and must not be shown.
  const [usedIds, setUsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [justUsed, setJustUsed] = useState(false);
  const [nextFailed, setNextFailed] = useState(false);

  const onUsed = useCallback((id: string) => {
    setUsedIds((prev) => new Set(prev).add(id));
    setJustUsed(true);
  }, []);

  // The console's RevealSlot holds this place until the list has answered.
  useRevealReady(!enabled || !loading);
  if (!enabled) return null;

  async function doCreate() {
    setFailed(null);
    const made = await create();
    if (made) {
      setLatest(made);
      setJustUsed(false);
    } else setFailed('create');
  }

  /** "Next person", after the shown invite was used: the card's own create. */
  async function next() {
    setNextFailed(false);
    const made = await create();
    if (!made) {
      setNextFailed(true);
      return;
    }
    setLatest(made);
    setJustUsed(false);
  }

  function pick(i: Invite) {
    setLatest(i);
    setJustUsed(false);
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
  const live = invites.filter((i) => !usedIds.has(i.id));
  const showing = justUsed ? null : (latest && !usedIds.has(latest.id) ? latest : null) ?? live[0] ?? null;
  const waiting = live.filter((i) => i.id !== showing?.id);

  return (
    // `space-y-3` on the CARD, not a margin on the body: `CardHeader` sets no
    // bottom margin by design, so the card owns the gap under it.
    <div className="glass-card space-y-3" style={{ padding: 'var(--space-5)' }}>
      {bare ? (
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('subtitle')}</p>
      ) : (
        <CardHeader icon="link" title={t('title')} subtitle={t('subtitle')} />
      )}

      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        {loading ? (
          // Reserve the shape with a shimmer line where the link will be — not
          // a "…" standing in for content (the loading rule). Seen only on a
          // reload; the first load is held behind the console's skeleton.
          <div className="shimmer-line rounded-lg" style={{ height: 12, width: '55%' }} aria-hidden="true" />
        ) : (
          <>
            {/* After a use, "Next person" below IS this button; two creates
                on one screen would be one too many. */}
            {!justUsed && (
              <button type="button" onClick={doCreate} disabled={busy} className="cc-btn cc-btn-primary" style={{ width: '100%' }}>
                {busy ? t('creating') : t('create')}
              </button>
            )}
            {failed === 'create' && <p className="field-error" role="alert">{t('createFailed')}</p>}

            {justUsed && (
              <div key="used" className="motion-fade" role="status" style={{ display: 'grid', gap: 'var(--space-4)', justifyItems: 'center', textAlign: 'center' }}>
                <span className="material-icons icon-xl" style={{ color: 'var(--accent)' }} aria-hidden="true">
                  check_circle
                </span>
                <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>{t('qrUsed')}</p>
                <button type="button" onClick={() => void next()} disabled={busy} className="cc-btn cc-btn-primary" style={{ width: '100%' }}>
                  {busy ? t('creating') : t('qrNext')}
                </button>
                {nextFailed && <p className="field-error" role="alert">{t('qrNextFailed')}</p>}
              </div>
            )}

            {showing && (
              <div key={showing.id} className="motion-fade" style={{ display: 'grid', gap: 'var(--space-5)' }}>
                {/* For the person standing next to you: the same one-time
                    invite, drawn big for their camera. */}
                <InviteQr invite={showing} onUsed={onUsed} />
                <InviteShare token={showing.token} code={showing.code} groupName={groupName} expiresAt={showing.expiresAt} />
                <InvitePosterButton invite={showing} groupName={groupName} />
                <button type="button" onClick={() => void doRevoke(showing.id)} disabled={busy} className="cc-btn cc-btn-ghost" style={{ width: '100%' }}>
                  {t('revoke')}
                </button>
              </div>
            )}

            {waiting.length > 0 && (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {/* Muted, not accent: the two labels above it name what is
                    being sent; this one only counts what is still waiting. */}
                <span className="section-label-muted">{t('waiting', { count: waiting.length })}</span>
                <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                  {/* A row is one tap target (ListRow's cc-mini-card button,
                      44px+): tapping shows that invite in full above, where
                      its Copy, Share and Revoke are. No buttons inside the
                      row — the first cut had 18px Show/Revoke links there. */}
                  {waiting.map((i) => (
                    <ListRow
                      key={i.id}
                      onClick={() => pick(i)}
                      ariaLabel={t('showAria', { code: i.code })}
                      title={
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>
                          {i.code.slice(0, 4)} {i.code.slice(4)}
                        </span>
                      }
                      subtitle={t('expires', { date: new Date(i.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })}
                      trailing={<span className="material-icons icon-md" style={{ color: 'var(--text-muted)' }} aria-hidden="true">chevron_right</span>}
                    />
                  ))}
                </div>
              </div>
            )}
            {failed === 'revoke' && <p className="field-error" role="alert">{t('revokeFailed')}</p>}

            {!showing && !justUsed && waiting.length === 0 && (
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('none')}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
