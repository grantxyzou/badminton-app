/**
 * ROSTER IMPORT — turn a pasted list or a CSV file into names
 * (docs/plans/roster-import.md). Pure: no reads, no writes, never throws.
 *
 * Three shapes, tried in this order:
 *   1. TAB-SEPARATED — cells copied out of Excel or Google Sheets.
 *   2. CSV — a `.csv` file, or a pasted export (RFC 4180 quoting, so
 *      `"Lee, Chris"` stays one name).
 *   3. A LIST — one name per line, or a numbered chat post like the one
 *      Six Feathers reposts all week: `1. Lin`, blank numbers for open spots,
 *      a "Waiting list" heading, guests written `Jenny (Josh)`.
 *
 * Only names leave this file, plus whether each person is a member or a
 * drop-in. Every other column (phone, email, e-transfer name) is reported by
 * its header and dropped — a roster does not need them, and an e-transfer
 * name is payment data (security rule 10).
 *
 * The server decides what each name MEANS on the roster (`POST
 * /api/members/import`); this only reads the text.
 */

export type RosterImportFormat = 'table' | 'csv' | 'list';

export interface RosterImportRow {
  name: string;
  /** Member (`true`) or drop-in (`false`) — a default the admin can flip in the preview. */
  regular: boolean;
  /** 1-based line in the source, for the preview. */
  line: number;
}

export interface RosterImportGuest {
  name: string;
  host: string;
}

export interface ParsedRoster {
  format: RosterImportFormat;
  rows: RosterImportRow[];
  /** Header names (or "column 3") of the columns that were read and NOT kept. */
  ignoredColumns: string[];
  /** `Jenny (Josh)` lines: plus-ones are added per session by their host, never imported. */
  guests: RosterImportGuest[];
  /** Non-empty lines that did not read as a name — a date header, a sentence. */
  skippedLines: string[];
}

// ---------------------------------------------------------------------------
// What the server answers (lib/rosterImportRun.ts) — here so the sheet can
// import the shapes without importing server code.
// ---------------------------------------------------------------------------

export interface ImportRowInput {
  name: string;
  /** Member (`true`) or drop-in (`false`). */
  regular: boolean;
  /** Import a `similar` row anyway — the admin ticked it in the preview. */
  force?: boolean;
}

export type ImportKind = 'new' | 'returning' | 'update' | 'unchanged' | 'similar' | 'duplicate' | 'invalid';

export interface ClassifiedRow {
  name: string;
  regular: boolean;
  kind: ImportKind;
  /** `similar`: the roster (or earlier) name it reads like. */
  similarTo?: string;
  /** `update` / `unchanged`: how the person is marked today; `null` = not marked. */
  current?: boolean | null;
  /** `invalid`: why. */
  reason?: 'empty' | 'too_long';
}

export type ImportOutcome = 'added' | 'rejoined' | 'updated' | 'unchanged' | 'skipped' | 'taken' | 'failed';

export interface ImportResultRow {
  name: string;
  outcome: ImportOutcome;
}

/** File types this cannot read, refused before parsing with the "save as CSV" line. */
const SPREADSHEET_FILE = /\.(xlsx|xlsm|xls|numbers|ods)$/i;

