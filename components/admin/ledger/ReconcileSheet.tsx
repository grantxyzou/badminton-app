'use client';

import { useCallback, useEffect, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Mismatch {
  memberId: string;
  name: string | null;
  ref: { kind: 'session' | 'stringing'; id: string; pk: string };
  code: 'missing_charge' | 'missing_payment' | 'stale_charge' | 'amount_mismatch';
  ledgerCents: number;
  liveCents: number;
}

interface Report {
  lastAt: string | null;
  checked?: number;
  unlisted?: number;
  truncated?: boolean;
  mirrorFailures?: number;
  mismatches?: Mismatch[];
}

const CODE: Record<Mismatch['code'], { label: string; fix: string }> = {
  missing_charge: { label: 'Not in the ledger', fix: 'Run the ledger backfill again.' },
  missing_payment: { label: 'Paid, but the ledger still shows it owed', fix: 'Run the ledger backfill again.' },
  stale_charge: { label: 'Ledger still shows it owed', fix: 'Redo the cover, unsettle or reversal so the ledger sees it.' },
  amount_mismatch: { label: 'Amounts differ', fix: 'Run the backfill; if it persists, unsettle and settle the session again.' },
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const who = (m: Mismatch) => m.name ?? (m.memberId === '~unlinked' ? 'Unlinked row' : m.memberId === '~anon' ? 'Former member' : 'Removed member');

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
export default function ReconcileSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const online = useOnline();
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');

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
      if (!res.ok) throw new Error(String(res.status));
      setReport((await res.json()) as Report);
      onChanged();
    } catch {
      setCheckError("Couldn't run the check — try again.");
    } finally {
      setChecking(false);
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
            Once a day, every finalized line people see is compared with the ledger this page sums. A line that
            disagrees is listed here with what to do about it. Nothing is changed automatically.
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
                  {mismatches.map((m) => (
                    <li key={`${m.ref.kind}:${m.ref.id}`} className="cc-mini-card" style={{ padding: 'var(--space-3)' }}>
                      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
                        <span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {who(m)} · {m.ref.kind === 'stringing' ? 'stringing' : 'session'}
                        </span>
                        <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          ledger {money(m.ledgerCents)} · app {money(m.liveCents)}
                        </span>
                      </div>
                      <p className="fs-sm" style={{ margin: 'var(--space-05) 0 0', color: 'var(--sev-warn)' }}>{CODE[m.code].label}</p>
                      <p className="fs-sm" style={{ margin: 'var(--space-05) 0 0', color: 'var(--text-muted)' }}>{CODE[m.code].fix}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {checkError && <p className="field-error" role="alert">{checkError}</p>}
          <button type="button" className="cc-btn cc-btn-secondary" disabled={!online || checking} onClick={() => void checkNow()} style={{ alignSelf: 'flex-start' }}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
