'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import { ColourDots, useReelColourName } from './StringColours';
import ReelColourPicker from './ReelColourPicker';
import { clubCombos, makerColourIds, parseShelf, type Shelf } from '@/lib/stringShelf';
import { MAX_LABEL_LEN } from '@/lib/stringingLimits';
import type { ComboColourId, CustomColour, ReelColourId } from '@/lib/stringPalette';
import type { CatalogItem } from '@/lib/types';
import { useCatalog } from '@/components/stats/useCatalog';
import { useOnline } from '@/lib/useOnline';
import { isRefused } from '@/lib/apiFetch';
import { useTabReturn } from '@/lib/tabActivity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The shelf, for a stringer who is not an admin
 * (docs/plans/stringer-shelf-edits.md; Grant, 2026-11-12: "open up reel and
 * string name, colour for stringers").
 *
 * The person who loads the reel is the one who knows it is white now, and the
 * request sheet offers members exactly the reel colours set here
 * (`requestColours`). So a stringer may NAME a string and say its COLOURS —
 * nothing else: no price, link, list, purchase or stock, which stay with an
 * admin on the bench's set-up screen. The server refuses any other field.
 *
 * The colours are picked on the SAME step the admin's shelf sheet uses
 * (`ReelColourPicker`): the maker's, two-colour sets (a stringer may make a
 * new one — a set needs no definition) and the club's own colours, without
 * "Custom colour": naming a colour of the club's is an admin's.
 */
export default function StringerShelfCard({ hasIdentity }: { hasIdentity: boolean }) {
  const t = useTranslations('home.stringing.shelfEdit');
  const online = useOnline();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const catalog = useCatalog('string');

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`strings ${res.status}`);
      const parsed = parseShelf(await res.json());
      // A throttled read answers every field null: unknown, which is not "no strings".
      if (!parsed) throw new Error('strings unknown');
      setShelf(parsed);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (hasIdentity) void load();
  }, [hasIdentity, load]);
  // An admin may have changed the list while the tab was away.
  useTabReturn(() => { if (hasIdentity) void load(); });

  useRevealReady(!hasIdentity || loadError || shelf !== null);
  if (!hasIdentity) return null;

  if (loadError) {
    return (
      <section className="glass-card p-5 space-y-3 motion-fade" aria-label={t('title')}>
        <CardHeader compact icon="tune" title={t('title')} />
        <ErrorState
          message={t('loadError')}
          action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>{t('retry')}</button>}
        />
      </section>
    );
  }
  if (!shelf) return null;

  return (
    <section className="glass-card p-5 space-y-3 motion-fade" aria-label={t('title')}>
      <CardHeader compact icon="tune" title={t('title')} subtitle={t('subtitle')} />
      {shelf.strings.length === 0 ? (
        <EmptyState icon="tune">{t('empty')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {shelf.strings.map((label) => {
            const ids = shelf.colours[label] ?? [];
            return (
              <ListRow
                key={label}
                onClick={() => setPicked(label)}
                ariaLabel={t('edit', { name: label })}
                title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{label}</span>}
                subtitle={ids.length === 0 ? <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('noColours')}</span> : undefined}
                trailing={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)' }}>
                    <ColourDots ids={ids} customs={shelf.customColours} />
                    <span className="material-icons icon-sm" aria-hidden="true">chevron_right</span>
                  </span>
                }
              />
            );
          })}
        </div>
      )}

      {picked !== null && (
        <StringerShelfSheet
          key={picked}
          label={picked}
          strings={shelf.strings}
          colours={shelf.colours[picked] ?? []}
          customs={shelf.customColours}
          clubCombos={clubCombos(shelf.colours)}
          item={shelf.links[picked] ? catalog.items.find((i) => i.id === shelf.links[picked]) ?? null : null}
          online={online}
          onClose={() => setPicked(null)}
          onSaved={(next) => {
            setShelf({ ...shelf, strings: next.strings, colours: next.colours, customColours: next.customColours });
            setPicked(null);
          }}
        />
      )}
    </section>
  );
}

type Saved = { strings: string[]; colours: Record<string, ReelColourId[]>; customColours: CustomColour[] };

/**
 * One string: its name and the colours on its reel, saved together by the one
 * button pinned at the foot of the sheet. A rename goes first, then the
 * colours under the NEW name, so the two can never land on different strings.
 */
