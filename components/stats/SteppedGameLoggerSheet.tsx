'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { KUDOS_TAGS, TAG_ICON, type KudosTag } from '@/lib/kudos';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Stepped game logger: partner → opponents → score → logged.
 *
 * Replaces five free-text fields with taps. The old sheet asked a member to
 * type three names correctly, and games join on NAME — so a typo did not just
 * look wrong, it silently detached the game from that player's record and from
 * the calibration fold.
 *
 * The POST body shape is unchanged, so nothing downstream has to know about
 * this. `loggedBy` is overridden server-side from the member cookie anyway;
 * the value here is only meaningful for the admin branch.
 *
 * The old `GameLoggerSheet` is untouched: `bpm-stable` still renders it via
 * the v1 arrangement. It goes when v1 goes, in Stage 8.
 */

type Step = 'partner' | 'opponents' | 'score' | 'done';

const MAX_OPPONENTS = 2;
const DEFAULT_MINE = 21;
const DEFAULT_THEIRS = 15;

export interface SteppedGameLoggerSheetProps {
  you: string;
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onLogged: () => void;
}

interface Player {
  name?: string;
  waitlisted?: boolean;
  removed?: boolean;
}

export default function SteppedGameLoggerSheet({
  you,
  sessionId,
  open,
  onClose,
  onLogged,
}: SteppedGameLoggerSheetProps) {
  const t = useTranslations('stats.logger');
  const tKudos = useTranslations('stats.kudos');
  const online = useOnline();

  const [step, setStep] = useState<Step>('partner');
  const [roster, setRoster] = useState<string[]>([]);
  const [rosterError, setRosterError] = useState(false);
  const [partner, setPartner] = useState<string | null>(null);
  const [opponents, setOpponents] = useState<string[]>([]);
  const [mine, setMine] = useState(DEFAULT_MINE);
  const [theirs, setTheirs] = useState(DEFAULT_THEIRS);
  const [guestOpen, setGuestOpen] = useState(false);
  const [guest, setGuest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [kudosSent, setKudosSent] = useState<Record<string, boolean>>({});

  const reset = useCallback(() => {
    setStep('partner');
    setPartner(null);
    setOpponents([]);
    setMine(DEFAULT_MINE);
    setTheirs(DEFAULT_THEIRS);
    setGuestOpen(false);
    setGuest('');
    setError(false);
    setKudosSent({});
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch(`${BASE}/api/players`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const names = ((d?.players ?? []) as Player[])
          .filter((p) => p?.name && !p.waitlisted && !p.removed)
          .map((p) => p.name as string)
          .filter((n) => n.trim().toLowerCase() !== you.trim().toLowerCase());
        setRoster(names);
        setRosterError(false);
      })
      .catch(() => live && setRosterError(true));
    return () => {
      live = false;
    };
  }, [open, you]);

  const toggleOpponent = (name: string) => {
    setOpponents((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      // Capped at two — a third replaces the oldest rather than being refused,
      // which would leave the member tapping with no feedback.
      return prev.length >= MAX_OPPONENTS ? [...prev.slice(1), name] : [...prev, name];
    });
  };

  const addGuest = () => {
    const name = guest.trim();
    if (!name) return;
    if (step === 'partner') {
      setPartner(name);
      setStep('opponents');
    } else {
      toggleOpponent(name);
    }
    setGuest('');
    setGuestOpen(false);
  };

  async function submit() {
    if (!partner || opponents.length === 0) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          teamA: [you, partner],
          teamB: opponents,
          scoreA: mine,
          scoreB: theirs,
          loggedBy: you,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onLogged();
      setStep('done');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function sendKudos(tag: KudosTag) {
    if (!partner) return;
    try {
      const res = await fetch(`${BASE}/api/kudos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientName: partner, tag }),
      });
      // 201 (sent) and 409 (already sent) both land on "sent" — same rule as
      // GiveKudosCard, so a double-tap reads as success rather than an error.
      if (res.ok || res.status === 409) setKudosSent((s) => ({ ...s, [tag]: true }));
    } catch {
      /* Kudos are a bonus on this screen; the game is already logged. */
    }
  }

  const listFor = step === 'opponents' ? roster.filter((n) => n !== partner) : roster;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={t('title')}
      maxHeight="85vh"
    >
      <BottomSheetHeader>
        <h2 className="bpm-h3" style={{ margin: 0 }}>{t('title')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="cc-btn cc-btn-ghost"
          style={{ minWidth: 44, minHeight: 44 }}
        >
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody bare>
        <div style={{ padding: '0 20px 34px', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {(step === 'partner' || step === 'opponents') && (
            <>
              <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>
                {step === 'partner' ? t('whoWith') : t('whoAgainst', { partner: partner ?? '' })}
              </p>

              {rosterError && <ErrorState message={t('rosterError')} />}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {listFor.map((name) => {
                  const picked = step === 'partner' ? partner === name : opponents.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => {
                        if (step === 'partner') {
                          // Tapping a name advances immediately — there is no
                          // Next on this step, because picking IS the answer.
                          setPartner(name);
                          setStep('opponents');
                        } else {
                          toggleOpponent(name);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--space-3)',
                        padding: '14px 12px',
                        minHeight: 48,
                        borderRadius: 'var(--radius-lg)',
                        background: picked ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                        border: `1px solid ${picked ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
                        color: 'var(--text-primary)',
                        fontSize: 'var(--fs-md)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span>{name}</span>
                      <span
                        className="material-icons"
                        aria-hidden="true"
                        style={{ fontSize: 'var(--icon-md)', color: picked ? 'var(--accent)' : 'var(--text-muted)' }}
                      >
                        {picked ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Guests: someone who turned up but isn't on tonight's list. */}
              {guestOpen ? (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    type="text"
                    value={guest}
                    maxLength={50}
                    onChange={(e) => setGuest(e.target.value)}
                    placeholder={t('guestPlaceholder')}
                    aria-label={t('guestPlaceholder')}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="cc-btn cc-btn-secondary" onClick={addGuest} disabled={!guest.trim()}>
                    {t('guestAdd')}
                  </button>
                </div>
              ) : (
                <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setGuestOpen(true)}>
                  {t('guestPrompt')}
                </button>
              )}

              <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {step === 'partner' ? t('rosterNote') : t('pickTwo')}
              </p>

              {step === 'opponents' && (
                <Footer
                  backLabel={t('back')}
                  onBack={() => setStep('partner')}
                  nextLabel={t('next')}
                  onNext={() => setStep('score')}
                  nextDisabled={opponents.length === 0}
                />
              )}
            </>
          )}

          {step === 'score' && (
            <>
              <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>
                {t('versus', { partner: partner ?? '', opponents: opponents.join(' & ') })}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                <Stepper label={t('yourScore')} value={mine} onChange={setMine} accent />
                <Stepper label={t('theirScore')} value={theirs} onChange={setTheirs} />
              </div>
              <p
                style={{
                  margin: 0,
                  textAlign: 'center',
                  fontSize: 'var(--fs-base)',
                  fontWeight: 600,
                  color: mine > theirs ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {mine > theirs ? t('youWon') : mine < theirs ? t('theyWon') : t('level')}
              </p>
              {error && <ErrorState message={t('saveError')} />}
              {!online && (
                <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('offline')}</p>
              )}
              <Footer
                backLabel={t('back')}
                onBack={() => setStep('opponents')}
                nextLabel={busy ? t('saving') : t('logIt')}
                onNext={submit}
                nextDisabled={busy || !online}
              />
            </>
          )}

          {step === 'done' && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-4)',
                  padding: 'var(--space-5)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--inner-card-green-bg)',
                  border: '1px solid var(--inner-card-green-border)',
                }}
              >
                <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent)' }}>
                  check_circle
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {t('logged')}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                    {mine}–{theirs} · {t('with', { partner: partner ?? '' })}
                  </p>
                </div>
              </div>

              <div>
                <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>
                  {t('kudosOffer', { partner: partner ?? '' })}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                  {KUDOS_TAGS.map((tag) => {
                    const sent = !!kudosSent[tag];
                    return (
                      <button
                        key={tag}
                        type="button"
                        className="cc-btn cc-btn-secondary"
                        disabled={sent || !online}
                        onClick={() => sendKudos(tag)}
                        style={{
                          minHeight: 40,
                          borderColor: sent ? 'var(--accent)' : undefined,
                          color: sent ? 'var(--accent)' : undefined,
                        }}
                      >
                        <span
                          className="material-icons"
                          aria-hidden="true"
                          style={{ marginRight: 4, fontSize: 'var(--icon-sm)', verticalAlign: 'text-bottom' }}
                        >
                          {sent ? 'check_circle' : TAG_ICON[tag]}
                        </span>
                        {tKudos(`tag.${tag}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Footer
                backLabel={t('logAnother')}
                onBack={reset}
                nextLabel={t('done')}
                onNext={onClose}
              />
            </>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}

function Footer({
  backLabel,
  onBack,
  nextLabel,
  onNext,
  nextDisabled = false,
}: {
  backLabel: string;
  onBack: () => void;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
      <button type="button" className="cc-btn cc-btn-ghost" style={{ flex: 1, minHeight: 44 }} onClick={onBack}>
        {backLabel}
      </button>
      <button
        type="button"
        className="cc-btn cc-btn-primary"
        style={{ flex: 1.6, minHeight: 44 }}
        onClick={onNext}
        disabled={nextDisabled}
      >
        {nextLabel}
      </button>
    </div>
  );
}

/** 44×44 controls — the app's touch minimum, and these get tapped repeatedly. */
function Stepper({
  label,
  value,
  onChange,
  accent = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: '16px 12px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--inner-card-bg)',
        border: '1px solid var(--inner-card-border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--fs-2xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 700,
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span
        aria-live="polite"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-stat-xl)',
          fontWeight: 700,
          color: 'var(--text-primary)',
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <button
          type="button"
          aria-label={`${label} −1`}
          className="cc-btn cc-btn-secondary"
          style={{ width: 44, height: 44 }}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </button>
        <button
          type="button"
          aria-label={`${label} +1`}
          className={accent ? 'cc-btn cc-btn-primary' : 'cc-btn cc-btn-secondary'}
          style={{ width: 44, height: 44 }}
          onClick={() => onChange(Math.min(99, value + 1))}
        >
          +
        </button>
      </span>
    </div>
  );
}
