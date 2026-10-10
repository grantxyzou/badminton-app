'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import Collapse from '@/components/primitives/Collapse';
import ListRow from '@/components/primitives/ListRow';
import { useRevealReady } from '@/components/primitives/Reveal';
import { useCatalog } from '@/components/stats/useCatalog';
import { stringSpecLine } from '@/lib/gearSetup';
import type { CatalogItem } from '@/lib/types';
import StringDetailSheet from './StringDetailSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The strings the club offers, with what each one is like, and a short
 * lesson in choosing one (docs/plans/string-inventory.md — Grant: "I want
 * people to be able to see the strings I provide with its attributes and
 * qualities etc. Educational stuff"). Reads the same offered list the
 * request form's dropdown does, plus the catalog links the stringer set;
 * an unlinked string is listed by name and says the catalog does not know
 * it yet. Renders nothing when the club lists nothing — the request form
 * already explains that case.
 */
export default function StringsWeOfferCard() {
  const t = useTranslations('home.stringing.offer');
  const tSetup = useTranslations('stats.gear.setup');
  const catalog = useCatalog('string');
  const [offered, setOffered] = useState<{ strings: string[]; links: Record<string, string> } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<CatalogItem | null>(null);
  const [learnOpen, setLearnOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d && Array.isArray(d.strings)) {
          setOffered({ strings: d.strings, links: d.links && typeof d.links === 'object' ? d.links : {} });
          setStatus('ready');
        } else setStatus('failed');
      })
      .catch(() => { if (!cancelled) setStatus('failed'); });
    return () => { cancelled = true; };
  }, [attempt]);

  // Holds its place until both the list and the catalog have answered; an
  // empty list closes the slot (the tab's slot is `canBeEmpty`).
  const ready = status !== 'loading' && (catalog.loaded || catalog.loadError);
  useRevealReady(ready, status === 'ready' && (offered?.strings.length ?? 0) === 0);
  if (!ready) return null;
  if (status === 'ready' && (offered?.strings.length ?? 0) === 0) return null;

  const itemFor = (label: string): CatalogItem | null => {
    const id = offered?.links[label];
    return id ? catalog.items.find((i) => i.id === id) ?? null : null;
  };

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="science" title={t('title')} subtitle={t('subtitle')} />
      {status === 'failed' ? (
        <ErrorState message={t('loadError')} action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => { setStatus('loading'); setAttempt((n) => n + 1); }}>{t('retry')}</button>} />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
          {offered!.strings.map((label) => {
            const item = itemFor(label);
            const line = item ? stringSpecLine(item, (k) => tSetup(k)) : null;
            return (
              <li key={label}>
                {/* A string the catalog does not know has no page to open, so
                    its row is the DISABLED row — the same chrome at half
                    opacity, which is how every row in the app says "not
                    tappable" — rather than a look-alike div. */}
                <ListRow
                  onClick={item ? () => setOpen(item) : () => {}}
                  disabled={!item}
                  title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{item ? `${item.brand} ${item.model}` : label}</span>}
                  subtitle={item ? [line, typeof item.attributes?.bestFor === 'string' ? item.attributes.bestFor : null].filter(Boolean).join(' · ') : t('unknown')}
                  trailing={item ? <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span> : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* The lesson: four short paragraphs a member reads once. Behind a row
          link so the list stays the card's first job. */}
      <button type="button" className="bpm-row-link" aria-expanded={learnOpen} onClick={() => setLearnOpen((v) => !v)}>
        <span className="material-icons icon-sm" aria-hidden="true">school</span>
        <span className="fs-sm">{t('learnTitle')}</span>
        <span className="material-icons icon-sm motion-chevron" aria-hidden="true">expand_more</span>
      </button>
      <Collapse open={learnOpen} spaceAbove="var(--space-3)">
        <div className="flex flex-col gap-3">
          {(['learnGauge', 'learnType', 'learnFeel', 'learnTension'] as const).map((k) => (
            <p key={k} className="fs-base" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{t(k)}</p>
          ))}
        </div>
      </Collapse>

      <StringDetailSheet item={open} open={open !== null} onClose={() => setOpen(null)} />
    </div>
  );
}
