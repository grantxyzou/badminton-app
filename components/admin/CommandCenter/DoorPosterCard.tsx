'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import InvitePosterButton from '@/components/admin/CommandCenter/InvitePosterButton';
import ClaimLinkSheet from '@/components/admin/CommandCenter/ClaimLinkSheet';
import { useOnline } from '@/lib/useOnline';
import { useRevealReady } from '@/components/primitives/Reveal';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  groupName?: string;
}

/**
 * "A poster for everyone" on the Invite page (docs/plans/door-link.md).
 *
 * The one-time invite above is for one person. This is the club's DOOR link,
 * the claim link widened to new names: reusable, so it can go in the group
 * chat, on a printed poster or on an NFC sticker, and safe for that because
 * nobody gets in without an organiser approving them. "Save poster" draws it
 * the way the invite's poster is drawn; the link itself, Copy, Share and "New
 * link" live in the club link sheet the Roster already opens.
 */
export default function DoorPosterCard({ groupName }: Props) {
  const t = useTranslations('groups.invite');
  const online = useOnline();
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [making, setMaking] = useState(false);
  const [makeFailed, setMakeFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/groups/claim-link`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`claim-link ${res.status}`);
      const body = (await res.json()) as { link: { token: string } | null };
      setToken(body.link?.token ?? null);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRevealReady(loaded);

  async function make() {
    setMaking(true);
    setMakeFailed(false);
    try {
      const res = await fetch(`${BASE}/api/groups/claim-link`, { method: 'POST' });
      if (!res.ok) throw new Error(`claim-link ${res.status}`);
      const body = (await res.json()) as { link: { token: string } };
      setToken(body.link.token);
    } catch {
      setMakeFailed(true);
    } finally {
      setMaking(false);
    }
  }

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="campaign"
        title={t('doorTitle')}
        message={<>{t('doorLoadFailed')} <StateLink onClick={() => void load()}>{t('doorRetry')}</StateLink></>}
      >
        <span className="state-line" style={{ width: '62%', height: 'var(--space-6)' }} />
      </StateCard>
    );
  }

  return (
    <div className="glass-card space-y-3" style={{ padding: 'var(--space-5)' }}>
      <CardHeader icon="campaign" title={t('doorTitle')} subtitle={t('doorSubtitle')} />
      {!loaded ? (
        <div className="shimmer-line rounded-lg" style={{ height: 12, width: '55%' }} aria-hidden="true" />
      ) : token ? (
        <div key={token} className="motion-fade" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <InvitePosterButton token={token} door groupName={groupName} label={t('doorSave')} />
          <button type="button" onClick={() => setSheetOpen(true)} className="cc-btn cc-btn-ghost" style={{ width: '100%' }}>
            {t('doorManage')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <button type="button" onClick={() => void make()} disabled={making || !online} className="cc-btn cc-btn-secondary" style={{ width: '100%' }}>
            {making ? t('creating') : t('doorMake')}
          </button>
          {makeFailed && <p className="field-error" role="alert">{t('doorMakeFailed')}</p>}
        </div>
      )}
      <ClaimLinkSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          // "New link" in the sheet retires this one; read what is live now.
          void load();
        }}
        clubName={groupName}
      />
    </div>
  );
}
