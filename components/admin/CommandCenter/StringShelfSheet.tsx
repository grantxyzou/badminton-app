'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import ActionRow from '@/components/primitives/ActionRow';
import ErrorState from '@/components/primitives/ErrorState';
import { catalogLabel, matches, parsePrice, priceDraftOf } from '@/lib/shelfEdit';
import { MAX_LABEL_LEN, MAX_NOTE_LEN } from '@/lib/stringingLimits';
import { comboParts, isReelColourId, type ComboColourId, type CustomColour, type ReelColourId } from '@/lib/stringPalette';
import { makerColourIds, stringTypeOf } from '@/lib/stringShelf';
import { stringPackSrc } from '@/lib/stringPackSrc';
import { fmtMoney } from '@/lib/fmt';
import { ColourDot, ColourDots, useReelColourName } from '@/components/stringing/StringColours';
import ReelColourPicker from '@/components/stringing/ReelColourPicker';
import StringPackImage from '@/components/stringing/StringPackImage';
import MoneyInput from '@/components/primitives/MoneyInput';
import ListRow from '@/components/primitives/ListRow';
import type { StringStockLine } from '@/lib/stringStockMath';
import type { CatalogItem, StringPurchase } from '@/lib/types';

const money = (cents: number) => fmtMoney(cents / 100);

/**
 * Everything about ONE string, in one place (docs/plans/bench-redesign.md).
 * Replaces the chip that packed link, price and remove into a pill, and the
 * second list that repeated the same strings with their stock.
 *
 *   offered  — a string on the shelf: price, stock, purchases, catalog link,
 *              the old spellings counted as it, and Remove.
 *   offShelf — stock bought under a name the shelf does not offer: count it
 *              as a shelf string (an alias), or offer it as its own.
 *   jobLabel — a name jobs were strung with that the shelf does not offer:
 *              count it as a shelf string. No "Offer it": these are mostly
 *              old typos, and the shelf is what players pick from.
 *
 * The offered sheet ("A string on the shelf · rethought", Grant 2026-11-12:
 * "rethink about this page, use mobbin" → "build it"): who it is (packet,
 * name, the catalog match), what is left and what it earns, then its details
 * — name, price, note and reel colours — saved together by ONE Save pinned in
 * the footer. Purchases and Remove act at once, as before: each is its own
 * action, not an edit to the string.
 *
 * Mount with a fresh `key` per opening: the drafts are `useState` initialisers.
 */
export type ShelfSheetMode = 'offered' | 'offShelf' | 'jobLabel';

