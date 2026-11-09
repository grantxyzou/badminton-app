'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import MemberAvatar from '@/components/primitives/MemberAvatar';
import { useGear } from '@/components/stats/useGear';
import { useOnline } from '@/lib/useOnline';
import { setMemberAvatar } from '@/lib/useMemberAvatars';
import { DEFAULT_RACKET_ID, isRacketAvatarId, type MemberAvatar as Avatar } from '@/lib/memberAvatar';
import { isRefused } from '@/lib/apiFetch';
import { rawList } from '@/lib/rawList';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** This club's rank (docs/plans/roles-v2.md). Mirrors `ProfileRank` in ProfileTab. */
export type EditProfileRank = 'owner' | 'admin' | 'member';

/** One picture the member can wear: `null` is their initial. */
interface Choice {
  key: string;
  label: string;
  avatar: Avatar | null;
}

/**
 * The racket pictures on offer: the member's own racket (when they have one on
 * their set-up) and, so a picture chosen earlier is never silently lost, the
 * racket they are wearing now when it is a different one.
 */
export function avatarChoices(
  current: Avatar | null,
  myRacketId: string | null,
  labels: { initial: string; myRacket: string; current: string },
): Choice[] {
  const out: Choice[] = [{ key: 'initial', label: labels.initial, avatar: null }];
  if (myRacketId) out.push({ key: `racket:${myRacketId}`, label: labels.myRacket, avatar: { kind: 'racket', racketId: myRacketId } });
  if (current?.kind === 'racket' && current.racketId !== myRacketId) {
    out.push({ key: `racket:${current.racketId}`, label: labels.current, avatar: current });
  }
  return out;
}

function sameAvatar(a: Avatar | null, b: Avatar | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.racketId === b.racketId;
}

/** "Nov 2026" in the app's locale and Vancouver time, like every date in the app. */
export function fmtMemberSince(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'America/Vancouver' });
  } catch {
    return null;
  }
}

interface Props {
  name: string;
  /** The club's name, when known. */
  clubName: string | null;
  /** This club's rank; `null` while unknown. */
  rank: EditProfileRank | null;
  /** The shell's admin verdict, which holds the place while the rank is unknown. */
  isAdmin: boolean;
  avatar: Avatar | null;
  memberCreatedAt: string | null;
  onAvatarSaved: (avatar: Avatar | null) => void;
  onEditName: () => void;
  onDeleteAccount: () => void;
  onBack: () => void;
}

/**
 * "Edit profile" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §2).
 *
 * Everything about you in one place, opened from the card at the top of
 * Profile: your picture, the name the club calls you, your rank and how long
 * you have been a member, and, at the bottom, deleting the account. A page,
 * not a sheet (Grant, 2026-11-08).
 *
 * The picture saves on tap, with no Save button: the ring and the big circle
 * move at once, and a failed save puts them back with a message.
 */
