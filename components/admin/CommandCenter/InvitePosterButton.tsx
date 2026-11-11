'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { inviteUrl } from '@/lib/useInvites';
import { qrGrid } from '@/lib/qr';
import { drawInvitePoster, posterWhen, type PosterContent } from '@/lib/invitePoster';
import { shareOrSaveImage } from '@/lib/shareImage';
import { useCurrentGroup } from '@/lib/useCurrentGroup';
import { APP_NAME } from '@/lib/brand';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Facts {
  organisers: string[];
  datetime: string | null;
  endDatetime: string | null;
  location: string | null;
  address: string | null;
}

const NO_FACTS: Facts = { organisers: [], datetime: null, endDatetime: null, location: null, address: null };

/**
 * Reads what the poster says about the club: its organisers (the roster's
 * `groupRole: 'owner'`), and the active session's day, time and place. Read
 * up front rather than on the tap, because iOS lets a share sheet open only
 * close to the tap that asked for it (`lib/shareImage.ts`). A read that fails
 * drops its lines from the poster; nothing on it is made up.
 */
function usePosterFacts(): Facts {
  const [facts, setFacts] = useState<Facts>(NO_FACTS);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [session, members] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!live) return;
      const roster = Array.isArray(members) ? (members as Array<{ name?: string; groupRole?: string; active?: boolean }>) : [];
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      setFacts({
        organisers: roster
          .filter((m) => m.groupRole === 'owner' && m.active !== false && typeof m.name === 'string')
          .map((m) => m.name as string),
        datetime: str(session?.datetime),
        endDatetime: str(session?.endDatetime),
        location: str(session?.locationName),
        address: str(session?.locationAddress),
      });
    })();
    return () => {
      live = false;
    };
  }, []);
  return facts;
}

interface Props {
  /** The token the QR carries: a one-time invite's, or the club's door link's. */
  token: string;
  /** A one-time invite's 8-character code; absent for the door link. */
  code?: string;
  /** When a one-time invite dies unused; absent for the door link. */
  expiresAt?: string;
  /** The club's door link (docs/plans/door-link.md): reusable, every join approved. */
  door?: boolean;
  groupName?: string;
  /** The button's words; "Save as image" by default. */
  label?: string;
}

/**
 * "Save as image": the invite as a poster the organiser can send or show — the
 * club's name, who runs it, when and where it plays, and this one-time
 * invite's QR and code (Grant, 2026-11-05). Drawn by `lib/invitePoster.ts`.
 *
 * A one-time invite's poster says it works once, for one person, until it
 * expires: posted in a group chat it would let in only the first person to
 * scan it. The club's DOOR poster (`door`) is the one for a chat or a wall:
 * anyone can ask, and an organiser lets each person in.
 */
export default function InvitePosterButton({ token, code, expiresAt, door = false, groupName, label }: Props) {
  const t = useTranslations('groups.invite');
  const locale = useLocale();
  const { group } = useCurrentGroup();
  const facts = usePosterFacts();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  function content(): PosterContent {
    const when = posterWhen(facts.datetime, facts.endDatetime, locale);
    const organisers = facts.organisers.length
      ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(facts.organisers)
      : null;
    const until = expiresAt ? new Date(expiresAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : '';
    return {
      eyebrow: t('posterEyebrow'),
      club: groupName?.trim() || group?.name?.trim() || APP_NAME,
      organisers: organisers ? t('posterOrganisedBy', { names: organisers }) : null,
      whenLabel: t('posterWhen'),
      whereLabel: t('posterWhere'),
      cadence: when ? t('posterCadence', { day: when.day, time: when.time }) : null,
      location: facts.location,
      address: facts.address,
      qr: qrGrid(inviteUrl(token)),
      scanLine: door ? t('posterDoorScan') : t('posterScan'),
      codeLine: !door && code ? t('posterCode') : null,
      code: !door && code ? `${code.slice(0, 4)} ${code.slice(4)}` : null,
      onceLine: door ? t('posterDoorLine') : t('posterOnce', { date: until }),
      appName: APP_NAME,
    };
  }

  async function save() {
    setFailed(false);
    setPreview(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const png = drawInvitePoster(canvas, content());
    if (!png) {
      setFailed(true);
      return;
    }
    setBusy(true);
    const outcome = await shareOrSaveImage(canvas, door ? 'club-poster.png' : `invite-${code ?? 'poster'}.png`);
    setBusy(false);
    if (outcome.kind === 'error') setFailed(true);
    // iOS without a file share: show the picture so it can be pressed and held.
    else if (outcome.kind === 'manual-save') setPreview(png);
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'none' }} />
      <button type="button" onClick={() => void save()} disabled={busy} className="cc-btn cc-btn-secondary" style={{ width: '100%' }}>
        <span className="material-icons icon-sm" aria-hidden="true">image</span>
        {label ?? t('posterSave')}
      </button>
      {failed && <p className="field-error" role="alert">{t('posterFailed')}</p>}
      {preview && (
        <div key={preview} className="motion-fade" style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from the canvas above; next/image cannot optimise it and must not try. */}
          <img src={preview} alt={t('posterAlt')} className="invite-poster-preview" />
          <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('posterHold')}</p>
        </div>
      )}
    </div>
  );
}
