'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ActionRow from '@/components/primitives/ActionRow';
import ErrorState from '@/components/primitives/ErrorState';
import { catalogLabel, matches, parsePrice, priceDraftOf } from '@/lib/shelfEdit';
import { MAX_LABEL_LEN } from '@/lib/stringingLimits';
import type { StringColourId } from '@/lib/stringPalette';
import { ColourPicker } from '@/components/stringing/StringColours';
import type { StringStockLine } from '@/lib/stringStockMath';
import type { CatalogItem, StringPurchase } from '@/lib/types';

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

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
 * Mount with a fresh `key` per opening: the drafts are `useState` initialisers.
 */
export type ShelfSheetMode = 'offered' | 'offShelf' | 'jobLabel';

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
  onSavePrice?: (cents: number | null) => void;
  onLogPurchase?: () => void;
  onRemovePurchase?: (id: string) => void;
  onLink?: (item: CatalogItem) => void;
  onRemoveAlias?: (from: string) => void;
  onRemove?: () => void;
  onAlias?: (target: string) => void;
  onOffer?: () => void;
  /** offered: the colours the club has it in. */
  colours?: StringColourId[];
  onSaveColours?: (ids: StringColourId[]) => void;
  /** offered: a new name for it. The card answers with `renameError` if the server refused. */
  onRename?: (to: string) => void;
  renameError?: 'name_taken' | 'invalid_name' | null;
}

