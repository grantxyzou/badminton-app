'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import ListRow from '@/components/primitives/ListRow';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { isFlagOn } from '@/lib/flags';
import { useOnline } from '@/lib/useOnline';
import type { EtransferPayment, PaymentAllocation } from '@/lib/types';
import { useRevealReady } from '@/components/primitives/Reveal';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Inbox {
  configured: boolean;
  keyCreatedAt: string | null;
  lastReceivedAt: string | null;
  review: EtransferPayment[];
  recent: EtransferPayment[];
  last28Days: { received: number; autoMatched: number; adminMatched: number; ignored: number; waiting: number };
  hold: { threshold: number; suggested: number; names: string[] };
}

/** No email for this long while set up reads as "the script may have stopped". */
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

const REASON: Record<string, string> = {
  unauthenticated: "Gmail couldn't confirm Interac sent this",
  unknown_sender: "We don't know this name yet",
  ambiguous_sender: 'More than one person has this name',
  nothing_owed: "They don't owe anything right now",
  amount_mismatch: "The amount doesn't match what they owe",
  unrecognized_email: "We couldn't read this email",
  changed_while_matching: 'Something changed while matching',
};

const money = (cents: number | null) => (cents === null ? '$—' : `$${(cents / 100).toFixed(2)}`);

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/**
 * The e-transfer inbox (docs/plans/payments.md). Renders nothing with the flag
 * off. Set up → a one-line status plus anything waiting for a person; not set
 * up → the invitation to set it up. A failed load is an explicit error: "0
 * waiting" is exactly the answer that would let a payment sit unseen.
 */
