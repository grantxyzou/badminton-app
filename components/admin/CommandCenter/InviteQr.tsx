'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { inviteUrl, type Invite } from '@/lib/useInvites';
import { qrPath } from '@/lib/qr';
import { useTabActive } from '@/lib/tabActivity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** How often the code on screen asks whether its invite has been used. */
export const QR_POLL_MS = 3000;

interface Props {
  /** The invite the card is showing. */
  invite: Invite;
  /** Called once when the invite has left the club's live list: used, or revoked elsewhere. */
  onUsed: (id: string) => void;
}

/**
 * The invite as a QR code, on the Invite page itself
 * (docs/superpowers/plans/2026-11-04-app-clip.md, Task 1.3). Grant,
 * 2026-11-05: on the page, not in a sheet — the organiser hands the phone
 * over with the code already showing.
 *
 * It is the same `/bpm/j/<token>` link the card shares (`inviteUrl`), so it
 * opens the app where installed and the sign-up page everywhere else, and
 * later the App Clip. Dark on a light ground in both themes (`.invite-qr`),
 * because a camera reads that best.
 *
 * WHEN IT IS USED, THE CARD SAYS SO. An invite is live exactly while the
 * club's list holds it (`lib/invites.ts`), so this asks the list every
 * `QR_POLL_MS` while it is on screen, and tells the card once its invite has
 * gone. It does its own read instead of the card's reload, so a failed check
 * is simply skipped and never tips the card into its error state. Revoking
 * from another phone reads the same as a use: rare, and either way the code is
 * dead and the next one is one tap away.
 */
export default function InviteQr({ invite, onUsed }: Props) {
  const t = useTranslations('groups.invite');
  const onScreen = useTabActive();
  const id = invite.id;

  useEffect(() => {
    if (!onScreen) return;
    let stopped = false;

    async function check() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`${BASE}/api/groups/invite`, { cache: 'no-store' });
        if (!res.ok) return;
        const { invites } = (await res.json()) as { invites: Invite[] };
        if (!stopped && Array.isArray(invites) && !invites.some((i) => i.id === id)) {
          stopped = true;
          onUsed(id);
        }
      } catch {
        // Offline or a blip: keep showing the code and ask again next time.
      }
    }

    const timer = window.setInterval(() => void check(), QR_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, onScreen, onUsed]);

  const qr = useMemo(() => qrPath(inviteUrl(invite.token)), [invite.token]);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <svg className="invite-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={t('qrAria')}>
        <path d={qr.d} />
      </svg>
      <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('qrHint')}</p>
    </div>
  );
}
