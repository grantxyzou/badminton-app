// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RequestStringingSheet from '../../components/stringing/RequestStringingSheet';
import enMessages from '../../messages/en.json';

/**
 * The intake form.
 *
 * Two states. The standard one asks for ONE tension and derives the crosses at
 * +2 lb, because that is the pair a stringer would have chosen anyway. The
 * custom one opens both numbers and turns the string dropdown into free text.
 *
 * The thing most worth pinning is what gets SENT, not what gets shown: a
 * player who touches one stepper must still produce a complete, sane
 * mains/crosses pair on the wire.
 */
function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RequestStringingSheet open onClose={() => {}} onRequested={() => {}} />
    </NextIntlClientProvider>,
  );
}

/** /strings answers with `offered`; the POST always succeeds. */
function mockApi(offered: string[] | null) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/strings')) {
      return Promise.resolve({ ok: true, json: async () => ({ strings: offered }) } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ job: { id: 'j1', stage: 'with_stringer' } }),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof mockApi>) {
  const call = fetchMock.mock.calls.find(
    (c) => String(c[0]).includes('/requests') && c[1]?.method === 'POST',
  );
  return call ? JSON.parse(String(call[1].body)) : null;
}

async function fillRacket() {
  fireEvent.change(await screen.findByLabelText('Which racket?'), {
    target: { value: 'Astrox 99 Pro' },
  });
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the standard form', () => {
  it('offers the strings the club stocks, as a dropdown', async () => {
    mockApi(['BG80 white', 'Aerobite', 'NBG95']);
    wrap();
    const select = await screen.findByLabelText('Which string?');
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Aerobite' })).toBeDefined();
  });

  it('asks for ONE tension, not two', async () => {
    mockApi(['BG80 white']);
    wrap();
    await screen.findByLabelText('Which string?');
    expect(screen.getByText('Tension')).toBeDefined();
    expect(screen.queryByText('Mains')).toBeNull();
    expect(screen.queryByText('Crosses')).toBeNull();
  });

  it('sends crosses at +2 lb without ever asking', async () => {
    // The point of the single stepper. Cross strings are shorter and woven
    // through the mains, so they finish looser at the same reference tension —
    // a player asking for "26" means a 26/28 job.
    const fetchMock = mockApi(['BG80 white']);
    wrap();
    await fillRacket();
    fireEvent.change(screen.getByLabelText('Which string?'), { target: { value: 'BG80 white' } });
    fireEvent.click(screen.getByRole('button', { name: 'More Tension' }));

    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({ tensionMains: 27, tensionCrosses: 29 });
  });

  it('will not submit without a string chosen', async () => {
    mockApi(['BG80 white']);
    wrap();
    await fillRacket();
    expect(screen.getByRole('button', { name: 'Send the request' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('custom request', () => {
  it('splits the tension and turns the string into free text', async () => {
    mockApi(['BG80 white']);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Custom request' }));

    expect(screen.getByText('Mains')).toBeDefined();
    expect(screen.getByText('Crosses')).toBeDefined();
    expect(screen.queryByText('Tension')).toBeNull();
    // The dropdown is gone; a text box takes its place.
    expect(screen.queryByLabelText('Which string?')).toBeNull();
    expect(screen.getByLabelText(/Which string\? e\.g\./i)).toBeDefined();
  });

  it('carries the standard choice forward instead of resetting it', async () => {
    // Someone opening custom usually wants to ADJUST what they had.
    mockApi(['BG80 white']);
    wrap();
    fireEvent.change(await screen.findByLabelText('Which string?'), {
      target: { value: 'BG80 white' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Custom request' }));
    expect((screen.getByLabelText(/Which string\? e\.g\./i) as HTMLInputElement).value).toBe(
      'BG80 white',
    );
  });

  it('allows an unconventional pair, but says it is unusual', async () => {
    // Refusing would be the app overruling somebody about their own racket.
    mockApi(['BG80 white']);
    wrap();
    await fillRacket();
    fireEvent.click(screen.getByRole('button', { name: 'Custom request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Less Crosses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Less Crosses' }));

    expect(screen.getByText(/Unusual pair/i)).toBeDefined();
    // A HINT, not a block — the send button stays live. (The toggle itself now
    // reads "Back to the usual", since we are in custom mode.)
    fireEvent.change(screen.getByLabelText(/Which string\? e\.g\./i), { target: { value: 'BG80' } });
    expect(screen.getByRole('button', { name: 'Send the request' })).toHaveProperty('disabled', false);
  });

  it('sends both numbers exactly as set', async () => {
    const fetchMock = mockApi(['BG80 white']);
    wrap();
    await fillRacket();
    fireEvent.click(screen.getByRole('button', { name: 'Custom request' }));
    fireEvent.change(screen.getByLabelText(/Which string\? e\.g\./i), {
      target: { value: 'Gut, if you have it' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'More Crosses' }));

    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({
      stringLabel: 'Gut, if you have it',
      tensionMains: 26,
      tensionCrosses: 29,
    });
  });
});

describe('when nothing is stocked', () => {
  it('falls back to free text rather than an empty dropdown', async () => {
    // An empty select is a dead end. A text box is not.
    mockApi([]);
    wrap();
    expect(await screen.findByLabelText(/Which string\? e\.g\./i)).toBeDefined();
    expect(screen.queryByLabelText('Which string?')).toBeNull();
    expect(screen.getByText(/hasn't listed what he stocks/i)).toBeDefined();
  });

  it('does the same when the list could not be read at all', async () => {
    // Unknown is not "no strings" — but for this form both mean the dropdown
    // has nothing to offer, so both degrade the same way.
    mockApi(null);
    wrap();
    expect(await screen.findByLabelText(/Which string\? e\.g\./i)).toBeDefined();
  });

  it('hides the custom toggle, since custom is already all there is', async () => {
    mockApi([]);
    wrap();
    await screen.findByLabelText(/Which string\? e\.g\./i);
    expect(screen.queryByRole('button', { name: 'Custom request' })).toBeNull();
  });
});

describe('the header', () => {
  it('has a visible way out', async () => {
    // BottomSheetHeader is a title-and-close ROW, but it renders whatever
    // children it is given — passing a bare string produced a sheet with no
    // close button. Escape and the backdrop still worked; nothing on screen
    // said so, which is the same as not working for most people.
    const onClose = vi.fn();
    mockApi(['BG80 white']);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open onClose={onClose} onRequested={() => {}} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });


  it('is an intake form, and promises nothing about price', async () => {
    mockApi(['BG80 white']);
    wrap();
    expect(await screen.findByText('Intake form')).toBeDefined();
    expect(screen.queryByText(/confirms the price/i)).toBeNull();
    expect(screen.queryByLabelText(/price/i)).toBeNull();
  });
});
