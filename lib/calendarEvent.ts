/**
 * One calendar event for one session (docs/plans/add-to-calendar.md).
 *
 * Pure, so the web route's `.ics` and the native plugin's fields come from
 * the same reading of the session and cannot disagree about when or where.
 */

import { APP_NAME } from './brand';

/** A session saved before `endDatetime` existed has no end; two hours is
 *  what the calendar shows for it. */
export const DEFAULT_SESSION_MINUTES = 120;

export interface CalendarEvent {
  /** Stable per session, so a second tap updates the event rather than
   *  adding another where the calendar honours UIDs. */
  uid: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
  url?: string;
}

interface SessionLike {
  id: string;
  title?: string;
  datetime: string;
  endDatetime?: string;
  locationName?: string;
  locationAddress?: string;
}

/** `null` when the session has no usable start: there is nothing to add. */
export function sessionCalendarEvent(
  session: SessionLike,
  opts: { fallbackTitle: string; url?: string; host?: string },
): CalendarEvent | null {
  const start = new Date(session.datetime);
  if (isNaN(start.getTime())) return null;
  const parsedEnd = session.endDatetime ? new Date(session.endDatetime) : null;
  const end = parsedEnd && parsedEnd.getTime() > start.getTime()
    ? parsedEnd
    : new Date(start.getTime() + DEFAULT_SESSION_MINUTES * 60_000);
  const location = [session.locationName, session.locationAddress]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(', ');
  return {
    uid: `${session.id}@${opts.host ?? 'bpm.grantzou.com'}`,
    title: session.title?.trim() || opts.fallbackTitle,
    start,
    end,
    location: location || undefined,
    url: opts.url,
  };
}

/** `20261030T030000Z` — UTC, so no VTIMEZONE block is needed. */
function icsTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped. */
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1: lines longer than 75 OCTETS fold onto a line starting with
 *  a space — counted in UTF-8 bytes, never splitting a character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines carry the leading space
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildIcs(evt: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${APP_NAME}//Badminton//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(evt.uid)}`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(evt.start)}`,
    `DTEND:${icsTime(evt.end)}`,
    `SUMMARY:${icsText(evt.title)}`,
    ...(evt.location ? [`LOCATION:${icsText(evt.location)}`] : []),
    ...(evt.url ? [`URL:${evt.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
