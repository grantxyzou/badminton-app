'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { MAX_OFFERED } from '@/lib/stringingLimits';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { useCatalog } from '@/components/stats/useCatalog';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const catalogLabel = (i: CatalogItem) => `${i.brand} ${i.model}`;
/** Catalog strings whose brand or model carries every word typed. */
function matches(items: CatalogItem[], query: string, limit = 5): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((i) => { const hay = catalogLabel(i).toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, limit);
}

/**
 * What the club stocks — the list behind the request form's dropdown.
 *
 * This exists so the PLAYER side can be a dropdown. A free-text string field
 * on a request produces "bg80", "BG-80", "Bg 80 white" and "yonex 80" for one
 * spool, and the person who has to reconcile that is the stringer. Typing the
 * list once here is the cheaper end of that trade.
 *
 * Saves on every change rather than behind a Save button. The list is a set of
 * short labels with no interdependence — there is no half-finished state worth
 * protecting, and a Save button on a bench screen is one more thing to forget
 * before walking away from the phone.
 */
export default function OfferedStringsCard() {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  // null = unknown (never loaded, or the read failed). Distinct from [], which
  // means "nothing stocked" — the request form treats them differently too.
  const [strings, setStrings] = useState<string[] | null>(null);
  // Offered label → catalog id (docs/plans/string-inventory.md): a linked
  // string gets its page on the member's Stringing tab and its reel length
  // in the inventory; an unlinked one is still offered, just unexplained.
  const [links, setLinks] = useState<Record<string, string>>({});
  // The chip whose catalog match is being picked, or null.
  const [linking, setLinking] = useState<string | null>(null);
  const catalog = useCatalog('string');
  const [loadError, setLoadError] = useState(false);
  // Bumped by "Try again" to re-run the load effect.
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.strings)) {
          setStrings(d.strings);
          setLinks(d.links && typeof d.links === 'object' ? d.links : {});
        } else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function save(next: string[], nextLinks: Record<string, string> = links) {
    if (busy || !online) return;
    // Optimistic, with a rollback: the previous list is captured before the
    // write so a failure restores exactly what was on screen rather than
    // leaving a chip that was never actually saved.
    const previous = strings;
    const previousLinks = links;
    // A link for a label that left the list goes with it.
    const kept = Object.fromEntries(Object.entries(nextLinks).filter(([label]) => next.includes(label)));
    setStrings(next);
    setLinks(kept);
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/strings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strings: next, links: kept }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (Array.isArray(d.strings)) {
        setStrings(d.strings);
        setLinks(d.links && typeof d.links === 'object' ? d.links : {});
      }
    } catch {
      setStrings(previous);
      setLinks(previousLinks);
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  /** Add a label, linked to a catalog row when one was picked. */
  function add(label = draft.trim(), item: CatalogItem | null = null) {
    if (!label || !strings) return;
    setDraft('');
    setLinking(null);
    const existing = strings.find((s) => s.toLowerCase() === label.toLowerCase());
    if (existing) {
      // Already listed: picking its catalog row links it.
      if (item && links[existing] !== item.id) void save(strings, { ...links, [existing]: item.id });
      return;
    }
    if (strings.length >= MAX_OFFERED) return;
    void save([...strings, label], item ? { ...links, [label]: item.id } : links);
  }

  function link(label: string, item: CatalogItem) {
    setLinking(null);
    setDraft('');
    if (!strings) return;
    void save(strings, { ...links, [label]: item.id });
  }

  // While a chip is being linked, the search box searches the catalog for
  // it: its own label first ("Yonex BG80" finds itself), and whatever the
  // admin types instead when the label is the club's own word for it
  // ("House string" matches nothing until they type "BG65").
  const suggestions = strings === null ? [] : matches(catalog.items, draft.trim() || linking || '');

  // A failed load tints the whole card (StateCard) and hides its controls, so
  // nothing is written against data that did not load.
  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="format_list_bulleted"
        title={t('strings.title')}
        subtitle={t('strings.hint')}
        message={<>{t('strings.loadError')} <StateLink onClick={() => setAttempt((n) => n + 1)}>{t('retry')}</StateLink></>}
      >
        <PreviewRow width="46%" />
        <PreviewRow width="34%" />
      </StateCard>
    );
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="format_list_bulleted" title={t('strings.title')} subtitle={t('strings.hint')} />

      {saveError && <ErrorState message={t('strings.saveError')} />}

      {strings !== null && strings.length === 0 && !loadError && (
        /* Standing — see the note in PricingCard. `inventory_2` rather than
            the header's own glyph: repeating it would read as a rendering
            glitch rather than a state. */
        <EmptyState icon="inventory_2">{t('strings.empty')}</EmptyState>
      )}

      {strings !== null && strings.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {strings.map((s) => (
            // One chip, two controls: the body removes it (as before); the
            // leading glyph says whether the catalog knows it, and for an
            // unlinked string opens the picker so it can.
            <span key={s} className="bpm-chip" style={{ cursor: 'default' }}>
              {links[s] ? (
                <span className="material-icons icon-xs" aria-label={t('strings.linked')} title={t('strings.linked')} style={{ color: 'var(--accent)' }}>check</span>
              ) : (
                <button
                  type="button"
                  disabled={busy || !online || !catalog.loaded}
                  onClick={() => setLinking(linking === s ? null : s)}
                  aria-label={t('strings.link', { name: s })}
                  aria-expanded={linking === s}
                  style={{ background: 'transparent', border: 'none', padding: 0, display: 'inline-flex', cursor: 'pointer' }}
                >
                  <span className="material-icons icon-xs" style={{ color: 'var(--text-muted)' }}>link</span>
                </button>
              )}
              <span className="fs-sm">{s}</span>
              <button
                type="button"
                disabled={busy || !online}
                onClick={() => void save(strings.filter((x) => x !== s))}
                aria-label={t('strings.remove', { name: s })}
                style={{ background: 'transparent', border: 'none', padding: 0, display: 'inline-flex', cursor: 'pointer' }}
              >
                <span className="material-icons icon-xs" style={{ color: 'var(--text-muted)' }}>close</span>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* The catalog's matches for what is being typed, or for the chip being
          linked. Picking one stores the label AND the link; a label the
          catalog does not know is added as typed with Enter. */}
      {(suggestions.length > 0 || linking) && (
        <div role="listbox" aria-label={t('strings.matches')} className="flex flex-col gap-1">
          {linking && <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('strings.linkHint', { name: linking })}</p>}
          {suggestions.map((i) => (
            <button
              key={i.id}
              type="button"
              role="option"
              aria-selected={false}
              className="cc-mini-card fs-sm"
              style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
              disabled={busy || !online}
              onClick={() => (linking ? link(linking, i) : add(catalogLabel(i), i))}
            >
              {catalogLabel(i)}
              {typeof i.attributes?.gaugeMm === 'number' && <span style={{ color: 'var(--text-muted)' }}>{` · ${i.attributes.gaugeMm.toFixed(2)}mm`}</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t('strings.placeholder')}
          aria-label={t('strings.placeholder')}
          maxLength={60}
          style={{ flex: 1 }}
          disabled={strings === null}
        />
        <button
          type="button"
          onClick={() => add()}
          disabled={busy || !online || !draft.trim() || strings === null}
          className="cc-btn cc-btn-secondary"
        >
          {t('strings.add')}
        </button>
      </div>
    </div>
  );
}
