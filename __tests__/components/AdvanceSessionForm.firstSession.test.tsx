// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import AdvanceSessionForm from '@/components/admin/AdvanceSessionForm';

/**
 * A brand-new group has no session until its organiser makes one, and
 * `GET /api/session` answers 404 `no_active_session` meanwhile. That is the
 * group's FIRST session, not a failed read: walking the create-a-group journey
 * (2026-10-09) showed the organiser "Couldn't load the current session" in red
 * and promised to archive a session that did not exist.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubSession(res: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/session')) return res();
      if (url.includes('/api/admin/settings')) return new Response(JSON.stringify({ skipDates: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

describe('<AdvanceSessionForm /> for a group with no session yet', () => {
  it('reads no_active_session as the first session, with no error and nothing to archive', async () => {
    stubSession(() => new Response(JSON.stringify({ error: 'no_active_session' }), { status: 404 }));
    render(<AdvanceSessionForm onBack={() => {}} />);
    expect(await screen.findByText("Creates your group's first session.")).toBeDefined();
    expect(screen.queryByText(/Couldn.t load the current session/)).toBeNull();
    expect(screen.queryByText(/will be archived/)).toBeNull();
  });

  it('still says so when the session read really fails', async () => {
    stubSession(() => new Response(JSON.stringify({ error: 'read_failed' }), { status: 503 }));
    render(<AdvanceSessionForm onBack={() => {}} />);
    expect(await screen.findByText(/Couldn.t load the current session/)).toBeDefined();
  });

  it('a 404 that is not no_active_session is still a failure', async () => {
    stubSession(() => new Response('not found', { status: 404 }));
    render(<AdvanceSessionForm onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load the current session/)).toBeDefined());
  });
});
