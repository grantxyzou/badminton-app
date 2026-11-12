'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import { CUSTOM_PRESETS, HUE_STRIP, hexOfHue, hueOfHex, reelColourFill, swatchInk } from '@/lib/stringShelf';
import {
  MAX_COLOURS_PER_STRING, MAX_CUSTOM_NAME_LEN, STRING_PALETTE,
  comboIdOf, comboParts, customColourError, customIdOf, isComboColourId, normaliseColourList, normaliseHex,
  type ComboColourId, type CustomColour, type ReelColourId, type SingleColourId,
} from '@/lib/stringPalette';
import { useReelColourName } from './StringColours';

/**
 * "Colours on the reel" — the reel-colour step of a shelf sheet
 * (docs/plans/string-stock-by-colour.md, Decisions, 2026-11-12; Grant on the
 * canvas: "two colour combo like aerobites, and custom picker for future",
 * then layout improvements 1, 4 and 6). ONE component for the admin's shelf
 * sheet and the stringer's, so the two cannot drift.
 *
 * Three sections, each three tiles across, fill-only (a picked tile is a solid
 * tint, never a ring):
 *   1. "{Brand} makes {model} in" — the maker's single colours from the
 *      catalog, first; absent for a string the catalog does not know;
 *   2. "Two-colour sets" — the maker's sets (Aerobite's red mains, white
 *      crosses), the club's, any picked here, then "New combo";
 *   3. "Other colours" — the rest of the palette, the club's own colours,
 *      then "Custom colour" (only where `onAddCustom` is given: an admin).
 *
 * Nothing is saved here: a pick changes `value`, and a new colour of the
 * club's goes to `onAddCustom`; the sheet's one Save sends both.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Back to the sheet this step belongs to. */
  onBack: () => void;
  value: ReelColourId[];
  onChange: (next: ReelColourId[]) => void;
  /** The linked catalog string: who makes it and in what. `null` when it is not linked. */
  maker: { brand: string; model: string; ids: ReelColourId[] } | null;
  /** The club's own colours, including any added in this sheet and not yet saved. */
  customs: readonly CustomColour[];
  /** Sets already on the club's other strings. */
  clubCombos?: readonly ComboColourId[];
  /** A new colour of the club's. Absent hides "Custom colour" (a stringer may not add one). */
  onAddCustom?: (colour: CustomColour) => void;
}

type View = 'pick' | 'combo' | 'custom';

const SWATCH_EDGE = 'inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 30%, transparent)';
const GRID = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-2)' } as const;
const ONE_LINE = { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

/**
 * A reel colour's swatch. A set is split down the middle — mains on the left
 * with a small "M", crosses on the right with a "C" — and shows a pick by the
 * tile's tint alone; a single colour takes a check at its corner.
 */
export function ReelSwatch({ id, size = 'var(--space-8)', checked = false, letters }: {
  id: ReelColourId;
  size?: string;
  checked?: boolean;
  letters?: { mains: string; crosses: string };
}) {
  const parts = comboParts(id);
  if (parts) {
    const half = (part: SingleColourId, letter: string | undefined) => (
      <span
        className="fs-2xs"
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: reelColourFill(part), color: swatchInk(part), fontWeight: 700, lineHeight: 1 }}
      >
        {letter}
      </span>
    );
    return (
      <span
        aria-hidden="true"
        data-swatch="combo"
        style={{ display: 'flex', width: size, height: size, flex: '0 0 auto', borderRadius: '50%', overflow: 'hidden', boxShadow: SWATCH_EDGE }}
      >
        {half(parts.mains, letters?.mains)}
        {half(parts.crosses, letters?.crosses)}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ position: 'relative', width: size, height: size, flex: '0 0 auto', borderRadius: '50%', background: reelColourFill(id), boxShadow: SWATCH_EDGE }}
    >
      {checked && (
        <span
          className="material-icons icon-xs"
          style={{
            position: 'absolute',
            right: 'calc(-1 * var(--space-1))',
            bottom: 'calc(-1 * var(--space-1))',
            width: 'var(--space-6)',
            height: 'var(--space-6)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
          }}
        >
          check
        </span>
      )}
    </span>
  );
}

