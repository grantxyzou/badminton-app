'use client';

import { useCallback, useEffect, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { reconcileFailureFrom, reconcileFailureMessage } from '@/lib/reconcileFailure';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Subject {
  kind: 'session' | 'stringing';
  exists: boolean;
  // session
  date?: string | null;
  paid?: boolean;
  paidVia?: string | null;
  covered?: boolean;
  removed?: boolean;
  settled?: boolean;
  // stringing
  jobNo?: string | null;
  racket?: string | null;
  status?: string | null;
  paidAt?: string | null;
  invoiced?: boolean;
  billsOnInvoice?: boolean;
  archived?: boolean;
  withdrawn?: boolean;
}

interface Entry {
  kind: string;
  amountCents: number;
  note: string;
  at: string | null;
  via: string | null;
  reason: string | null;
  voided: boolean;
}

interface Mismatch {
  memberId: string;
  name: string | null;
  ref: { kind: 'session' | 'stringing'; id: string; pk: string };
  code: 'missing_charge' | 'missing_payment' | 'stale_charge' | 'amount_mismatch';
  ledgerCents: number;
  liveCents: number;
  /** The job or session behind the line and its ledger entries (absent from an older server). */
  detail?: { subject: Subject; entries: Entry[] };
}

interface Report {
  lastAt: string | null;
  checked?: number;
  unlisted?: number;
  truncated?: boolean;
  mirrorFailures?: number;
  mismatches?: Mismatch[];
}

/** The short name of what went wrong, as a heading. */
const LABEL: Record<Mismatch['code'], string> = {
  missing_charge: 'Missing from the ledger',
  missing_payment: 'Paid, but the ledger still shows it owed',
  stale_charge: 'The ledger still shows it owed',
  amount_mismatch: 'Amounts differ',
};

const money = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const plain = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
const who = (m: Mismatch) => m.name ?? (m.memberId === '~unlinked' ? 'Unlinked row' : m.memberId === '~anon' ? 'Former member' : 'Removed member');

const day = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });
};

const STATUS: Record<string, string> = { requested: 'Requested', received: 'Dropped off', strung: 'Strung', ready: 'Ready', picked_up: 'Picked up' };
const VIA: Record<string, string> = { card: 'card', etransfer: 'e-transfer', credit: 'credit', manual: 'marked paid' };

/** "Grant · J-0006 · Astrox 88D Pro" or "Lin · Nov 13 session". */
function title(m: Mismatch): string {
  const s = m.detail?.subject;
  if (m.ref.kind === 'stringing') {
    if (!s) return `${who(m)} · stringing`;
    if (!s.exists) return `${who(m)} · stringing job (deleted)`;
    return [who(m), s.jobNo, s.racket].filter(Boolean).join(' · ');
  }
  const date = day(s?.date ?? null);
  return `${who(m)} · ${date ? `${date} session` : 'session'}`;
}

/** Where the job or row stands now, as the app sees it. */
function facts(m: Mismatch): string {
  const s = m.detail?.subject;
  if (!s) return '';
  if (!s.exists) return m.ref.kind === 'stringing' ? 'Deleted from the archive' : 'This row was deleted';
  const out: string[] = [];
  if (s.kind === 'stringing') {
    if (s.status) out.push(STATUS[s.status] ?? s.status);
    out.push(s.paidAt ? `paid ${day(s.paidAt)}` : 'not paid');
    if (s.billsOnInvoice) out.push(s.invoiced ? 'invoiced' : 'not invoiced');
    if (s.withdrawn) out.push('withdrawn');
    if (s.archived) out.push('archived');
  } else {
    out.push(s.settled ? 'Settled' : 'Not settled');
    if (s.paid) out.push(s.paidVia && VIA[s.paidVia] ? `paid (${VIA[s.paidVia]})` : 'paid');
    else out.push('not paid');
    if (s.covered) out.push('covered');
    if (s.removed) out.push('removed from the list');
  }
  return out.join(' · ');
}

/** What is wrong, in a sentence. */
function explain(m: Mismatch): string {
  const name = who(m);
  switch (m.code) {
    case 'missing_charge':
      return `The app shows ${name} owes ${plain(m.liveCents)} for this, but the ledger has no charge for it.`;
    case 'missing_payment':
      return `${name} has paid this, but the ledger still shows ${plain(m.ledgerCents)} owed: the payment never reached the ledger.`;
    case 'stale_charge':
      return `The ledger still shows ${plain(m.ledgerCents)} owed, but the app says ${m.liveCents === 0 ? 'nothing is' : `${plain(m.liveCents)} is`} owed. The ledger missed a change.`;
    case 'amount_mismatch':
      if (m.ledgerCents < 0 && m.liveCents === 0) {
        return `The ledger has a ${plain(m.ledgerCents)} payment but no charge under it. Nobody owes anything and no money is missing: the ledger is only missing the charge half.`;
      }
      return `The ledger says ${plain(m.ledgerCents)} is owed; the app shows ${plain(m.liveCents)}.`;
  }
}

