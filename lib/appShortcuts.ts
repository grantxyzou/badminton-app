'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { hasNativePlugin, isNative } from './native';
import { requestStringing } from './stringingIntent';
import { sharedFetch } from './sharedRead';

/**
 * The menu a long press on the store app's icon opens
 * (docs/plans/native-badge-shortcuts.md): Sign up for this week, What I owe,
 * Request stringing — each with the live line under it that Home already
 * knows (the session's date, the amount owed).
 *
 * Store app only. The web app installed on a home screen has no dynamic
 * shortcuts on iPhone, so nothing here runs outside `isNative()`, and the
 * plugin is a dynamic import inside that branch.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type ShortcutId = 'signup' | 'owed' | 'stringing';

/**
 * Where a tapped shortcut goes, as a place in the app (`routeInApp`). Request
 * stringing also leaves the one-shot intent that opens the request form, so
 * the tap lands on the form and not one tap short of it. Anything else is not
 * ours: `null`.
 */
export function openShortcut(id: string): string | null {
  if (id === 'signup' || id === 'owed') return `${BASE}/`;
  if (id === 'stringing') {
    requestStringing();
    return `${BASE}/?tab=stringing`;
  }
  return null;
}

interface NativeShortcut {
  id: ShortcutId;
  title: string;
  description: string;
  /** SF Symbol. iOS wants an icon whenever there is a description. */
  iosIcon: string;
}

let lastSet = '';

/** Replace the menu. Never throws; a no-op off the store app. */
export async function setAppShortcuts(shortcuts: NativeShortcut[]): Promise<void> {
  if (!isNative() || hasNativePlugin('AppShortcuts') === false) return;
  const key = JSON.stringify(shortcuts);
  if (key === lastSet) return;
  try {
    const { AppShortcuts } = await import('@capawesome/capacitor-app-shortcuts');
    await AppShortcuts.set({ shortcuts });
    lastSet = key;
  } catch {
    /* an older binary or a launcher without shortcuts: no menu */
  }
}

/** Signing out: a shared phone must not keep the last person's balance in its menu. */
export async function clearAppShortcuts(): Promise<void> {
  lastSet = '';
  if (!isNative() || hasNativePlugin('AppShortcuts') === false) return;
  try {
    const { AppShortcuts } = await import('@capawesome/capacitor-app-shortcuts');
    await AppShortcuts.clear();
  } catch {
    /* nothing to clear */
  }
}

/** The balance card tells the menu what is owed, so no second read is made. */
export const SHORTCUT_OWED_EVENT = 'bpm:shortcut-owed';

export function noteOwedForShortcuts(totalOwed: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<number>(SHORTCUT_OWED_EVENT, { detail: totalOwed }));
}

interface SessionFacts {
  datetime?: string;
  signupOpen?: boolean;
}

/**
 * Keeps the menu current while the app is open. Mounted once, in HomeShell.
 * The session read is the one Home makes anyway (`sharedFetch` shares a read
 * in flight); the amount arrives from the balance card.
 */
export function useAppShortcuts(): void {
  const t = useTranslations('appShortcuts');
  const locale = useLocale();
  const [native] = useState(() => isNative());
  const [session, setSession] = useState<SessionFacts | null | undefined>(undefined);
  const [owed, setOwed] = useState<number | null>(null);

  useEffect(() => {
    if (!native) return;
    let live = true;
    const read = () => {
      sharedFetch('/api/session')
        .then(async (res) => {
          if (!live) return;
          if (res.status === 404) setSession(null);
          else if (res.ok) setSession((await res.json()) as SessionFacts);
        })
        .catch(() => undefined);
    };
    read();
    const onOwed = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') setOwed(n);
    };
    window.addEventListener(SHORTCUT_OWED_EVENT, onOwed);
    window.addEventListener('bpm:resume', read);
    return () => {
      live = false;
      window.removeEventListener(SHORTCUT_OWED_EVENT, onOwed);
      window.removeEventListener('bpm:resume', read);
    };
  }, [native]);

  useEffect(() => {
    if (!native || session === undefined) return;
    const when = session?.datetime ? new Date(session.datetime) : null;
    const zone = { timeZone: 'America/Vancouver' } as const;
    const day = when ? new Intl.DateTimeFormat(locale, { ...zone, weekday: 'long' }).format(when) : null;
    const date = when
      ? new Intl.DateTimeFormat(locale, { ...zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(when)
      : null;
    const amount = owed == null ? null : Number.isInteger(owed) ? `$${owed}` : `$${owed.toFixed(2)}`;
    void setAppShortcuts([
      {
        id: 'signup',
        title: day ? t('signUpFor', { day }) : t('signUpThisWeek'),
        description: !when ? t('noSession') : session?.signupOpen === false ? t('notOpenYet') : (date ?? ''),
        iosIcon: 'person.badge.plus',
      },
      {
        id: 'owed',
        title: t('owed'),
        description: amount == null ? t('owedUnknown') : owed! > 0 ? t('owedAmount', { amount }) : t('allPaid'),
        iosIcon: 'dollarsign.circle',
      },
      {
        id: 'stringing',
        title: t('stringing'),
        description: t('stringingSub'),
        iosIcon: 'wrench.and.screwdriver',
      },
    ]);
  }, [native, session, owed, locale, t]);
}
