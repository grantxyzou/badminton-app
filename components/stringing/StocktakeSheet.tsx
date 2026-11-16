'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import StringPackImage from '@/components/stringing/StringPackImage';
import { useOnline } from '@/lib/useOnline';
import { photoToJpegBase64 } from '@/lib/photoDownscale';
import { MAX_PHOTO_BASE64 } from '@/lib/stringStocktakeScan';
import {
  FULLNESS_ORDER, metresByWeight, setsByEye, setsByWeight, type Fullness,
} from '@/lib/stringStocktakeMath';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * THE STOCKTAKE (docs/plans/string-photo-stocktake.md; Grant, 2026-11-15:
 * "taking a picture in app gives the stocking inventory"). Take a photo, or
 * count by hand; check every string; save. The photo only PROPOSES — nothing
 * changes until Save, and a string the photo did not show is left out of the
 * count rather than read as none, so photographing half the shelf never
 * empties the other half.
 *
 * Opened by an admin from the bench's shelf card and by a stringer from
 * theirs; the read it makes carries sets, never money.
 */

interface SheetString {
  label: string;
  catalogId: string | null;
  appSets: number;
  setMetres: number;
  reelMetres: number;
  gramsPerMetre: number;
  tareGrams: number | null;
}

type Reel = { by: 'eye'; fullness: Fullness } | { by: 'weigh'; grams: string; tare: string; gpm: string };
interface Row { packets: number; reels: Reel[] }
interface Unknown { id: number; kind: 'reel' | 'packet'; count: number; fullness: Fullness | null; colour: string | null; assign: string }
interface ScanItem { label: string | null; kind: 'reel' | 'packet'; count: number; fullness: Fullness | null; colour: string | null }
type Step = 'start' | 'reading' | 'review' | 'saved';

const FULLNESS_KEY: Record<Fullness, string> = { full: 'full', three_quarters: 'threeQuarters', half: 'half', quarter: 'quarter' };
const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));

function reelSets(r: Reel, s: SheetString): number {
  if (r.by === 'eye') return setsByEye(r.fullness, s.reelMetres, s.setMetres);
  const g = toNum(r.grams);
  const tare = toNum(r.tare);
  const gpm = toNum(r.gpm);
  return Number.isFinite(g) && Number.isFinite(tare) && gpm > 0 ? setsByWeight(g, tare, gpm, s.setMetres) : 0;
}
const rowSets = (row: Row, s: SheetString) => row.packets + row.reels.reduce((n, r) => n + reelSets(r, s), 0);

