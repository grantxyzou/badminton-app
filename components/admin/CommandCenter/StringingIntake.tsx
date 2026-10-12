'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import DatePicker from '@/components/DatePicker';
import OfferedStringOptions from '@/components/stringing/OfferedStringOptions';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import ListRow from '@/components/primitives/ListRow';
import { useOnline } from '@/lib/useOnline';
import { formatServicePrice } from '@/lib/stringingRateCard';
import {
  TENSION_MIN_LB,
  TENSION_MAX_LB,
  priceBand,
  formatPriceBand,
} from '@/lib/stringing';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onBack: () => void;
  onCreated: () => void;
}

interface PickableMember {
  id: string;
  name: string;
}

/**
 * New job — screen 2c.
 *
 * THE MEMBER LIST IS EVERY BPM ACCOUNT HOLDER, not this week's signups.
 * Walk-ups are the entire reason this screen exists: someone hands over a
 * racket at a session they are not playing, or on a night they are not booked.
 * Filtering to the roster would make the common case the impossible one. With
 * ~50 accounts and growing it is a search field rather than a dropdown.
 *
 * NOTHING IS PREFILLED, despite the design's "Everything below is pre-filled".
 * The price is set per job by the stringer — the design's $30 was a mock — and
 * inventing a default would put a number in front of them that looks decided.
 * A job may also be created with NO price at all, which is what lets a racket
 * be logged in ten seconds at a session and priced later at the bench, instead
 * of the form demanding a figure while someone stands waiting.
 */
