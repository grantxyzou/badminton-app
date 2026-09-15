'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import MemberAvatar from '@/components/primitives/MemberAvatar';
import { useGear } from '@/components/stats/useGear';
import { useOnline } from '@/lib/useOnline';
import { setMemberAvatar } from '@/lib/useMemberAvatars';
import { DEFAULT_RACKET_ID, isRacketAvatarId, racketAvatarIds, type MemberAvatar as Avatar } from '@/lib/memberAvatar';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  name: string;
  current: Avatar | null;
  onSaved: (avatar: Avatar | null) => void;
}

/** A racket the shuffle lands on — never the one already showing. */
export function shuffleRacket(currentId: string | null, random: () => number = Math.random): string {
  const ids = racketAvatarIds().filter((id) => id !== currentId);
  return ids[Math.floor(random() * ids.length)] ?? DEFAULT_RACKET_ID;
}

/**
 * Choosing the picture beside your name (lib/memberAvatar.ts): your own racket,
 * a shuffled one from the catalog, or just your initial. Nothing is saved until
 * Save, so shuffling is free.
 */
export default function AvatarSheet({ open, onClose, name, current, onSaved }: Props) {
  const t = useTranslations('profile.avatar');
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={onClose}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('title')}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {/* Mounted only while open, so the gear read happens when it is wanted. */}
        {open && <AvatarPicker name={name} current={current} onClose={onClose} onSaved={onSaved} />}
      </BottomSheetBody>
    </BottomSheet>
  );
}

function AvatarPicker({ name, current, onClose, onSaved }: Omit<Props, 'open'>) {
  const t = useTranslations('profile.avatar');
  const online = useOnline();
  const gear = useGear(name);
  const [draft, setDraft] = useState<Avatar | null>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'auth' | 'failed' | null>(null);

  const myRacketId = gear.active
    ? isRacketAvatarId(gear.active.catalogId)
      ? gear.active.catalogId
      : DEFAULT_RACKET_ID
    : null;
  const draftId = draft?.kind === 'racket' ? draft.racketId : null;
  const unchanged = (draftId ?? null) === (current?.kind === 'racket' ? current.racketId : null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/members/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatar: draft }),
      });
      if (res.status === 401 || res.status === 403) {
        setError('auth');
        return;
      }
      if (!res.ok) {
        setError('failed');
        return;
      }
      setMemberAvatar(name, draft);
      onSaved(draft);
      onClose();
    } catch {
      setError('failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)' }}>
      <MemberAvatar name={name} avatar={draft} size={112} />
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--space-3)' }}>
        {/* Always offered, so it is findable; disabled until the member has a
            racket set (or while their gear is still loading). */}
        <button
          type="button"
          className="cc-btn cc-btn-secondary"
          aria-pressed={!!myRacketId && draftId === myRacketId}
          disabled={!myRacketId}
          onClick={() => myRacketId && setDraft({ kind: 'racket', racketId: myRacketId })}
        >
          {t('myRacket')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn-secondary"
          onClick={() => setDraft({ kind: 'racket', racketId: shuffleRacket(draftId) })}
        >
          {t('shuffle')}
        </button>
        <button
          type="button"
          className="cc-btn cc-btn-secondary"
          aria-pressed={draft === null}
          onClick={() => setDraft(null)}
        >
          {t('initial')}
        </button>
      </div>
      {gear.loaded && !gear.active && (
        <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0', textAlign: 'center' }}>
          {t('noRacket')}
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        style={{ width: '100%' }}
        disabled={saving || !online || unchanged}
        onClick={save}
      >
        {t('save')}
      </button>
      {error === 'auth' && <p role="alert" className="field-error">{t('signIn')}</p>}
      {error === 'failed' && <p role="alert" className="field-error">{t('failed')}</p>}
    </div>
  );
}
