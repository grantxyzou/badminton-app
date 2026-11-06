'use client';

import { useEffect, useRef } from 'react';
import { recordEngagement } from './engagement';
import { APP_SHELL_ATTR, TAB_PANEL_ATTR } from './appSettled';
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

/** The first screen is filled in: a tab is on screen, it has content, and no loading line is showing. */
export function firstScreenReady(doc: Document): boolean {
  const panel = doc.querySelector(`[${APP_SHELL_ATTR}] [${TAB_PANEL_ATTR}]:not([hidden])`);
  if (!panel || (panel.textContent ?? '').trim().length < 20) return false;
  for (const el of Array.from(panel.querySelectorAll('.shimmer-line'))) {
    if (el.getClientRects().length > 0) return false;
  }
  return true;
}

/** The launch screen has gone (or never showed: a landing URL, a quick return). */
export function launchGone(doc: Document): boolean {
  const state = doc.documentElement.dataset.launch;
  return !state || state === 'done' || state === 'lifted' || state === 'welcome';
}

/** Give up after this: a phone left on a loading screen is not a load time. */
const TIMING_WATCH_MS = 20_000;

/**
 * The usage beacons (docs/plans/usage-metrics.md): `app_open` once per
 * launch — and again after the app has been away for half an hour — and
 * `tab_view` on each change of tab. Mounted ONCE, in HomeShell.
 *
 * Silent for anyone not signed in: the server refuses both (no cookie →
 * 401), but not sending is cheaper than being refused. The admin tab is not usage.
 * Fire-and-forget through `recordEngagement`, like every other beacon.
 */
export function useUsageBeacons(activeTab: string, signedIn: boolean): void {
  const on = signedIn;
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

  // How long this open took on THIS phone (docs/plans/startup-speed.md): once
  // per page load, when the first screen is filled in and the launch screen
  // has gone. Measured from the page starting (performance.now() is 0 there),
  // so it includes the download, the launch screen and the first reads.
  const timed = useRef(false);
  useEffect(() => {
    if (!on || timed.current || typeof performance === 'undefined') return;
    timed.current = true;
    let readyAt: number | null = null;
    let launchAt: number | null = null;
    let finished = false;
    const id = window.setInterval(() => {
      const now = performance.now();
      if (readyAt === null && firstScreenReady(document)) readyAt = now;
      if (launchAt === null && launchGone(document)) launchAt = now;
      if ((readyAt !== null && launchAt !== null) || now > TIMING_WATCH_MS) {
        window.clearInterval(id);
        finished = true;
        if (readyAt === null || launchAt === null) return;
        const start = document.documentElement.dataset.launchSkipped === 'return' ? 'return' : 'open';
        void recordEngagement('app_ready', { ms: Math.round(readyAt), launchMs: Math.round(launchAt), start, platform: usagePlatform() });
      }
    }, 50);
    return () => {
      window.clearInterval(id);
      // Torn down before it could send (React's dev double-run): let the next run time it.
      if (!finished) timed.current = false;
    };
  }, [on]);

  useEffect(() => {
    if (!on || !COUNTED_TABS.includes(activeTab) || lastTab.current === activeTab) return;
    lastTab.current = activeTab;
    void recordEngagement('tab_view', { tab: activeTab as UsageTab });
  }, [on, activeTab]);
}
