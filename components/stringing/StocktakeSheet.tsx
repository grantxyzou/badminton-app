'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import StringPackImage from '@/components/stringing/StringPackImage';
import { ColourDot, useReelColourName } from '@/components/stringing/StringColours';
import { useOnline } from '@/lib/useOnline';
import { isNative } from '@/lib/native';
import { tapSuccess } from '@/lib/haptics';
import {
  cameraFailure, canScan, primeBeep, scanFeedback, startBarcodeScanner, stopBeep, type ScannerControls,
} from '@/lib/barcodeScanner';
import {
  addPacket, addReel, linesForSave, makeScanGate, rowKey, rowsOf, updateRow, weighIncomplete, withoutString,
  type Reel, type ScanAnswer, type Tally, type TallyRow,
} from '@/lib/stocktakeTally';
import { FULLNESS_ORDER, metresByWeight, setsByEye, setsByWeight, type Fullness } from '@/lib/stringStocktakeMath';
import type { CustomColour, ReelColourId } from '@/lib/stringPalette';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * THE STOCKTAKE (docs/plans/string-photo-stocktake.md, scanning since
 * docs/plans/string-barcode-stocktake.md; Grant, 2026-11-16: "why cant we just
 * treat reading inventory like scanning a product in?").
 *
 * Scan each packet and reel: a barcode the club has taught counts itself (a
 * packet is +1, a reel asks how full); a new one is taught once — which
 * string, which colour, packet or reel — and remembered. Then the review: per
 * string and colour, what the app says beside what was counted. Nothing
 * changes until Save, and a string nobody scanned is left OUT of the count
 * rather than read as none, so scanning half the shelf never empties the
 * other half. "None left" counts one as zero on purpose.
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
  colours: ReelColourId[];
  byColour: Array<{ color: ReelColourId; appSets: number }>;
  mixedSets: number;
}

type Step = 'start' | 'scan' | 'review' | 'saved';
type Camera = 'starting' | 'on' | 'denied' | 'missing' | 'failed';
type Pending = { kind: 'teach'; code: string } | { kind: 'reel'; answer: ScanAnswer } | null;

const FULLNESS_KEY: Record<Fullness, string> = { full: 'full', three_quarters: 'threeQuarters', half: 'half', quarter: 'quarter' };
const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));
const ROUND_BUTTON = { width: 44, height: 44, padding: 0, borderRadius: 'var(--radius-pill)' } as const;

function reelSets(r: Reel, s: SheetString): number {
  if (r.by === 'eye') return setsByEye(r.fullness, s.reelMetres, s.setMetres);
  const g = toNum(r.grams);
  const tare = toNum(r.tare);
  const gpm = toNum(r.gpm);
  return Number.isFinite(g) && Number.isFinite(tare) && gpm > 0 ? setsByWeight(g, tare, gpm, s.setMetres) : 0;
}
const rowSets = (row: TallyRow, s: SheetString) => row.packets + row.reels.reduce((n, r) => n + reelSets(r, s), 0);

/** What the app says for one colour row: its own pool once purchases are tagged, else nothing per colour. */
function appSetsForRow(s: SheetString, color: ReelColourId | null): number | null {
  if (s.byColour.length === 0) return null;
  if (color === null) return s.mixedSets;
  return s.byColour.find((c) => c.color === color)?.appSets ?? 0;
}

