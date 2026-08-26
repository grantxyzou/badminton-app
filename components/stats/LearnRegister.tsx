'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { BottomSheet, BottomSheetBody, BottomSheetHeader } from '../BottomSheet';
import { useOnline } from '@/lib/useOnline';
import CheckInSheet from './CheckInSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The design shows exactly two. More is a chore list, fewer is not a week. */
const SHOWN = 2;

/**
 * The Learn register: a weekly focus hero, then two concrete things to do.
 *
 * THE APP PICKS THE FOCUS. There is no chooser and no setup — it is the drills
 * engine's primary pick, which is the member's lowest-rated skill, already
 * rotated weekly by session id. Asking someone to pick what to work on is
 * asking them to do the judgement they came here to outsource.
 *
 * NOTHING HERE SCOLDS. There is no overdue state, no red, no reminder, and no
 * count of weeks you skipped. The completion card is a payoff for finishing,
 * not a rebuke for not having.
 */

interface DrillPick {
  id: string;
  skillKey: string;
  skillLabel: string;
  title: string;
  description: string;
  minutes: number;
  setting: 'solo' | 'pair' | 'group';
  reason: string;
}

const SETTING_ICON: Record<DrillPick['setting'], string> = {
  solo: 'fitness_center',
  pair: 'sports_tennis',
  group: 'groups',
};

const SETTING_COLOR: Record<DrillPick['setting'], string> = {
  solo: 'var(--accent)',
  pair: 'var(--accent-amber)',
  group: 'var(--sev-low-label)',
};

export interface LearnRegisterProps {
  activeName: string | null;
  /** True when the member has never checked in — no ratings, no picks. */
  needsCheckIn?: boolean;
  onCheckedIn?: () => void;
}