/** One tile: a swatch over a one-line name. */
function Tile({ checked, disabled, onClick, label, swatch, name, testId }: {
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  swatch: ReactNode;
  name: string;
  testId?: string;
}) {
  const action = checked === undefined;
  return (
    <button
      type="button"
      {...(action ? {} : { role: 'checkbox', 'aria-checked': checked })}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      className="cc-choice"
      onClick={onClick}
      style={{
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-4) var(--space-1)',
        textAlign: 'center',
        minWidth: 0,
        color: checked ? 'var(--accent)' : action ? 'var(--text-secondary)' : 'var(--text-primary)',
        // Selected is a SOLID tint, never a ring (fill-only containers).
        ...(checked ? { background: 'var(--tone-green-bg)' } : {}),
      }}
    >
      {swatch}
      <span className="fs-xs" style={{ ...ONE_LINE, fontWeight: checked ? 600 : 400 }}>{name}</span>
    </button>
  );
}

/** "New combo" / "Custom colour": a fill-only tile with a glyph where the swatch would be. */
function ActionSwatch({ icon }: { icon: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: 'var(--space-8)', height: 'var(--space-8)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--inner-card-bg)', boxShadow: SWATCH_EDGE, color: 'var(--accent)' }}
    >
      <span className="material-icons icon-md">{icon}</span>
    </span>
  );
}

/** A step's header: back chevron, title, and an optional note — or a ✕ — on the right. */
function StepHeader({ title, onBack, backLabel, right, onClose, closeLabel }: {
  title: string;
  onBack: () => void;
  backLabel: string;
  right?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <BottomSheetHeader onClose={onClose} closeLabel={closeLabel}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, flex: 1 }}>
        <button
          type="button"
          className="sheet-close-btn"
          onClick={onBack}
          aria-label={backLabel}
          style={{ marginLeft: 'calc(-1 * var(--space-4))' }}
        >
          <span className="material-icons icon-lg" aria-hidden="true">chevron_left</span>
        </button>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, minWidth: 0 }}>{title}</span>
      </span>
      {right}
    </BottomSheetHeader>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="section-label-muted">{title}</span>
      {hint && <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{hint}</p>}
      <div role="group" aria-label={title} style={GRID}>{children}</div>
    </section>
  );
}

export default function ReelColourPicker({ open, onClose, onBack, value, onChange, maker, customs, clubCombos = [], onAddCustom }: Props) {
  const t = useTranslations('home.stringing.reelPicker');
  const name = useReelColourName(customs);
  const [view, setView] = useState<View>('pick');
  const picked = new Set(value);
  const full = value.length >= MAX_COLOURS_PER_STRING;
  const letters = { mains: t('mainsLetter'), crosses: t('crossesLetter') };

  const toggle = (id: ReelColourId) => {
    if (picked.has(id)) onChange(value.filter((v) => v !== id));
    else if (!full) onChange(normaliseColourList([...value, id]));
  };
  const add = (id: ReelColourId) => {
    if (!picked.has(id) && !full) onChange(normaliseColourList([...value, id]));
  };

  if (view === 'combo') {
    return (
      <ComboStep
        open={open}
        onClose={onClose}
        onBack={() => setView('pick')}
        customs={customs}
        onAdd={(id) => {
          add(id);
          setView('pick');
        }}
      />
    );
  }
  if (view === 'custom' && onAddCustom) {
    return (
      <CustomStep
        open={open}
        onClose={onClose}
        onBack={() => setView('pick')}
        customs={customs}
        onAdd={(colour) => {
          onAddCustom(colour);
          add(colour.id);
          setView('pick');
        }}
      />
    );
  }

  const makerSingles = (maker?.ids ?? []).filter((id) => !isComboColourId(id));
  const combos: ComboColourId[] = [];
  for (const id of [...(maker?.ids ?? []), ...clubCombos, ...value]) {
    if (isComboColourId(id) && !combos.includes(id)) combos.push(id);
  }
  const others: ReelColourId[] = [
    ...STRING_PALETTE.filter((id) => !makerSingles.includes(id)),
    ...customs.map((c) => c.id).filter((id) => !makerSingles.includes(id)),
  ];

  const tile = (id: ReelColourId) => {
    const on = picked.has(id);
    const combo = isComboColourId(id);
    return (
      <Tile
        key={id}
        checked={on}
        disabled={!on && full}
        onClick={() => toggle(id)}
        label={name(id)}
        swatch={<ReelSwatch id={id} checked={on && !combo} letters={combo ? letters : undefined} />}
        name={name(id, true)}
        testId={`reel-tile-${id}`}
      />
    );
  };

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <StepHeader
        title={t('title')}
        onBack={onBack}
        backLabel={t('back')}
        right={
          <span className="fs-sm" aria-live="polite" style={{ color: 'var(--text-muted)', flex: '0 0 auto' }}>
            {t('picked', { count: value.length })}
          </span>
        }
      />
      <BottomSheetBody>
        <div key="pick" className="motion-fade flex flex-col gap-5">
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
            {full ? t('atCap', { max: MAX_COLOURS_PER_STRING }) : t('hint')}
          </p>
          {maker && makerSingles.length > 0 && (
            <Section title={t('makerTitle', { brand: maker.brand, model: maker.model })}>
              {makerSingles.map(tile)}
            </Section>
          )}
          <Section title={t('combosTitle')} hint={t('combosHint')}>
            {combos.map(tile)}
            <Tile
              disabled={full}
              onClick={() => setView('combo')}
              label={t('newCombo')}
              swatch={<ActionSwatch icon="add" />}
              name={t('newCombo')}
              testId="reel-new-combo"
            />
          </Section>
          <Section title={t('otherTitle')}>
            {others.map(tile)}
            {onAddCustom && (
              <Tile
                disabled={full}
                onClick={() => setView('custom')}
                label={t('customColour')}
                swatch={<ActionSwatch icon="add" />}
                name={t('customColour')}
                testId="reel-custom-colour"
              />
            )}
          </Section>
        </div>
      </BottomSheetBody>
      <BottomSheetFooter>
        <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }} onClick={onBack}>
          {t('done')}
        </button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}

