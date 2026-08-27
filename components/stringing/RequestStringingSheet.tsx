'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import {
  TENSION_MIN_LB,
  TENSION_MAX_LB,
  crossesFor,
  isConventionalPair,
} from '@/lib/stringing';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  onRequested: () => void;
}

/**
 * A player asking for a restring — the intake form.
 *
 * TWO STATES, AND THE SIMPLE ONE IS THE DEFAULT
 *
 * Standard: pick a string the club stocks from a dropdown, and set ONE tension
 * number. The crosses are derived at +2 lb (`crossesFor`), because that is
 * what a stringer would have chosen anyway — cross strings are shorter and
 * woven through the mains, so they finish looser at the same reference
 * tension. Asking a player for two numbers invites a pair nobody would pick.
 *
 * Custom: the string becomes free text and the tension splits into mains and
 * crosses, set independently. Unconventional pairs are HINTED at, never
 * refused — someone who wants 28/28 is entitled to it, and blocking would be
 * the app overruling them about their own racket.
 *
 * WHY THE DROPDOWN IS ADMIN-FED. A free-text string field produces "bg80",
 * "BG-80", "Bg 80 white" and "yonex 80" for one spool, and the person who has
 * to reconcile that is the stringer. They declare what they stock on the
 * bench; this reads it.
 *
 * When nothing is stocked yet — or the list could not be read — the form falls
 * back to the custom path rather than presenting an empty dropdown. An empty
 * select is a dead end; a text box is not.
 */
export default function RequestStringingSheet({ open, onClose, onRequested }: Props) {
  const t = useTranslations('home.stringing');
  const online = useOnline();

  const [offered, setOffered] = useState<string[] | null>(null);
  const [racketLabel, setRacketLabel] = useState('');
  const [pickedString, setPickedString] = useState('');
  const [customString, setCustomString] = useState('');
  const [tension, setTension] = useState(26);
  const [crosses, setCrosses] = useState(28);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setOffered(d && Array.isArray(d.strings) ? d.strings : null);
      })
      .catch(() => {
        /* stays null — the form falls back to the custom path */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // No list, or a list we could not read, means the dropdown has nothing to
  // offer. Forcing custom is the only honest option.
  const mustBeCustom = offered === null || offered.length === 0;
  const isCustom = custom || mustBeCustom;

  const clamp = (n: number) => Math.max(TENSION_MIN_LB, Math.min(TENSION_MAX_LB, n));
  const stringLabel = (isCustom ? customString : pickedString).trim();
  const mains = tension;
  const finalCrosses = isCustom ? crosses : crossesFor(mains);
  const canSubmit = !busy && online && !!racketLabel.trim() && !!stringLabel;

  function enterCustom() {
    // Carry the simple choice forward rather than resetting: someone opening
    // custom usually wants to ADJUST what they had, not start over.
    if (!customString && pickedString) setCustomString(pickedString);
    setCrosses(crossesFor(tension));
    setCustom(true);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/stringing/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          racketLabel: racketLabel.trim(),
          stringLabel,
          tensionMains: mains,
          tensionCrosses: finalCrosses,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(t(`error.${data.error ?? 'generic'}`));
        setBusy(false);
        return;
      }
      setDone(true);
      setBusy(false);
      onRequested();
    } catch {
      setError(t('error.generic'));
      setBusy(false);
    }
  }

  function stepper(label: string, value: number, set: (n: number) => void) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <span className="fs-md" style={{ flex: 1 }}>{label}</span>
        <button
          type="button"
          onClick={() => set(clamp(value - 1))}
          aria-label={t('decrease', { field: label })}
          className="cc-btn cc-btn-secondary"
          style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: 0 }}
        >
          <span className="material-icons icon-sm">remove</span>
        </button>
        <span
          className="fs-stat"
          style={{ minWidth: 62, textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
        >
          {value}
          <span className="fs-sm" style={{ marginLeft: 2, color: 'var(--text-muted)' }}>
            {t('lb')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => set(clamp(value + 1))}
          aria-label={t('increase', { field: label })}
          className="cc-btn cc-btn-secondary"
          style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: 0 }}
        >
          <span className="material-icons icon-sm">add</span>
        </button>
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('requestTitle')}>
      <BottomSheetHeader>{t('requestTitle')}</BottomSheetHeader>
      <BottomSheetBody>
        {done ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p role="status" className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
              {t('requestSent')}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {t('requestDone')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
              {t('requestSubtitle')}
            </p>

            <input
              type="text"
              value={racketLabel}
              onChange={(e) => setRacketLabel(e.target.value)}
              placeholder={t('racketPlaceholder')}
              aria-label={t('racketPlaceholder')}
              maxLength={80}
              autoFocus
            />

            {isCustom ? (
              <input
                type="text"
                value={customString}
                onChange={(e) => setCustomString(e.target.value)}
                placeholder={t('stringPlaceholder')}
                aria-label={t('stringPlaceholder')}
                maxLength={80}
              />
            ) : (
              <select
                value={pickedString}
                onChange={(e) => setPickedString(e.target.value)}
                aria-label={t('whichString')}
              >
                <option value="">{t('pickString')}</option>
                {(offered ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}

            {isCustom ? (
              <>
                {stepper(t('mains'), mains, setTension)}
                {stepper(t('crosses'), crosses, setCrosses)}
                {!isConventionalPair(mains, crosses) && (
                  <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                    {t('unusualPair', { suggested: crossesFor(mains) })}
                  </p>
                )}
              </>
            ) : (
              stepper(t('tension'), tension, setTension)
            )}

            {mustBeCustom ? (
              <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {t('noStringsYet')}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => (custom ? setCustom(false) : enterCustom())}
                className="link-quiet"
              >
                {custom ? t('standardRequest') : t('customRequest')}
              </button>
            )}

            {error && <p className="field-error">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('requestSending') : t('sendCta')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