export function isSpreadsheetFile(fileName: string): boolean {
  return SPREADSHEET_FILE.test(fileName.trim());
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * Split delimited text into rows of cells, honouring double quotes: a quoted
 * cell may hold the delimiter, a newline, or `""` for a literal quote. Excel
 * quotes a copied cell the same way, so one reader serves tabs and commas.
 */
function readCells(text: string, delimiter: ',' | '\t'): Array<{ cells: string[]; line: number }> {
  const out: Array<{ cells: string[]; line: number }> = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(cell);
      out.push({ cells: row, line: rowLine });
      row = [];
      cell = '';
      line++;
      rowLine = line;
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  out.push({ cells: row, line: rowLine });
  return out.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

/** A name as it should be stored: no emoji, no chat formatting, single spaces. */
function cleanName(raw: string): string {
  return raw
    .replace(/\p{Extended_Pictographic}|‍|️/gu, '')
    .replace(/[*_~]+/g, ' ')
    .replace(/\s+\+\s*1$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Jenny (Josh)` → a guest of Josh. A bracket that is the whole name is not one. */
function asGuest(name: string): RosterImportGuest | null {
  const m = /^(.+?)\s*[(（]\s*([^()（）]+?)\s*[)）]$/u.exec(name);
  if (!m) return null;
  return { name: m[1].trim(), host: m[2].trim() };
}

const HEADER_NAME = new Set(['name', 'names', 'full name', 'player', 'players', 'member name', '姓名', '名字']);
const HEADER_FIRST = new Set(['first', 'first name', 'firstname', 'given name', '名']);
const HEADER_LAST = new Set(['last', 'last name', 'lastname', 'surname', 'family name', '姓']);
const HEADER_KIND = new Set([
  'member', 'members', 'member?', 'regular', 'type', 'status', 'membership', 'drop-in', 'dropin', 'drop in', 'member or drop-in',
]);
const MEMBER_WORDS = new Set(['member', 'members', 'regular', 'yes', 'y', 'm', 'true', '1', '✓', '✔', 'x', '会员']);
const DROP_IN_WORDS = new Set([
  'drop-in', 'dropin', 'drop in', 'drop-ins', 'guest', 'no', 'n', 'd', 'false', '0', 'casual', 'non-member', 'nonmember', 'non member',
]);

const norm = (s: string) => s.trim().toLowerCase();

/** `true` member, `false` drop-in, `null` a value that says neither. */
function readKind(value: string): boolean | null {
  const v = norm(value);
  if (MEMBER_WORDS.has(v)) return true;
  if (DROP_IN_WORDS.has(v)) return false;
  return null;
}

function fromTable(
  table: Array<{ cells: string[]; line: number }>,
  format: 'table' | 'csv',
): ParsedRoster {
  const result: ParsedRoster = { format, rows: [], ignoredColumns: [], guests: [], skippedLines: [] };
  if (table.length === 0) return result;

  const first = table[0].cells.map(norm);
  const headerNameAt = first.findIndex((c) => HEADER_NAME.has(c));
  // A sheet with First and Last columns instead of one Name column.
  const firstAt = headerNameAt < 0 ? first.findIndex((c) => HEADER_FIRST.has(c)) : -1;
  const lastAt = firstAt >= 0 ? first.findIndex((c) => HEADER_LAST.has(c)) : -1;
  const hasHeader = headerNameAt >= 0 || firstAt >= 0;
  const width = Math.max(...table.map((r) => r.cells.length));
  const body = hasHeader ? table.slice(1) : table;
  const nameAt = headerNameAt >= 0 ? headerNameAt : firstAt >= 0 ? firstAt : 0;

  let kindAt = hasHeader ? first.findIndex((c, i) => i !== nameAt && HEADER_KIND.has(c)) : -1;
  if (!hasHeader) {
    // No header: a column whose every filled cell reads as member or drop-in.
    for (let col = 0; col < width && kindAt < 0; col++) {
      if (col === nameAt) continue;
      const filled = body.map((r) => r.cells[col] ?? '').filter((c) => c.trim() !== '');
      if (filled.length > 0 && filled.every((c) => readKind(c) !== null)) kindAt = col;
    }
  }

  for (let col = 0; col < width; col++) {
    if (col === nameAt || col === kindAt || col === lastAt) continue;
    const used = body.some((r) => (r.cells[col] ?? '').trim() !== '');
    if (!used && !(hasHeader && (table[0].cells[col] ?? '').trim())) continue;
    const label = hasHeader ? (table[0].cells[col] ?? '').trim() : '';
    result.ignoredColumns.push(label || `column ${col + 1}`);
  }

  for (const r of body) {
    const name = cleanName(lastAt >= 0 ? `${r.cells[nameAt] ?? ''} ${r.cells[lastAt] ?? ''}` : r.cells[nameAt] ?? '');
    if (!name) continue;
    const guest = asGuest(name);
    if (guest) { result.guests.push(guest); continue; }
    const kind = kindAt >= 0 ? readKind(r.cells[kindAt] ?? '') : null;
    result.rows.push({ name, regular: kind ?? true, line: r.line });
  }
  return result;
}

// ---------------------------------------------------------------------------
// A list
// ---------------------------------------------------------------------------

/** `1.` `1)` `12 -` `3、` or a bullet, at the start of a line. */
const NUMBERED = /^\s*(?:\d{1,3}\s*[.)\-:、．]?|[-•*·])\s*/u;
const WAITLIST_HEADING = /^(?:waiting\s*list|wait\s*list|waitlist|waiting|reserves?|候补|候補|等候|后备)\b|^(?:候补|候補|等候|后备)/iu;
const DATE_WORDS =
  /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm)\b|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|\d+\s*[月日号]/iu;
/** A CJK weekday reads as a date on its own; no one is called 星期六. */
const CJK_WEEKDAY = /[星周]期?[一二三四五六日天]|礼拜[一二三四五六日天]/u;
/**
 * A date or time header ("Saturday Oct 26, 7–10pm"). It needs a DIGIT beside
 * the month or weekday word: May, Jun and Sun are people's names too.
 */
function looksLikeADate(line: string): boolean {
  return CJK_WEEKDAY.test(line) || (/\d/.test(line) && DATE_WORDS.test(line));
}
/** Longer than any name: a sentence in the post, not a person. */
const MAX_NAME_WORDS = 4;

function fromList(text: string): ParsedRoster {
  const result: ParsedRoster = { format: 'list', rows: [], ignoredColumns: [], guests: [], skippedLines: [] };
  let regular = true;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const plain = cleanName(line).replace(/[:：]$/, '').trim();
    // Short, or "waiting for Ian to confirm" would flip the rest to drop-ins.
    if (plain.split(' ').length <= 3 && WAITLIST_HEADING.test(plain)) { regular = false; return; }

    const marker = NUMBERED.exec(line);
    const numbered = marker !== null && marker[0].trim() !== '';
    const rest = cleanName(numbered ? line.slice(marker![0].length) : line);
    // A number with nothing after it is an open spot on the list.
    if (!rest) return;
    if (!numbered) {
      if (line.endsWith(':') || line.endsWith('：') || looksLikeADate(rest) || rest.split(' ').length > MAX_NAME_WORDS) {
        result.skippedLines.push(line);
        return;
      }
    }
    const guest = asGuest(rest);
    if (guest) { result.guests.push(guest); return; }
    result.rows.push({ name: rest, regular, line: index + 1 });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Read a pasted list or a file's text. `source: 'csv'` (the file picker)
 * always reads as CSV, or tab-separated if the file has tabs and no commas.
 * A paste is tab-separated when any line has a tab, CSV when most lines carry
 * a comma and none is numbered, and a list otherwise.
 */
export function parseRosterText(text: string, opts: { source?: 'paste' | 'csv' } = {}): ParsedRoster {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { format: 'list', rows: [], ignoredColumns: [], guests: [], skippedLines: [] };

  const hasTab = lines.some((l) => l.includes('\t'));
  const withComma = lines.filter((l) => l.includes(',')).length;
  if (opts.source === 'csv') {
    return hasTab && withComma === 0 ? fromTable(readCells(clean, '\t'), 'table') : fromTable(readCells(clean, ','), 'csv');
  }
  if (hasTab) return fromTable(readCells(clean, '\t'), 'table');
  const anyNumbered = lines.some((l) => /^\s*\d{1,3}\s*[.)\-:、．]/u.test(l));
  if (!anyNumbered && withComma * 2 > lines.length) return fromTable(readCells(clean, ','), 'csv');
  return fromList(clean);
}