export default function StringShelfSheet(props: Props) {
  const { open, onClose, mode, label, busy, online } = props;
  const t = useTranslations('admin.stringing');
  const [priceDraft, setPriceDraft] = useState(() => priceDraftOf(props.price));
  const [query, setQuery] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [nameDraft, setNameDraft] = useState(label);
  const [colourDraft, setColourDraft] = useState<StringColourId[]>(() => props.colours ?? []);
  const off = busy || !online;
  const nameTrim = nameDraft.trim();
  // Another offered string with this name, any case: refused here before the
  // server is asked, and said in the same words the server's 409 gets.
  const nameTaken = (props.offered ?? []).some((s) => s !== label && s.toLowerCase() === nameTrim.toLowerCase());
  const nameChanged = nameTrim !== label;
  const nameOk = !!nameTrim && nameTrim.length <= MAX_LABEL_LEN && !nameTaken;
  const nameError = nameTaken || props.renameError === 'name_taken'
    ? t('shelf.sheet.nameTaken')
    : props.renameError === 'invalid_name' ? t('shelf.sheet.nameInvalid') : null;
  const coloursChanged = colourDraft.join() !== (props.colours ?? []).join();
  const parsed = parsePrice(priceDraft);
  // Against the STORED value, unset included: an empty field on a string with
  // no price saves "Ask" (null), which is different from no price at all.
  const priceChanged = parsed !== undefined && parsed !== props.price;
  const errorLine = props.error ? <ErrorState message={t('strings.saveError')} /> : null;

  /** One purchase, with its notes and a delete. Shared by both sheet modes. */
  const purchaseList = (purchases: StringPurchase[]) =>
    purchases.length > 0 && (
      <ul style={{ listStyle: 'none', padding: 0 }} className="flex flex-col gap-1">
        {purchases.map((p) => (
          <li key={p.id} className="fs-sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', color: 'var(--text-secondary)' }}>
            <span style={{ minWidth: 0 }}>
              {day(p.date)} · {p.units} {p.unit}{p.units === 1 ? '' : 's'} × {p.metresPerUnit} m · {money(p.totalCostCents)}
              {p.label !== label ? ` · ${p.label}` : ''}
              {p.notes ? ` · ${p.notes}` : ''}
            </span>
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              disabled={off}
              onClick={() => props.onRemovePurchase?.(p.id)}
              aria-label={t('shelf.sheet.removePurchase', { date: day(p.date) })}
              style={{ minWidth: 44, minHeight: 44, padding: 0, flex: '0 0 auto' }}
            >
              <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>delete_outline</span>
            </button>
          </li>
        ))}
      </ul>
    );

  const heading = (
    <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{label}</span>
  );

  if (mode !== 'offered') {
    const offered = props.offered ?? [];
    return (
      <BottomSheet open={open} onClose={onClose} ariaLabel={label}>
        <BottomSheetHeader onClose={onClose} closeLabel={t('actions.close')}>{heading}</BottomSheetHeader>
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

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={label}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('actions.close')}>{heading}</BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-5">
          {errorLine}
          {/* NAME — what the shelf, the request form and the bench call it.
              Renaming keeps its price, link, colours and stock: jobs and
              purchases under the old name go on counting as this string. */}
          <div className="flex flex-col gap-2">
            <label htmlFor="shelf-name" className="section-label-muted">{t('shelf.sheet.name')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <input
                id="shelf-name"
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameChanged && nameOk && !off) {
                    e.preventDefault();
                    props.onRename?.(nameTrim);
                  }
                }}
                maxLength={MAX_LABEL_LEN}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="cc-btn cc-btn-secondary"
                disabled={off || !nameChanged || !nameOk}
                onClick={() => props.onRename?.(nameTrim)}
              >
                {t('shelf.sheet.nameSave')}
              </button>
            </div>
            {nameError
              ? <p className="field-error" role="alert">{nameError}</p>
              : <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('shelf.sheet.nameHint')}</p>}
          </div>

          {/* PRICE — what a player reads first. */}
          <div className="flex flex-col gap-2">
            <label htmlFor="shelf-price" className="section-label-muted">{t('strings.price')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span className="fs-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>$</span>
              <input
                id="shelf-price"
                type="text"
                inputMode="decimal"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && priceChanged && !off) {
                    e.preventDefault();
                    props.onSavePrice?.(parsed ?? null);
                  }
                }}
                placeholder={t('strings.priceAsk')}
                maxLength={7}
                style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)' }}
              />
              <button
                type="button"
                className="cc-btn cc-btn-secondary"
                disabled={off || !priceChanged}
                onClick={() => props.onSavePrice?.(parsed ?? null)}
              >
                {t('strings.priceSave')}
              </button>
            </div>
            <p className="fs-xs" style={{ margin: 0, color: parsed === undefined ? 'var(--sev-crit-text)' : 'var(--text-muted)' }}>
              {parsed === undefined ? t('shelf.sheet.priceInvalid') : t('strings.priceHint')}
            </p>
          </div>

          {/* COLOURS — what is on the reel, shown to players on the Stringing
              tab in place of the maker's list. */}
          <div className="flex flex-col gap-2">
            <span className="section-label-muted">{t('shelf.sheet.colours')}</span>
            <ColourPicker value={colourDraft} onChange={setColourDraft} disabled={off} label={t('shelf.sheet.colours')} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('shelf.sheet.coloursHint')}</p>
              <button
                type="button"
                className="cc-btn cc-btn-secondary"
                disabled={off || !coloursChanged}
                onClick={() => props.onSaveColours?.(colourDraft)}
                style={{ flex: '0 0 auto' }}
              >
                {t('shelf.sheet.coloursSave')}
              </button>
            </div>
          </div>

          {/* STOCK — counted from jobs; the only thing logged here is a purchase. */}
          <div className="flex flex-col gap-2">
            <span className="section-label-muted">{t('shelf.sheet.stock')}</span>
            {line && line.purchases > 0 ? (
              <>
                <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {t('shelf.setsLeft', { count: line.remainingSets })}
                </span>
                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('shelf.sheet.stockDetail', { remaining: line.remainingMetres, purchased: line.purchasedMetres, used: line.usedSets })}
                  {line.costPerSetCents !== null ? ` · ${t('shelf.sheet.costPerSet', { cost: money(line.costPerSetCents) })}` : ''}
                </span>
              </>
            ) : (
              <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                {t('shelf.noStock')}
                {line && line.usedSets > 0 ? ` · ${t('shelf.sheet.usedOnly', { used: line.usedSets })}` : ''}
              </span>
            )}
            <div>
              <button type="button" className="cc-btn cc-btn-secondary" disabled={off} onClick={() => props.onLogPurchase?.()}>
                <span className="material-icons icon-sm" aria-hidden="true">add</span>
                {t('shelf.sheet.logPurchase')}
              </button>
            </div>
            {purchaseList(purchases)}
          </div>

          {/* OLD SPELLINGS counted as this string. */}
          {(props.aliasesHere ?? []).length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="section-label-muted">{t('shelf.sheet.alsoCounts')}</span>
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
            </div>
          )}

          {/* CATALOG — a linked string gets its page on the Stringing tab. */}
          <div className="flex flex-col gap-2">
            <span className="section-label-muted">{t('shelf.sheet.catalog')}</span>
            {/* "Matched" comes from the STORED link. The catalog row only adds
                its name: a catalog still loading, or one that failed, must not
                read as "not matched" and offer a search that overwrites it. */}
            {linkedId ? (
              <span className="fs-sm" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                <span className="material-icons icon-xs" aria-hidden="true" style={{ color: 'var(--accent)' }}>check</span>
                {props.linked ? t('shelf.sheet.linkedAs', { name: catalogLabel(props.linked) }) : t('shelf.sheet.linkedUnknown')}
              </span>
            ) : props.catalogState === 'failed' ? (
              <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('shelf.sheet.catalogError')}</span>
            ) : (
              <>
                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('shelf.sheet.notLinked')}</span>
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
                  <div role="listbox" aria-label={t('strings.matches')} className="flex flex-col gap-1">
                    {suggestions.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="cc-mini-card fs-sm"
                        style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                        disabled={off}
                        onClick={() => props.onLink?.(i)}
                      >
                        {catalogLabel(i)}
                        {typeof i.attributes?.gaugeMm === 'number' && (
                          <span style={{ color: 'var(--text-muted)' }}>{` · ${i.attributes.gaugeMm.toFixed(2)}mm`}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* REMOVE — last, and two taps: the price and links go with it. */}
          {!confirmingRemove ? (
            <ActionRow
              icon="delete_outline"
              label={t('shelf.sheet.remove')}
              hint={t('shelf.sheet.removeHint')}
              disabled={off}
              destructive
              onClick={() => setConfirmingRemove(true)}
            />
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
    </BottomSheet>
  );
}
