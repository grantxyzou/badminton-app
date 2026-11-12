// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingIntake from '../../components/admin/CommandCenter/StringingIntake';
import StringingJobDetail from '../../components/admin/CommandCenter/StringingJobDetail';
import JobCard, { JobSpecLine } from '../../components/stringing/JobCard';
import enMessages from '../../messages/en.json';
import type { StringingJob } from '../../lib/types';

/**
 * Walk-ups on the bench's screens (docs/plans/stringing-walk-ups.md; Grant on
 * the canvas, 2026-11-12: "give me the ability to add a job for people thats
 * not in the roster", approved as drawn).
 *
 * The intake offers "Add {name} as a walk-up" only when the search matches
 * nobody AND the member list has loaded, and a walk-up's job saves with no
 * member id: the server mints one.
 */
function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="America/Vancouver">
      {node}
    </NextIntlClientProvider>,
  );
}

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function stubFetch(opts: { members?: unknown; membersOk?: boolean; post?: { ok: boolean; body: unknown } } = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.endsWith('/api/stringing/jobs') && init?.method === 'POST') {
        const post = opts.post ?? { ok: true, body: { job: {} } };
        return Promise.resolve({ ok: post.ok, status: post.ok ? 201 : 400, json: async () => post.body } as Response);
      }
      if (u.includes('/api/members')) {
        const ok = opts.membersOk !== false;
        return Promise.resolve({ ok, status: ok ? 200 : 503, json: async () => opts.members ?? [{ id: 'member-wei', name: 'Wei' }] } as Response);
      }
      if (u.includes('/strings')) return Promise.resolve({ ok: true, json: async () => ({ strings: [] }) } as Response);
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function typeName(name: string) {
  fireEvent.change(await screen.findByLabelText('Search by name'), { target: { value: name } });
}

describe('the intake offers a walk-up when the search matches nobody', () => {
  it('says so, and offers to add them', async () => {
    stubFetch();
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    expect(screen.getByText('Someone in the club, or a walk-up without an account.')).toBeDefined();
    await typeName('Lee');
    expect(await screen.findByText('No one in the club is called Lee.')).toBeDefined();
    expect(screen.getByText('Add Lee as a walk-up')).toBeDefined();
    expect(screen.getByText('No account needed. Just this job.')).toBeDefined();
  });

  it('leaves a name that matches a member exactly as it was', async () => {
    stubFetch();
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    await typeName('Wei');
    expect(await screen.findByText('Wei')).toBeDefined();
    expect(screen.queryByText(/as a walk-up/)).toBeNull();
    expect(screen.queryByText(/No one in the club/)).toBeNull();
  });

  it('claims nothing about the club while the member list failed to load', async () => {
    stubFetch({ membersOk: false });
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    expect(await screen.findByText("Couldn't load members.")).toBeDefined();
    await typeName('Lee');
    expect(screen.queryByText(/No one in the club/)).toBeNull();
    expect(screen.queryByText(/as a walk-up/)).toBeNull();
  });

  it('shows the walk-up, their contact field, and how they pay, then saves with no member id', async () => {
    const onCreated = vi.fn();
    stubFetch();
    wrap(<StringingIntake onBack={() => {}} onCreated={onCreated} />);
    await typeName('Lee');
    fireEvent.click(await screen.findByText('Add Lee as a walk-up'));

    expect(screen.getByText('Lee')).toBeDefined();
    expect(screen.getByText('Walk-up')).toBeDefined();
    expect(screen.getByText('Not in the club')).toBeDefined();
    expect(screen.getByText(/A walk-up has no app, so nothing reaches them on its own/)).toBeDefined();
    // The price card's footer: how they pay, never what "the player sees".
    expect(screen.getByText('How they pay')).toBeDefined();
    expect(screen.getByText('At pickup, to you')).toBeDefined();
    expect(screen.queryByText(/sees$/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Phone or email (optional)'), { target: { value: ' 604-555-0199 ' } });
    fireEvent.change(screen.getByLabelText(/Racket, e.g./i), { target: { value: 'Astrox 88D Pro' } });
    fireEvent.change(screen.getByLabelText(/String, e.g./i), { target: { value: 'BG80' } });
    const save = screen.getByRole('button', { name: /Save job/i });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = calls.find((c) => c.init?.method === 'POST')!;
    const body = JSON.parse(String(post.init!.body));
    expect(body).toMatchObject({ walkUp: true, memberName: 'Lee', walkUpContact: '604-555-0199', racketLabel: 'Astrox 88D Pro' });
    expect(body).not.toHaveProperty('memberId');
    // A walk-up's bag is nobody's: no gear read by their name.
    expect(calls.some((c) => c.url.includes('equipment/gear'))).toBe(false);
  });

  it('"Change" goes back to the search with the name still in it', async () => {
    stubFetch();
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    await typeName('Lee');
    fireEvent.click(await screen.findByText('Add Lee as a walk-up'));
    fireEvent.click(screen.getByText('Change'));
    expect((screen.getByLabelText('Search by name') as HTMLInputElement).value).toBe('Lee');
    expect(screen.getByText('Add Lee as a walk-up')).toBeDefined();
    expect(screen.queryByLabelText('Phone or email (optional)')).toBeNull();
  });

  it('shows our sentence for a refusal it knows, and the generic one for a code it does not', async () => {
    stubFetch({ post: { ok: false, body: { error: 'invalid_contact' } } });
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    await typeName('Lee');
    fireEvent.click(await screen.findByText('Add Lee as a walk-up'));
    fireEvent.change(screen.getByLabelText(/Racket, e.g./i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/String, e.g./i), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /Save job/i }));
    expect(await screen.findByText('That phone or email is too long.')).toBeDefined();

    cleanup();
    stubFetch({ post: { ok: false, body: { error: 'not_on_roster' } } });
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    await typeName('Wei');
    fireEvent.click(await screen.findByText('Wei'));
    fireEvent.change(screen.getByLabelText(/Racket, e.g./i), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/String, e.g./i), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /Save job/i }));
    expect(await screen.findByText("Couldn't save that. Give it another go.")).toBeDefined();
    expect(screen.queryByText(/error\.not_on_roster/)).toBeNull();
  });
});

