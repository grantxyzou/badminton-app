'use client';

import { useEffect, useRef } from 'react';
import { isFlagOn } from './flags';
import { recordEngagement } from './engagement';
import { nativePlatform } from './native';
import { isStandalone } from './standalone';
import type { USAGE_PLATFORMS, USAGE_TABS } from './events';

type Platform = (typeof USAGE_PLATFORMS)[number];
type UsageTab = (typeof USAGE_TABS)[number];

/** Hidden this long, coming back counts as opening the app again. */
export const REOPEN_AFTER_MS = 30 * 60 * 1000;

/** Store app, the installed web app, or a browser tab. */
export function usagePlatform(): Platform {
  const native = nativePlatform();
  if (native) return native;
  return isStandalone() ? 'installed' : 'web';
}

const COUNTED_TABS: readonly string[] = ['home', 'stringing', 'skills', 'profile'] satisfies readonly UsageTab[];

/**
 * The usage beacons (docs/plans/usage-metrics.md): `app_open` once per
 * launch — and again after the app has been away for half an hour — and
 * `tab_view` on each change of tab. Mounted ONCE, in HomeShell.
 *
 * Off with NEXT_PUBLIC_FLAG_USAGE_METRICS off, and silent for anyone not
 * signed in: the server refuses both (flag off → 404, no cookie → 401), but
 * not sending is cheaper than being refused. The admin tab is not usage.
 * Fire-and-forget through `recordEngagement`, like every other beacon.
 */
export function useUsageBeacons(activeTab: string, signedIn: boolean): void {
  const on = isFlagOn('NEXT_PUBLIC_FLAG_USAGE_METRICS') && signedIn;
  const opened = useRef(false);
  const lastTab = useRef<string | null>(null);

  useEffect(() => {
    if (!on) return;
    if (!opened.current) {
      opened.current = true;
      void recordEngagement('app_open', { platform: usagePlatform() });
    }
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= REOPEN_AFTER_MS) {
        void recordEngagement('app_open', { platform: usagePlatform() });
        // A fresh visit starts its tab count over.
        lastTab.current = null;
      }
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [on]);

  useEffect(() => {
    if (!on || !COUNTED_TABS.includes(activeTab) || lastTab.current === activeTab) return;
    lastTab.current = activeTab;
    void recordEngagement('tab_view', { tab: activeTab as UsageTab });
  }, [on, activeTab]);
}