export default function StocktakeSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const t = useTranslations('home.stringing.stocktake');
  const tClose = useTranslations('recovery');
  const online = useOnline();
  const [strings, setStrings] = useState<SheetString[] | null>(null);
  const [customs, setCustoms] = useState<CustomColour[]>([]);
  const [barcodes, setBarcodes] = useState<Map<string, ScanAnswer>>(new Map());
  const [scanOn, setScanOn] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>('start');
  const [source, setSource] = useState<'scan' | 'hand'>('hand');
  const [tally, setTally] = useState<Tally>({});
  const [camera, setCamera] = useState<Camera>('starting');
  const [pending, setPending] = useState<Pending>(null);
  const [last, setLast] = useState<{ answer: ScanAnswer; n: number } | null>(null);
  const [teach, setTeach] = useState<{ label: string; color: ReelColourId | null; form: 'packet' | 'reel' }>({ label: '', color: null, form: 'packet' });
  const [teachBusy, setTeachBusy] = useState(false);
  const [teachError, setTeachError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Array<{ label: string; appSets: number; counted: number }>>([]);
  const colourName = useReelColourName(customs);

  async function load() {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/stocktake`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`stocktake ${res.status}`);
      const d = await res.json();
      if (!Array.isArray(d.strings)) throw new Error('shape');
      setStrings((d.strings as SheetString[]).map((s) => ({ ...s, colours: s.colours ?? [], byColour: s.byColour ?? [], mixedSets: s.mixedSets ?? 0 })));
      setCustoms(Array.isArray(d.customColours) ? d.customColours : []);
      setBarcodes(new Map((Array.isArray(d.barcodes) ? (d.barcodes as ScanAnswer[]) : []).map((b) => [b.code, b])));
      setScanOn(await canScan());
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => { void load(); }, []);

  const byLabel = useMemo(() => new Map((strings ?? []).map((s) => [s.label, s])), [strings]);

  // ── The camera ──────────────────────────────────────────────────────────
  // The read callback runs outside React's render, so it reads the current
  // barcodes and pending prompt through refs.
  const videoRef = useRef<HTMLVideoElement>(null);
  const barcodesRef = useRef(barcodes);
  const pendingRef = useRef(pending);
  useEffect(() => { barcodesRef.current = barcodes; }, [barcodes]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const gate = useMemo(() => makeScanGate(), []);
  // A prompt a scan raised opens below the camera: bring it into view, so a
  // hand holding a packet never has to scroll for "Save and count it".
  const promptRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (pending) promptRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [pending]);

  const counted = useCallback((answer: ScanAnswer) => {
    setLast((l) => ({ answer, n: (l?.n ?? 0) + 1 }));
    scanFeedback();
    tapSuccess();
  }, []);

  const onCode = useCallback((code: string) => {
    if (!gate(code, Date.now()) || pendingRef.current) return;
    const answer = barcodesRef.current.get(code);
    if (!answer) {
      scanFeedback();
      setTeach({ label: '', color: null, form: 'packet' });
      setTeachError(false);
      setPending({ kind: 'teach', code });
      return;
    }
    if (answer.form === 'reel') {
      scanFeedback();
      setPending({ kind: 'reel', answer });
      return;
    }
    setTally((tl) => addPacket(tl, answer));
    counted(answer);
  }, [gate, counted]);

  useEffect(() => {
    if (step !== 'scan') return;
    let controls: ScannerControls | null = null;
    let cancelled = false;
    setCamera('starting');
    (async () => {
      try {
        if (!videoRef.current) throw new Error('no video element');
        const c = await startBarcodeScanner(videoRef.current, onCode);
        if (cancelled) c.stop();
        else {
          controls = c;
          setCamera('on');
        }
      } catch (err) {
        if (!cancelled) setCamera(cameraFailure(err));
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [step, onCode]);
  useEffect(() => () => stopBeep(), []);

  function startScan() {
    primeBeep();
    setSource('scan');
    setStep('scan');
  }
  function startByHand() {
    setSource('hand');
    setStep('review');
  }

  async function saveTeach() {
    if (pending?.kind !== 'teach' || !teach.label) return;
    setTeachBusy(true);
    setTeachError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/stocktake/barcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pending.code, label: teach.label, form: teach.form, ...(teach.color ? { color: teach.color } : {}) }),
      });
      if (!res.ok) throw new Error(`barcode ${res.status}`);
      const answer = (await res.json()) as ScanAnswer;
      setBarcodes((m) => new Map(m).set(answer.code, answer));
      if (answer.form === 'reel') {
        setPending({ kind: 'reel', answer });
      } else {
        setTally((tl) => addPacket(tl, answer));
        counted(answer);
        setPending(null);
      }
    } catch {
      setTeachError(true);
    } finally {
      setTeachBusy(false);
    }
  }

  function countReel(answer: ScanAnswer, reel: Reel) {
    setTally((tl) => addReel(tl, answer, reel));
    counted(answer);
    setPending(null);
  }

  /** A fresh weigh-in for this string, from its last empty-reel weight and grams a metre. */
  const newWeigh = (s: SheetString): Reel => ({ by: 'weigh', grams: '', tare: s.tareGrams === null ? '' : String(s.tareGrams), gpm: String(s.gramsPerMetre) });

  // ── Saving ──────────────────────────────────────────────────────────────
  const rowCount = Object.keys(tally).length;
  const weighOpen = weighIncomplete(tally);
  const canSave = online && !busy && rowCount > 0 && !weighOpen;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/stocktake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, lines: linesForSave(tally) }),
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

  const diffText = (n: number, app: number) =>
    n === app ? t('matches') : n > app ? t('more', { count: n - app }) : t('fewer', { count: app - n });
  const rowName = (label: string, color: ReelColourId | null) => `${label} · ${color ? colourName(color) : t('mixed')}`;

  // ── Pieces ──────────────────────────────────────────────────────────────
  const fullnessChips = (onPick: (f: Fullness) => void, current?: Fullness) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }} role="group" aria-label={t('howFull')}>
      {FULLNESS_ORDER.map((f) => (
        <button key={f} type="button" className="bpm-chip" aria-pressed={current === f} style={{ minHeight: 44 }} onClick={() => onPick(f)}>
          <span className="fs-md">{t(`fullness.${FULLNESS_KEY[f]}`)}</span>
        </button>
      ))}
    </div>
  );

  const packetStepper = (s: SheetString, row: TallyRow) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span className="fs-md" style={{ flex: 1, color: 'var(--text-secondary)' }}>{t('packets')}</span>
      <button type="button" className="cc-btn cc-btn-secondary" style={ROUND_BUTTON} aria-label={t('fewerPackets', { name: rowName(s.label, row.color) })} disabled={row.packets === 0} onClick={() => setTally((tl) => updateRow(tl, s.label, row.color, (r) => ({ ...r, packets: Math.max(0, r.packets - 1) })))}>
        <span className="material-icons icon-sm" aria-hidden="true">remove</span>
      </button>
      <span className="fs-stat" style={{ minWidth: 'var(--space-8)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{row.packets}</span>
      <button type="button" className="cc-btn cc-btn-secondary" style={ROUND_BUTTON} aria-label={t('morePackets', { name: rowName(s.label, row.color) })} onClick={() => setTally((tl) => updateRow(tl, s.label, row.color, (r) => ({ ...r, packets: r.packets + 1 })))}>
        <span className="material-icons icon-sm" aria-hidden="true">add</span>
      </button>
    </div>
  );

  const reelEditor = (s: SheetString, row: TallyRow, reel: Reel, i: number) => {
    const setReel = (fn: (x: Reel) => Reel) => setTally((tl) => updateRow(tl, s.label, row.color, (r) => ({ ...r, reels: r.reels.map((x, j) => (j === i ? fn(x) : x)) })));
    return (
      <div key={i} className="bpm-inner-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="fs-md" style={{ flex: 1, color: 'var(--text-primary)' }}>{t('reelN', { n: i + 1 })}</span>
          <button type="button" className="link-quiet link-quiet--flush" onClick={() => setTally((tl) => updateRow(tl, s.label, row.color, (r) => ({ ...r, reels: r.reels.filter((_, j) => j !== i) })))}>{t('removeReel')}</button>
        </div>
        <div className="segment-control flex" role="group" aria-label={t('howCounted')}>
          <button type="button" aria-pressed={reel.by === 'eye'} className={`flex-1 flex items-center justify-center ${reel.by === 'eye' ? 'segment-tab-active' : 'segment-tab-inactive'}`} onClick={() => setReel(() => ({ by: 'eye', fullness: 'full' }))}>{t('byEye')}</button>
          <button type="button" aria-pressed={reel.by === 'weigh'} className={`flex-1 flex items-center justify-center ${reel.by === 'weigh' ? 'segment-tab-active' : 'segment-tab-inactive'}`} onClick={() => setReel(() => newWeigh(s))}>{t('weigh')}</button>
        </div>
        {reel.by === 'eye' ? (
          fullnessChips((f) => setReel(() => ({ by: 'eye', fullness: f })), reel.fullness)
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
                  onChange={(e) => setReel((x) => (x.by === 'weigh' ? { ...x, [field]: e.target.value } : x))}
                />
              </label>
            ))}
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {t('weighResult', { metres: Math.round(metresByWeight(toNum(reel.grams), toNum(reel.tare), toNum(reel.gpm)) || 0), sets: reelSets(reel, s) })}
            </p>
          </div>
        )}
      </div>
    );
  };

  /** One colour's counting, inside a string's card. */
  const colourRow = (s: SheetString, row: TallyRow, showName: boolean) => {
    const app = appSetsForRow(s, row.color);
    return (
      <div key={rowKey(s.label, row.color)} className="flex flex-col gap-3">
        {showName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {row.color && <ColourDot id={row.color} />}
            <span className="fs-md" style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 600 }}>{row.color ? colourName(row.color) : t('mixed')}</span>
            {app !== null && <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('appSays', { count: app })} · {t('youCount', { count: rowSets(row, s) })}</span>}
          </div>
        )}
        {packetStepper(s, row)}
        {row.reels.map((reel, i) => reelEditor(s, row, reel, i))}
        <button type="button" className="link-quiet link-quiet--flush" style={{ alignSelf: 'flex-start' }} onClick={() => setTally((tl) => addReel(tl, { label: s.label, color: row.color }, { by: 'eye', fullness: 'full' }))}>{t('addReel')}</button>
      </div>
    );
  };

  const stringCard = (s: SheetString) => {
    const rows = rowsOf(tally, s.label);
    if (rows.length === 0) {
      return (
        <div key={s.label} className="bpm-inner-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0, flex: 1 }}>
            <StringPackImage catalogId={s.catalogId} size="line" />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span className="fs-md" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{s.label}</span>
              <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('notCounted')} · {t('appSays', { count: s.appSets })}</span>
            </span>
          </span>
          <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setTally((tl) => updateRow(tl, s.label, null, (r) => r))}>{t('countIt')}</button>
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setTally((tl) => updateRow(tl, s.label, null, () => ({ label: s.label, color: null, packets: 0, reels: [] })))}>{t('noneLeft')}</button>
          </span>
        </div>
      );
    }
    const total = rows.reduce((n, r) => n + rowSets(r, s), 0);
    const showNames = rows.length > 1 || rows[0].color !== null || s.byColour.length > 0;
    const unused = [null, ...s.colours].filter((c) => !rows.some((r) => r.color === c));
    return (
      <div key={s.label} className="glass-card p-4 flex flex-col gap-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <StringPackImage catalogId={s.catalogId} size="line" />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600, overflowWrap: 'anywhere' }}>{s.label}</span>
            <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('appSays', { count: s.appSets })} · {t('youCount', { count: total })}</span>
          </span>
          <span className="fs-sm" style={{ color: total === s.appSets ? 'var(--accent)' : 'var(--sev-warn)', fontWeight: 600 }}>{diffText(total, s.appSets)}</span>
        </div>
        {rows.map((row) => colourRow(s, row, showNames))}
        {unused.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }} role="group" aria-label={t('addColour')}>
            <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('addColour')}</span>
            {unused.map((c) => (
              <button key={c ?? 'mixed'} type="button" className="bpm-chip" style={{ minHeight: 44 }} onClick={() => setTally((tl) => updateRow(tl, s.label, c, (r) => r))}>
                {c && <ColourDot id={c} size="sm" />}
                <span className="fs-sm">{c ? colourName(c) : t('mixed')}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="link-quiet link-quiet--flush" style={{ alignSelf: 'flex-start' }} onClick={() => setTally((tl) => withoutString(tl, s.label))}>{t('leaveOut')}</button>
      </div>
    );
  };

  /** The prompt a scan raised: teach a new barcode, or say how full a reel is. */
  const pendingPanel = () => {
    if (!pending) return null;
    if (pending.kind === 'reel') {
      const s = byLabel.get(pending.answer.label);
      return (
        <section ref={promptRef} className="glass-card p-4 flex flex-col gap-3 motion-fade" aria-label={t('howFull')}>
          <span className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('reelScanned', { name: rowName(pending.answer.label, pending.answer.color) })}</span>
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('howFull')}</span>
          {fullnessChips((f) => countReel(pending.answer, { by: 'eye', fullness: f }))}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {s && <button type="button" className="link-quiet link-quiet--flush" onClick={() => countReel(pending.answer, newWeigh(s))}>{t('weighLater')}</button>}
            <button type="button" className="link-quiet link-quiet--flush" onClick={() => setPending(null)}>{t('skip')}</button>
          </div>
        </section>
      );
    }
    const s = byLabel.get(teach.label);
    return (
      <section ref={promptRef} className="glass-card p-4 flex flex-col gap-3 motion-fade" aria-label={t('teachTitle')}>
        <span className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('teachTitle')}</span>
        <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('teachIntro')}</span>
        <span className="fs-sm" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{pending.code}</span>
        <label className="flex flex-col gap-1">
          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('teachString')}</span>
          <select value={teach.label} onChange={(e) => setTeach((x) => ({ ...x, label: e.target.value, color: null }))}>
            <option value="">{t('chooseString')}</option>
            {(strings ?? []).map((x) => <option key={x.label} value={x.label}>{x.label}</option>)}
          </select>
        </label>
        {s && (
          <div className="flex flex-col gap-2">
            <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('teachColour')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }} role="group" aria-label={t('teachColour')}>
              {[null, ...s.colours].map((c) => (
                <button key={c ?? 'mixed'} type="button" className="bpm-chip" aria-pressed={teach.color === c} style={{ minHeight: 44 }} onClick={() => setTeach((x) => ({ ...x, color: c }))}>
                  {c && <ColourDot id={c} size="sm" />}
                  <span className="fs-sm">{c ? colourName(c) : t('mixed')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="segment-control flex" role="group" aria-label={t('teachForm')}>
          {(['packet', 'reel'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={teach.form === f} className={`flex-1 flex items-center justify-center ${teach.form === f ? 'segment-tab-active' : 'segment-tab-inactive'}`} onClick={() => setTeach((x) => ({ ...x, form: f }))}>{t(f === 'packet' ? 'packet' : 'reel')}</button>
          ))}
        </div>
        {teachError && <p className="field-warn" role="alert" style={{ margin: 0 }}>{t('teachError')}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button type="button" className="cc-btn cc-btn-primary" disabled={!online || teachBusy || !teach.label} onClick={() => void saveTeach()}>{teachBusy ? t('saving') : t('teachSave')}</button>
          <button type="button" className="link-quiet link-quiet--flush" disabled={teachBusy} onClick={() => setPending(null)}>{t('skip')}</button>
        </div>
      </section>
    );
  };

  const scannedList = () => {
    const rows = Object.values(tally).filter((r) => r.packets > 0 || r.reels.length > 0);
    if (rows.length === 0) return <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('scannedNothing')}</p>;
    return (
      <section className="flex flex-col gap-2" aria-label={t('scanned')}>
        <span className="section-label-muted">{t('scanned')}</span>
        {rows.map((r) => (
          <div key={rowKey(r.label, r.color)} className="bpm-inner-row">
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
              {r.color && <ColourDot id={r.color} size="sm" />}
              <span className="fs-md" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{rowName(r.label, r.color)}</span>
            </span>
            <span className="fs-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{t('scannedCounts', { packets: r.packets, reels: r.reels.length })}</span>
          </div>
        ))}
      </section>
    );
  };

  const cameraMessage = camera === 'denied' ? t('cameraDenied') : camera === 'missing' ? t('cameraMissing') : camera === 'failed' ? t('cameraFailed') : null;

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
        ) : step === 'start' ? (
          <div className="flex flex-col gap-3">
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>{scanOn ? t('intro') : t('introHand')}</p>
            {!scanOn && isNative() && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('scanNeedsUpdate')}</p>}
          </div>
        ) : step === 'scan' ? (
          <div className="flex flex-col gap-4">
            {cameraMessage ? (
              <p className="field-warn" role="alert" style={{ margin: 0 }}>{cameraMessage}</p>
            ) : (
              <div className={pending ? 'stocktake-camera stocktake-camera--answering' : 'stocktake-camera'}>
                <video ref={videoRef} playsInline muted autoPlay aria-label={t('cameraLabel')} />
                <span className="fs-sm stocktake-camera-hint" role="status">{camera === 'starting' ? t('cameraStarting') : t('pointAt')}</span>
              </div>
            )}
            {last && (
              <p key={last.n} className="fs-md motion-fade" role="status" style={{ margin: 0, color: 'var(--text-primary)' }}>
                {t(last.answer.form === 'reel' ? 'lastReel' : 'lastPacket', { name: rowName(last.answer.label, last.answer.color) })}
              </p>
            )}
            {pendingPanel()}
            {scannedList()}
          </div>
        ) : step === 'review' ? (
          <div className="flex flex-col gap-4">
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{source === 'scan' ? t('reviewScan') : t('reviewHand')}</p>
            <section className="flex flex-col gap-3" aria-label={t('strings')}>
              {strings.map((s) => stringCard(s))}
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
          {step === 'review' && weighOpen && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('weighIncomplete')}</p>}
          {strings && strings.length > 0 && step === 'start' && (
            <>
              {scanOn && (
                <button type="button" className="btn-primary" onClick={startScan}>
                  <span className="material-icons icon-md" aria-hidden="true">barcode_scanner</span>
                  {t('scan')}
                </button>
              )}
              <button type="button" className={scanOn ? 'link-quiet' : 'btn-primary'} onClick={startByHand}>{t('byHand')}</button>
            </>
          )}
          {step === 'scan' && (
            <button type="button" className="btn-primary" disabled={pending !== null} onClick={() => setStep('review')}>
              {t('review', { count: Object.values(tally).filter((r) => r.packets > 0 || r.reels.length > 0).length })}
            </button>
          )}
          {step === 'review' && (
            <>
              {source === 'scan' && <button type="button" className="link-quiet" onClick={() => setStep('scan')}>{t('scanMore')}</button>}
              <button type="button" className="btn-primary" disabled={!canSave} onClick={() => void save()}>
                {busy ? t('saving') : t('save')}
              </button>
            </>
          )}
          {step === 'saved' && <button type="button" className="btn-primary" onClick={onClose}>{t('done')}</button>}
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