const walkUpJob: StringingJob = {
  id: 'job-w',
  memberId: '~walkup:0011223344556677',
  jobNo: 'J-0042',
  memberName: 'Lee',
  stringerId: null,
  stringerName: null,
  status: 'received',
  racketLabel: 'Astrox 88D Pro',
  stringLabel: 'BG80',
  tensionMains: 26,
  tensionCrosses: 28,
  method: 'Zach · 2 strings, 4 knots',
  priceCents: 3000,
  readyBy: null,
  acceptedAt: null,
  paidAt: null,
  sessionId: null,
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z',
  history: [],
  walkUp: true,
  walkUpContact: '604-555-0199',
};

describe('a walk-up job on the bench', () => {
  it('the job page shows the pill, the contact and how they pay, and changes without asking', async () => {
    stubFetch();
    wrap(<StringingJobDetail job={walkUpJob} onBack={() => {}} onChanged={() => {}} />);
    expect(screen.getByText('Walk-up')).toBeDefined();
    expect(screen.getByText('Phone or email · 604-555-0199')).toBeDefined();
    expect(screen.getByText('How they pay')).toBeDefined();
    expect(screen.getByText('At pickup, to you')).toBeDefined();
    expect(screen.queryByText('Lee sees')).toBeNull();

    fireEvent.click(screen.getByText(enMessages.admin.stringing.propose.title));
    expect(screen.getByText('Lee is a walk-up, so a change applies at once. Agree it with them in person.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save change' })).toBeDefined();
    // Nobody to ask, so no "change without asking".
    expect(screen.queryByLabelText(enMessages.admin.stringing.propose.forceMenu)).toBeNull();
  });

  it('a member’s job page is unchanged: no pill, no contact, the player’s view', async () => {
    stubFetch();
    const { walkUp: _w, walkUpContact: _c, ...member } = walkUpJob;
    wrap(<StringingJobDetail job={{ ...member, memberId: 'member-wei', memberName: 'Wei' }} onBack={() => {}} onChanged={() => {}} />);
    expect(screen.queryByText('Walk-up')).toBeNull();
    expect(screen.getByText('Wei sees')).toBeDefined();
    fireEvent.click(screen.getByText(enMessages.admin.stringing.propose.title));
    expect(screen.getByLabelText(enMessages.admin.stringing.propose.forceMenu)).toBeDefined();
  });

  it('the bench card wears the pill beside the name, and keeps the contact for the job page', () => {
    wrap(<JobCard job={walkUpJob} today="2026-11-12" />);
    expect(screen.getByText('Walk-up')).toBeDefined();
    expect(screen.getByText(/for Lee/)).toBeDefined();
    expect(screen.queryByText(/604-555-0199/)).toBeNull();
  });

  it('the stringer’s own queue line carries the contact the server sent it', () => {
    wrap(<JobSpecLine spec="BG80 · for Lee" walkUp contact="604-555-0199" />);
    expect(screen.getByText('Walk-up')).toBeDefined();
    expect(screen.getByText('Phone or email · 604-555-0199')).toBeDefined();
  });
});
