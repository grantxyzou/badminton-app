import { groupDocId, groupScope, type GroupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';
import { labelKey } from './stringStock';
import { isReelColourId, type ReelColourId } from './stringPalette';

/**
 * THE CLUB'S BARCODES (docs/plans/string-barcode-stocktake.md; Grant,
 * 2026-11-16: "why cant we just treat reading inventory like scanning a
 * product in?"). A packet or a reel carries a barcode; the first time a club
 * scans one, the counter says which shelf string, which colour and whether it
 * is a packet or a reel, and the club remembers it here. Every later scan is
 * exact, free and needs no network beyond saving the count.
 *
 * One `kind: 'stringBarcode'` row in `clubSettings` per code — no new
 * container (the account sits at Cosmos's cap). Taught again, a code REPLACES
 * its answer, which is how a wrong one is put right. Nothing about a person
 * or money: who taught it, and when, for the record.
 */

export const STRING_BARCODE_KIND = 'stringBarcode';
export type BarcodeForm = 'packet' | 'reel';

export interface StringBarcode {
  id: string;
  groupId?: string;
  kind: typeof STRING_BARCODE_KIND;
  /** The code as the camera read it. */
  code: string;
  /** The shelf label it stands for, exactly as offered. */
  label: string;
  /** A reel colour id; absent = mixed / not sure. */
  color?: ReelColourId;
  form: BarcodeForm;
  taughtBy: string;
  taughtAt: string;
}

/** What the sheet needs per code, and nothing else. */
export type BarcodeAnswer = Pick<StringBarcode, 'code' | 'label' | 'form'> & { color: ReelColourId | null };

/** EAN-8/13, UPC-A/E, ITF-14 are digits; Code 128 is printable ASCII. A length a label can carry. */
const CODE = /^[\x21-\x7e]{4,64}$/;
export const isBarcode = (v: unknown): v is string => typeof v === 'string' && CODE.test(v);

/** The doc id for a code. Hex-encoded so a code's own characters never shape an id. */
export function barcodeDocId(groupId: string, code: string): string {
  return groupDocId(groupId, `stringBarcode:${Buffer.from(code, 'utf8').toString('hex')}`);
}

export async function readStringBarcodes(scope: GroupScope): Promise<StringBarcode[]> {
  await ensureClubSettings();
  // A literal, as `readStringPurchases`: the mock knows no `@kind`.
  const rows = await scope.query<StringBarcode & { kind?: string }>('clubSettings', { where: `c.kind = '${STRING_BARCODE_KIND}'` });
  return rows.filter((r) => r.kind === STRING_BARCODE_KIND && isBarcode(r.code));
}

/** The answers a sheet carries, keyed by nothing but the code; a label no longer offered is dropped. */
export function barcodeAnswers(rows: readonly StringBarcode[], offered: readonly string[]): BarcodeAnswer[] {
  const byKey = new Map(offered.map((l) => [labelKey(l), l]));
  const out: BarcodeAnswer[] = [];
  for (const r of rows) {
    const label = byKey.get(labelKey(r.label));
    if (!label) continue;
    out.push({ code: r.code, label, form: r.form === 'reel' ? 'reel' : 'packet', color: isReelColourId(r.color) ? r.color : null });
  }
  return out;
}

export class BarcodeError extends Error {
  constructor(public readonly code: 'invalid_request' | 'unknown_string' | 'changed_elsewhere') {
    super(code);
  }
}

/** Checks a teach body against the shelf: an offered label, a palette colour or none, packet or reel. */
export function validateBarcode(body: Record<string, unknown>, offered: readonly string[]): Omit<BarcodeAnswer, 'color'> & { color?: ReelColourId } {
  if (!isBarcode(body.code)) throw new BarcodeError('invalid_request');
  if (body.form !== 'packet' && body.form !== 'reel') throw new BarcodeError('invalid_request');
  if (body.color !== undefined && body.color !== null && !isReelColourId(body.color)) throw new BarcodeError('invalid_request');
  const label = typeof body.label === 'string' ? offered.find((l) => labelKey(l) === labelKey(body.label as string)) : undefined;
  if (!label) throw new BarcodeError('unknown_string');
  return { code: body.code, label, form: body.form, ...(isReelColourId(body.color) ? { color: body.color } : {}) };
}

/**
 * Teach (or re-teach) one code. Created the first time; REPLACED under the
 * etag of the read after that, so two phones teaching the same code at once
 * end with one answer and the other told to try again, never a silent mix.
 */
export async function saveStringBarcode(
  groupId: string,
  input: Omit<BarcodeAnswer, 'color'> & { color?: ReelColourId },
  memberId: string,
): Promise<StringBarcode> {
  await ensureClubSettings();
  const scope = groupScope(groupId);
  const id = barcodeDocId(groupId, input.code);
  const doc: StringBarcode = {
    id, kind: STRING_BARCODE_KIND, code: input.code, label: input.label, form: input.form,
    ...(input.color ? { color: input.color } : {}),
    taughtBy: memberId, taughtAt: new Date().toISOString(),
  };
  const existing = await scope.read<StringBarcode>('clubSettings', id);
  if (existing && existing.kind !== STRING_BARCODE_KIND) throw new Error(`clubSettings ${id} is not a barcode`);
  if (!existing) {
    try {
      return await scope.create<StringBarcode>('clubSettings', doc);
    } catch (err) {
      if ((err as { code?: unknown })?.code === 409) throw new BarcodeError('changed_elsewhere');
      throw err;
    }
  }
  // Carry the read's etag (the spread) so `replace` is conditional on it.
  const { color: _old, ...rest } = existing;
  const written = await scope.replace<StringBarcode>('clubSettings', { ...rest, ...doc });
  if (!written) throw new BarcodeError('changed_elsewhere');
  return written;
}
