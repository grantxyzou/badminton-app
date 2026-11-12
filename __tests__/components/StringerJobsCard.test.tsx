// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import zhMessages from '@/messages/zh-CN.json';
import StringerJobsCard from '@/components/stringing/StringerJobsCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringerJobsCard hasIdentity />
    </NextIntlClientProvider>,
  );
}

describe('<StringerJobsCard /> states', () => {
  it('renders nothing when the server refuses — no session says nothing about stringing', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const { container } = wrap();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a real failure shows the card with an alert and a Try again that asks again', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    wrap();
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load your jobs.");
    const before = fetchSpy.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(before));
  });
});

const stringerJob = (status: string) => ({
  id: 'j1', jobNo: 'J-0003', memberId: 'm-akane', memberName: 'Akane', status,
  racketLabel: 'Arcsaber 11 Pro', stringLabel: 'Aerobite', tensionMains: 25, tensionCrosses: 27,
  method: '', readyBy: null, createdAt: '', updatedAt: '',
});

describe('the advance button speaks the status words, not the key', () => {
  // Audit 2026-10-11, finding 08: the label interpolated the raw status key,
  // so zh-CN rendered "标记为ready". The words come from the status table both
  // locales already carry.
  it('reads "Mark strung" for a received job', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [stringerJob('received')], view: 'stringer' }), { status: 200 }),
    );
    wrap();
    const expected = `Mark ${enMessages.admin.stringing.status.strung.toLowerCase()}`;
    expect(await screen.findByRole('button', { name: expected })).toBeDefined();
  });

  it('renders the Chinese status word in zh-CN, never the English key', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [stringerJob('received')], view: 'stringer' }), { status: 200 }),
    );
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <StringerJobsCard hasIdentity />
      </NextIntlClientProvider>,
    );
    const expected = zhMessages.home.stringing.stringerAdvance.replace('{status}', zhMessages.admin.stringing.status.strung);
    expect(await screen.findByRole('button', { name: expected })).toBeDefined();
    expect(screen.queryByRole('button', { name: /strung/ })).toBeNull();
  });

  it('shows the ready-by date and how late it is — the stringer is the one who has to hit it', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [{ ...stringerJob('received'), readyBy: '2000-01-01' }], view: 'stringer' }), { status: 200 }),
    );
    wrap();
    await screen.findByText('Arcsaber 11 Pro');
    // "N days late" from admin.stringing.due.overdue, the bench's own words.
    expect(screen.getByText(/days late$/)).toBeDefined();
  });

  it('offers Undo after an advance, and Undo puts the previous status back', async () => {
    // The mock server remembers the status it was given, as the real one does.
    let status = 'received';
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') {
        status = JSON.parse(String(init.body)).status;
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: [stringerJob(status)], view: 'stringer' }), { status: 200 });
    });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark strung' }));
    const undo = await screen.findByRole('button', { name: enMessages.home.stringing.stringerUndo });
    fireEvent.click(undo);
    await waitFor(() => {
      const patches = fetchSpy.mock.calls.filter((c) => c[1]?.method === 'PATCH').map((c) => JSON.parse(String(c[1]?.body)));
      expect(patches).toEqual([
        { memberId: 'm-akane', status: 'strung' },
        { memberId: 'm-akane', status: 'received' },
      ]);
    });
    // Undone: the offer goes away until the next advance.
    await waitFor(() => expect(screen.queryByRole('button', { name: enMessages.home.stringing.stringerUndo })).toBeNull());
  });

  it('offers no Undo when the reload shows someone else moved the job meanwhile', async () => {
    // The admin marked it picked up between the tap and the reload. Undo
    // would revert THEIR move; it is offered only while the job still sits
    // where this card put it.
    let patched = false;
    vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ jobs: [stringerJob(patched ? 'picked_up' : 'received')], view: 'stringer' }), { status: 200 });
    });
    wrap();
    const btn = await screen.findByRole('button', { name: 'Mark strung' });
    patched = true;
    fireEvent.click(btn);
    await screen.findByRole('button', { name: 'Mark picked up' }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: enMessages.home.stringing.stringerUndo })).toBeNull();
  });

  it('offers no Undo for an advance that failed', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ jobs: [stringerJob('received')], view: 'stringer' }), { status: 200 });
    });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark strung' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByRole('button', { name: enMessages.home.stringing.stringerUndo })).toBeNull();
  });

  it('reads "Mark picked up" for a ready job', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [stringerJob('ready')], view: 'stringer' }), { status: 200 }),
    );
    wrap();
    const expected = `Mark ${enMessages.admin.stringing.status.picked_up.toLowerCase()}`;
    expect(await screen.findByRole('button', { name: expected })).toBeDefined();
  });
});

describe('as the Bench register (docs/plans/stringing-tabs.md)', () => {
  it('says nothing is assigned, instead of rendering nothing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [], view: 'stringer', canString: true }), { status: 200 }),
    );
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StringerJobsCard hasIdentity showEmpty />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText(enMessages.home.stringing.stringerEmpty)).toBeDefined();
  });
});

