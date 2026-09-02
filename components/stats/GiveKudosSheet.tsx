'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetBody, BottomSheetHeader } from '@/components/BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import { KUDOS_TAGS, TAG_ICON, KUDOS_NOTE_MAX, type KudosTag } from '@/lib/kudos';
import { SKILLS } from '@/lib/assessment';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The ONE surface for giving kudos, opened from two places: the Stats card and
 * a name on the Sign-Ups roster.
 *
 * Two doors, one sheet, on purpose. The flow used to live entirely inside a
 * conditional card that returned `null` whenever there was nobody to thank — so
 * a real player asked "how do I give kudos to other people?" and the owner's
 * own answer ("log a game first") was wrong, because the rule was roster-based
 * all along. Nobody could see the rule, so everyone inferred one.
 *
 * `recipient` fixes the person (the Sign-Ups door); leaving it null shows the
 * picker (the Stats door).
 */
export interface GiveKudosSheetProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected person, when opened from a specific name. */
  recipient?: string | null;
  /** Candidates for the picker. Ignored when `recipient` is set. */
  candidates?: string[];
  onSent?: (name: string, tag: KudosTag) => void;
}

type SendState = 'idle' | 'sending' | 'sent' | 'error' | 'duplicate';

export default function GiveKudosSheet({
  open,
  onClose,
  recipient = null,
  candidates = [],
  onSent,
}: GiveKudosSheetProps) {
  const t = useTranslations('stats.kudos');
  const online = useOnline();

  const [who, setWho] = useState<string | null>(recipient);
  const [tag, setTag] = useState<KudosTag | null>(null);
  const [note, setNote] = useState('');
  const [skillKey, setSkillKey] = useState<string>('');
  const [state, setState] = useState<SendState>('idle');

  /* Reset on each OPEN, not on close: closing animates out, and clearing the
     fields mid-animation shows the form emptying itself on the way. */
  useEffect(() => {
    if (!open) return;
    setWho(recipient);
    setTag(null);
    setNote('');
    setSkillKey('');
    setState('idle');
  }, [open, recipient]);

  const canSend = !!who && !!tag && online && state !== 'sending' && state !== 'sent';

  async function send() {
    if (!who || !tag) return;
    setState('sending');
    try {
      const res = await fetch(`${BASE}/api/kudos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: who,
          tag,
          // Empty strings are omitted rather than sent — the server would drop
          // them anyway, and this keeps the request honest about what was said.
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(note.trim() && skillKey ? { skillKey } : {}),
        }),
        cache: 'no-store',
      });
      if (res.status === 409) {
        // Already sent this tag to this person this week. A distinct state, not
        // an error — the gesture already happened.
        setState('duplicate');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      setState('sent');
      onSent?.(who, tag);
    } catch {
      setState('error');
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('giveTitle')} maxHeight="88vh">
      <BottomSheetHeader>
        <h2 className="bpm-h3 m-0">{t('giveTitle')}</h2>
        <button type="button" onClick={onClose} className="cc-btn cc-btn-ghost" aria-label={t('close')}>
          <span className="material-icons" aria-hidden="true">close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody>
        {state === 'sent' ? (
          /* The confirmation IS the sheet. Dismissing on success would render
             the acknowledgement for one frame to nobody — the same rule the
             gear sheets landed on. */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center', padding: 'var(--space-5) 0' }}>
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-xl)', color: 'var(--accent)' }}>
              check_circle
            </span>
            <p className="fs-md m-0" style={{ textAlign: 'center' }}>{t('sentTo', { name: who ?? '' })}</p>
            <button type="button" onClick={onClose} className="cc-btn cc-btn-primary cc-btn-lg">
              {t('done')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* WHO — hidden when the sheet was opened on a specific person. */}
            {!recipient && (
              <section>
                <p className="section-label-muted" style={{ margin: '0 0 var(--space-3)' }}>{t('whoLabel')}</p>
                {candidates.length === 0 ? (
                  <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('noCandidates')}</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                    {candidates.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setWho(name)}
                        aria-pressed={who === name}
                        className="cc-btn cc-btn-ghost"
                        style={{
                          fontSize: 'var(--fs-sm)',
                          padding: 'var(--space-2) var(--space-4)',
                          ...(who === name
                            ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                            : null),
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* WHAT — the required half. */}
            <section>
              <p className="section-label-muted" style={{ margin: '0 0 var(--space-3)' }}>{t('whatLabel')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {KUDOS_TAGS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTag(k)}
                    aria-pressed={tag === k}
                    className="cc-btn cc-btn-ghost"
                    style={{
                      fontSize: 'var(--fs-sm)',
                      padding: 'var(--space-2) var(--space-4)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      ...(tag === k ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : null),
                    }}
                  >
                    <span className="material-icons icon-sm" aria-hidden="true">{TAG_ICON[k]}</span>
                    {t(`tag.${k}`)}
                  </button>
                ))}
              </div>
            </section>

            {/* WHY — both optional. The note is SIGNED; say so where they type
                it, not in a policy page nobody reads. */}
            <section>
              <p className="section-label-muted" style={{ margin: '0 0 var(--space-2)' }}>{t('noteLabel')}</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, KUDOS_NOTE_MAX))}
                maxLength={KUDOS_NOTE_MAX}
                rows={2}
                placeholder={t('notePlaceholder')}
                className="fs-base"
                style={{
                  width: '100%',
                  resize: 'none',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  color: 'var(--input-text)',
                  fontFamily: 'inherit',
                }}
              />
              <p className="fs-sm m-0" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                {t('noteSigned')}
              </p>

              {/* The skill only makes sense as context FOR a note. */}
              {note.trim() && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <label htmlFor="kudos-skill" className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                    {t('skillLabel')}
                  </label>
                  <select
                    id="kudos-skill"
                    value={skillKey}
                    onChange={(e) => setSkillKey(e.target.value)}
                    className="fs-base"
                    style={{
                      width: '100%',
                      marginTop: 'var(--space-1)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-lg)',
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--input-text)',
                    }}
                  >
                    <option value="">{t('skillNone')}</option>
                    {SKILLS.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            {state === 'error' && <ErrorState message={t('sendError')} />}
            {state === 'duplicate' && (
              <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('alreadySent')}</p>
            )}
            {!online && (
              <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('offline')}</p>
            )}

            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%', ...(canSend ? null : { opacity: 0.5 }) }}
            >
              {state === 'sending' ? t('sending') : t('sendCta')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