export default function PaymentsInboxCard({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const enabled = isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO');
  const [data, setData] = useState<Inbox | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [assigning, setAssigning] = useState<EtransferPayment | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/payments`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`inbox ${res.status}`);
      setData((await res.json()) as Inbox);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load, refreshKey]);

  // The console's RevealSlot holds this place until the inbox has answered.
  useRevealReady(!enabled || data !== null || loadError);

  if (!enabled) return null;
  const title = 'E-transfers';

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="receipt_long"
        title={title}
        message={<>Couldn&apos;t load the e-transfer inbox. <StateLink onClick={() => void load()}>Try again</StateLink></>}
      />
    );
  }
  if (!data) return null;

  const done = () => {
    void load();
    onChanged?.();
  };

  if (!data.configured) {
    return (
      <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
        <CardHeader icon="receipt_long" title="Auto-detect e-transfers" subtitle="Stop ticking people off one by one." />
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          A small script in your Gmail sends each Interac notification here. Payments that clearly match what
          someone owes are marked paid on their own; anything unclear waits for you below.
        </p>
        <button type="button" className="cc-btn cc-btn-primary" onClick={() => setSetupOpen(true)}>
          Set up
        </button>
        <SetupSheet open={setupOpen} onClose={() => setSetupOpen(false)} onDone={done} />
      </section>
    );
  }

  const stale = !data.lastReceivedAt
    ? Date.now() - Date.parse(data.keyCreatedAt ?? '') > STALE_MS
    : Date.now() - Date.parse(data.lastReceivedAt) > STALE_MS;
  const w = data.last28Days;

  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={title}>
      <CardHeader
        icon="receipt_long"
        title={title}
        subtitle={`Last email ${ago(data.lastReceivedAt)}${w.received > 0 ? ` · ${w.autoMatched} of ${w.received} matched on their own (28 days)` : ''}`}
        action={
          <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setSetupOpen(true)}>
            Setup
          </button>
        }
      />
      {stale && (
        <p className="fs-sm" role="status" style={{ margin: 0, color: 'var(--sev-warn)' }}>
          No e-transfer email in two weeks. If people have been paying, the Gmail script may have stopped — open
          Setup to check it.
        </p>
      )}
      {data.review.length === 0 ? (
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Nothing waiting. New e-transfers are matched as they arrive.
        </p>
      ) : (
        <>
          <p className="section-label-muted" style={{ margin: 0 }}>
            Needs a look · {data.review.length}
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
            {data.review.map((p) => (
              <li key={p.id}>
                <ListRow
                  onClick={() => setAssigning(p)}
                  title={
                    <span className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {p.senderName ?? 'Unreadable email'}
                    </span>
                  }
                  subtitle={
                    <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                      {/* Unverified is said in the LIST, not only in the sheet:
                          the reason shown may be a different one (an unknown
                          name), and a forged email must never look ordinary. */}
                      {!p.authenticated && <span style={{ color: 'var(--sev-warn)' }}>Unverified · </span>}
                      {REASON[p.reason ?? ''] ?? 'Waiting for you'} · {ago(p.receivedAt)}
                    </span>
                  }
                  trailing={
                    <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {money(p.amountCents)}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <HoldRow hold={data.hold} onDone={done} />
      <SetupSheet open={setupOpen} onClose={() => setSetupOpen(false)} onDone={done} configured />
      {assigning && <AssignSheet payment={assigning} onClose={() => setAssigning(null)} onDone={done} />}
    </section>
  );
}

// ── The soft hold ──────────────────────────────────────────────────────────

/**
 * Off by default, and the switch shows WHO it would hold before it is
 * pressed: a club whose payments were ticked by hand for months carries old
 * rows, and the admin should see "this would hold Lin and Viktor" — and clean
 * that up — before anyone is waitlisted for a debt they paid in cash.
 */
function HoldRow({ hold, onDone }: { hold: Inbox['hold']; onDone: () => void }) {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const on = hold.threshold > 0;
  const n = on ? hold.threshold : hold.suggested;

  async function set(holdAfterUnpaid: number) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/payments/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdAfterUnpaid }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onDone();
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  const who = hold.names.length === 0 ? 'nobody' : hold.names.join(', ');
  return (
    <div className="flex flex-col gap-2" style={{ borderTop: '1px solid var(--inner-card-border)', paddingTop: 'var(--space-4)' }}>
      <p className="section-label-muted" style={{ margin: 0 }}>
        Unpaid hold · {on ? 'on' : 'off'}
      </p>
      <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
        {on
          ? `Anyone owing for ${n}+ finalized sessions joins the waitlist until they pay. Held now: ${who}.`
          : `If on, anyone owing for ${n}+ finalized sessions joins the waitlist until they pay. Today that would be: ${who}.`}
      </p>
      <button type="button" className="cc-btn cc-btn-secondary" disabled={!online || busy} onClick={() => void set(on ? 0 : n)}>
        {on ? 'Turn off' : 'Turn on'}
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

// ── Setup ──────────────────────────────────────────────────────────────────

function SetupSheet({ open, onClose, onDone, configured = false }: { open: boolean; onClose: () => void; onDone: () => void; configured?: boolean }) {
  const online = useOnline();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'key' | 'script' | null>(null);
  const [busy, setBusy] = useState(false);

  async function mint() {
    if (configured && !window.confirm('A new key stops the old one working. Your Gmail script will need the new key. Continue?')) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/payments/key`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      setKey(((await res.json()) as { key: string }).key);
      onDone();
    } catch {
      setError("Couldn't create a key — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(what: 'key' | 'script') {
    setError('');
    try {
      const text =
        what === 'key' ? key ?? '' : await fetch(`${BASE}/payments/apps-script.gs`, { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        });
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setError("Couldn't copy — try again, or long-press to select.");
    }
  }

  const url = typeof window !== 'undefined' ? `${window.location.origin}${BASE}/api/payments/etransfer` : '';
  const step = { margin: 0, color: 'var(--text-secondary)' } as const;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Set up e-transfer detection">
      <BottomSheetHeader onClose={onClose} closeLabel="Close">
        <h2 className="bpm-h3" style={{ margin: 0 }}>Auto-detect e-transfers</h2>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-4">
          <p className="fs-sm" style={step}>
            <strong>1.</strong> {configured ? 'Your key is set. Create a new one only if you need to reinstall or think it leaked.' : 'Create your club’s key. It is shown once.'}
          </p>
          {key ? (
            <div className="flex flex-col gap-2">
              <code className="fs-sm" style={{ wordBreak: 'break-all', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{key}</code>
              <button type="button" className="cc-btn cc-btn-secondary" onClick={() => void copy('key')}>
                {copied === 'key' ? 'Copied' : 'Copy key'}
              </button>
            </div>
          ) : (
            <button type="button" className="cc-btn cc-btn-primary" disabled={!online || busy} onClick={() => void mint()}>
              {configured ? 'Create a new key' : 'Create key'}
            </button>
          )}
          <p className="fs-sm" style={step}>
            <strong>2.</strong> On a computer, open script.google.com signed in to the Gmail that gets your e-transfers.
            New project, then paste the script over the sample.
          </p>
          <button type="button" className="cc-btn cc-btn-secondary" onClick={() => void copy('script')}>
            {copied === 'script' ? 'Script copied' : 'Copy the script'}
          </button>
          <p className="fs-sm" style={step}>
            <strong>3.</strong> Project Settings → Script properties: add <code>BPM_KEY</code> (the key) and <code>BPM_URL</code>:
          </p>
          <code className="fs-sm" style={{ wordBreak: 'break-all', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{url}</code>
          <p className="fs-sm" style={step}>
            <strong>4.</strong> Pick <code>install</code> in the function menu and press Run, then allow access. It checks every 5 minutes from then on.
          </p>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}

// ── Assign ─────────────────────────────────────────────────────────────────

interface OwedResponse {
  sessions: { sessionId: string; playerId: string; date: string; owedAmount: number }[];
  stringing: { jobId: string; jobNo: string; racketLabel: string; amount: number }[];
}

function AssignSheet({ payment, onClose, onDone }: { payment: EtransferPayment; onClose: () => void; onDone: () => void }) {
  const online = useOnline();
  const suggestions = payment.suggestions ?? [];
  const [roster, setRoster] = useState<string[]>([]);
  const [name, setName] = useState<string>(suggestions[0]?.name ?? '');
  const [owed, setOwed] = useState<OwedResponse | null>(null);
  const [owedError, setOwedError] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BASE}/api/members`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rows: { name: string }[]) => setRoster(rows.map((m) => m.name)))
      .catch(() => setRoster([]));
  }, []);

  useEffect(() => {
    if (!name) return;
    setOwed(null);
    setOwedError(false);
    fetch(`${BASE}/api/players/unpaid?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: OwedResponse) => {
        setOwed(d);
        const proposed = suggestions.find((s) => s.name === name)?.proposed ?? [];
        setPicked(new Set(proposed.map((a: PaymentAllocation) => a.ref)));
      })
      .catch(() => setOwedError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- suggestions are fixed for this sheet
  }, [name]);

  const lines = owed
    ? [
        ...owed.sessions.map((s) => ({ ref: s.playerId, label: new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cents: Math.round(s.owedAmount * 100) })),
        ...owed.stringing.map((j) => ({ ref: j.jobId, label: `Stringing ${j.jobNo}`, cents: Math.round(j.amount * 100) })),
      ]
    : [];
  const pickedCents = lines.filter((l) => picked.has(l.ref)).reduce((s, l) => s + l.cents, 0);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/payments/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: payment.id, ...body }),
      });
      if (!res.ok) {
        const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        throw new Error(code === 'not_owed' ? "Those lines aren't owed any more — refresh." : 'Couldn’t save — try again.');
      }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} ariaLabel="Match this e-transfer">
      <BottomSheetHeader onClose={onClose} closeLabel="Close">
        <h2 className="bpm-h3" style={{ margin: 0 }}>{`${payment.senderName ?? 'Unknown'} · ${money(payment.amountCents)}`}</h2>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-4">
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
            {REASON[payment.reason ?? ''] ?? 'Waiting for you'}
            {payment.memo ? ` · “${payment.memo}”` : ''}
          </p>
          {!payment.authenticated && (
            <p className="fs-sm" role="status" style={{ margin: 0, color: 'var(--sev-warn)' }}>
              Check your bank shows this money before matching it — anyone can send an email that looks like Interac.
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="section-label-muted">Who paid</span>
            <select className="fs-md" value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">Choose…</option>
              {suggestions.map((s) => (
                <option key={`s-${s.name}`} value={s.name}>{s.name} (suggested)</option>
              ))}
              {roster.filter((r) => !suggestions.some((s) => s.name === r)).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          {owedError && <p className="field-error" role="alert">Couldn&apos;t load what they owe.</p>}
          {name && owed && lines.length === 0 && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{name} doesn&apos;t owe anything right now.</p>
          )}
          {lines.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
              {lines.map((l) => (
                <li key={l.ref}>
                  <label className="flex items-center justify-between gap-3 fs-md" style={{ color: 'var(--text-primary)' }}>
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.has(l.ref)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(l.ref);
                          else next.delete(l.ref);
                          setPicked(next);
                        }}
                      />
                      {l.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{money(l.cents)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {picked.size > 0 && payment.amountCents !== null && pickedCents !== payment.amountCents && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
              Selected {money(pickedCents)} of the {money(payment.amountCents)} received.
            </p>
          )}
          {payment.senderName && name && payment.senderName.toLowerCase() !== name.toLowerCase() && (
            <label className="flex items-center gap-2 fs-sm" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember “{payment.senderName}” as {name}
            </label>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button
            type="button"
            className="cc-btn cc-btn-primary"
            disabled={!online || busy || !name || picked.size === 0}
            onClick={() => void send({ action: 'assign', name, refs: [...picked], remember })}
          >
            Mark paid
          </button>
          <button type="button" className="cc-btn cc-btn-ghost" disabled={!online || busy} onClick={() => void send({ action: 'ignore', ...(name && remember ? { name, remember: true } : {}) })}>
            {name && remember && payment.senderName && payment.senderName.toLowerCase() !== name.toLowerCase()
              ? `Dismiss, and remember as ${name}`
              : 'Not a session payment — dismiss'}
          </button>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
