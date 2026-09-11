'use client';

import { useEffect, useState } from 'react';
import { readStored, useClientSubscription } from '@/lib/useClientValue';

type Theme = 'dark' | 'light';

const THEME_KEY = 'badminton_theme';
const SYSTEM_LIGHT = '(prefers-color-scheme: light)';

/**
 * The theme is not really component state — it is a function of two external
 * things, a stored preference and the OS setting. Modelling it as such is what
 * lets the toggle drop its mount effect: `useSyncExternalStore` renders 'dark'
 * through hydration (matching the server) and the resolved value after.
 *
 * A stored preference always wins, which is why a system change while one is
 * set produces no re-render: `read` returns the same string and React bails
 * out. The old code expressed the same rule as an `if` inside the listener.
 */
function read(): Theme {
  const saved = readStored(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  try {
    return window.matchMedia(SYSTEM_LIGHT).matches ? 'light' : 'dark';
  } catch {
    /* matchMedia can throw in odd embedded webviews */
    return 'dark';
  }
}

/**
 * `localStorage` fires no event in the tab that wrote it, so the toggle has to
 * tell the store itself. Module scope, so the subscribe identity is stable and
 * React does not resubscribe on every render.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  let mq: MediaQueryList | null = null;
  try {
    mq = window.matchMedia(SYSTEM_LIGHT);
    mq.addEventListener('change', onChange);
  } catch {
    /* no matchMedia — a stored preference still works */
  }
  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener('change', onChange);
  };
}

export default function ThemeToggle() {
  const stored = useClientSubscription(subscribe, read, 'dark');
  /* The in-page override, and it is load-bearing in exactly one case: private
     mode, where `localStorage.setItem` throws and `read()` therefore keeps
     answering the SYSTEM value. Without it the store never moves, so the icon
     never flips and `next` is recomputed from the same stale value every tap —
     the toggle sets the attribute once and can never set it back. Same shape
     as `InstallBanner` and `SkillDiscoveryCard` in this directory: the stored
     answer is the durable one, the local one covers the write that failed. */
  const [override, setOverride] = useState<Theme | null>(null);
  const theme = override ?? stored;

  // The one declarative owner of the attribute. It used to be written from
  // three places, which is how the initial read and the system listener came
  // to carry duplicate copies of the same line.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode — the override below is what keeps the toggle working */
    }
    setOverride(next);
    // Paint the change on this tick rather than waiting for the passive
    // effect: the attribute repaints the whole page, and a tap should not be
    // able to show a frame of the old theme.
    document.documentElement.setAttribute('data-theme', next);
    listeners.forEach((l) => l());
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <span className="material-icons">
        {theme === 'dark' ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  );
}
