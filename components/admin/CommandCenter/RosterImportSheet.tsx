'use client';

import { useRef, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ListRow from '@/components/primitives/ListRow';
import { useOnline } from '@/lib/useOnline';
import { isRefused } from '@/lib/apiFetch';
import { showTopToast } from '@/lib/topToast';
import {
  parseRosterText,
  isSpreadsheetFile,
  type ParsedRoster,
  type ClassifiedRow,
  type ImportKind,
  type ImportResultRow,
} from '@/lib/rosterImport';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Kinds the import acts on unless the admin unticks them. */
const ACTS_BY_DEFAULT: ReadonlySet<ImportKind> = new Set<ImportKind>(['new', 'returning', 'update']);
/** Kinds the admin may tick: the defaults, plus a name that reads like someone already here. */
const TICKABLE: ReadonlySet<ImportKind> = new Set<ImportKind>(['new', 'returning', 'update', 'similar']);

interface PreviewRow extends ClassifiedRow {
  include: boolean;
}

type Step =
  | { at: 'input' }
  /** `marksStored` false (groups off): member/drop-in cannot be kept for anyone already here. */
  | { at: 'preview'; parsed: ParsedRoster; rows: PreviewRow[]; marksStored: boolean }
  | { at: 'results'; results: ImportResultRow[] };

function noteFor(row: PreviewRow): string {
  switch (row.kind) {
    case 'new': return 'New';
    case 'returning': return 'Comes back';
    case 'update': return row.regular ? 'Already here · mark as member' : 'Already here · mark as drop-in';
    case 'unchanged': return 'Already here';
    case 'similar': return `Looks like ${row.similarTo ?? 'someone here'}`;
    case 'duplicate': return 'Listed twice';
    case 'invalid': return row.reason === 'too_long' ? 'Longer than 50 characters' : 'No name';
  }
}

/** A row the admin re-marks moves between "already here" and "mark as …". */
function remark(row: PreviewRow, regular: boolean): PreviewRow {
  const next = { ...row, regular };
  if ((row.kind === 'update' || row.kind === 'unchanged') && row.current !== undefined) {
    next.kind = row.current === regular ? 'unchanged' : 'update';
    next.include = next.kind === 'update';
  }
  return next;
}

function countLine(rows: PreviewRow[]): string {
  const picked = rows.filter((r) => r.include);
  const adds = picked.filter((r) => r.kind !== 'update').length;
  const marks = picked.filter((r) => r.kind === 'update').length;
  const parts = [`${adds} to add`];
  if (marks) parts.push(`${marks} to re-mark`);
  const here = rows.filter((r) => r.kind === 'unchanged').length;
  if (here) parts.push(`${here} already here`);
  const skip = rows.length - picked.length - here;
  if (skip) parts.push(`${skip} skipped`);
  return parts.join(' · ');
}

const OUTCOME_LABEL: Record<ImportResultRow['outcome'], string> = {
  added: 'Added',
  rejoined: 'Back on the roster',
  updated: 'Re-marked',
  unchanged: 'Already here',
  skipped: 'Skipped',
  taken: 'Someone else took this name just now',
  failed: 'Didn’t save',
};

/**
 * "Import a list" (docs/plans/roster-import.md). Paste cells from a
 * spreadsheet, a CSV export or a numbered chat list — or pick a `.csv` file —
 * then check what each row will do before anything is saved. The file is read
 * here; only the names reach the server. English only, like every admin
 * screen (CLAUDE.md, Q10).
 */
export default function RosterImportSheet({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  /** After any write: the roster re-reads. */
  onImported: () => void;
}) {
  const online = useOnline();
  const [text, setText] = useState('');
  const [source, setSource] = useState<'paste' | 'csv'>('paste');
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ at: 'input' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setText('');
    setSource('paste');
    setFileName(null);
    setStep({ at: 'input' });
    setError('');
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError('');
    if (isSpreadsheetFile(file.name)) {
      setError('That’s a spreadsheet file. Save it as CSV first, or copy the cells and paste them here.');
      return;
    }
    try {
      setText(await file.text());
      setSource('csv');
      setFileName(file.name);
    } catch {
      setError('Couldn’t read that file.');
    }
  }

  async function check() {
    setError('');
    const parsed = parseRosterText(text, { source });
    if (parsed.rows.length === 0) {
      setError('No names found. Paste one name per line, or cells with a Name column.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/members/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, rows: parsed.rows.map((r) => ({ name: r.name, regular: r.regular })) }),
      });
      if (isRefused(res)) { setError('Sign in as an admin to import a list.'); return; }
      const data = (await res.json().catch(() => ({}))) as { rows?: ClassifiedRow[]; marksStored?: boolean; error?: string; max?: number };
      if (!res.ok || !data.rows) {
        setError(data.error === 'too_many_rows'
          ? `That’s more than ${data.max ?? 200} names. Import it in parts.`
          : 'Couldn’t check the list. Try again.');
        return;
      }
      setStep({
        at: 'preview',
        parsed,
        rows: data.rows.map((r) => ({ ...r, include: ACTS_BY_DEFAULT.has(r.kind) })),
        marksStored: data.marksStored !== false,
      });
    } catch {
      setError('Couldn’t check the list. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function updateRow(index: number, change: (row: PreviewRow) => PreviewRow) {
    if (step.at !== 'preview') return;
    setStep({ ...step, rows: step.rows.map((r, i) => (i === index ? change(r) : r)) });
  }

  async function runImport() {
    if (step.at !== 'preview') return;
    const picked = step.rows.filter((r) => r.include);
    if (picked.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/members/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: picked.map((r) => ({ name: r.name, regular: r.regular, force: r.kind === 'similar' })),
        }),
      });
      if (isRefused(res)) { setError('Sign in as an admin to import a list.'); return; }
      const data = (await res.json().catch(() => ({}))) as { results?: ImportResultRow[] };
      if (!res.ok || !data.results) {
        // Nothing is known about which rows landed: checking again shows it,
        // because every row that did reads "Already here" the second time.
        setError('The import stopped part-way. Check the list again to see what landed.');
        onImported();
        return;
      }
      onImported();
      const added = data.results.filter((r) => r.outcome === 'added' || r.outcome === 'rejoined').length;
      const remarked = data.results.filter((r) => r.outcome === 'updated').length;
      const trouble = data.results.some((r) => r.outcome === 'failed' || r.outcome === 'taken');
      if (trouble) {
        setStep({ at: 'results', results: data.results });
        return;
      }
      showTopToast({
        tone: 'success',
        icon: 'group_add',
        title: `${added} ${added === 1 ? 'person' : 'people'} added`,
        body: remarked ? `${remarked} re-marked` : undefined,
      });
      reset();
      onClose();
    } catch {
      setError('The import stopped part-way. Check the list again to see what landed.');
      onImported();
    } finally {
      setBusy(false);
    }
  }

  const picked = step.at === 'preview' ? step.rows.filter((r) => r.include).length : 0;

  return (
    <BottomSheet open={open} onClose={close} ariaLabel="Import a list">
      <BottomSheetHeader onClose={close} closeLabel="Close">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Import a list</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {step.at === 'input' && (
          <div className="flex flex-col gap-4">
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
              Paste names one per line, a numbered list from a group chat, or cells copied from a spreadsheet.
              Only names are kept — phone and email columns are left out.
            </p>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setSource('paste'); setFileName(null); }}
              rows={8}
              placeholder={'1. Lin\n2. Viktor\n3. Carolina\n\nWaiting list\n1. Kento'}
              aria-label="Your list"
              disabled={busy}
            />
            <div className="flex items-center gap-3">
              <button type="button" className="cc-btn cc-btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                <span className="material-icons icon-sm" aria-hidden="true">format_list_bulleted</span>
                Choose a .csv file
              </button>
              {fileName && <span className="fs-sm" style={{ color: 'var(--text-muted)', minWidth: 0 }}>{fileName}</span>}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                hidden
                onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="cc-btn cc-btn-ghost" onClick={close} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="cc-btn cc-btn-primary"
                onClick={() => void check()}
                disabled={busy || !online || text.trim() === ''}
              >
                {busy ? 'Checking…' : 'Check the list'}
              </button>
            </div>
          </div>
        )}

        {step.at === 'preview' && (
          <div className="flex flex-col gap-4">
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>{countLine(step.rows)}</p>
            {(step.parsed.ignoredColumns.length > 0 || step.parsed.guests.length > 0 || step.parsed.skippedLines.length > 0) && (
              <ul className="fs-sm flex flex-col gap-1" style={{ margin: 0, paddingLeft: 'var(--space-6)', color: 'var(--text-muted)' }}>
                {step.parsed.ignoredColumns.length > 0 && (
                  <li>Left out: {step.parsed.ignoredColumns.join(', ')}</li>
                )}
                {step.parsed.guests.length > 0 && (
                  <li>
                    Guests, not imported: {step.parsed.guests.map((g) => `${g.name} (${g.host})`).join(', ')}. Their host
                    brings them as a plus-one.
                  </li>
                )}
                {step.parsed.skippedLines.length > 0 && (
                  <li>
                    {step.parsed.skippedLines.length === 1 ? 'One line' : `${step.parsed.skippedLines.length} lines`} didn’t
                    look like a name: {step.parsed.skippedLines.slice(0, 3).map((l) => `“${l}”`).join(', ')}
                    {step.parsed.skippedLines.length > 3 ? '…' : ''}
                  </li>
                )}
              </ul>
            )}
            <ul className="flex flex-col gap-2" style={{ margin: 0, padding: 0, listStyle: 'none' }} aria-label="Names in your list">
              {step.rows.map((row, i) => {
                const tickable = TICKABLE.has(row.kind);
                const alreadyHere = row.kind === 'update' || row.kind === 'unchanged';
                const markable =
                  row.kind === 'similar' ? row.include
                  : alreadyHere ? step.marksStored
                  : row.kind !== 'duplicate' && row.kind !== 'invalid';
                return (
                  <li key={`${i}:${row.name}`}>
                    <ListRow
                      leading={
                        <label className="cc-checkbox">
                          <input
                            type="checkbox"
                            checked={row.include}
                            disabled={!tickable || busy}
                            onChange={(e) => updateRow(i, (r) => ({ ...r, include: e.target.checked }))}
                            aria-label={`Import ${row.name || 'this row'}`}
                          />
                        </label>
                      }
                      title={
                        <span
                          className="fs-md"
                          style={{ fontWeight: 600, color: row.include || row.kind === 'unchanged' ? 'var(--text-primary)' : 'var(--text-muted)' }}
                        >
                          {row.name || '—'}
                        </span>
                      }
                      subtitle={noteFor(row)}
                      trailing={
                        markable && (
                          <div className="segment-control flex" role="radiogroup" aria-label={`${row.name}: member or drop-in`}>
                            {([true, false] as const).map((value) => (
                              <button
                                key={String(value)}
                                type="button"
                                role="radio"
                                aria-checked={row.regular === value}
                                disabled={busy}
                                onClick={() => updateRow(i, (r) => remark(r, value))}
                                className={`flex-1 flex items-center justify-center px-3 fs-xs rounded-full ${row.regular === value ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                              >
                                {value ? 'Member' : 'Drop-in'}
                              </button>
                            ))}
                          </div>
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setStep({ at: 'input' })} disabled={busy}>
                Back
              </button>
              <button
                type="button"
                className="cc-btn cc-btn-primary"
                onClick={() => void runImport()}
                disabled={busy || !online || picked === 0}
              >
                {busy ? 'Importing…' : `Import ${picked} ${picked === 1 ? 'person' : 'people'}`}
              </button>
            </div>
          </div>
        )}

        {step.at === 'results' && (
          <div className="flex flex-col gap-4">
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
              Most of the list is in. These need another look:
            </p>
            <ul className="flex flex-col gap-2" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {step.results
                .filter((r) => r.outcome === 'failed' || r.outcome === 'taken')
                .map((r, i) => (
                  <li key={`${i}:${r.name}`}>
                    <ListRow
                      title={<span className="fs-md" style={{ fontWeight: 600 }}>{r.name}</span>}
                      subtitle={OUTCOME_LABEL[r.outcome]}
                    />
                  </li>
                ))}
            </ul>
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
              Importing the same list again adds only what’s missing.
            </p>
            <div className="flex justify-end">
              <button type="button" className="cc-btn cc-btn-primary" onClick={close}>Done</button>
            </div>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
