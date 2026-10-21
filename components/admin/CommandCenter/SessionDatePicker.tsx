'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { todayIso } from '@/lib/stringingDue';
import {
  dayKey,
  earlierMonthOwes,
  monthCells,
  monthKey,
  type SessionMoneyState,
} from '@/lib/sessionCalendar';

/**
 * The date on the Payments card, and the month calendar it opens
 * (docs/plans/payments-today-first.md; canvas board "Payments · tap the date
 * to pick a session"). Only a session's day can be picked. Each one carries a
 * dot for its money — amber still owing, grey all paid, green the current
 * session — and ‹ carries an amber dot while an earlier month still owes, so
 * an old debt is one tap away without the card listing every session.
 *
 * Portalled like `components/DatePicker.tsx`, for the same reason: the card
 * is a backdrop-filtered surface, and a popover inside it would be clipped by
 * the stacking context it creates.
 */

export interface PickerSession {
  id: string;
  /** `YYYY-MM-DD` — `sessionDay()`. */
  day: string;
  state: SessionMoneyState;
}

interface Props {
  sessions: PickerSession[];
  selectedId: string | null;
  activeId: string | null;
  /** What the trigger reads — the selected session's date. */
  label: string;
  onPick: (id: string) => void;
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const STATE_WORD: Record<SessionMoneyState, string> = { owe: 'still owing', paid: 'all paid', none: '' };
/** Popover width ceiling; it shrinks to the viewport less the page gutters. */
const MAX_W = 320;
const GUTTER = 16;

export default function SessionDatePicker({ sessions, selectedId, activeId, label, onPick }: Props) {
  const [todayStr] = useState(() => todayIso());
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: MAX_W });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const byDay = useMemo(() => new Map(sessions.map((s) => [s.day, s])), [sessions]);
  const states = useMemo(() => new Map(sessions.map((s) => [s.day, s.state])), [sessions]);
  const months = useMemo(() => sessions.map((s) => monthKey(s.day)).sort(), [sessions]);
  const selectedDay = sessions.find((s) => s.id === selectedId)?.day ?? todayStr;

  const [view, setView] = useState(() => monthKey(selectedDay));
  const viewYear = Number(view.slice(0, 4));
  const viewMonth = Number(view.slice(5, 7)) - 1;
  const firstMonth = months[0] ?? view;
  const lastMonth = months[months.length - 1] ?? view;

  const place = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(MAX_W, window.innerWidth - GUTTER * 2);
    const centre = rect.left + rect.width / 2;
    const left = Math.max(GUTTER, Math.min(centre - width / 2, window.innerWidth - width - GUTTER));
    setPos({ top: rect.bottom + 6, left, width });
  }, []);

  function toggle() {
    if (!open) {
      // Open on the month of the session being viewed, not wherever the
      // calendar was last paged to.
      setView(monthKey(selectedDay));
      place();
    }
    setOpen((o) => !o);
  }

  // Outside tap and Escape close it; a scroll moves it with its trigger
  // (one layout read per frame, as DatePicker does).
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    }
    let raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; place(); });
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open, place]);

  function step(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setView(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const canBack = view > firstMonth;
  const canForward = view < lastMonth;
  const olderOwes = earlierMonthOwes(states, view);

  const popover = open ? (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Pick a session"
      className="pay-cal animate-scaleIn"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="pay-cal-head">
        <button
          type="button"
          className="pay-cal-nav"
          onClick={() => step(-1)}
          disabled={!canBack}
          aria-label={olderOwes ? 'Previous month, an earlier session still owes' : 'Previous month'}
        >
          <span className="material-icons" aria-hidden="true">chevron_left</span>
          {olderOwes && <span className="pay-cal-nav-dot" aria-hidden="true" />}
        </button>
        <span className="pay-cal-month">{MONTHS_FULL[viewMonth]} {viewYear}</span>
        <button type="button" className="pay-cal-nav" onClick={() => step(1)} disabled={!canForward} aria-label="Next month">
          <span className="material-icons" aria-hidden="true">chevron_right</span>
        </button>
      </div>
      <div className="pay-cal-grid" aria-hidden="true">
        {DAYS.map((d, i) => <span key={i} className="pay-cal-dow">{d}</span>)}
      </div>
      <div className="pay-cal-grid">
        {monthCells(viewYear, viewMonth).map((day, i) => {
          if (day == null) return <span key={i} />;
          const key = dayKey(viewYear, viewMonth, day);
          const s = byDay.get(key);
          if (!s) {
            return (
              <span key={i} className="pay-cal-day" data-today={key === todayStr ? 'true' : undefined}>
                {day}
              </span>
            );
          }
          const current = s.id === activeId;
          const word = current ? 'current session' : STATE_WORD[s.state];
          return (
            <button
              key={i}
              type="button"
              className="pay-cal-day is-session"
              aria-pressed={s.id === selectedId}
              aria-label={`${MONTHS_FULL[viewMonth]} ${day}${word ? `, ${word}` : ''}`}
              onClick={() => { onPick(s.id); setOpen(false); }}
            >
              <span>{day}</span>
              <span className="pay-cal-dot" data-state={current ? 'current' : s.state} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="pay-cal-legend" aria-hidden="true">
        <span><span className="pay-cal-dot" data-state="owe" />Owing</span>
        <span><span className="pay-cal-dot" data-state="paid" />All paid</span>
        <span><span className="pay-cal-dot" data-state="current" />This week</span>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="pay-date-btn"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}, pick another session`}
      >
        <span>{label}</span>
        <span className="material-icons motion-chevron" data-open={open ? 'true' : 'false'} aria-hidden="true">expand_more</span>
      </button>
      {typeof document !== 'undefined' && popover && createPortal(popover, document.body)}
    </>
  );
}