/** What to do about it, for this kind of line in the state it is in. */
function fix(m: Mismatch): string {
  const s = m.detail?.subject;
  if (m.ref.kind === 'stringing') {
    const job = s?.jobNo ?? 'the job';
    if (s && !s.exists) {
      return canRestore(m)
        ? `The job was deleted after it was paid, and the delete took its charge with it. Tap Restore the charge: it writes the missing ${plain(m.ledgerCents)} charge back, so the payment has its bill again. Nobody is charged anything.`
        : 'The job was deleted, so it cannot repair itself. It needs a one-off ledger entry; ask the operator.';
    }
    if (m.code === 'missing_payment') return `Open ${job} on the bench${s?.archived ? ' (in the archive)' : ''}, mark it unpaid, then paid again.`;
    return `Open ${job} on the bench${s?.archived ? ' (in the archive)' : ''} and make any change, such as archiving or unarchiving it. Any change to a job rewrites its ledger lines.`;
  }
  if (s && !s.exists) return 'The row was deleted. Run the ledger backfill; if it stays, it needs a one-off ledger entry.';
  switch (m.code) {
    case 'missing_charge':
      return 'Run the ledger backfill: it writes the missing charge.';
    case 'missing_payment':
      return 'Open this session’s payments, mark the row unpaid, then paid again.';
    case 'stale_charge':
      return 'Open this session’s payments and redo the last change to this row (the cover, removal or unsettle) so the ledger sees it.';
    case 'amount_mismatch':
      return 'Open this session’s payments and settle it again. If it stays, run the ledger backfill.';
  }
}

/** A deleted job whose only live money is a payment: the one line "Restore the charge" can mend. */
function canRestore(m: Mismatch): boolean {
  const s = m.detail?.subject;
  return m.ref.kind === 'stringing' && !!s && !s.exists && m.code === 'amount_mismatch' && m.ledgerCents < 0 && m.liveCents === 0;
}