/** What one Save changes. Only the fields that changed are present. */
export interface ShelfEdits {
  name?: string;
  /** Cents; `null` is "Ask". */
  price?: number | null;
  /** Trimmed; empty deletes it. */
  note?: string;
  /** Empty falls back to the maker's colours. */
  colours?: ReelColourId[];
  /** Colours of the club's own named in this sheet that the new list uses: saved WITH it. */
  addColours?: CustomColour[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: ShelfSheetMode;
  label: string;
  busy: boolean;
  online: boolean;
  /** The last save failed. Said HERE, because the card's own message sits
   *  behind this sheet (review of the bench redesign, finding 4). */
  error?: boolean;
  /** offered */
  price?: number | null;
  line?: StringStockLine | null;
  /** The purchases this line's stock was counted from (offered and offShelf). */
  purchases?: StringPurchase[];
  /** The stored link. Decides "matched", whatever the catalog read says. */
  linkedId?: string | null;
  /** That link's catalog row, when the catalog has it. */
  linked?: CatalogItem | null;
  catalog?: CatalogItem[];
  catalogState?: 'loading' | 'ready' | 'failed';
  aliasesHere?: string[];
  /** offShelf / jobLabel: the shelf strings it could be counted as. */
  offered?: string[];
  /** jobLabel: how many rackets carry the name. */
  jobCount?: number;
  onLogPurchase?: () => void;
  onRemovePurchase?: (id: string) => void;
  onLink?: (item: CatalogItem) => void;
  onRemoveAlias?: (from: string) => void;
  onRemove?: () => void;
  onAlias?: (target: string) => void;
  onOffer?: () => void;
  /** offered: the colours the club has it in. */
  colours?: ReelColourId[];
  /** The club's own colours (`custom:<rrggbb>`), for names and the picker. */
  customColours?: CustomColour[];
  /** Two-colour sets on the club's other strings, offered in the picker. */
  clubCombos?: ComboColourId[];
  /** offered: the stringer's note players see on the string's page. */
  note?: string;
  /**
   * offered: the one Save. The card renames FIRST (when the name changed),
   * then saves the rest under the new name; it answers `renameError` if the
   * server refused the name.
   */
  onSave?: (edits: ShelfEdits) => void;
  renameError?: 'name_taken' | 'invalid_name' | null;
}

/** A filled field with its label inside it, and an optional counter. */
function FilledField({ id, label, counter, children }: { id: string; label: string; counter?: string; children: ReactNode }) {
  return (
    <div className="bpm-field-filled">
      <div className="bpm-field-filled-label">
        <label htmlFor={id}>{label}</label>
        {counter && <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)' }}>{counter}</span>}
      </div>
      {children}
    </div>
  );
}

export default function StringShelfSheet(props: Props) {
  const { open, onClose, mode, label, busy, online } = props;
  const t = useTranslations('admin.stringing');
  // The palette's names and the string types live with the member copy; the bench reads the same ones.
  const tOffer = useTranslations('home.stringing.offer');
  const locale = useLocale();
  const [priceDraft, setPriceDraft] = useState(() => priceDraftOf(props.price));
  const [query, setQuery] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [nameDraft, setNameDraft] = useState(label);
  const [colourDraft, setColourDraft] = useState<ReelColourId[]>(() => props.colours ?? []);
  // Colours of the club's own named in this sheet, held until Save like every other edit.
  const [customDraft, setCustomDraft] = useState<CustomColour[]>([]);
  const customs = [...(props.customColours ?? []), ...customDraft];
  const colourName = useReelColourName(customs);
  const [noteDraft, setNoteDraft] = useState(() => props.note ?? '');
  const [step, setStep] = useState<'main' | 'colours'>('main');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The name the last Save sent: a refusal is said only while it is still the name typed.
  const [sentName, setSentName] = useState<string | null>(null);
  // Save was the last thing pressed: "Saving…" is not said over a purchase being deleted.
  const [saving, setSaving] = useState(false);
  const off = busy || !online;

  // The purchase's own day, in the app's language. Parsed as UTC noon and
  // shown in UTC, so no phone's zone can move it a day.
  const day = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  const nameTrim = nameDraft.trim();
  // Another offered string with this name, any case: refused here before the
  // server is asked, and said in the same words the server's 409 gets.
  const nameTaken = (props.offered ?? []).some((s) => s !== label && s.toLowerCase() === nameTrim.toLowerCase());
  const nameChanged = nameTrim !== label;
  const nameOk = !!nameTrim && nameTrim.length <= MAX_LABEL_LEN && !nameTaken;
  const refused = props.renameError && sentName === nameTrim ? props.renameError : null;
  const nameError = nameTaken || refused === 'name_taken'
    ? t('shelf.sheet.nameTaken')
    : refused === 'invalid_name' || (nameChanged && !nameTrim) ? t('shelf.sheet.nameInvalid') : null;
  const coloursChanged = colourDraft.join() !== (props.colours ?? []).join();
  const noteChanged = noteDraft.trim() !== (props.note ?? '').trim();
  const parsed = parsePrice(priceDraft);
  // Against the STORED value, unset included: an empty field on a string with
  // no price saves "Ask" (null), which is different from no price at all.
  const priceChanged = parsed !== undefined && parsed !== props.price;
  const changed = nameChanged || priceChanged || noteChanged || coloursChanged;
  const canSave = !off && changed && nameOk && parsed !== undefined;
  const errorLine = props.error ? <ErrorState message={t('strings.saveError')} /> : null;

  function save() {
    if (!canSave) return;
    const edits: ShelfEdits = {};
    if (nameChanged) edits.name = nameTrim;
    if (priceChanged) edits.price = parsed ?? null;
    if (noteChanged) edits.note = noteDraft.trim();
    if (coloursChanged) {
      edits.colours = colourDraft;
      // Only the new colours this list still uses: one added then unpicked is forgotten with the sheet.
      const uses = (id: string) => colourDraft.some((c) => c === id || comboParts(c)?.mains === id || comboParts(c)?.crosses === id);
      const added = customDraft.filter((c) => uses(c.id));
      if (added.length > 0) edits.addColours = added;
    }
    setSentName(nameChanged ? nameTrim : null);
    setSaving(true);
    props.onSave?.(edits);
  }
  const saveOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canSave) {
      e.preventDefault();
      save();
    }
  };

  /** One purchase per filled row, its delete behind ⋯. Shared by both sheet modes. */
  const purchaseList = (purchases: StringPurchase[]) =>
    purchases.length > 0 && (
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="flex flex-col gap-2">
        {purchases.map((p) => {
          const sub = [
            day(p.date),
            isReelColourId(p.color) ? colourName(p.color) : null,
            p.label !== label ? p.label : null,
            p.notes || null,
          ].filter(Boolean).join(' · ');
          const menuOpen = menuFor === p.id;
          return (
            <li key={p.id} className="bpm-inner-row">
              <ListRow
                leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>inventory_2</span>}
                title={
                  <span className="fs-md" style={{ color: 'var(--text-primary)' }}>
                    {t(p.unit === 'set' ? 'shelf.sheet.purchaseSets' : 'shelf.sheet.purchaseReels', {
                      units: p.units,
                      metres: p.metresPerUnit,
                      cost: money(p.totalCostCents),
                    })}
                  </span>
                }
                subtitle={<span style={{ overflowWrap: 'anywhere' }}>{sub}</span>}
                trailing={
                  menuOpen ? (
                    <span className="motion-fade" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto' }}>
                      <button
                        type="button"
                        className="cc-btn cc-btn-danger"
                        disabled={off}
                        onClick={() => {
                          setMenuFor(null);
                          setSaving(false);
                          props.onRemovePurchase?.(p.id);
                        }}
                        aria-label={t('shelf.sheet.removePurchase', { date: day(p.date) })}
                      >
                        {t('shelf.sheet.purchaseDelete')}
                      </button>
                      <button
                        type="button"
                        className="sheet-close-btn"
                        onClick={() => setMenuFor(null)}
                        aria-label={t('actions.close')}
                      >
                        <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>close</span>
                      </button>
                    </span>
                  ) : (
                    // The sheet header's bare icon button: a glyph, no outline.
                    <button
                      type="button"
                      className="sheet-close-btn"
                      disabled={off}
                      onClick={() => setMenuFor(p.id)}
                      aria-label={t('shelf.sheet.purchaseMore', { date: day(p.date) })}
                      aria-expanded={false}
                      style={{ opacity: off ? 0.5 : 1 }}
                    >
                      <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>more_horiz</span>
                    </button>
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    );

  if (mode !== 'offered') {
    const offered = props.offered ?? [];
    return (
      <BottomSheet open={open} onClose={onClose} ariaLabel={label}>
        <BottomSheetHeader onClose={onClose} closeLabel={t('actions.close')}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{label}</span>
        </BottomSheetHeader>
        <BottomSheetBody>
          <div className="flex flex-col gap-4">
            {errorLine}
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {mode === 'offShelf'
                ? t('shelf.sheet.offShelfIntro', { sets: props.line?.remainingSets ?? 0 })
                : t('shelf.sheet.jobLabelIntro', { count: props.jobCount ?? 0 })}
            </p>
            {/* Its purchases, so a typo'd label's reel can be deleted without
                first counting it as some other string. */}
            {mode === 'offShelf' && purchaseList(props.purchases ?? [])}
            {offered.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="section-label-muted">{t('shelf.sheet.sameAs')}</span>
                {offered.map((target) => (
                  <ActionRow
                    key={target}
                    icon="link"
                    label={target}
                    disabled={off}
                    onClick={() => props.onAlias?.(target)}
                  />
                ))}
              </div>
            )}
            {mode === 'offShelf' && (
              <ActionRow
                icon="add"
                label={t('shelf.sheet.offerIt')}
                hint={t('shelf.sheet.offerItHint')}
                disabled={off}
                onClick={() => props.onOffer?.()}
              />
            )}
          </div>
        </BottomSheetBody>
      </BottomSheet>
    );
  }

  const line = props.line ?? null;
  const purchases = props.purchases ?? [];
  const linkedId = props.linkedId ?? null;
  const catalogReady = props.catalogState === 'ready';
  const suggestions = linkedId || !catalogReady ? [] : matches(props.catalog ?? [], query.trim() || label);
  const type = stringTypeOf(props.linked ?? null);
  const colourNames = colourDraft.map((id) => colourName(id)).join(', ');

  // ── The colour picker: a second step of the same sheet, shared with the
  //    stringer's (`ReelColourPicker`). What is picked — and any colour of
  //    the club's named on the way — is held here until Save. ──
  if (step === 'colours') {
    const linked = props.linked ?? null;
    return (
      <ReelColourPicker
        open={open}
        onClose={onClose}
        onBack={() => setStep('main')}
        value={colourDraft}
        onChange={setColourDraft}
        maker={linked ? { brand: linked.brand, model: linked.model, ids: makerColourIds(linked) } : null}
        customs={customs}
        clubCombos={props.clubCombos ?? []}
        onAddCustom={(c) => setCustomDraft((d) => (d.some((x) => x.id === c.id) ? d : [...d, c]))}
      />
    );
  }

  const margin = line && line.costPerSetCents !== null && typeof props.price === 'number'
    ? props.price - line.costPerSetCents
    : null;
  const hasStock = !!line && line.purchases > 0;
  const remainingPct = hasStock && line.purchasedMetres > 0
    ? Math.max(0, Math.min(100, (line.remainingMetres / line.purchasedMetres) * 100))
    : 0;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={label}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('actions.close')}>
        {/* WHO IT IS — the packet, the name, and the catalog match in place of
            a "Catalog" section of its own. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0, flex: 1 }}>
          {linkedId && stringPackSrc(linkedId) ? (
            <StringPackImage catalogId={linkedId} size="row" />
          ) : (
            <span
              aria-hidden="true"
              className="string-pack-row"
              style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', background: 'var(--inner-card-bg)', color: 'var(--text-muted)' }}
            >
              <span className="material-icons icon-md">inventory_2</span>
            </span>
          )}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-05)', minWidth: 0 }}>
            <span className="bpm-h2" style={{ overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>{label}</span>
            {/* "Matched" comes from the STORED link. The catalog row only adds
                its name: a catalog still loading, or one that failed, must not
                read as "not matched" and offer a search that overwrites it. */}
            {linkedId ? (
              <span data-testid="shelf-catalog-line" className="fs-sm" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--text-secondary)' }}>
                <span className="material-icons icon-xs" role="img" aria-label={t('shelf.sheet.matched')} style={{ color: 'var(--accent)' }}>check</span>
                <span style={{ minWidth: 0 }}>
                  {props.linked
                    ? [catalogLabel(props.linked), type ? tOffer(`hero_${type}`) : null].filter(Boolean).join(' · ')
                    : t('shelf.sheet.linkedUnknown')}
                </span>
              </span>
            ) : (
              <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                {props.catalogState === 'failed' ? t('shelf.sheet.catalogError') : t('shelf.sheet.notLinked')}
              </span>
            )}
          </span>
        </span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div key="main" className="motion-fade flex flex-col gap-6">
          {/* MATCH IT — only while it is not matched: the catalog search, small, under the header. */}
          {!linkedId && props.catalogState !== 'failed' && (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('shelf.sheet.linkSearch')}
                aria-label={t('shelf.sheet.linkSearch')}
                maxLength={60}
                disabled={!catalogReady}
              />
              {suggestions.length > 0 && (
                <div role="group" aria-label={t('strings.matches')} className="flex flex-col gap-2">
                  {suggestions.map((i) => (
                    <ListRow
                      key={i.id}
                      disabled={off}
                      onClick={() => props.onLink?.(i)}
                      title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{catalogLabel(i)}</span>}
                      subtitle={typeof i.attributes?.gaugeMm === 'number' ? `${i.attributes.gaugeMm.toFixed(2)}mm` : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STOCK FIRST — counted from jobs; the only thing logged here is a purchase. */}
          <section
            data-testid="shelf-stock"
            aria-label={t('shelf.sheet.stock')}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', background: 'var(--tone-green-bg)' }}
          >
            {hasStock ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{line.remainingSets}</span>
                    <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('shelf.sheet.setsLeftLabel', { count: line.remainingSets })}</span>
                  </span>
                  <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {t('shelf.sheet.metresOf', { remaining: line.remainingMetres, purchased: line.purchasedMetres })}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={t('shelf.sheet.metresOf', { remaining: line.remainingMetres, purchased: line.purchasedMetres })}
                  aria-valuemin={0}
                  aria-valuemax={line.purchasedMetres}
                  aria-valuenow={Math.max(0, line.remainingMetres)}
                  style={{ position: 'relative', height: 'var(--space-2)', borderRadius: 'var(--radius-pill)', overflow: 'hidden', background: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}
                >
                  <span className="bpm-meter-fill" style={{ width: `${remainingPct}%`, background: 'var(--accent)' }} />
                </div>
                <div className="fs-sm" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {[
                      t('shelf.sheet.usedOnly', { used: line.usedSets }),
                      line.costPerSetCents !== null ? t('shelf.sheet.costsYou', { cost: money(line.costPerSetCents) }) : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  {/* What a set earns: said plainly either way, never in an alarm colour. */}
                  {margin !== null && (
                    <span style={{ fontWeight: 600, color: margin >= 0 ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      {margin >= 0
                        ? t('shelf.sheet.margin', { amount: money(margin) })
                        : t('shelf.sheet.marginLoss', { amount: money(-margin) })}
                    </span>
                  )}
                </div>
                {/* Per colour, once a purchase says one (docs/plans/string-stock-by-colour.md):
                    what the request sheet offers a member is read from these. */}
                {(line.byColour?.length ?? 0) > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="flex flex-col gap-1">
                    {line.byColour.map((c) => (
                      <li key={c.color} className="fs-sm" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: c.remainingSets > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                        <ColourDot id={c.color} size="sm" />
                        {t('shelf.sheet.byColour', { colour: colourName(c.color), count: c.remainingSets })}
                      </li>
                    ))}
                    {purchases.some((p) => !isReelColourId(p.color)) && (
                      <li className="fs-sm" style={{ color: line.mixedRemainingSets > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                        {t('shelf.sheet.mixedPool', { count: line.mixedRemainingSets })}
                      </li>
                    )}
                  </ul>
                )}
              </>
            ) : (
              <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>
                {t('shelf.noStock')}
                {line && line.usedSets > 0 ? ` · ${t('shelf.sheet.usedOnly', { used: line.usedSets })}` : ''}
              </span>
            )}
          </section>

          {/* DETAILS — what the shelf, the request form and the bench call it,
              what a player pays, and the stringer's word on it. Renaming keeps
              its price, link, colours and stock: jobs and purchases under the
              old name go on counting as this string. */}
          <section className="flex flex-col gap-2" aria-labelledby="shelf-details">
            <span id="shelf-details" className="section-label-muted">{t('shelf.sheet.details')}</span>
            <FilledField id="shelf-name" label={t('shelf.sheet.name')} counter={`${nameDraft.length}/${MAX_LABEL_LEN}`}>
              <input
                id="shelf-name"
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={saveOnEnter}
                maxLength={MAX_LABEL_LEN}
              />
            </FilledField>
            <FilledField id="shelf-price" label={t('strings.price')}>
              <MoneyInput
                id="shelf-price"
                value={priceDraft}
                onChange={setPriceDraft}
                onKeyDown={saveOnEnter}
                placeholder={t('strings.priceAsk')}
                maxLength={7}
              />
            </FilledField>
            <FilledField id="shelf-note" label={t('shelf.sheet.note')} counter={`${noteDraft.length}/${MAX_NOTE_LEN}`}>
              <textarea
                id="shelf-note"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                maxLength={MAX_NOTE_LEN}
                rows={3}
                placeholder={t('shelf.sheet.notePlaceholder')}
              />
            </FilledField>
            {nameError ? (
              <p className="field-error" role="alert">{nameError}</p>
            ) : parsed === undefined ? (
              <p className="field-error" role="alert">{t('shelf.sheet.priceInvalid')}</p>
            ) : (
              <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('shelf.sheet.renameHint')}</p>
            )}
          </section>

          {/* ON THE REEL — what players pick from when they ask for a restring,
              in place of the maker's list. Picked on a step of its own. */}
          <section className="flex flex-col gap-2" aria-labelledby="shelf-reel">
            <span id="shelf-reel" className="section-label-muted">{t('shelf.sheet.onTheReel')}</span>
            <div className="bpm-inner-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                {colourDraft.length > 0 ? (
                  <>
                    <ColourDots ids={colourDraft} size="md" customs={customs} />
                    <span className="fs-md" style={{ color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>{colourNames}</span>
                  </>
                ) : (
                  <span className="fs-md" style={{ color: 'var(--text-muted)' }}>{t('shelf.sheet.reelNone')}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setStep('colours')}
                aria-label={t('shelf.sheet.editColours')}
                className="fs-md"
                style={{ flex: '0 0 auto', minHeight: 44, padding: 0, background: 'transparent', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
              >
                {t('shelf.sheet.edit')}
              </button>
            </div>
            <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('shelf.sheet.coloursHint')}</p>
          </section>

          {/* PURCHASES — each its own action, at once: delete behind ⋯, log a new one. */}
          <section className="flex flex-col gap-2" aria-labelledby="shelf-purchases">
            <span id="shelf-purchases" className="section-label-muted">{t('shelf.sheet.purchases')}</span>
            {purchaseList(purchases)}
            <ListRow
              onClick={() => props.onLogPurchase?.()}
              disabled={off}
              leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>add</span>}
              title={<span className="fs-md" style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('shelf.sheet.logPurchase')}</span>}
            />
          </section>

          {/* OLD SPELLINGS counted as this string. */}
          {(props.aliasesHere ?? []).length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="shelf-aliases">
              <span id="shelf-aliases" className="section-label-muted">{t('shelf.sheet.alsoCounts')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {(props.aliasesHere ?? []).map((from) => (
                  <span key={from} className="bpm-chip fs-sm" style={{ cursor: 'default' }}>
                    {from}
                    <button
                      type="button"
                      disabled={off}
                      onClick={() => props.onRemoveAlias?.(from)}
                      aria-label={t('shelf.sheet.removeAlias', { name: from })}
                      style={{ background: 'transparent', border: 'none', padding: 0, display: 'inline-flex', cursor: 'pointer' }}
                    >
                      <span className="material-icons icon-xs" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>close</span>
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* REMOVE — last, quiet, and two taps: the price and links go with it. */}
          {!confirmingRemove ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                className="link-quiet"
                disabled={off}
                onClick={() => {
                  setSaving(false);
                  setConfirmingRemove(true);
                }}
                style={{ gap: 'var(--space-2)', textDecoration: 'none', color: 'var(--sev-crit-text)', fontWeight: 600 }}
              >
                <span className="material-icons icon-sm" aria-hidden="true">delete_outline</span>
                {t('shelf.sheet.remove')}
              </button>
            </div>
          ) : (
            <div className="motion-fade flex flex-col gap-3">
              <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
                {t('shelf.sheet.removeConfirm', { name: label })}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button type="button" className="cc-btn cc-btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmingRemove(false)}>
                  {t('shelf.sheet.removeKeep')}
                </button>
                <button type="button" className="cc-btn cc-btn-danger" style={{ flex: 1 }} disabled={off} onClick={() => props.onRemove?.()}>
                  {t('shelf.sheet.removeGo')}
                </button>
              </div>
            </div>
          )}
        </div>
      </BottomSheetBody>
      <BottomSheetFooter className="flex flex-col gap-3">
        {errorLine}
        <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }} disabled={!canSave} onClick={save}>
          {busy && saving ? t('shelf.sheet.saving') : t('shelf.sheet.save')}
        </button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