function StringerShelfSheet({ label, strings, colours, customs, clubCombos: combos, item, online, onClose, onSaved }: {
  label: string;
  strings: string[];
  colours: ReelColourId[];
  customs: CustomColour[];
  clubCombos: ComboColourId[];
  /** The linked catalog string, for the maker's colours; `null` when not linked (or not loaded). */
  item: CatalogItem | null;
  online: boolean;
  onClose: () => void;
  onSaved: (next: Saved) => void;
}) {
  const t = useTranslations('home.stringing.shelfEdit');
  const tClose = useTranslations('recovery');
  const [name, setName] = useState(label);
  const [picked, setPicked] = useState<ReelColourId[]>(colours);
  const [step, setStep] = useState<'main' | 'colours'>('main');
  const colourName = useReelColourName(customs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'name_taken' | 'invalid_name' | 'refused' | 'failed' | null>(null);

  const trimmed = name.trim();
  // Another string with this name, any case: the same refusal the server gives, said before asking.
  const taken = strings.some((s) => s !== label && s.toLowerCase() === trimmed.toLowerCase());
  const nameOk = !!trimmed && trimmed.length <= MAX_LABEL_LEN && !taken;
  const renamed = trimmed !== label;
  const recoloured = picked.join() !== colours.join();
  const canSave = online && !busy && nameOk && (renamed || recoloured);

  async function patch(body: unknown): Promise<Saved | 'name_taken' | 'invalid_name' | 'refused' | 'failed'> {
    try {
      const res = await fetch(`${BASE}/api/stringing/strings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.strings)) {
        const shelf = parseShelf({ strings: data.strings, colours: data.colours, customColours: data.customColours });
        return shelf ? { strings: shelf.strings, colours: shelf.colours, customColours: shelf.customColours } : 'failed';
      }
      if (data.error === 'name_taken' || data.error === 'invalid_name') return data.error;
      return isRefused(res) ? 'refused' : 'failed';
    } catch {
      return 'failed';
    }
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    let current = label;
    let result: Saved | null = null;
    if (renamed) {
      const r = await patch({ rename: { from: label, to: trimmed } });
      if (typeof r === 'string') { setError(r); setBusy(false); return; }
      current = trimmed;
      result = r;
    }
    if (recoloured) {
      const r = await patch({ colours: { [current]: picked } });
      // The name may already have moved: keep it and say the colours did not.
      if (typeof r === 'string') {
        setError(r === 'name_taken' || r === 'invalid_name' ? 'failed' : r);
        setBusy(false);
        if (result) onSaved(result);
        return;
      }
      result = r;
    }
    setBusy(false);
    if (result) onSaved(result);
  }

  const errorText = error === 'name_taken' || taken
    ? t('nameTaken')
    : error === 'invalid_name' ? t('nameInvalid')
    : error === 'refused' ? t('refused')
    : error === 'failed' ? t('saveError')
    : null;

  if (step === 'colours') {
    return (
      <ReelColourPicker
        open
        onClose={onClose}
        onBack={() => setStep('main')}
        value={picked}
        onChange={setPicked}
        maker={item ? { brand: item.brand, model: item.model, ids: makerColourIds(item) } : null}
        customs={customs}
        clubCombos={combos}
      />
    );
  }

  return (
    <BottomSheet open onClose={onClose} ariaLabel={label}>
      <BottomSheetHeader onClose={onClose} closeLabel={tClose('close')}>{label}</BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="stringer-shelf-name" className="section-label-muted">{t('name')}</label>
            <input
              id="stringer-shelf-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_LABEL_LEN}
              disabled={busy}
            />
            <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('nameHint')}</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="section-label-muted">{t('onTheReel')}</span>
            <div className="bpm-inner-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                {picked.length > 0 ? (
                  <>
                    <ColourDots ids={picked} size="md" customs={customs} />
                    <span className="fs-md" style={{ color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>
                      {picked.map((id) => colourName(id)).join(', ')}
                    </span>
                  </>
                ) : (
                  <span className="fs-md" style={{ color: 'var(--text-muted)' }}>{t('noColours')}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setStep('colours')}
                disabled={busy}
                aria-label={t('editReelLabel')}
                className="fs-md"
                style={{ flex: '0 0 auto', minHeight: 44, padding: 0, background: 'transparent', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
              >
                {t('editReel')}
              </button>
            </div>
            <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('coloursHint')}</p>
          </div>
        </div>
      </BottomSheetBody>
      <BottomSheetFooter>
        <div className="flex flex-col gap-2">
          {errorText && <p className="field-error" role="alert">{errorText}</p>}
          <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }} disabled={!canSave} onClick={() => void save()}>
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
