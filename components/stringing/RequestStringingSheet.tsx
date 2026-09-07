'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import type { UseGear } from '@/components/stats/useGear';
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
  /**
   * The player's kit, MOUNTED BY THE PARENT and handed down.
   *
   * `useGear` is single-owner by rule (components/stats/CLAUDE.md): four
   * components once read `/api/equipment/gear` independently, two of them
   * writing, each with its own op counter — an out-of-order-response race that
   * shipped twice. Calling it here would be a second owner in this tree, so
   * `StringingCard` owns it and passes the object, the way `GearRegister`
   * does.
   *
   * `null` when there is no identity to read a kit for; the form then behaves
   * exactly as it did before this existed.
   */
  gear: UseGear | null;
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
export default function RequestStringingSheet({ open, onClose, onRequested, gear }: Props) {
  const t = useTranslations('home.stringing');
  // `close` lives in the shared namespace — every sheet in the app uses it.
  const tCommon = useTranslations('recovery');
  const online = useOnline();

  const [offered, setOffered] = useState<string[] | null>(null);
  const [racketLabel, setRacketLabel] = useState('');
  /* Typing a racket rather than picking one from the kit. Forced when the kit
     is empty or unreadable — an empty select is a dead end, the same reasoning
     the string dropdown already carries. */
  const [customRacket, setCustomRacket] = useState(false);
  const [pickedString, setPickedString] = useState('');
  const [customString, setCustomString] = useState('');
  const [tension, setTension] = useState(26);
  const [crosses, setCrosses] = useState(28);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  const kit = gear?.rackets ?? [];
  /**
   * THREE states, not two. `useGear` keeps `loaded` and `loadError` apart on
   * purpose and the first cut folded them back together with `||`, so while
   * the read was still in flight the sheet rendered "Type the racket — we'll
   * add it to your kit": an affirmative claim that the bag is empty, made
   * before anything had answered. That is the lying-empty-state rule, in code
   * written the same day as four fixes for it.
   *
   * It was reachable in practice — `useActiveName` resolves post-mount, so the
   * gear read starts a tick after the sheet opens, and cold starts here run
   * 10-20s. The control would then swap to a select underneath whatever the
   * player had begun typing.
   */
  const kitLoading = gear !== null && !gear.loaded && !gear.loadError;
  const kitUnreadable = gear === null || gear.loadError;
  const mustTypeRacket = !kitLoading && (kitUnreadable || kit.length === 0);
  const typingRacket = customRacket || mustTypeRacket;
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
      /**
       * A racket they typed goes into their kit, so next time it is a tap.
       *
       * Deliberately AFTER the request has succeeded and deliberately unable to
       * fail it: the restring is what they came for, and a full bag or an
       * expired cookie must not turn a placed request into an error. Same
       * best-effort posture as the stringing notifier — do the main thing, then
       * try the nicety.
       *
       * `catalogId: null` is the supported shape for a free-text entry, and the
       * endpoint dedupes on the normalised label, so re-typing a racket already
       * in the kit is a no-op rather than a duplicate.
       */
      if (typingRacket && gear) {
        try {
          await gear.addCustom(racketLabel.trim());
        } catch {
          /* the request stands either way */
        }
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
          style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: '0' }}
        >
          <span className="material-icons icon-sm">remove</span>
        </button>
        <span
          className="fs-stat"
          style={{ minWidth: 62, textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
        >
          {value}
          <span className="fs-sm" style={{ marginLeft: 'var(--space-05)', color: 'var(--text-muted)' }}>
            {t('lb')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => set(clamp(value + 1))}
          aria-label={t('increase', { field: label })}
          className="cc-btn cc-btn-secondary"
          style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: '0' }}
        >
          <span className="material-icons icon-sm">add</span>
        </button>
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('requestTitle')}>
      {/* BottomSheetHeader is a title-and-close ROW, but the close button is
          the consumer's to supply — it renders whatever children it is given.
          Passing a bare string, as this did, produces a sheet with no visible
          way out. Escape and the backdrop still worked; nothing on screen said
          so. Matches the pattern in EnterCodeSheet / RecoveryPinSheet. */}
      <BottomSheetHeader>
        <span className="fs-lg" style={{ fontWeight: 600 }}>{t('requestTitle')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tCommon('close')}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            // 44px is the tap-target floor, not a spacing value.
            minWidth: 44,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>
            close
          </span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        {done ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p role="status" className="fs-md" style={{ margin: '0', color: 'var(--text-primary)' }}>
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
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
              {t('requestSubtitle')}
            </p>

            {/* The kit first, typing second — mirroring the string control right

                below, and for the same reason: the stringer is the one who has to

                reconcile "Astrox 88D", "astrox88d" and "88d pro" for one racket. */}

            {kitLoading ? (
              /* Neither control yet. A disabled placeholder says "we are
                 asking" without asserting an answer, and does not steal focus
                 into a field that is about to be replaced. */
              <input
                type="text"
                value=""
                disabled
                readOnly
                placeholder={t('pickRacket')}
                aria-label={t('whichRacket')}
              />
            ) : typingRacket ? (
              <input
                type="text"
                value={racketLabel}
                onChange={(e) => setRacketLabel(e.target.value)}
                placeholder={t('racketPlaceholder')}
                aria-label={t('whichRacket')}
                maxLength={80}
                autoFocus
              />
            ) : (
              <select
                value={racketLabel}
                onChange={(e) => setRacketLabel(e.target.value)}
                aria-label={t('whichRacket')}
              >
                <option value="">{t('pickRacket')}</option>
                {kit.map((r) => (
                  <option key={r.id} value={r.label}>{r.label}</option>
                ))}
              </select>
            )}


            {mustTypeRacket ? (
              <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
                {kitUnreadable && gear?.loadError ? t('kitUnavailable') : t('noRacketsYet')}

              </p>
            ) : (
              <button

                type="button"

                onClick={() => setCustomRacket((v) => !v)}

                className="link-quiet"

              >

                {typingRacket ? t('backToKit') : t('otherRacket')}

              </button>

            )}

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
                  <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
                    {t('unusualPair', { suggested: crossesFor(mains) })}
                  </p>
                )}
              </>
            ) : (
              stepper(t('tension'), tension, setTension)
            )}

            {mustBeCustom ? (
              <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
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