export default function StringingIntake({ onBack, onCreated }: Props) {
  const t = useTranslations('admin.stringing');
  const online = useOnline();

  const [members, setMembers] = useState<PickableMember[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  // Bumped by "Try again" to re-run the members load.
  const [membersAttempt, setMembersAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<PickableMember | null>(null);

  const [racketLabel, setRacketLabel] = useState('');
  const [stringLabel, setStringLabel] = useState('');
  const [mains, setMains] = useState(26);
  const [crosses, setCrosses] = useState(28);
  const [priceDollars, setPriceDollars] = useState('');
  // Once the stringer types a price, a string picked afterwards never
  // overwrites it.
  const [priceTouched, setPriceTouched] = useState(false);
  /* Each shelf string's restring price, and a restring with the player's own
     string (docs/plans/bench-redesign.md, PR 2), for prefilling. null = not
     loaded or unreachable; nothing prefills and the field is typed, which is
     the status quo and not a failure worth a message. */
  const [shelfPrices, setShelfPrices] = useState<Record<string, number | null> | null>(null);
  const [ownCents, setOwnCents] = useState<number | null>(null);
  const [readyBy, setReadyBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = (path: string) =>
      fetch(`${BASE}/api/stringing/${path}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    Promise.all([read('strings'), read('pricing')])
      .then(([shelf, card]) => {
        if (cancelled) return;
        if (shelf && Array.isArray(shelf.strings) && shelf.prices && typeof shelf.prices === 'object') setShelfPrices(shelf.prices);
        if (typeof card?.ownStringCents === 'number') setOwnCents(card.ownStringCents);
      })
      .catch(() => {
        /* stays null — nothing prefills */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMembersError(false);
    fetch(`${BASE}/api/members`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : Array.isArray(d.members) ? d.members : [];
        setMembers(
          list
            .filter((m: { id?: string; name?: string }) => m.id && m.name)
            .map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })),
        );
      })
      .catch(() => {
        if (!cancelled) setMembersError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [membersAttempt]);

  const matches = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    if (!q) return members.slice(0, 8);
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [members, search]);

  const clamp = (n: number) => Math.max(TENSION_MIN_LB, Math.min(TENSION_MAX_LB, n));

  /** The shelf string a typed label is (its own spelling, any case), or null. */
  const shelfLabelOf = (typed: string) => {
    const key = typed.trim().toLowerCase();
    if (!key || !shelfPrices) return null;
    return Object.keys(shelfPrices).find((l) => l.toLowerCase() === key) ?? null;
  };
  const shelfLabel = shelfLabelOf(stringLabel);
  const dollars = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));
  /** Typing or picking a shelf string fills its price, until the stringer types one. */
  function changeString(next: string) {
    setStringLabel(next);
    const match = shelfLabelOf(next);
    if (!priceTouched && match && shelfPrices) setPriceDollars(dollars(shelfPrices[match] ?? null));
  }

  // Empty is a legitimate price — "not decided yet", not zero.
  const priceCents = useMemo(() => {
    const raw = priceDollars.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.round(n * 100);
  }, [priceDollars]);

  const canSave =
    !busy && online && !!picked && !!racketLabel.trim() && !!stringLabel.trim() && priceCents !== undefined;

  async function save() {
    if (!canSave || !picked) return;
    setBusy(true);
    setSaveError(null);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: picked.id,
          memberName: picked.name,
          racketLabel: racketLabel.trim(),
          stringLabel: stringLabel.trim(),
          tensionMains: mains,
          tensionCrosses: crosses,
          priceCents: priceCents ?? null,
          readyBy: readyBy.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(t(`error.${data.error ?? 'generic'}`));
        setBusy(false);
        return;
      }
      onCreated();
    } catch {
      setSaveError(t('error.generic'));
      setBusy(false);
    }
  }

  return (
    <div>
      <AdminBackHeader onBack={onBack} title={t('newJob')} />
      <div className="flex flex-col gap-4 pb-6">
        {/* Who */}
        <div className="glass-card p-5 space-y-3">
          <CardHeader icon="person" title={t('who')} subtitle={t('whoHint')} />
          {membersError && (
            <ErrorState
              message={t('membersError')}
              action={
                <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setMembersAttempt((n) => n + 1)}>
                  {t('retry')}
                </button>
              }
            />
          )}
          {picked ? (
            <ListRow
              onClick={() => setPicked(null)}
              leading={<span className="material-icons icon-sm" style={{ color: 'var(--accent)' }}>check_circle</span>}
              title={<span className="fs-md" style={{ fontWeight: 600 }}>{picked.name}</span>}
              trailing={<span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('change')}</span>}
            />
          ) : (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchMembers')}
                aria-label={t('searchMembers')}
                maxLength={50}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                {matches.map((m) => (
                  <ListRow key={m.id} onClick={() => setPicked(m)} title={<span className="fs-md">{m.name}</span>} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* What */}
        <div className="glass-card p-5 space-y-3">
          <CardHeader icon="sports_tennis" title={t('theRacket')} />
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <input
              type="text"
              value={racketLabel}
              onChange={(e) => setRacketLabel(e.target.value)}
              placeholder={t('racketPlaceholder')}
              aria-label={t('racketPlaceholder')}
              maxLength={80}
            />
            <input
              type="text"
              value={stringLabel}
              onChange={(e) => changeString(e.target.value)}
              placeholder={t('stringPlaceholder')}
              aria-label={t('stringPlaceholder')}
              maxLength={80}
              list="intake-offered-strings"
            />
            <OfferedStringOptions id="intake-offered-strings" />
          </div>
        </div>

        {/* Tension */}
        <div
          className="glass-card p-5 space-y-3"
          style={{ background: 'var(--banner-green-bg)', borderColor: 'var(--banner-green-border)' }}
        >
          <CardHeader icon="bolt" title={t('tension')} />
          {([
            [t('mains'), t('mainsHint'), mains, setMains],
            [t('crosses'), t('crossesHint'), crosses, setCrosses],
          ] as [string, string, number, (n: number) => void][]).map(([label, hint, value, set]) => (
            <div
              key={label}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fs-md" style={{ fontWeight: 600 }}>{label}</div>
                <div className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{hint}</div>
              </div>
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
          ))}
        </div>

        {/* Money — and what the player will read */}
        <div className="glass-card p-5 space-y-3">
          <CardHeader icon="paid" title={t('yourPrice')} subtitle={t('priceOptional')} />
          {/* The $ sits INSIDE the field rather than in the placeholder, which
              is where the rest of the app puts it today (SetupPage's "$ per
              court"). A placeholder disappears the moment you type, so the
              unit is gone exactly when you are entering the number and most
              want to know what it means. */}
          {/* One tap fills the price, still editable: the picked string's
              shelf price, or a restring with the player's own string. A null
              ("Ask") price CLEARS the field rather than writing 0: "I'll tell
              you later" is a real answer and free is not. */}
          {(shelfLabel || ownCents !== null) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span className="section-label-muted">{t('rateCard')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {shelfLabel && shelfPrices && (
                  <button type="button" className="bpm-chip" onClick={() => { setPriceTouched(true); setPriceDollars(dollars(shelfPrices[shelfLabel] ?? null)); }}>
                    <span className="fs-sm">
                      {shelfLabel} · {formatServicePrice(shelfPrices[shelfLabel] ?? null) ?? t('rateCardAsk')}
                    </span>
                  </button>
                )}
                {ownCents !== null && (
                  <button type="button" className="bpm-chip" onClick={() => { setPriceTouched(true); setPriceDollars(dollars(ownCents)); }}>
                    <span className="fs-sm">
                      {t('ownString')} · {formatServicePrice(ownCents)}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <span
              aria-hidden="true"
              className="fs-md"
              style={{
                position: 'absolute',
                left: 'var(--space-4)',
                top: '50%',
                transform: 'translateY(-50%)',
                color: priceDollars.trim() ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                pointerEvents: 'none',
              }}
            >
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={priceDollars}
              onChange={(e) => {
                setPriceTouched(true);
                setPriceDollars(e.target.value);
              }}
              placeholder={t('pricePlaceholder')}
              aria-label={t('yourPrice')}
              maxLength={8}
              style={{ width: '100%', paddingLeft: 'var(--space-6)', fontFamily: 'var(--font-mono)' }}
            />
          </div>
          {priceCents === undefined && <p className="field-error">{t('error.invalid_price')}</p>}
          {/* A DATE, not free text. See lib/stringingDue.ts: the old free-text
              field could not be translated, could not be compared, and so
              nothing could ever be overdue — which is the entire reason a
              stringer opens the bench. */}
          <div>
            <DatePicker value={readyBy} onChange={setReadyBy} placeholder={t('readyByPlaceholder')} />
          </div>
          {/* The band, shown live. The stringer should never have to guess what
              the other side reads — that is the rule the whole feature rests on. */}
          <div
            className="fs-sm"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--divider)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              color: 'var(--text-secondary)',
            }}
          >
            <span>{t('theySee', { name: picked?.name ?? t('theyFallback') })}</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {priceCents === undefined || priceCents === null
                ? t('unpriced')
                : formatPriceBand(priceBand(priceCents))}
            </span>
          </div>
        </div>

        {saveError && <ErrorState message={saveError} />}

        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%' }}
        >
          {busy ? t('saving') : t('saveAndTell', { name: picked?.name ?? t('theyFallback') })}
        </button>
      </div>
    </div>
  );
}