export default function StocktakeSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const t = useTranslations('home.stringing.stocktake');
  const tClose = useTranslations('recovery');
  const online = useOnline();
  const fileRef = useRef<HTMLInputElement>(null);
  const [strings, setStrings] = useState<SheetString[] | null>(null);
  const [photoOn, setPhotoOn] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>('start');
  const [source, setSource] = useState<'photo' | 'hand'>('hand');
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [unknowns, setUnknowns] = useState<Unknown[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Array<{ label: string; appSets: number; counted: number }>>([]);

  async function load() {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/stocktake`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`stocktake ${res.status}`);
      const d = await res.json();
      if (!Array.isArray(d.strings)) throw new Error('shape');
      setStrings(d.strings as SheetString[]);
      setPhotoOn(d.photo === true);
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => { void load(); }, []);

  const byLabel = useMemo(() => new Map((strings ?? []).map((s) => [s.label, s])), [strings]);

  /** A fresh weigh-in for this string, from its last empty-reel weight and grams a metre. */
  const newWeigh = (s: SheetString): Reel => ({ by: 'weigh', grams: '', tare: s.tareGrams === null ? '' : String(s.tareGrams), gpm: String(s.gramsPerMetre) });

  function startByHand() {
    setSource('hand');
    setRows({});
    setUnknowns([]);
    setStep('review');
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setScanError(null);
    setStep('reading');
    try {
      const image = await photoToJpegBase64(file, MAX_PHOTO_BASE64 - 2000);
      const res = await fetch(`${BASE}/api/stringing/stocktake/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, mediaType: 'image/jpeg' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setScanError(d.error === 'photo_unreadable' ? t('unreadable') : d.error === 'club_ai_limit' ? t('clubLimit') : t('readFailed'));
        setStep('start');
        return;
      }
      const d = (await res.json()) as { items: ScanItem[] };
      const next: Record<string, Row> = {};
      const odd: Unknown[] = [];
      d.items.forEach((item, i) => {
        if (!item.label || !byLabel.has(item.label)) {
          odd.push({ id: i, kind: item.kind, count: item.count, fullness: item.fullness, colour: item.colour, assign: '' });
          return;
        }
        const row = next[item.label] ?? { packets: 0, reels: [] };
        if (item.kind === 'packet') row.packets += item.count;
        else for (let n = 0; n < item.count; n++) row.reels.push({ by: 'eye', fullness: item.fullness ?? 'full' });
        next[item.label] = row;
      });
      setSource('photo');
      setRows(next);
      setUnknowns(odd);
      setStep('review');
    } catch {
      setScanError(t('readFailed'));
      setStep('start');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const update = (label: string, fn: (row: Row) => Row) =>
    setRows((r) => ({ ...r, [label]: fn(r[label] ?? { packets: 0, reels: [] }) }));

  /** Rows to save: every string counted, with the not-sure items given a string added in. */
  function linesToSave() {
    const merged: Record<string, Row> = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { packets: v.packets, reels: [...v.reels] }]));
    for (const u of unknowns) {
      if (!u.assign || !byLabel.has(u.assign)) continue;
      const row = merged[u.assign] ?? { packets: 0, reels: [] };
      if (u.kind === 'packet') row.packets += u.count;
      else for (let n = 0; n < u.count; n++) row.reels.push({ by: 'eye', fullness: u.fullness ?? 'full' });
      merged[u.assign] = row;
    }
    return merged;
  }
  const toSave = linesToSave();
  const weighIncomplete = Object.values(toSave).some((row) => row.reels.some((r) => r.by === 'weigh' && !(toNum(r.grams) >= 0 && toNum(r.tare) >= 0 && toNum(r.gpm) > 0)));
  const canSave = online && !busy && Object.keys(toSave).length > 0 && !weighIncomplete;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setSaveError(false);
    try {
      const lines = Object.entries(toSave).map(([label, row]) => ({
        label,
        packets: row.packets,
        reels: row.reels.map((r) => (r.by === 'eye'
          ? { by: 'eye', fullness: r.fullness }
          : { by: 'weigh', grams: toNum(r.grams), tareGrams: toNum(r.tare), gramsPerMetre: toNum(r.gpm) })),
      }));
      const res = await fetch(`${BASE}/api/stringing/stocktake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, lines }),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      const d = await res.json();
      setSaved(Array.isArray(d.lines) ? d.lines : []);
      setStep('saved');
      onSaved?.();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  const diffText = (counted: number, app: number) =>
    counted === app ? t('matches') : counted > app ? t('more', { count: counted - app }) : t('fewer', { count: app - counted });

  return (
    <BottomSheet open onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={tClose('close')}>{t('title')}</BottomSheetHeader>
      <BottomSheetBody>
        {loadError ? (
          <ErrorState message={t('loadError')} action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>{t('retry')}</button>} />
        ) : !strings ? (
          <p className="fs-md" role="status" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('loading')}</p>
        ) : strings.length === 0 ? (
          <p className="fs-md" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('empty')}</p>
        ) : step === 'start' || step === 'reading' ? (
          <div className="flex flex-col gap-4">
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>{photoOn ? t('intro') : t('introHand')}</p>
            {scanError && <p className="field-warn" role="alert" style={{ margin: 0 }}>{scanError}</p>}
            {step === 'reading' && <p className="fs-md motion-fade" role="status" style={{ margin: 0, color: 'var(--text-primary)' }}>{t('reading')}</p>}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
          </div>
        ) : step === 'review' ? (
          <div className="flex flex-col gap-4">
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{source === 'photo' ? t('reviewPhoto') : t('reviewHand')}</p>

            {unknowns.length > 0 && (
              <section className="flex flex-col gap-2" aria-label={t('notSure')}>
                <span className="section-label-muted">{t('notSure')}</span>
                {unknowns.map((u) => (
                  <label key={u.id} className="bpm-inner-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-2)' }}>
                    <span className="fs-md" style={{ color: 'var(--text-primary)' }}>
                      {t(u.kind === 'reel' ? 'unknownReel' : 'unknownPacket', { count: u.count })}{u.colour ? ` · ${u.colour}` : ''}
                    </span>
                    <select
                      value={u.assign}
                      onChange={(e) => setUnknowns((all) => all.map((x) => (x.id === u.id ? { ...x, assign: e.target.value } : x)))}
                      aria-label={t('whichString')}
                    >
                      <option value="">{t('leaveItOut')}</option>
                      {strings.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
                    </select>
                  </label>
                ))}
              </section>
            )}

            <section className="flex flex-col gap-3" aria-label={t('strings')}>
              {strings.map((s) => {
                const row = rows[s.label];
                const merged = toSave[s.label];
                if (!row) {
                  return (
                    <div key={s.label} className="bpm-inner-row">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                        <StringPackImage catalogId={s.catalogId} size="line" />
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span className="fs-md" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{s.label}</span>
                          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                            {merged ? t('youCount', { count: rowSets(merged, s) }) : t('notCounted')} · {t('appSays', { count: s.appSets })}
                          </span>
                        </span>
                      </span>
                      <button type="button" className="cc-btn cc-btn-ghost" onClick={() => update(s.label, (r) => r)}>{t('countIt')}</button>
                    </div>
                  );
                }
                const counted = rowSets(merged ?? row, s);
                return (
                  <div key={s.label} className="glass-card p-4 flex flex-col gap-3">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <StringPackImage catalogId={s.catalogId} size="line" />
                      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600, overflowWrap: 'anywhere' }}>{s.label}</span>
                        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('appSays', { count: s.appSets })}</span>
                      </span>
                      <span className="fs-sm" style={{ color: counted === s.appSets ? 'var(--accent)' : 'var(--sev-warn)', fontWeight: 600 }}>{diffText(counted, s.appSets)}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span className="fs-md" style={{ flex: 1, color: 'var(--text-secondary)' }}>{t('packets')}</span>
                      <button type="button" className="cc-btn cc-btn-secondary" style={{ width: 44, height: 44, padding: 0, borderRadius: 'var(--radius-pill)' }} aria-label={t('fewerPackets', { name: s.label })} disabled={row.packets === 0} onClick={() => update(s.label, (r) => ({ ...r, packets: Math.max(0, r.packets - 1) }))}>
                        <span className="material-icons icon-sm" aria-hidden="true">remove</span>
                      </button>
                      <span className="fs-stat" style={{ minWidth: 'var(--space-8)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{row.packets}</span>
                      <button type="button" className="cc-btn cc-btn-secondary" style={{ width: 44, height: 44, padding: 0, borderRadius: 'var(--radius-pill)' }} aria-label={t('morePackets', { name: s.label })} onClick={() => update(s.label, (r) => ({ ...r, packets: r.packets + 1 }))}>
                        <span className="material-icons icon-sm" aria-hidden="true">add</span>
                      </button>
                    </div>

                    {row.reels.map((reel, i) => (
                      <div key={i} className="bpm-inner-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-3)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                          <span className="fs-md" style={{ flex: 1, color: 'var(--text-primary)' }}>{t('reelN', { n: i + 1 })}</span>
                          <button type="button" className="link-quiet link-quiet--flush" onClick={() => update(s.label, (r) => ({ ...r, reels: r.reels.filter((_, j) => j !== i) }))}>{t('removeReel')}</button>
                        </div>
                        <div className="segment-control flex" role="group" aria-label={t('howCounted')}>
                          <button type="button" aria-pressed={reel.by === 'eye'} className={`flex-1 flex items-center justify-center ${reel.by === 'eye' ? 'segment-tab-active' : 'segment-tab-inactive'}`} onClick={() => update(s.label, (r) => ({ ...r, reels: r.reels.map((x, j) => (j === i ? { by: 'eye', fullness: 'full' } : x)) }))}>{t('byEye')}</button>
                          <button type="button" aria-pressed={reel.by === 'weigh'} className={`flex-1 flex items-center justify-center ${reel.by === 'weigh' ? 'segment-tab-active' : 'segment-tab-inactive'}`} onClick={() => update(s.label, (r) => ({ ...r, reels: r.reels.map((x, j) => (j === i ? newWeigh(s) : x)) }))}>{t('weigh')}</button>
                        </div>
                        {reel.by === 'eye' ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }} role="group" aria-label={t('howFull')}>
                            {FULLNESS_ORDER.map((f) => (
                              <button key={f} type="button" className="bpm-chip" aria-pressed={reel.fullness === f} style={{ minHeight: 44 }} onClick={() => update(s.label, (r) => ({ ...r, reels: r.reels.map((x, j) => (j === i ? { by: 'eye', fullness: f } : x)) }))}>
                                <span className="fs-md">{t(`fullness.${FULLNESS_KEY[f]}`)}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {([['grams', t('scale')], ['tare', t('emptyReel')], ['gpm', t('gramsPerMetre')]] as const).map(([field, label]) => (
                              <label key={field} className="flex flex-col gap-1">
                                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="any"
                                  value={reel[field]}
                                  onChange={(e) => update(s.label, (r) => ({ ...r, reels: r.reels.map((x, j) => (j === i && x.by === 'weigh' ? { ...x, [field]: e.target.value } : x)) }))}
                                />
                              </label>
                            ))}
                            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                              {t('weighResult', {
                                metres: Math.round(metresByWeight(toNum(reel.grams), toNum(reel.tare), toNum(reel.gpm)) || 0),
                                sets: reelSets(reel, s),
                              })}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}

                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                      <button type="button" className="link-quiet link-quiet--flush" onClick={() => update(s.label, (r) => ({ ...r, reels: [...r.reels, { by: 'eye', fullness: 'full' }] }))}>{t('addReel')}</button>
                      <span className="fs-md" style={{ color: 'var(--text-primary)' }}>{t('youCount', { count: counted })}</span>
                    </div>
                    <button type="button" className="link-quiet link-quiet--flush" style={{ alignSelf: 'flex-start' }} onClick={() => setRows((r) => { const { [s.label]: _drop, ...rest } = r; return rest; })}>{t('leaveOut')}</button>
                  </div>
                );
              })}
            </section>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('savedIntro')}</p>
            {saved.map((l) => (
              <div key={l.label} className="bpm-inner-row">
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span className="fs-md" style={{ color: 'var(--text-primary)' }}>{l.label}</span>
                  <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('appSaid', { count: l.appSets })}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{l.counted}</span>
                  <span className="fs-sm" style={{ color: l.counted === l.appSets ? 'var(--accent)' : 'var(--sev-warn)' }}>{diffText(l.counted, l.appSets)}</span>
                </span>
              </div>
            ))}
            {saved.some((l) => l.counted !== l.appSets) && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('whyDiffer')}</p>}
          </div>
        )}
      </BottomSheetBody>
      <BottomSheetFooter>
        <div className="flex flex-col gap-2">
          {step === 'review' && saveError && <p className="field-error" role="alert">{t('saveError')}</p>}
          {step === 'review' && weighIncomplete && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('weighIncomplete')}</p>}
          {strings && strings.length > 0 && (step === 'start' || step === 'reading') && (
            <>
              {photoOn && (
                <button type="button" className="btn-primary" disabled={!online || step === 'reading'} onClick={() => fileRef.current?.click()}>
                  <span className="material-icons icon-md" aria-hidden="true">photo_camera</span>
                  {step === 'reading' ? t('reading') : t('takePhoto')}
                </button>
              )}
              <button type="button" className={photoOn ? 'link-quiet' : 'btn-primary'} disabled={step === 'reading'} onClick={startByHand}>{t('byHand')}</button>
            </>
          )}
          {step === 'review' && (
            <button type="button" className="btn-primary" disabled={!canSave} onClick={() => void save()}>
              {busy ? t('saving') : t('save')}
            </button>
          )}
          {step === 'saved' && <button type="button" className="btn-primary" onClick={onClose}>{t('done')}</button>}
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
