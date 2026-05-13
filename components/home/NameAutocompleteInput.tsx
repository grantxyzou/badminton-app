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
 * Owns its own focus-driven `showSuggestions` state — the parent only
 * needs to pass the value, change handler, and the suggestion list.
 *
 * The dropdown uses inline styles for the glass background because the
 * tokens involved (`--dropdown-bg`, `--glass-border`) are not exposed via
 * Tailwind utility classes.
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

  return (
    <div className="relative">
      <input
        id={id}
        name="name"
        type="text"
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={errorId}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 100)}
        maxLength={50}
        autoComplete="off"
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl max-h-60 overflow-y-auto animate-scaleIn"
          style={{
            background: 'var(--dropdown-bg)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--glass-border)',
          }}
        >
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={() => {
                  onValueChange(s);
                  setShowSuggestions(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
                style={{ color: 'var(--text-primary)' }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
