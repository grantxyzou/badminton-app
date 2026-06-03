'use client';

import { useState } from 'react';

interface Props {
  /** HTML id for the input (used by aria-describedby in the caller). */
  id: string;
  value: string;
  onValueChange: (next: string) => void;
  /** Names to surface in the dropdown. Filtering is the caller's job. */
  suggestions: string[];
  placeholder: string;
  ariaLabel: string;
  /** Error id for aria-describedby. Pass undefined when no error. */
  errorId?: string;
}

/**
 * Name input + member-name autocomplete dropdown. Extracted from HomeTab
 * where the same JSX was duplicated across the waitlist + normal sign-up
 * branches (one of the bigger duplications flagged by #70).
 *
 * Implements the WAI-ARIA combobox-with-listbox pattern (focus stays on the
 * input; `aria-activedescendant` points at the highlighted option) so assistive
 * tech announces "combobox, N options" and a keyboard user can ArrowDown/Up →
 * Enter to pick a name. Enter only selects when an option is highlighted —
 * otherwise it falls through so the sign-up form still submits. The mouse path
 * uses `onMouseDown` (fires before the blur that closes the list).
 *
 * Owns its own focus-driven `showSuggestions` state — the parent only
 * needs to pass the value, change handler, and the suggestion list.
 */
export default function NameAutocompleteInput({
  id,
  value,
  onValueChange,
  suggestions,
  placeholder,
  ariaLabel,
  errorId,
}: Props) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Index of the keyboard-highlighted option, or -1 for none.
  const [activeIndex, setActiveIndex] = useState(-1);

  const open = showSuggestions && suggestions.length > 0;
  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;
  // Guard against a stale index if the suggestion list shrank.
  const active = open && activeIndex >= 0 && activeIndex < suggestions.length ? activeIndex : -1;

  function selectSuggestion(name: string) {
    onValueChange(name);
    setShowSuggestions(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setShowSuggestions(true);
        return;
      }
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // Only intercept Enter when an option is highlighted; otherwise let it
      // bubble so the enclosing sign-up form submits normally.
      if (active >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setShowSuggestions(false);
        setActiveIndex(-1);
      }
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        name="name"
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={errorId}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setShowSuggestions(true);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 100)}
        maxLength={50}
        autoComplete="off"
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl max-h-60 overflow-y-auto animate-scaleIn"
          style={{
            background: 'var(--dropdown-bg)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--glass-border)',
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={() => selectSuggestion(s)}
              onMouseEnter={() => setActiveIndex(i)}
              className="w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer"
              style={{
                color: 'var(--text-primary)',
                background: i === active ? 'rgba(255,255,255,0.06)' : 'transparent',
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
