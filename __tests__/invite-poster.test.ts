import { describe, it, expect } from 'vitest';
import { posterWhen } from '@/lib/invitePoster';
import { qrGrid, qrPath } from '@/lib/qr';

/** The poster's words and its QR (Task 1.3, "Save as image"). */
describe('posterWhen', () => {
  it('reads the weekday and times in Vancouver time, whatever the stored offset', () => {
    // 8 PM Thursday in Vancouver (summer time, -07:00), stored as UTC: Friday 03:00Z.
    // A July date, so the test does not ride on where the zone's DST rules stand.
    expect(posterWhen('2026-07-10T03:00:00Z', '2026-07-10T05:00:00Z', 'en-US')).toEqual({
      day: 'Thursday',
      time: '8:00 PM – 10:00 PM',
    });
  });

  it('gives the start alone when there is no end', () => {
    expect(posterWhen('2026-07-09T20:00:00-07:00', undefined, 'en-US')).toEqual({ day: 'Thursday', time: '8:00 PM' });
  });

  it('is null for a missing or unreadable date, never "Invalid Date"', () => {
    expect(posterWhen(null, null, 'en-US')).toBeNull();
    expect(posterWhen('nonsense', null, 'en-US')).toBeNull();
  });
});

describe('qrGrid', () => {
  it('is the same code the page draws', () => {
    const url = 'https://bpm.grantzou.com/bpm/j/' + 'a'.repeat(32);
    const { size, data } = qrGrid(url);
    let d = '';
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (data[y]![x]) d += `M${x} ${y}h1v1h-1z`;
    expect(d).toBe(qrPath(url).d);
  });
});
