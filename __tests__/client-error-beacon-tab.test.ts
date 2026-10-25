// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * docs/plans/client-error-beacon.md. A crash names the tab it happened on,
 * read from the session copy HomeShell writes — `html[data-tab]` is already
 * gone by the time an error boundary's effect runs.
 */
describe('reportClientError names the tab', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const sent = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

  it('sends the tab the member was on', async () => {
    window.sessionStorage.setItem('badminton_active_tab', 'skills');
    const { reportClientError } = await import('@/lib/engagement');
    reportClientError('render');
    expect(sent()).toEqual([{ kind: 'client_error', where: 'render', tab: 'skills' }]);
  });

  it('sends no tab when none was stored', async () => {
    const { reportClientError } = await import('@/lib/engagement');
    reportClientError('render');
    expect(sent()).toEqual([{ kind: 'client_error', where: 'render' }]);
  });

  it('stops after three in one page load', async () => {
    const { reportClientError } = await import('@/lib/engagement');
    for (let i = 0; i < 5; i++) reportClientError('render');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