export default function EditProfilePage({
  name, clubName, rank, isAdmin, avatar, memberCreatedAt, onAvatarSaved, onEditName, onDeleteAccount, onBack,
}: Props) {
  const t = useTranslations('profile.editProfile');
  const locale = useLocale();
  const online = useOnline();
  const gear = useGear(name);
  const [shown, setShown] = useState<Avatar | null>(avatar);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'auth' | 'failed' | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const myRacketId = gear.active
    ? isRacketAvatarId(gear.active.catalogId) ? gear.active.catalogId : DEFAULT_RACKET_ID
    : null;
  const choices = avatarChoices(avatar, myRacketId, {
    initial: t('initial'),
    myRacket: t('myRacket'),
    current: t('currentPicture'),
  });

  async function choose(next: Avatar | null) {
    if (saving || !online || sameAvatar(next, shown)) return;
    const before = shown;
    setShown(next);
    setSaving(true);
    setError(null);
    setSavedNote(false);
    try {
      const res = await fetch(`${BASE}/api/members/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatar: next }),
      });
      if (!res.ok) {
        setShown(before);
        setError(isRefused(res) ? 'auth' : 'failed');
        return;
      }
      setMemberAvatar(name, next);
      onAvatarSaved(next);
      setSavedNote(true);
    } catch {
      setShown(before);
      setError('failed');
    } finally {
      setSaving(false);
    }
  }

  const shownRank: EditProfileRank | null = rank ?? (isAdmin ? 'admin' : null);
  const memberSince = fmtMemberSince(memberCreatedAt, locale);
  const can = shownRank ? rawList<string>(t.raw(`can.${shownRank}`)) : [];

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight flex flex-col gap-4" data-edit-profile-page>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
        {/* Keyed so a new picture fades in rather than swapping in a frame. */}
        <span key={shown?.racketId ?? 'initial'} className="motion-fade" style={{ display: 'inline-flex' }}>
          <MemberAvatar name={name} avatar={shown} size={112} tone="neutral" />
        </span>
        <div
          role="radiogroup"
          aria-label={t('pictureGroup')}
          style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--space-4)' }}
        >
          {choices.map((c) => {
            const checked = sameAvatar(c.avatar, shown);
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={c.label}
                className="avatar-choice"
                disabled={!online || saving}
                onClick={() => void choose(c.avatar)}
              >
                <MemberAvatar name={name} avatar={c.avatar} size={52} tone="neutral" />
              </button>
            );
          })}
        </div>
        {gear.loaded && !gear.active && (
          <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0', textAlign: 'center' }}>
            {t('noRacket')}
          </p>
        )}
        <p aria-live="polite" className="fs-sm" style={{ margin: '0', minHeight: 'var(--space-5)', color: 'var(--text-muted)' }}>
          {savedNote ? t('saved') : ''}
        </p>
        {error === 'auth' && <p role="alert" className="field-error" style={{ margin: '0' }}>{t('signIn')}</p>}
        {error === 'failed' && <p role="alert" className="field-error" style={{ margin: '0' }}>{t('failed')}</p>}
      </div>

      <ProfileEyebrow>{clubName ?? t('thisClub')}</ProfileEyebrow>
      <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
        <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
          <li>
            <button type="button" className="settings-row edit-profile-row" onClick={onEditName}>
              <span className="edit-profile-field">
                <span className="edit-profile-key">{t('displayName')}</span>
                <span className="edit-profile-value">{name}</span>
              </span>
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-secondary)' }}>
                chevron_right
              </span>
            </button>
          </li>
          {shownRank && (
            <li className="edit-profile-row" style={{ borderTop: '1px solid var(--divider)' }}>
              <span className="edit-profile-field">
                <span className="edit-profile-key">{t('role')}</span>
                <span className="edit-profile-value">{t(`rank.${shownRank}`)}</span>
                {can.length > 0 && (
                  <ul className="edit-profile-can">
                    {can.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
              </span>
            </li>
          )}
          {memberSince && (
            <li className="edit-profile-row" style={{ borderTop: '1px solid var(--divider)' }}>
              <span className="edit-profile-field">
                <span className="edit-profile-key">{t('memberSince')}</span>
                <span className="edit-profile-value">{memberSince}</span>
              </span>
            </li>
          )}
        </ul>
      </div>

      {/* Deleting the account lives here, with everything else about you, not
          at the foot of Profile beside Log out (Grant, 2026-11-09: "move delete
          my account to profile"). Still one tap from the card, which is what
          App Store 5.1.1(v) asks: findable from inside the app. The row opens
          the confirmation sheet; the danger is on that sheet's button. */}
      <div>
        <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
          <button type="button" className="settings-row edit-profile-row" onClick={onDeleteAccount} style={{ color: 'var(--color-red)' }}>
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--fs-stat)' }}>delete</span>
            <span style={{ flex: 1, fontSize: 'var(--fs-lg)' }}>{t('deleteAccount')}</span>
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-secondary)' }}>
              chevron_right
            </span>
          </button>
        </div>
        <p className="fs-base" style={{ margin: 'var(--space-3) var(--space-1) 0', color: 'var(--text-muted)' }}>
          {t('deleteNote')}
        </p>
      </div>
    </div>
  );
}