/** One ledger entry as a line: "Nov 15 · Payment (card)  −$40.00". */
function entryLabel(e: Entry): string {
  const kind =
    e.kind === 'charge' ? 'Charge'
    : e.kind === 'payment' ? `Payment${e.via && VIA[e.via] ? ` (${VIA[e.via]})` : ''}`
    : e.kind === 'cover' ? 'Covered'
    : e.kind === 'void' ? `Reversal${e.reason ? ` (${e.reason.replace(/_/g, ' ')})` : ''}`
    : e.note || e.kind;
  return [day(e.at), kind].filter(Boolean).join(' · ');
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/**
 * The row-by-row result of the last ledger check, and "Check now". Reads
 * on open, so the list is never older than the sheet.
 */
export default function ReconcileSheet({
  open,
  onClose,
  onChanged,
  onOpenSession,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** Opens a session's payments (the Ledger page's own link). */
  onOpenSession?: (sessionId: string) => void;
}) {
  const online = useOnline();
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/ledger/reconcile`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setReport((await res.json()) as Report);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function checkNow() {
    setChecking(true);
    setCheckError('');
    try {
      const res = await fetch(`${BASE}/api/admin/ledger/reconcile`, { method: 'POST' });
      if (!res.ok) {
        setCheckError(await reconcileFailureFrom(res));
        return;
      }
      setReport((await res.json()) as Report);
      onChanged();
    } catch {
      // fetch threw: no answer at all (offline, a dropped connection).
      setCheckError(reconcileFailureMessage(null, null));
    } finally {
      setChecking(false);
    }
  }

  // "Restore the charge": one entry for one deleted job, then the check runs
  // again so the line goes away in front of the person who tapped it.
  async function restore(m: Mismatch) {
    setRestoring(m.ref.id);
    setRestoreError(null);
    try {
      const res = await fetch(`${BASE}/api/admin/ledger/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'stringing', id: m.ref.id, memberId: m.memberId }),
      });
      if (!res.ok) {
        const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
        setRestoreError({
          id: m.ref.id,
          message:
            code === 'nothing_to_restore'
              ? 'Already restored. Tap Check now to refresh the list.'
              : code === 'job_exists'
                ? 'The job still exists: open it and make any change instead.'
                : res.status === 401
                  ? 'Your admin sign-in has expired. Sign in again and retry.'
                  : `Couldn't restore it (${res.status}). Try again.`,
        });
        return;
      }
      await checkNow();
    } catch {
      setRestoreError({ id: m.ref.id, message: "Couldn't reach the server. Try again." });
    } finally {
      setRestoring(null);
    }
  }

  const mismatches = report?.mismatches ?? [];

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Ledger check">
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Ledger check</span>
        <button type="button" onClick={onClose} aria-label="Close" className="cc-btn cc-btn-ghost">
          <span className="material-icons" style={{ fontSize: 'var(--icon-md)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            The ledger is the running record behind this page: a charge for every bill and a payment for every
            payment. Once a day it is checked against what each person sees in the app. A line where the two
            disagree is listed here with what happened and how to fix it. Nothing is changed automatically.
          </p>
          {loadError ? (
            <ErrorState message="Couldn't load the check." action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>Try again</button>} />
          ) : !report ? (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }} aria-busy="true">
              &nbsp;
            </p>
          ) : (
            <>
              <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {report.lastAt
                  ? `Checked ${ago(report.lastAt)} · ${report.checked ?? 0} lines · ${mismatches.length}${report.truncated ? '+' : ''} mismatch${mismatches.length === 1 ? '' : 'es'}${(report.unlisted ?? 0) > 0 ? ` · ${report.unlisted} for people no longer listed` : ''}`
                  : 'Not checked yet.'}
              </p>
              {report.lastAt && mismatches.length === 0 && (
                <p className="fs-md" style={{ margin: 0, color: 'var(--accent)', fontWeight: 600 }}>
                  The ledger matches what everyone sees.
                </p>
              )}
              {mismatches.length > 0 && (
                <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}>
                  {mismatches.map((m) => {
                    const entries = m.detail?.entries ?? [];
                    const fact = facts(m);
                    return (
                      <li key={`${m.ref.kind}:${m.ref.id}`} className="cc-mini-card flex flex-col" style={{ padding: 'var(--space-4)', gap: 'var(--space-2)' }}>
                        <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
                          <span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>
                            {title(m)}
                          </span>
                          <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--sev-warn)', whiteSpace: 'nowrap' }}>
                            off by {plain(m.ledgerCents - m.liveCents)}
                          </span>
                        </div>
                        {fact && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{fact}</p>}
                        <p className="fs-sm" style={{ margin: 0, color: 'var(--sev-warn)', fontWeight: 600 }}>{LABEL[m.code]}</p>
                        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)' }}>{explain(m)}</p>

                        <div className="flex flex-col" style={{ gap: 'var(--space-1)', paddingTop: 'var(--space-1)' }}>
                          <div className="flex justify-between fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            <span>In the ledger</span>
                            <span>{money(m.ledgerCents)}</span>
                          </div>
                          <div className="flex justify-between fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            <span>In the app</span>
                            <span>{money(m.liveCents)}</span>
                          </div>
                        </div>

                        {entries.length > 0 && (
                          <div className="flex flex-col" style={{ gap: 'var(--space-1)', paddingTop: 'var(--space-1)' }} data-testid="reconcile-entries">
                            <span className="section-label-muted">Ledger entries for this</span>
                            {entries.map((e, i) => (
                              <div key={i} className="flex justify-between fs-sm" style={{ gap: 'var(--space-3)', color: e.voided ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                                <span style={{ textDecoration: e.voided ? 'line-through' : undefined }}>{entryLabel(e)}</span>
                                <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', textDecoration: e.voided ? 'line-through' : undefined }}>
                                  {money(e.amountCents)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>To fix: </span>
                          {fix(m)}
                        </p>
                        {canRestore(m) && (
                          <>
                            <button
                              type="button"
                              className="cc-btn cc-btn-secondary"
                              style={{ alignSelf: 'flex-start' }}
                              disabled={!online || restoring !== null || checking}
                              onClick={() => void restore(m)}
                              data-testid="reconcile-restore"
                            >
                              {restoring === m.ref.id ? 'Restoring…' : `Restore the ${plain(m.ledgerCents)} charge`}
                            </button>
                            {restoreError?.id === m.ref.id && (
                              <p className="field-error" role="alert" style={{ margin: 0 }}>{restoreError.message}</p>
                            )}
                          </>
                        )}
                        {m.ref.kind === 'session' && onOpenSession && (
                          <button
                            type="button"
                            className="cc-btn cc-btn-ghost"
                            style={{ alignSelf: 'flex-start' }}
                            onClick={() => {
                              onClose();
                              onOpenSession(m.ref.pk);
                            }}
                          >
                            Open this session’s payments
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </BottomSheetBody>
      {/* The sheet's one action stays in reach under a long mismatch list. */}
      <BottomSheetFooter>
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
          {checkError && <p className="field-error" role="alert" style={{ margin: 0 }}>{checkError}</p>}
          <button type="button" className="cc-btn cc-btn-secondary" disabled={!online || checking} onClick={() => void checkNow()} style={{ alignSelf: 'flex-start' }}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