export default function LearnRegister({ activeName, onCheckedIn }: LearnRegisterProps) {
  const t = useTranslations('stats.learn');
  const online = useOnline();

  const [drills, setDrills] = useState<DrillPick[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [needsCheckIn, setNeedsCheckIn] = useState(false);
  const [openDrill, setOpenDrill] = useState<DrillPick | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [saveError, setSaveError] = useState(false);
  /** Set by the sheet's onSaved, consumed by its onClose — see the sheet. */
  const savedRef = useRef(false);

  const load = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/stats/drills?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const picks = (d?.drills ?? []) as DrillPick[];
        setDrills(picks);
        setDone((d?.done ?? []) as string[]);
        // No picks means no ratings to derive them from — the engine returns
        // nothing rather than inventing a drill for an unrated skill.
        setNeedsCheckIn(picks.length === 0);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [activeName]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDone = useCallback(
    async (drill: DrillPick) => {
      const next = !done.includes(drill.id);
      setSaveError(false);
      // Optimistic: the tap should feel instant. Reverted below on failure so
      // a check mark never survives a write that did not happen.
      setDone((prev) => (next ? [...prev, drill.id] : prev.filter((d) => d !== drill.id)));
      try {
        const res = await fetch(`${BASE}/api/stats/drills/done`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drillId: drill.id, done: next }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        setDone((body?.done ?? []) as string[]);
      } catch {
        setSaveError(true);
        setDone((prev) => (next ? prev.filter((d) => d !== drill.id) : [...prev, drill.id]));
      }
    },
    [done],
  );

  if (!activeName) return null;
  if (status === 'loading') return <CardSkeleton height={320} />;
  if (status === 'error') {
    return (
      <div className="glass-card p-5">
        <ErrorState message={t('error')} />
      </div>
    );
  }

  // No check-in yet — the whole register is one invitation, not four empty
  // cards apologising for having nothing to say.
  if (needsCheckIn) {
    return (
      <>
        {/* Same shape as every other "you have no data yet" card: standing
            EmptyState over the CTA. It used to be a bare h3 + paragraph, which
            made the one card that is purely an invitation look less finished
            than the cards it sits beside. */}
        <div className="glass-card p-5 space-y-3">
          <EmptyState icon="school">{t('needsCheckInBody')}</EmptyState>
          <button
            type="button"
            className="cc-btn cc-btn-primary cc-btn-lg"
            style={{ width: '100%' }}
            onClick={() => setCheckInOpen(true)}
          >
            {t('needsCheckInCta')}
          </button>
        </div>
        <CheckInSheet
          name={activeName}
          open={checkInOpen}
          onClose={() => {
            setCheckInOpen(false);
            // Refresh only once the sheet is gone. Reloading on save flips
            // needsCheckIn false, which unmounts this whole branch — and the
            // sheet with it — destroying the SAVED step that exists precisely
            // so fourteen screens of self-assessment don't end in the sheet
            // vanishing with nothing to show for it.
            if (savedRef.current) {
              savedRef.current = false;
              load();
              onCheckedIn?.();
            }
          }}
          onSaved={() => { savedRef.current = true; }}
        />
      </>
    );
  }

  const shown = drills.slice(0, SHOWN);
  const doneCount = shown.filter((d) => done.includes(d.id)).length;
  const focus = shown[0];
  const allDone = shown.length > 0 && doneCount === shown.length;

  return (
    <>
      {/* Weekly focus hero — a gradient surface, deliberately NOT a glass card:
          it is the one thing on the register that is being asserted rather
          than listed. */}
      {focus && !allDone && (
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-6)',
            background:
              'linear-gradient(140deg, color-mix(in srgb, var(--accent) 82%, black), color-mix(in srgb, var(--accent-dark) 92%, black))',
          }}
        >
          <span
            className="material-icons"
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -10,
              right: -8,
              fontSize: 118,
              color: 'color-mix(in srgb, white 14%, transparent)',
              lineHeight: 1,
            }}
          >
            flag
          </span>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                fontSize: 'var(--fs-2xs)',
                color: 'color-mix(in srgb, white 86%, transparent)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontWeight: 700,
              }}
            >
              {t('focusEyebrow')}
            </span>
            <p
              className="bpm-h2"
              style={{ margin: '10px 0 0', color: 'white' }}
            >
              {focusTitle(t, focus)}
            </p>
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 'var(--fs-base)',
                lineHeight: 1.45,
                color: 'color-mix(in srgb, white 82%, transparent)',
              }}
            >
              {t('focusBody')}
            </p>
          </div>
        </div>
      )}

      <div className="glass-card p-5 space-y-3">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <h3 className="bpm-h3" style={{ margin: 0 }}>
            {t('twoTitle')}
          </h3>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--accent)' }}>
            {t('counter', { n: doneCount })}
          </span>
        </div>

        {shown.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {shown.map((d) => {
              const isDone = done.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setOpenDrill(d)}
                  style={{
                    display: 'flex',
                    gap: 'var(--space-4)',
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    minHeight: 52,
                    padding: 'var(--space-5)',
                    borderRadius: 'var(--radius-xl)',
                    background: isDone ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                    border: `1px solid ${isDone ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 'var(--radius-pill)',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--inner-card-bg)',
                    }}
                  >
                    <span
                      className="material-icons"
                      aria-hidden="true"
                      style={{ fontSize: 'var(--icon-lg)', color: SETTING_COLOR[d.setting] }}
                    >
                      {SETTING_ICON[d.setting]}
                    </span>
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 'var(--fs-2xs)',
                        color: SETTING_COLOR[d.setting],
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontWeight: 700,
                      }}
                    >
                      {d.skillLabel}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 2,
                        fontSize: 'var(--fs-md)',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        lineHeight: 'var(--lh-tight, 1.3)',
                      }}
                    >
                      {d.title}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 6,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-sm)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {t('minutes', { min: d.minutes })} · {d.setting}
                    </span>
                  </span>
                  <span
                    className="material-icons"
                    aria-hidden="true"
                    style={{
                      fontSize: 'var(--icon-lg)',
                      color: isDone ? 'var(--accent)' : 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {isDone ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {saveError && <ErrorState message={t('saveError')} />}
        {!online && <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('offline')}</p>}
      </div>

      {allDone && focus && (
        <div
          style={{
            background: 'var(--inner-card-green-bg)',
            border: '1px solid var(--inner-card-green-border)',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-6)',
            display: 'flex',
            gap: 'var(--space-4)',
            alignItems: 'flex-start',
          }}
        >
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent)', flexShrink: 0 }}>
            check_circle
          </span>
          <div>
            <p className="bpm-h3" style={{ margin: 0 }}>
              {t('doneTitle')}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-base)', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
              {t('doneBody', { skill: focus.skillLabel })}
            </p>
          </div>
        </div>
      )}

      <DrillSheet
        drill={openDrill}
        done={openDrill ? done.includes(openDrill.id) : false}
        online={online}
        onToggle={(d) => {
          toggleDone(d);
          setOpenDrill(null);
        }}
        onClose={() => setOpenDrill(null)}
      />
    </>
  );
}

/** Per-skill headline, falling back to a generic line for an unmapped key. */
function focusTitle(t: ReturnType<typeof useTranslations<'stats.learn'>>, drill: DrillPick): string {
  const key = `focusTitle.${drill.skillKey}` as const;
  // t.has keeps an unmapped skill from throwing MISSING_MESSAGE — the drill
  // library and this copy map can drift, and a missing headline must not take
  // the register down.
  if (typeof t.has === 'function' && !t.has(key)) {
    return t('focusFallback', { label: drill.skillLabel.toLowerCase() });
  }
  try {
    return t(key);
  } catch {
    return t('focusFallback', { label: drill.skillLabel.toLowerCase() });
  }
}

function DrillSheet({
  drill,
  done,
  online,
  onToggle,
  onClose,
}: {
  drill: DrillPick | null;
  done: boolean;
  online: boolean;
  onToggle: (d: DrillPick) => void;
  onClose: () => void;
}) {
  const t = useTranslations('stats.learn');
  return (
    <BottomSheet open={!!drill} onClose={onClose} ariaLabel={drill?.title ?? ''} maxHeight="75vh">
      <BottomSheetHeader>
        <h2 className="bpm-h3" style={{ margin: 0 }}>
          {drill?.title}
        </h2>
        <button type="button" onClick={onClose} aria-label={t('close')} className="cc-btn cc-btn-ghost" style={{ minWidth: 44, minHeight: 44 }}>
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody bare>
        {drill && (
          <div style={{ padding: '0 20px 34px', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span
                style={{
                  fontSize: 'var(--fs-2xs)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-pill)',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: SETTING_COLOR[drill.setting],
                  border: '1px solid var(--inner-card-border)',
                }}
              >
                {drill.skillLabel}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat)', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('minutes', { min: drill.minutes })}
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {drill.setting}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--fs-md)', lineHeight: 1.5, color: 'var(--text-primary)' }}>{drill.description}</p>
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', fontStyle: 'italic', color: 'var(--text-muted)' }}>{drill.reason}</p>
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
              disabled={!online}
              onClick={() => onToggle(drill)}
            >
              {done ? t('undo') : t('markDone')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
