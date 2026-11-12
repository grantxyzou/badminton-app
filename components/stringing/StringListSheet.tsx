'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import StringPackImage from './StringPackImage';
import { stringPackSrc } from '@/lib/stringPackSrc';
import {
  TRAITS,
  feelWordOf,
  stringTypeOf,
  traitTint,
  traitValueOf,
  typeDotFill,
  type ShelfEntry,
  type Trait,
} from '@/lib/stringShelf';

/** What the list sorts by: a trait, highest first, or the price, lowest first. */
export type ListSort = Trait | 'price';

/**
 * The whole shelf as a list, the map's swipe-up (the Stringing canvas, idea
 * B, frame 1b, 2026-11-12). It replaced the card's list/map switch: the card
 * holds only the map, and this sheet is the full text equivalent of it,
 * every string included, the ones the map cannot plot too.
 *
 * Each row: the packet, the name and price, type · feel, what it is for, and
 * the maker's five ratings as tinted number chips (Grant chose option G:
 * "this one"), with a colour legend once at the top. The chip of the trait
 * the list is sorted by is filled solid, so the eye runs down that column;
 * the sort button and its menu wear that trait's colour (Grant: "make this
 * dropdown colour coded too"). A string that suits the member's racket says
 * so, as on the map and the peek.
 */
