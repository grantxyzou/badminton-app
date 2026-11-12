// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingJobDetail from '../../components/admin/CommandCenter/StringingJobDetail';
import enMessages from '../../messages/en.json';
import { STAGE_LOOK, STAGE_TRACK } from '../../lib/stringingStatusTone';
import type { StringingJob } from '../../lib/types';
import type { StringingStatus } from '../../lib/stringing';

/**
 * The job page's Progress card (Stringing canvas, 2026-11-12; Grant: "colour
 * should match the updated status colour"). The stepper is five steps in a
 * row, and everything up to the current step wears the CURRENT stage's colour
 * from lib/stringingStatusTone.ts — the same table the stringer's queue reads.
 */
const job: StringingJob = {
  id: 'job-1',
  memberId: 'member-wei',
  jobNo: 'J-0042',
  memberName: 'Wei',
  stringerId: 'member-grant',
  stringerName: 'Grant',
  status: 'received',
  racketLabel: 'Astrox 99 Pro',
  stringLabel: 'BG80',
  tensionMains: 26,
  tensionCrosses: 28,
  method: 'Zach',
  priceCents: 3000,
  readyBy: null,
  acceptedAt: null,
  paidAt: null,
  sessionId: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
  history: [],
};

function wrap(status: StringingStatus, extra: Partial<StringingJob> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringingJobDetail job={{ ...job, status, ...extra }} onBack={() => {}} onChanged={() => {}} />
    </NextIntlClientProvider>,
  );
}

function steps() {
  const { requested, received, strung, ready, picked_up } = enMessages.admin.stringing.status;
  return [requested, received, strung, ready, picked_up].map(
    (name) => screen.getByText(name, { selector: 'button.flow-step span' }).closest('button') as HTMLButtonElement,
  );
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Progress header says the status in its own colour and glyph', () => {
  for (const status of ['requested', 'received', 'strung', 'ready', 'picked_up'] as const) {
    it(status, () => {
      wrap(status);
      const label = screen.getByTestId('job-status-label');
      expect(label.style.color).toBe(STAGE_LOOK[status].tone);
      expect(label.textContent).toBe(`${STAGE_LOOK[status].icon}${enMessages.admin.stringing.status[status]}`);
    });
  }

  it('is the RACKET\'s stage while a change waits on the player, not purple', () => {
    wrap('received', { pendingEdit: { priceCents: 3400, proposedAt: '2026-09-01T00:00:00.000Z', proposedBy: 'g' } });
    expect(screen.getByTestId('job-status-label').style.color).toBe(STAGE_LOOK.received.tone);
  });
});

describe('the stepper, opened', () => {
  it('colours the steps up to the current one in the current stage\'s tone', () => {
    wrap('strung');
    fireEvent.click(screen.getByLabelText('Progress'));
    const tone = STAGE_LOOK.strung.tone;
    const buttons = steps();
    expect(buttons).toHaveLength(5);
    expect(buttons.map((b) => b.style.color)).toEqual([tone, tone, tone, 'var(--text-secondary)', 'var(--text-secondary)']);
    // The line into Strung is coloured; the line out of it is still the track.
    const lines = (b: HTMLButtonElement) => [...b.querySelectorAll('span[aria-hidden="true"] > span:not(.material-icons)')] as HTMLElement[];
    const [, outOfReceived] = lines(buttons[1]);
    const [intoStrung, outOfStrung] = lines(buttons[2]);
    expect(outOfReceived.style.background).toBe(tone);
    expect(intoStrung.style.background).toBe(tone);
    expect(outOfStrung.style.background).toBe(STAGE_TRACK);
  });

  it('is amber while Received, blue at Strung — the colour moves with the job', () => {
    wrap('received');
    fireEvent.click(screen.getByLabelText('Progress'));
    expect(steps()[1].style.color).toBe(STAGE_LOOK.received.tone);
    expect(STAGE_LOOK.received.tone).not.toBe(STAGE_LOOK.strung.tone);
  });

  it('marks the current step, says "now" under it, and hints at what a tap does', () => {
    wrap('ready');
    fireEvent.click(screen.getByLabelText('Progress'));
    const buttons = steps();
    expect(buttons.map((b) => b.getAttribute('aria-current'))).toEqual([null, null, null, 'step', null]);
    expect(buttons[3].textContent).toContain(enMessages.admin.stringing.now);
    expect(screen.getByText(enMessages.admin.stringing.stepHint)).toBeDefined();
  });

  it('still moves the job either way on a tap', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job: { ...job, status: 'received' } }) } as Response);
    vi.stubGlobal('fetch', fetchMock);
    wrap('ready');
    fireEvent.click(screen.getByLabelText('Progress'));
    fireEvent.click(steps()[1]);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
      expect(patch && JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ memberId: 'member-wei', status: 'received' });
    });
  });
});