/** A row of single colours to pick ONE from, as the app's chips. */
function SingleRow({ label, ids, value, onPick, customs }: {
  label: string;
  ids: readonly SingleColourId[];
  value: SingleColourId | null;
  onPick: (id: SingleColourId) => void;
  customs: readonly CustomColour[];
}) {
  const name = useReelColourName(customs);
  return (
    <div className="flex flex-col gap-2">
      <span className="section-label-muted">{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-2)' }}>
        {ids.map((id) => {
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(id)}
              style={{ minHeight: 44, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'inherit' }}
            >
              <span className={on ? 'filter-chip filter-chip--applied' : 'filter-chip'} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <ReelSwatch id={id} size="var(--space-4)" />
                {name(id, true)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "New combo": a mains colour, then a crosses colour, on one step with two rows. */
function ComboStep({ open, onClose, onBack, customs, onAdd }: {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  customs: readonly CustomColour[];
  onAdd: (id: ComboColourId) => void;
}) {
  const t = useTranslations('home.stringing.reelPicker');
  const name = useReelColourName(customs);
  const [mains, setMains] = useState<SingleColourId | null>(null);
  const [crosses, setCrosses] = useState<SingleColourId | null>(null);
  const singles: SingleColourId[] = [...STRING_PALETTE, ...customs.map((c) => c.id)];
  const id = comboIdOf(mains, crosses);
  const same = mains !== null && mains === crosses;
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('comboStepTitle')}>
      <StepHeader title={t('comboStepTitle')} onBack={onBack} backLabel={t('back')} onClose={onClose} closeLabel={t('close')} />
      <BottomSheetBody>
        <div key="combo" className="motion-fade flex flex-col gap-5">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            {id ? (
              <ReelSwatch id={id} size="var(--space-9)" letters={{ mains: t('mainsLetter'), crosses: t('crossesLetter') }} />
            ) : (
              <span aria-hidden="true" style={{ width: 'var(--space-9)', height: 'var(--space-9)', borderRadius: '50%', background: 'var(--inner-card-bg)', boxShadow: SWATCH_EDGE, flex: '0 0 auto' }} />
            )}
            <span className="fs-md" data-testid="combo-preview-name" style={{ color: id ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: id ? 600 : 400 }}>
              {id ? name(id) : same ? t('comboSame') : t('comboPrompt')}
            </span>
          </div>
          <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('combosHint')}</p>
          <SingleRow label={t('mains')} ids={singles} value={mains} onPick={setMains} customs={customs} />
          <SingleRow label={t('crosses')} ids={singles} value={crosses} onPick={setCrosses} customs={customs} />
        </div>
      </BottomSheetBody>
      <BottomSheetFooter>
        <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }} disabled={!id} onClick={() => id && onAdd(id)}>
          {t('addCombo')}
        </button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}

/** "Your own colour": a name, a colour (quick picks, a hue strip, or a hex), and Add. */
function CustomStep({ open, onClose, onBack, customs, onAdd }: {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  customs: readonly CustomColour[];
  onAdd: (colour: CustomColour) => void;
}) {
  const t = useTranslations('home.stringing.reelPicker');
  const [nameDraft, setNameDraft] = useState('');
  const [hexDraft, setHexDraft] = useState(CUSTOM_PRESETS[0]);
  const hex = normaliseHex(hexDraft);
  const trimmed = nameDraft.trim();
  const error = customColourError(customs, trimmed, hexDraft);
  // The hex is judged as soon as it is wrong; the name once one is typed.
  const sameHex = hex ? customs.find((c) => c.hex === hex) : undefined;
  const message = !hex ? t('hexInvalid')
    : sameHex ? t('hexTaken', { name: sameHex.name })
    : !trimmed || !error ? null
    : error === 'colour_name_taken' ? t('nameTaken')
    : t('nameInvalid');
  const pickHex = (h: string) => setHexDraft(h.toUpperCase());

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('customStepTitle')}>
      <StepHeader title={t('customStepTitle')} onBack={onBack} backLabel={t('back')} onClose={onClose} closeLabel={t('close')} />
      <BottomSheetBody>
        <div key="custom" className="motion-fade flex flex-col gap-5">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <span
              aria-hidden="true"
              data-testid="custom-preview"
              style={{ width: 'var(--space-9)', height: 'var(--space-9)', flex: '0 0 auto', borderRadius: '50%', background: hex ?? 'var(--inner-card-bg)', boxShadow: SWATCH_EDGE }}
            />
            <span className="flex flex-col gap-1" style={{ minWidth: 0 }}>
              <span className="fs-md" style={{ fontWeight: 600, color: trimmed ? 'var(--text-primary)' : 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                {trimmed || t('customPreviewName')}
              </span>
              <span className="fs-xs" style={{ color: 'var(--text-muted)' }}>{t('customPreviewHint')}</span>
            </span>
          </div>
          <div className="bpm-field-filled">
            <div className="bpm-field-filled-label">
              <label htmlFor="reel-custom-name">{t('customName')}</label>
              <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)' }}>{`${nameDraft.length}/${MAX_CUSTOM_NAME_LEN}`}</span>
            </div>
            <input
              id="reel-custom-name"
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={MAX_CUSTOM_NAME_LEN}
              placeholder={t('customNamePlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="section-label-muted">{t('quickPicks')}</span>
            {/* One row of eight, each a full 44px tap. */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${CUSTOM_PRESETS.length}, minmax(0, 1fr))` }}>
              {CUSTOM_PRESETS.map((p) => {
                const on = hex === p;
                return (
                  <button
                    key={p}
                    type="button"
                    aria-label={t('usePreset', { hex: p.toUpperCase() })}
                    aria-pressed={on}
                    onClick={() => pickHex(p)}
                    style={{ minHeight: 44, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 'var(--space-7)',
                        height: 'var(--space-7)',
                        borderRadius: '50%',
                        background: p,
                        // The chosen one: a thicker inner edge in the page ink, not a ring around the button.
                        boxShadow: on ? 'inset 0 0 0 3px var(--text-primary)' : SWATCH_EDGE,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="reel-custom-hue" className="section-label-muted">{t('hue')}</label>
            <input
              id="reel-custom-hue"
              type="range"
              className="reel-hue"
              min={0}
              max={359}
              value={hex ? hueOfHex(hex) : 0}
              onChange={(e) => pickHex(hexOfHue(Number(e.target.value)))}
              style={{ background: HUE_STRIP }}
            />
          </div>
          <div className="bpm-field-filled">
            <div className="bpm-field-filled-label">
              <label htmlFor="reel-custom-hex">{t('hex')}</label>
            </div>
            <input
              id="reel-custom-hex"
              type="text"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              maxLength={7}
              spellCheck={false}
              autoCapitalize="characters"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          {message ? (
            <p className="field-error" role="alert">{message}</p>
          ) : (
            <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('customHint')}</p>
          )}
        </div>
      </BottomSheetBody>
      <BottomSheetFooter>
        <button
          type="button"
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%' }}
          disabled={!!error || !hex}
          onClick={() => {
            const id = hex ? customIdOf(hex) : null;
            if (!error && hex && id) onAdd({ id, name: trimmed, hex });
          }}
        >
          {t('addColour')}
        </button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}