export default function StringListSheet({
  open,
  onClose,
  entries,
  sort,
  onSort,
  priceOf,
  priceCents,
  matches,
  racket,
  onOpenString,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  entries: ShelfEntry[];
  sort: ListSort;
  onSort: (next: ListSort) => void;
  /** The price as shown ("$34", "Ask"), or null when none is set. */
  priceOf: (label: string) => string | null;
  /** The price in cents for sorting; null sorts last. */
  priceCents: (label: string) => number | null;
  /** Catalog ids that suit the member's own racket. */
  matches: ReadonlySet<string>;
  racket: string | null;
  onOpenString: (label: string) => void;
  /** The stringer's other prices and note, under the list. */
  footer?: ReactNode;
}) {
  const t = useTranslations('home.stringing.offer');
  const [menuOpen, setMenuOpen] = useState(false);
  const sortTint = sort === 'price' ? 'var(--text-muted)' : traitTint(sort);
  const sortName = sort === 'price' ? t('sortPrice') : t(`trait_${sort}`);

  const sorted = entries.slice().sort((a, b) => {
    if (sort === 'price') {
      const pa = priceCents(a.label);
      const pb = priceCents(b.label);
      if (pa === null || pb === null) return pa === pb ? 0 : pa === null ? 1 : -1;
      return pa - pb;
    }
    const va = traitValueOf(sort, a.item);
    const vb = traitValueOf(sort, b.item);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return vb - va;
  });
  const anyPack = entries.some((e) => stringPackSrc(e.item?.id));

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('listTitle', { count: entries.length })}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        <span className="bpm-h3" style={{ margin: 0 }}>{t('listTitle', { count: entries.length })}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-4">
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            {/* What the chip colours mean, once. */}
            <ul aria-label={t('ratingsLegend')} className="fs-xs" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-4)', color: 'var(--text-muted)' }}>
              {TRAITS.map((tr) => (
                <li key={tr} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span aria-hidden="true" style={{ width: 'var(--space-3)', height: 'var(--space-3)', borderRadius: '50%', background: traitTint(tr) }} />
                  {t(`trait_${tr}`)}
                </li>
              ))}
            </ul>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="fs-sm"
              data-testid="list-sort"
              style={{
                flex: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                minHeight: 'var(--space-8)',
                padding: '0 var(--space-3) 0 var(--space-4)',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid transparent',
                background: `color-mix(in srgb, ${sortTint} 16%, transparent)`,
                color: sortTint,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('sortLabel')}</span>
              <span aria-hidden="true" style={{ width: 'var(--space-3)', height: 'var(--space-3)', borderRadius: '50%', background: sortTint }} />
              {sortName}
              <span className="material-icons icon-sm motion-chevron" data-open={menuOpen ? 'true' : 'false'} aria-hidden="true">expand_more</span>
            </button>
            {menuOpen && (
              <ul
                role="menu"
                aria-label={t('sortLabel')}
                className="string-sort-menu"
                style={{ listStyle: 'none', margin: 0 }}
              >
                {([...TRAITS, 'price'] as ListSort[]).map((k) => {
                  const tint = k === 'price' ? 'var(--text-muted)' : traitTint(k);
                  const on = k === sort;
                  return (
                    <li key={k} role="none">
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={on}
                        onClick={() => { onSort(k); setMenuOpen(false); }}
                        className="string-sort-item fs-md"
                        style={{
                          background: on ? `color-mix(in srgb, ${tint} 16%, transparent)` : undefined,
                          color: on ? tint : 'var(--text-primary)',
                          fontWeight: on ? 600 : 400,
                        }}
                      >
                        <span aria-hidden="true" style={{ flex: 'none', width: 'var(--space-4)', height: 'var(--space-4)', borderRadius: '50%', background: tint }} />
                        <span style={{ flex: 1, textAlign: 'left' }}>{k === 'price' ? t('sortPrice') : t(`trait_${k}`)}</span>
                        {on && <span className="material-icons icon-sm" aria-hidden="true">check</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
            {sorted.map((e) => {
              const type = stringTypeOf(e.item);
              const feel = feelWordOf(e.item);
              const headline = [type ? t(`hero_${type}`) : null, feel ? t(`heroFeel_${feel}`) : null].filter(Boolean).join(' · ');
              const price = priceOf(e.label);
              const bestFor = typeof e.item?.attributes?.bestFor === 'string' ? e.item.attributes.bestFor : null;
              const match = !!(e.item && matches.has(e.item.id));
              const rated = TRAITS.filter((tr) => traitValueOf(tr, e.item) !== null);
              const body = (
                <>
                  {stringPackSrc(e.item?.id)
                    ? <StringPackImage catalogId={e.item!.id} size="row" />
                    : anyPack ? <span aria-hidden="true" className="string-pack-row" style={{ flex: 'none' }} /> : null}
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                      <span className="fs-lg" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {type && <span aria-hidden="true" style={{ flex: 'none', width: 'var(--space-3)', height: 'var(--space-3)', borderRadius: '50%', background: typeDotFill(type) }} />}
                        {e.label}
                      </span>
                      {price && <span className="fs-lg" style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{price}</span>}
                    </span>
                    {headline && <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{headline}</span>}
                    {bestFor && <span className="fs-sm" style={{ color: 'var(--text-muted)', lineHeight: 'var(--lh-snug)' }}>{bestFor}</span>}
                    {match && racket && (
                      <span className="fs-xs" data-testid="list-match" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--text-secondary)' }}>
                        <span className="material-icons icon-xs" aria-hidden="true" style={{ color: 'var(--accent)' }}>check_circle</span>
                        {t('suitsYourRacket', { racket })}
                      </span>
                    )}
                    {rated.length > 0 && (
                      <span
                        aria-label={rated.map((tr) => `${t(`trait_${tr}`)} ${traitValueOf(tr, e.item)}`).join(', ')}
                        role="img"
                        style={{ display: 'inline-flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)', alignSelf: 'flex-start' }}
                      >
                        {rated.map((tr) => {
                          const tint = traitTint(tr);
                          const solid = tr === sort;
                          return (
                            <span
                              key={tr}
                              data-chip={tr}
                              className="string-rating-chip fs-xs"
                              style={{
                                background: solid ? tint : `color-mix(in srgb, ${tint} 18%, transparent)`,
                                color: solid ? `color-mix(in srgb, ${tint} 22%, black)` : tint,
                              }}
                            >
                              {traitValueOf(tr, e.item)}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                <li key={e.label}>
                  {e.item ? (
                    <button type="button" className="cc-mini-card string-list-row" onClick={() => onOpenString(e.label)}>
                      {body}
                    </button>
                  ) : (
                    <div className="cc-mini-card string-list-row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {footer}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