describe('telling the statuses apart (Stringing canvas, 2026-11-12)', () => {
  // Grant: "I am having trouble telling the status apart". Each stage has its
  // own words, glyph and colour, and a bar that fills to where the racket is.
  const serve = (jobs: unknown[]) =>
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs, view: 'stringer' }), { status: 200 }),
    );

  const cases = [
    { status: 'requested', label: 'Not dropped off', icon: 'schedule', filled: 0 },
    { status: 'received', label: 'Received', icon: 'inventory_2', filled: 1 },
    { status: 'strung', label: 'Strung', icon: 'check', filled: 2 },
    { status: 'ready', label: 'Ready for pickup', icon: 'check_circle', filled: 3 },
    { status: 'picked_up', label: 'Picked up', icon: 'check_circle', filled: 4 },
  ] as const;

  for (const c of cases) {
    it(`${c.status}: "${c.label}" with its icon, and the bar filled to ${c.filled}`, async () => {
      serve([stringerJob(c.status)]);
      const { container } = wrap();
      await screen.findByText('Arcsaber 11 Pro');
      const pill = container.querySelector('[data-testid="stringer-job-status"]') as HTMLElement;
      expect(pill.textContent).toBe(`${c.icon}${c.label}`);
      const bar = container.querySelector('[data-testid="stringer-job-progress"]') as HTMLElement;
      const on = [...bar.children].map((s) => (s as HTMLElement).dataset.on);
      expect(on.filter((v) => v === 'true')).toHaveLength(c.filled);
      // Filled from the left: no gap before the last filled segment.
      expect(on.indexOf('false') === -1 ? on.length : on.indexOf('false')).toBe(c.filled);
    });
  }

  it('each stage has its own colour, except the two greys at either end', async () => {
    serve(cases.map((c, i) => ({ ...stringerJob(c.status), id: `j${i}` })));
    const { container } = wrap();
    await screen.findByText('Not dropped off');
    const colours = [...container.querySelectorAll('[data-testid="stringer-job-status"]')]
      .map((el) => (el as HTMLElement).style.color);
    // received, strung, ready: three distinct hues.
    expect(new Set(colours.slice(1, 4)).size).toBe(3);
  });

  it('heads the list with a plain heading and the count, not an outer card', async () => {
    serve([
      { ...stringerJob('received'), readyBy: '2000-01-01' },
      { ...stringerJob('strung'), id: 'j2' },
    ]);
    const { container } = wrap();
    expect(await screen.findByText('2 assigned to you · 1 late')).toBeDefined();
    const section = container.querySelector('section') as HTMLElement;
    expect(section.className).not.toContain('glass-card');
    expect(container.querySelectorAll('[data-testid="stringer-job"].glass-card')).toHaveLength(2);
  });

  it('a job waiting on the player says what was suggested and offers no action', async () => {
    serve([{
      ...stringerJob('received'),
      memberName: 'Lin',
      pendingEdit: { proposedAt: '2026-11-01T00:00:00.000Z', stringFrom: 'BG80', stringTo: 'BG65' },
    }]);
    const { container } = wrap();
    expect(await screen.findByText('Waiting on Lin')).toBeDefined();
    expect(screen.getByText('Suggested BG65 instead of BG80. Lin has to accept before you string it.')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    // The bar still says where the racket is: received.
    const bar = container.querySelector('[data-testid="stringer-job-progress"]') as HTMLElement;
    expect(bar.dataset.filled).toBe('1');
  });

  it('a job waiting on the player before drop-off still offers "Mark received" (review, 2026-11-12)', async () => {
    serve([{ ...stringerJob('requested'), pendingEdit: { proposedAt: '2026-11-01T00:00:00.000Z' } }]);
    wrap();
    expect(await screen.findByRole('button', { name: /Mark received/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Mark strung/ })).toBeNull();
  });

  it('a pending change it cannot describe still says the player has to confirm', async () => {
    serve([{ ...stringerJob('received'), pendingEdit: { proposedAt: '2026-11-01T00:00:00.000Z' } }]);
    wrap();
    expect(await screen.findByText('Waiting for Akane to confirm the change.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Mark strung' })).toBeNull();
  });

  it('every stage label exists in Chinese too', () => {
    const en = enMessages.home.stringing.stringerStage;
    const zh = zhMessages.home.stringing.stringerStage;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});

describe('requests nobody has taken (docs/plans/stringing-request-nudge.md)', () => {
  const old = new Date(Date.now() - 50 * 3_600_000).toISOString();
  const unclaimed = { ...stringerJob('requested'), id: 'u1', jobNo: 'J-0009', createdAt: old };

  it('lists them with "Take it", and marks one waiting past 48 hours', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [], unclaimed: [unclaimed], view: 'stringer' }), { status: 200 }),
    );
    const { container } = wrap();
    expect(await screen.findByText('Waiting for a stringer')).toBeDefined();
    expect(screen.getByText('Waiting 2 days for a stringer')).toBeDefined();
    expect(container.querySelector('.bpm-job-card--waiting')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Take it' })).toBeDefined();
  });

  it('Take it sends a claim for themselves, and a 409 says someone got there first', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') return new Response('{"error":"already_taken"}', { status: 409 });
      return new Response(JSON.stringify({ jobs: [], unclaimed: [unclaimed], view: 'stringer' }), { status: 200 });
    });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Someone took this one first.');
    const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(String(patch[0])).toMatch(/\/api\/stringing\/jobs\/u1$/);
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ memberId: 'm-akane', claim: true });
  });
});
