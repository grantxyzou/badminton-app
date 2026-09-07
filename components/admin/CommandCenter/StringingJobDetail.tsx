'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { formatReadyBy } from '@/lib/stringingDue';
import { STRINGING_FLOW, formatPriceExact, playerStageFor } from '@/lib/stringing';
import type { StringingStatus } from '@/lib/stringing';
import type { StringingJob } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  job: StringingJob;
  onBack: () => void;
  onChanged: () => void;
}

/**
 * One job — screen 2b.
 *
 * The stepper is TAPPABLE IN BOTH DIRECTIONS, matching `canTransition`. A
 * racket gets handed back before it is paid for and rows get tapped by
 * mistake; refusing to go backwards would make the app wrong about the shelf
 * and offer no way to say so. The append-only history is what keeps that safe.
 *
 * The footnote showing what the PLAYER currently sees is not decoration. Every
 * price on this screen is exact, and the whole feature rests on the player
 * never seeing that figure — so the one screen where the exact number lives is
 * the right place to show, continuously, what the other side is reading.
 */
export default function StringingJobDetail({ job, onBack, onChanged }: Props) {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [local, setLocal] = useState(job);

  async function patch(body: Record<string, unknown>) {
    if (busy || !online) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${local.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: local.memberId, ...body }),
      });
      if (!res.ok) throw new Error(`patch ${res.status}`);
      const data = await res.json();
      setLocal(data.job);
      onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  /* The proposal form. Draft state is separate from `local` so nothing on this
     screen changes until the player agrees — which is the whole feature. */
  const [proposePrice, setProposePrice] = useState(
    local.priceCents === null ? '' : (local.priceCents / 100).toFixed(2),
  );
  const [proposeString, setProposeString] = useState(local.stringLabel);
  const [proposeMains, setProposeMains] = useState(String(local.tensionMains));
  const [proposeCrosses, setProposeCrosses] = useState(String(local.tensionCrosses));
  /* CLOSED ON EVERY MOUNT, including when a proposal is already pending.
     This screen's job is to tell you where a racket is; changing what you
     charge for it is a deliberate act, and a form standing open invites a
     stray tap on the one control that asks somebody to agree to a new price.
     Never seeded from props — "it was open last time" is not a reason. */
  /* Also closed by default. Tapping a step is a claim about the physical
     world ("I have the racket", "it is strung"), and five live targets under a
     thumb on first paint is how a racket gets marked picked-up by accident.
     The collapsed row still SAYS the status — only changing it is behind a tap. */
  const [statusOpen, setStatusOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [proposeBusy, setProposeBusy] = useState(false);
  const [proposeError, setProposeError] = useState(false);
  /* The force path: an ellipsis beside Send, then a confirm. Two taps, because
     it is the one control that moves somebody's bill without telling them. */
  const [forceOpen, setForceOpen] = useState(false);
  const [forceError, setForceError] = useState(false);

  /** Put the form back to what the job actually says. */
  function resetDraft() {
    setProposePrice(local.priceCents === null ? '' : (local.priceCents / 100).toFixed(2));
    setProposeString(local.stringLabel);
    setProposeMains(String(local.tensionMains));
    setProposeCrosses(String(local.tensionCrosses));
    setProposeError(false);
  }

  const pending = local.pendingEdit ?? null;
  const declined = !pending && typeof local.pendingEditDeclinedAt === 'string';

  const parsedCents = (() => {
    const raw = proposePrice.trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
  })();

  const differsFromJob =
    (parsedCents !== undefined && parsedCents !== local.priceCents) ||
    proposeString.trim() !== local.stringLabel ||
    Number(proposeMains) !== local.tensionMains ||
    Number(proposeCrosses) !== local.tensionCrosses;

  /**
   * Already asked, and asked for exactly this.
   *
   * Sending does not change the job's base fields — only `pendingEdit` — so a
   * comparison against the job alone stays dirty forever after a send, leaving
   * the button live. A second tap then builds an identical diff with a fresh
   * `proposedAt`, which the route reads as a NEW proposal and pushes again.
   * The player gets a duplicate notification for a question already open in
   * front of them. Every other push trigger in this app is de-duped
   * (`signupOpenNotifiedAt` is the precedent); this is the same rule.
   */
  const alreadyProposed =
    pending !== null &&
    (pending.priceCents ?? local.priceCents) === parsedCents &&
    (pending.stringLabel ?? local.stringLabel) === proposeString.trim() &&
    (pending.tensionMains ?? local.tensionMains) === Number(proposeMains) &&
    (pending.tensionCrosses ?? local.tensionCrosses) === Number(proposeCrosses);

  const proposalDirty = differsFromJob && !alreadyProposed;

  /** A drafted price that differs from the committed one — drives the headline
   *  diff. Deliberately NOT `proposalDirty`: a string or tension edit changes
   *  the job without changing the number, and turning the price into a
   *  "$30 → $30" diff for those would be noise. */
  const priceDrafted = parsedCents !== undefined && parsedCents !== local.priceCents;

  async function sendProposal() {
    if (proposeBusy || !online || !proposalDirty || parsedCents === undefined) return;
    setProposeBusy(true);
    setProposeError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${local.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: local.memberId,
          propose: {
            priceCents: parsedCents,
            stringLabel: proposeString.trim(),
            tensionMains: Number(proposeMains),
            tensionCrosses: Number(proposeCrosses),
          },
        }),
      });
      if (!res.ok) throw new Error(`propose ${res.status}`);
      setLocal((await res.json()).job);
      onChanged();
    } catch {
      setProposeError(true);
    } finally {
      setProposeBusy(false);
    }
  }

  /**
   * Change the price WITHOUT asking. The route has accepted `force` since the
   * propose branch shipped and nothing could reach it — so every correction of
   * a typo went out as a question to the player.
   *
   * Deliberately not a third way to edit: it sends the same drafted price the
   * form already holds, it just skips the asking.
   */
  async function forceChange() {
    if (proposeBusy || !online || parsedCents === undefined) return;
    setProposeBusy(true);
    setForceError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${local.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: local.memberId,
          priceCents: parsedCents,
          force: true,
        }),
      });
      if (!res.ok) throw new Error(`force ${res.status}`);
      setLocal((await res.json()).job);
      setForceOpen(false);
      onChanged();
    } catch {
      setForceError(true);
    } finally {
      setProposeBusy(false);
    }
  }

  const specRows: [string, string][] = [
    [t('spec.racket'), local.racketLabel],
    [t('spec.string'), local.stringLabel],
    [t('spec.tension'), `${local.tensionMains} / ${local.tensionCrosses} lb`],
    [t('spec.method'), local.method],
  ];

  return (
    <div>
      <AdminBackHeader onBack={onBack} title={local.memberName} />
      <div className="flex flex-col gap-4 pb-6">
        <p className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', margin: '0' }}>
          {/* Just the number now. The status has a card of its own directly
              below, and printing it twice on one screen made the smaller,
              greyer copy look like the authoritative one. */}
          {local.jobNo}
        </p>

        {error && <ErrorState message={t('saveError')} />}

        {/* What the player has been asked, and has not answered. Sits above
            everything because it changes what every number below it means:
            the price card still shows the OLD figure, and that is correct. */}
        {pending && (
          <div
            className="glass-card p-5"
            style={{
              background: 'var(--pill-waitlist-bg)',
              borderColor: 'var(--banner-green-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <div className="fs-md" style={{ fontWeight: 600 }}>
              {t('propose.waiting', { name: local.memberName })}
            </div>
            <div className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('propose.waitingHint')}
            </div>
          </div>
        )}
        {declined && (
          <div className="fs-sm" style={{ color: 'var(--text-secondary)', margin: 0 }}>
            {t('propose.declined', { name: local.memberName })}
          </div>
        )}

        {/* STATUS FIRST, AND ONE ROW UNTIL YOU ASK.
            Where the racket is, is the reason to open this screen — it used to
            be five stacked 44px rows at the BOTTOM, so the one fact you came
            for was the one you had to scroll for. Collapsed it reads
            "Progress … Ready"; expanded it is the same stepper as before.

            The rows stay 44px when open. That is the minimum comfortable tap
            target, so the space is won by not showing them until they are
            wanted, not by shrinking them below what a thumb can hit. */}
        <div className="glass-card p-5 space-y-3">
          {/* The whole header row is the target, not just the chevron. This is
              the control reached for most often on the screen, and `CardHeader`
              renders nothing interactive, so wrapping it is valid and costs no
              drift from the primitive. */}
          <button
            type="button"
            onClick={() => setStatusOpen((v) => !v)}
            aria-expanded={statusOpen}
            aria-label={t('statusTitle')}
            /* minHeight 44 because a CardHeader row is 26px, and a
               358x26 target is wide but not tall enough to hit reliably —
               the height is the dimension a thumb misses. */
            style={{
              width: '100%',
              textAlign: 'left',
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
            <CardHeader
              icon="fact_check"
              title={t('statusTitle')}
              action={
                <span
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                >
                  <span className="fs-md" style={{ fontWeight: 600, color: 'var(--accent)' }}>
                    {t(`status.${local.status}`)}
                  </span>
                  <span
                    className="material-icons icon-sm"
                    aria-hidden="true"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {statusOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </span>
              }
            />
            </div>
          </button>
          {statusOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {STRINGING_FLOW.map((step: StringingStatus) => {
                const idx = STRINGING_FLOW.indexOf(step);
                const current = STRINGING_FLOW.indexOf(local.status);
                const on = idx <= current;
                return (
                  <button
                    key={step}
                    type="button"
                    disabled={busy || !online}
                    onClick={() => patch({ status: step })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-4)',
                      borderRadius: 'var(--radius-lg)',
                      textAlign: 'left',
                      background: on ? 'var(--banner-green-bg)' : 'var(--inner-card-bg)',
                      border: `1px solid ${on ? 'var(--banner-green-border)' : 'var(--inner-card-border)'}`,
                      ...(busy || !online ? { opacity: 0.5, pointerEvents: 'none' as const } : {}),
                    }}
                  >
                    <span
                      className="material-icons icon-sm"
                      style={{ color: on ? 'var(--accent)' : 'var(--text-muted)' }}
                    >
                      {on ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span
                      className="fs-md"
                      style={{ flex: 1, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--text-muted)' }}
                    >
                      {t(`status.${step}`)}
                    </span>
                    {idx === current && (
                      <span className="fs-2xs" style={{ color: 'var(--text-muted)' }}>{t('now')}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="glass-card p-5 space-y-3">
          <CardHeader icon="sports_tennis" title={t('spec.title')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {specRows.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{k}</span>
                <span className="fs-md" style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ONE CARD: the price, and the way to change it.
            These were two — a green "Your price" card and a plain "Change this
            job" form directly under it — which meant the number you were
            editing and the number you were looking at sat in different
            containers, styled as if they were different subjects. They are the
            same subject. The green treatment stays because this is still the
            card about money; the form is what you do to it.

            When a change is drafted the headline becomes the diff, in the same
            from → to shape the player is shown in `ConfirmChangeSheet`. The
            admin sees the exact thing they are about to ask for. */}
        <div
          className="glass-card p-5 space-y-3"
          style={{ background: 'var(--banner-green-bg)', borderColor: 'var(--banner-green-border)' }}
        >
          <CardHeader icon="request_quote" title={t('quoted')} />

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <span
              className="fs-stat-lg"
              style={{
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                // Demoted to the "from" half once there is a "to".
                color: priceDrafted ? 'var(--text-muted)' : 'var(--text-primary)',
                textDecoration: priceDrafted ? 'line-through' : undefined,
              }}
            >
              {formatPriceExact(local.priceCents) ?? t('unpriced')}
            </span>
            {priceDrafted && (
              <>
                <span className="material-icons icon-sm" style={{ color: 'var(--text-muted)' }}>
                  arrow_forward
                </span>
                <span
                  className="fs-stat-lg"
                  style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}
                >
                  {formatPriceExact(parsedCents ?? null) ?? t('unpriced')}
                </span>
              </>
            )}
          </div>

          {local.readyBy && (
            <div className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
              {/* Formatted when it is a date; shown verbatim when it is not.
                  Rows written before readyBy became a date still hold free
                  text like "Sunday", and echoing that back beats relabelling
                  it "Invalid Date". */}
              {t('readyBy', { date: formatReadyBy(local.readyBy) ?? local.readyBy })}
            </div>
          )}

          {/* What the other side is reading, right now. Still attached to the
              price above it rather than to the form below — it describes the
              committed state, not the draft. */}
          <div
            className="fs-sm"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--banner-green-border)',
              color: 'var(--text-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
            }}
          >
            <span>{t('playerSees', { name: local.memberName })}</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {t(`playerStage.${playerStageFor(local.status)}`)}
            </span>
          </div>

          {/* The action half. A second rule rather than a second card. */}
          <div
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--banner-green-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                // Closing DISCARDS the draft. Otherwise a typed-then-collapsed
                // change leaves the headline reading "$30.00 → $34.00" with
                // nothing on screen that explains it or can undo it.
                if (changeOpen) resetDraft();
                setChangeOpen((v) => !v);
              }}
              aria-expanded={changeOpen}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <span className="section-label">{t('propose.title')}</span>
              <span
                className="material-icons icon-sm"
                aria-hidden="true"
                style={{ color: 'var(--text-muted)' }}
              >
                {changeOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {changeOpen && (
              <>
            <p
              className="fs-sm"
              style={{ color: 'var(--text-secondary)', margin: 0 }}
            >
              {t('propose.hint', { name: local.memberName })}
            </p>

            {proposeError && <p className="field-error" role="alert">{t('propose.error')}</p>}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('propose.price')}</span>
              <input
                type="text"
                inputMode="decimal"
                value={proposePrice}
                onChange={(e) => setProposePrice(e.target.value)}
                aria-label={t('propose.price')}
                placeholder={t('pricePlaceholder')}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('propose.string')}</span>
              <input
                type="text"
                value={proposeString}
                onChange={(e) => setProposeString(e.target.value)}
                aria-label={t('propose.string')}
                maxLength={80}
              />
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1 }}>
                <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('mains')}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={proposeMains}
                  onChange={(e) => setProposeMains(e.target.value)}
                  aria-label={t('mains')}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1 }}>
                <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('crosses')}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={proposeCrosses}
                  onChange={(e) => setProposeCrosses(e.target.value)}
                  aria-label={t('crosses')}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'stretch' }}>
              <button
                type="button"
                className="cc-btn cc-btn-primary cc-btn-lg"
                style={{ flex: 1 }}
                disabled={proposeBusy || !online || !proposalDirty || parsedCents === undefined}
                onClick={() => void sendProposal()}
              >
                {proposeBusy ? t('propose.sending') : t('propose.send', { name: local.memberName })}
              </button>
              {/* Asking is the primary action and keeps the filled button.
                  Changing without asking sits behind an ellipsis because it is
                  the exception, not because it is hidden. */}
              <button
                type="button"
                className="cc-btn cc-btn-ghost cc-btn-lg"
                aria-label={t('propose.forceMenu')}
                aria-expanded={forceOpen}
                disabled={proposeBusy || !online || parsedCents === undefined}
                onClick={() => {
                  setForceOpen((v) => !v);
                  setForceError(false);
                }}
                style={{ flex: '0 0 auto' }}
              >
                <span className="material-icons icon-md" aria-hidden="true">more_horiz</span>
              </button>
            </div>

            {forceOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--inner-card-bg)',
                  border: '1px solid var(--inner-card-border)',
                }}
              >
                {forceError && <p className="field-error" role="alert">{t('propose.forceError')}</p>}
                <div>
                  <div className="fs-md" style={{ fontWeight: 600 }}>
                    {t('propose.forceLabel')}
                  </div>
                  {/* Say what it does to the other person, not just to the
                      record. "Is not asked AND is not told" is the whole
                      difference from the button beside it. */}
                  <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: 'var(--space-05) 0 0' }}>
                    {t('propose.forceHint', { name: local.memberName })}
                  </p>
                </div>
                <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  {t('propose.forceConfirm', {
                    name: local.memberName,
                    price: formatPriceExact(parsedCents ?? null) ?? t('unpriced'),
                  })}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  <button
                    type="button"
                    className="cc-btn cc-btn-ghost"
                    style={{ flex: 1 }}
                    disabled={proposeBusy}
                    onClick={() => setForceOpen(false)}
                  >
                    {t('propose.forceKeep')}
                  </button>
                  <button
                    type="button"
                    className="cc-btn cc-btn-danger"
                    style={{ flex: 1 }}
                    disabled={proposeBusy || !online}
                    onClick={() => void forceChange()}
                  >
                    {proposeBusy ? t('propose.sending') : t('propose.forceGo')}
                  </button>
                </div>
              </div>
            )}
            {!proposalDirty && (
              <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
                {t('propose.noChange')}
              </p>
            )}
              </>
            )}
          </div>
        </div>


        <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0' }}>
          {local.stringerName ? t('heldBy', { name: local.stringerName }) : t('unclaimed')}
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => patch({ paid: local.paidAt === null })}
            className="cc-btn cc-btn-secondary"
            style={{ flex: 1 }}
          >
            {local.paidAt ? t('markUnpaid') : t('markPaid')}
          </button>
          <button
            type="button"
            // Previously `!local.stringerId`, which disabled the button on
            // exactly the jobs worth claiming — the unclaimed ones — and left
            // it live on the ones already yours. No ownership guard at all is
            // the right answer rather than the inverse one: this screen cannot
            // know which admin is looking without another round trip, taking
            // over someone else's job is legitimate, and re-claiming your own
            // is a harmless no-op. Who holds it is shown below instead.
            disabled={busy || !online}
            onClick={() => patch({ claim: true })}
            className="cc-btn cc-btn-secondary"
            style={{ flex: 1 }}
          >
            {t('claim')}
          </button>
        </div>
      </div>
    </div>
  );
}
