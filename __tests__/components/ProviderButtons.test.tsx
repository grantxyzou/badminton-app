// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ProviderButtons from '../../components/auth/ProviderButtons';
import enMessages from '../../messages/en.json';

/**
 * The distinction this file exists to pin: UNKNOWN is not KNOWN-EMPTY.
 *
 * `/api/auth/methods` answers `available: null` when it is throttled or
 * errors, and `available: []` when the deployment genuinely has no provider
 * credentials. Both must render zero buttons — but for opposite reasons, and
 * only one of them should ever be treated as settled. This is the
 * lying-empty-state rule applied to a capability probe rather than to data.
 */
function renderButtons(props: Parameters<typeof ProviderButtons>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ProviderButtons {...props} />
    </NextIntlClientProvider>,
  );
}

function mockMethods(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response),
  );
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProviderButtons', () => {
  it('renders a button per configured provider, linking to that provider start route', async () => {
    mockMethods({ available: ['google', 'apple'], linked: [] });
    renderButtons();

    const google = await screen.findByText('Continue with Google');
    const apple = await screen.findByText('Continue with Apple');
    // Plain links, not fetch calls: an OAuth flow is a full-page navigation,
    // and fetching the consent page would hit CORS.
    //
    // No `/bpm` prefix here because NEXT_PUBLIC_BASE_PATH is unset under
    // vitest, so the component's `BASE` resolves to ''. That is the same var
    // whose absence makes the whole app appear offline in dev (CLAUDE.md); the
    // prefixed route is verified against a running server instead.
    const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    expect(google.closest('a')?.getAttribute('href')).toBe(`${BASE}/api/auth/google/start`);
    expect(apple.closest('a')?.getAttribute('href')).toBe(`${BASE}/api/auth/apple/start`);
  });

  it('shows only the providers this deployment actually configured', async () => {
    mockMethods({ available: ['google'], linked: [] });
    renderButtons();

    await screen.findByText('Continue with Google');
    expect(screen.queryByText('Continue with Apple')).toBeNull();
  });

  it('renders nothing when the probe FAILED (unknown), not an empty state', async () => {
    mockMethods({ available: null, linked: null });
    const { container } = renderButtons();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders nothing when the probe throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { container } = renderButtons();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders nothing when no provider is configured', async () => {
    mockMethods({ available: [], linked: [] });
    const { container } = renderButtons();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('shows an already-linked provider as connected, not as a tappable link', async () => {
    mockMethods({ available: ['google'], linked: ['google'] });
    renderButtons(({ mode: 'link', linked: ['google'] }));

    const connected = await screen.findByText('Google connected');
    expect(connected.closest('a')).toBeNull();
    expect(screen.queryByText('Connect Google')).toBeNull();
  });

  it('uses connect wording when linking rather than signing in', async () => {
    mockMethods({ available: ['google'], linked: [] });
    renderButtons({ mode: 'link' });

    await screen.findByText('Connect Google');
    expect(screen.queryByText('Continue with Google')).toBeNull();
  });
});

/**
 * Server-resolved availability.
 *
 * Which providers exist is decided by environment variables, so the server
 * knows at render time. Passing it in is not an optimisation — it is what lets
 * these buttons LEAD the anonymous Profile card without the card painting
 * form-first and reflowing when a probe returns.
 */
describe('ProviderButtons with server-resolved availability', () => {
  it('renders immediately and issues NO probe', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    renderButtons({ available: ['google'] });

    expect(screen.getByText('Continue with Google')).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats a server-resolved empty list as a real answer, not as unknown', async () => {
    // `[]` from the server means "no provider is configured". Probing anyway
    // would re-ask a settled question — and, worse, a throttled probe answers
    // `null`, which the component would then also render as nothing while
    // having spent a request to learn less than it already knew.
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { container } = renderButtons({ available: [] });

    expect(container.firstChild).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
