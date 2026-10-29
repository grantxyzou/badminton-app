'use client';

import { hasNativePlugin, isNative } from './native';
import { markExternalExcursion } from './excursion';
import { sessionCalendarEvent } from './calendarEvent';

/**
 * "Add to calendar" (docs/plans/add-to-calendar.md): one tap, and the phone's
 * own calendar takes over with the session filled in.
 *
 * - Store app with the `BpmCalendar` plugin → the native New Event screen.
 * - The web (a browser tab or the home-screen app) → `GET
 *   /api/session/calendar`, a real `text/calendar` URL; iOS answers it with
 *   its "Add to Calendar" sheet, Android's browser hands the file to the
 *   calendar app.
 * - A store build from before the plugin → no button at all. Its only
 *   cookie-free way out is the Browser sheet, where the route answers 401, and
 *   a button that does nothing is the one outcome the plan rules out.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const CALENDAR_PATH = '/api/session/calendar';

interface BpmCalendarPlugin {
  addEvent(opts: {
    title: string;
    startMs: number;
    endMs: number;
    location?: string;
    url?: string;
  }): Promise<{ outcome: 'saved' | 'canceled' | 'shown' | 'denied' | 'no_calendar' }>;
}

/** The plugin travels in a box: a Capacitor proxy answers `then` as a native
 *  method, so a promise resolved WITH the proxy would call it (see
 *  lib/widgetBridge.ts, where that dropped every call on the first device run). */
let plugin: Promise<{ calendar: BpmCalendarPlugin }> | null = null;

function bpmCalendar(): Promise<{ calendar: BpmCalendarPlugin }> {
  if (!plugin) {
    plugin = import('@capacitor/core').then(({ registerPlugin }) => ({
      calendar: registerPlugin<BpmCalendarPlugin>('BpmCalendar'),
    }));
  }
  return plugin;
}

/** Whether this device can add the session at all. The web always can; the
 *  store app only once its binary carries the plugin. */
export function canAddToCalendar(): boolean {
  if (!isNative()) return true;
  return hasNativePlugin('BpmCalendar') === true;
}

interface SessionLike {
  id: string;
  title?: string;
  datetime: string;
  endDatetime?: string;
  locationName?: string;
  locationAddress?: string;
}

export async function addSessionToCalendar(session: SessionLike, fallbackTitle: string): Promise<void> {
  if (!isNative()) {
    // iOS may evict the home-screen app while the calendar sheet is up.
    markExternalExcursion();
    window.location.assign(`${BASE}${CALENDAR_PATH}`);
    return;
  }
  const evt = sessionCalendarEvent(session, {
    fallbackTitle,
    url: `${window.location.origin}${BASE}/`,
    host: window.location.host,
  });
  if (!evt) return;
  const { calendar } = await bpmCalendar();
  await calendar.addEvent({
    title: evt.title,
    startMs: evt.start.getTime(),
    endMs: evt.end.getTime(),
    location: evt.location,
    url: evt.url,
  });
}
