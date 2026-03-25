'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Props {
  value: string;         // YYYY-MM-DD
  onChange: (v: string) => void;
  placeholder?: string;
}

export default function DatePicker({ value, onChange, placeholder = 'Date' }: Props) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => value ? parseInt(value.slice(0, 4)) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? parseInt(value.slice(5, 7)) - 1 : today.getMonth());
  const [calPos, setCalPos] = useState({ top: 0, left: 0, width: 0 });

  const btnRef = useRef<HTMLButtonElement>(null);
  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.slice(0, 4)));
      setViewMonth(parseInt(value.slice(5, 7)) - 1);
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        calRef.current && !calRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Reposition calendar when scrolling while open
  useEffect(() => {
    if (!open) return;
    function reposition() {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      setCalPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    window.addEventListener('scroll', reposition, true);
    return () => window.removeEventListener('scroll', reposition, true);
  }, [open]);

  function handleToggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCalPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    setOpen(o => !o);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function selectDay(day: number) {
    onChange(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    setOpen(false);
  }

  function formatDisplay(v: string) {
    const d = new Date(v + 'T00:00:00');
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  const calendar = open ? (
    <div
      ref={calRef}
      style={{
        position: 'fixed',
        top: calPos.top,
        left: calPos.left,
        width: calPos.width,
        zIndex: 9999,
        background: 'linear-gradient(160deg, rgba(22,22,26,0.97) 0%, rgba(14,14,18,0.99) 100%)',
        backdropFilter: 'blur(40px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 16,
        padding: '10px 8px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 16px 48px rgba(0,0,0,0.7)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button type="button" onClick={prevMonth}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: '2px 4px', lineHeight: 1 }}>
          <span className="material-icons" style={{ fontSize: 16 }}>chevron_left</span>
        </button>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.75rem' }}>
          {MONTHS_FULL[viewMonth]} {viewYear}
        </span>
        <button type="button" onClick={nextMonth}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: '2px 4px', lineHeight: 1 }}>
          <span className="material-icons" style={{ fontSize: 16 }}>chevron_right</span>
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
        {DAYS.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: '0.6rem', color: 'rgba(255,255,255,0.28)', fontWeight: 700, padding: '1px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dayStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = dayStr === value;
          const isToday = dayStr === todayStr;
          return (
            <button
              key={i}
              type="button"
              onClick={() => selectDay(day)}
              style={{
                aspectRatio: '1',
                borderRadius: 6,
                border: isToday && !isSelected ? '1px solid rgba(74,222,128,0.4)' : '1px solid transparent',
                background: isSelected
                  ? 'linear-gradient(160deg, rgba(74,222,128,0.3) 0%, rgba(22,163,74,0.2) 100%)'
                  : 'transparent',
                color: isSelected ? '#4ade80' : 'rgba(255,255,255,0.75)',
                fontSize: '0.72rem',
                fontWeight: isSelected ? 700 : 400,
                cursor: 'pointer',
                transition: 'background 0.1s',
                lineHeight: 1,
              }}
              onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        style={{
          width: '100%',
          textAlign: 'left',
          background: open
            ? 'linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.06) 100%)'
            : 'linear-gradient(160deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)',
          backdropFilter: 'blur(20px)',
          border: open ? '1px solid rgba(74,222,128,0.45)' : '1px solid rgba(255,255,255,0.14)',
          boxShadow: open
            ? 'inset 0 1px 0 rgba(255,255,255,0.10), 0 0 0 3px rgba(74,222,128,0.10)'
            : 'inset 0 1px 0 rgba(255,255,255,0.10)',
          borderRadius: 14,
          color: value ? '#e2e8f0' : 'rgba(255,255,255,0.3)',
          padding: '0 10px',
          height: '42px',
          fontSize: '0.8rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <span className="material-icons" style={{ fontSize: 14, flexShrink: 0, color: 'rgba(255,255,255,0.35)' }}>
          calendar_today
        </span>
      </button>

      {/* Portal — renders at document.body, escaping all stacking contexts */}
      {typeof document !== 'undefined' && calendar && createPortal(calendar, document.body)}
    </div>
  );
}
