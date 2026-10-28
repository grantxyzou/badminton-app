// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RequestStringingSheet from '../../components/stringing/RequestStringingSheet';
import type { UseGear } from '@/components/stats/useGear';
import { resetCatalogCache } from '@/components/stats/useCatalog';
import enMessages from '../../messages/en.json';

/**
 * The intake form, in two steps (docs/plans/stringing-canvas-redesign.md):
 * what (racket, string, colour), then how tight (tension, summary, Send).
 *
 * The tension is ONE number by default and the crosses are derived at +2 lb,
 * because that is the pair a stringer would have chosen anyway. "Separate
 * tension requests…" opens both numbers — and leaves the string alone.
 *
 * The thing most worth pinning is what gets SENT, not what gets shown: a
 * player who touches one stepper must still produce a complete, sane
 * mains/crosses pair on the wire.
 */
function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RequestStringingSheet open onClose={() => {}} onRequested={() => {}} gear={null} />
    </NextIntlClientProvider>,
  );
}

/** /strings answers with `offered` (plus any shelf maps); /catalog with
 *  `catalog`; the POST always succeeds. */
function mockApi(offered: string[] | null, shelf: Record<string, unknown> = {}, catalog: unknown[] = []) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/strings')) {
      return Promise.resolve({ ok: true, json: async () => ({ strings: offered, ...shelf }) } as Response);
    }
    if (String(url).includes('/catalog')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: catalog }) } as Response);
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

/** Step 1 → step 2. */
function toTension() {
  fireEvent.click(screen.getByRole('button', { name: 'Next: string tension' }));
}

async function fillRacket() {
  fireEvent.change(await screen.findByLabelText('Which racket?'), {
    target: { value: 'Astrox 99 Pro' },
  });
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  // The catalog read is cached per page; each test brings its own.
  resetCatalogCache();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the standard form', () => {
  it('offers the strings the club stocks, as a list, with Bring my own last', async () => {
    mockApi(['BG80 white', 'Aerobite', 'NBG95']);
    wrap();
    await screen.findByRole('radiogroup', { name: 'Which string?' });
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining('BG80 white'),
      expect.stringContaining('Aerobite'),
      expect.stringContaining('NBG95'),
      expect.stringContaining('I have my own'),
    ]);
  });

  it('asks for ONE tension, not two, on step 2', async () => {
    mockApi(['BG80 white']);
    wrap();
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /BG80 white/ }));
    // Step 1 asks no tension at all.
    expect(screen.queryByText('Main + Cross')).toBeNull();
    toTension();
    expect(screen.getByText('Main + Cross')).toBeDefined();
    expect(screen.getByText('2 of 2')).toBeDefined();
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
    fireEvent.click(screen.getByRole('radio', { name: /BG80 white/ }));
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'More Main + Cross' }));

    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({ tensionMains: 27, tensionCrosses: 29 });
  });

  it('will not move on without a string chosen', async () => {
    mockApi(['BG80 white']);
    wrap();
    await fillRacket();
    await screen.findByRole('radiogroup', { name: 'Which string?' });
    expect(screen.getByRole('button', { name: 'Next: string tension' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Send the request' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /BG80 white/ }));
    expect(screen.getByRole('button', { name: 'Next: string tension' })).toHaveProperty('disabled', false);
  });

  it('goes back to step 1 with the choices kept', async () => {
    mockApi(['BG80 white']);
    wrap();
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /BG80 white/ }));
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('1 of 2')).toBeDefined();
    expect(screen.getByRole('radio', { name: /BG80 white/ }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('separate mains and crosses', () => {
  async function toSplit() {
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /BG80 white/ }));
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'Separate tension requests for Main and Cross' }));
  }

  it('splits the tension and LEAVES THE STRING ALONE', async () => {
    // The two were one "Custom request" switch, and asking for 26/30 threw
    // away the string the player had just picked.
    mockApi(['BG80 white']);
    wrap();
    await toSplit();
    expect(screen.getByText('Mains')).toBeDefined();
    expect(screen.getByText('Crosses')).toBeDefined();
    expect(screen.queryByText('Main + Cross')).toBeNull();
    expect(screen.queryByLabelText(/Which string\? e\.g\./i)).toBeNull();
    expect(screen.getByText('BG80 white · 26 lb')).toBeDefined();
  });

  it('allows an unconventional pair, but says it is unusual', async () => {
    // Refusing would be the app overruling somebody about their own racket.
    mockApi(['BG80 white']);
    wrap();
    await toSplit();
    fireEvent.click(screen.getByRole('button', { name: 'Less Crosses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Less Crosses' }));
    expect(screen.getByText(/Unusual pair/i)).toBeDefined();
    // A HINT, not a block — the send button stays live.
    expect(screen.getByRole('button', { name: 'Send the request' })).toHaveProperty('disabled', false);
    expect(screen.getByText('BG80 white · 26/26 lb')).toBeDefined();
  });

  it('sends both numbers exactly as set, with the picked string', async () => {
    const fetchMock = mockApi(['BG80 white']);
    wrap();
    await toSplit();
    fireEvent.click(screen.getByRole('button', { name: 'More Crosses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({ stringLabel: 'BG80 white', tensionMains: 26, tensionCrosses: 29 });
  });

  it('goes back to one number with "Back to the usual"', async () => {
    const fetchMock = mockApi(['BG80 white']);
    wrap();
    await toSplit();
    fireEvent.click(screen.getByRole('button', { name: 'More Crosses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the usual' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({ tensionMains: 26, tensionCrosses: 28 });
  });
});

describe('when nothing is stocked', () => {
  it('falls back to free text rather than an empty dropdown', async () => {
    // An empty select is a dead end. A text box is not.
    mockApi([]);
    wrap();
    expect(await screen.findByLabelText(/Which string\? e\.g\./i)).toBeDefined();
    expect(screen.queryByLabelText('Which string?')).toBeNull();
    expect(screen.getByText(enMessages.home.stringing.noStringsYet)).toBeDefined();
  });

  it('does the same when the list could not be read at all', async () => {
    // Unknown is not "no strings" — but for this form both mean the dropdown
    // has nothing to offer, so both degrade the same way.
    mockApi(null);
    wrap();
    expect(await screen.findByLabelText(/Which string\? e\.g\./i)).toBeDefined();
  });

  it('takes the typed string through to step 2', async () => {
    const fetchMock = mockApi([]);
    wrap();
    await fillRacket();
    fireEvent.change(await screen.findByLabelText(/Which string\? e\.g\./i), { target: { value: 'Gut, if you have it' } });
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({ stringLabel: 'Gut, if you have it' });
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
        <RequestStringingSheet open onClose={onClose} onRequested={() => {}} gear={null} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });


  it('is an intake form, and promises nothing about price', async () => {
    mockApi(['BG80 white']);
    wrap();
    // Not "Intake form" any more: that was bench vocabulary on the player's
    // sheet (audit 2026-10-11, note N1). The subtitle says what to do next.
    expect(await screen.findByText(enMessages.home.stringing.requestSubtitle)).toBeDefined();
    expect(screen.queryByText(/confirms the price/i)).toBeNull();
    expect(screen.queryByLabelText(/price/i)).toBeNull();
  });
});

/**
 * The player's kit.
 *
 * The honesty rule from the string dropdown carries over exactly: a kit that
 * could not be READ must not render as a kit that is EMPTY. A player with three
 * rackets on a flaky fetch being told to type one is a small annoyance; being
 * told they own none is the app asserting something false about their bag.
 */
function fakeGear(over: Partial<UseGear> = {}): UseGear {
  return {
    gear: null,
    rackets: [],
    active: null,
    loaded: true,
    loadError: false,
    forbidden: false,
    busy: false,
    online: true,
    reload: async () => {},
    add: async () => ({ ok: true as const }),
    addCustom: async () => ({ ok: true as const }),
    activate: async () => ({ ok: true as const }),
    remove: async () => ({ ok: true as const }),
    setPrefs: async () => ({ ok: true as const }),
    setTension: async () => ({ ok: true as const }),
    ...over,
  } as UseGear;
}

function wrapWithGear(gear: UseGear | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RequestStringingSheet open onClose={() => {}} onRequested={() => {}} gear={gear} />
    </NextIntlClientProvider>,
  );
}

describe('picking a racket from the kit', () => {
  it('offers the kit when there is one', async () => {
    mockApi(['BG65']);
    const racket = { id: 'r1', label: 'Astrox 99 Pro' } as UseGear['rackets'][number];
    wrapWithGear(fakeGear({ rackets: [racket] }));
    await waitFor(() => expect(screen.getByLabelText('Which racket?')).toBeDefined());
    expect(screen.getByRole('option', { name: 'Astrox 99 Pro' })).toBeDefined();
  });

  it('falls back to typing when the kit is empty', async () => {
    mockApi(['BG65']);
    wrapWithGear(fakeGear({ rackets: [] }));
    await waitFor(() => expect(screen.getByLabelText('Which racket?')).toBeDefined());
    // A text box, not an empty select — an empty select is a dead end.
    expect((screen.getByLabelText('Which racket?') as HTMLElement).tagName).toBe('INPUT');
    expect(screen.getByText("Type the racket and we'll add it to your equipment.")).toBeDefined();
  });

  it('says the kit could not be READ rather than implying it is empty', async () => {
    mockApi(['BG65']);
    wrapWithGear(fakeGear({ rackets: [], loadError: true }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't load your equipment. Type the racket instead.")).toBeDefined(),
    );
  });

  it('saves a typed racket to the kit, after the request succeeds', async () => {
    // Best-effort and deliberately after: the restring is what they came for,
    // and a full bag must not turn a placed request into an error.
    mockApi(['BG65']);
    const addCustom = vi.fn(async () => ({ ok: true as const }));
    wrapWithGear(fakeGear({ rackets: [], addCustom }));
    await waitFor(() => expect(screen.getByLabelText('Which racket?')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Which racket?'), {
      target: { value: 'Arcsaber 11' },
    });
    // A string is required too, or the submit stays disabled.
    fireEvent.click(screen.getByRole('radio', { name: /BG65/ }));
    toTension();
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(addCustom).toHaveBeenCalledWith('Arcsaber 11'));
  });
});

describe('a kit that has not answered yet is not an empty kit', () => {
  it('does not claim the bag is empty while the read is in flight', async () => {
    // `useActiveName` resolves post-mount, so the gear read starts a tick
    // after the sheet opens — and cold starts here run 10-20s. Folding
    // `!loaded` into "unreadable" asserted "your kit is empty" before anything
    // had answered, then swapped the control underneath whatever the player
    // had begun typing.
    mockApi(['BG65']);
    wrapWithGear(fakeGear({ rackets: [], loaded: false, loadError: false }));
    await waitFor(() => expect(screen.getByLabelText('Which racket?')).toBeDefined());
    expect(screen.queryByText("Type the racket and we'll add it to your equipment.")).toBeNull();
    expect((screen.getByLabelText('Which racket?') as HTMLInputElement).disabled).toBe(true);
  });

  it('says the bag is empty once the read actually says so', async () => {
    mockApi(['BG65']);
    wrapWithGear(fakeGear({ rackets: [], loaded: true, loadError: false }));
    await waitFor(() =>
      expect(screen.getByText("Type the racket and we'll add it to your equipment.")).toBeDefined(),
    );
  });
});

// Loading cascade follow-up: the string list loading and the list FAILING were
// one `null`. Loading forced the form into free text and then swapped it for a
// dropdown; failing said "Grant hasn't listed what he stocks" — untrue.
describe('RequestStringingSheet while the string list is unknown', () => {
  it('shows a disabled placeholder, not free text, while the list loads', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    wrap();
    const field = screen.getByLabelText('Which string?') as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(field.disabled).toBe(true);
    expect(screen.queryByText(enMessages.home.stringing.noStringsYet)).toBeNull();
  });

  it('says the list could not load, not that nothing is stocked, when it fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response));
    wrap();
    expect(await screen.findByText(enMessages.home.stringing.stringsUnavailable)).toBeDefined();
    expect(screen.queryByText(enMessages.home.stringing.noStringsYet)).toBeNull();
  });
});

describe('reopening the sheet', () => {
  // Audit 2026-10-11, finding 02: `done` is component state and the sheet
  // stays MOUNTED between opens, so a second "Submit a request" reopened onto
  // the previous "Sent." screen with no form — a second racket needed a reload.
  it('starts a fresh form after a send, not the old "Sent." screen', async () => {
    const fetchMock = mockApi(['BG80 white']);
    const sheet = (open: boolean) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open={open} onClose={() => {}} onRequested={() => {}} gear={null} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(sheet(true));
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /BG80 white/ }));
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByRole('status')).toBeDefined();
    expect(sentBody(fetchMock)).not.toBeNull();
    // The Sent screen: what to do next, and the job at its first segment.
    expect(screen.getByText('Drop off your racket')).toBeDefined();
    expect(screen.getByText('Drop it off')).toBeDefined();
    expect(screen.getByText('Requested').getAttribute('aria-current')).toBe('step');

    // Close, then open again — the same mounted component, as StringingCard does.
    rerender(sheet(false));
    rerender(sheet(true));
    expect(screen.queryByRole('status')).toBeNull();
    expect(((await screen.findByLabelText('Which racket?')) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Next: string tension' })).toBeDefined();
    expect(screen.getByText('1 of 2')).toBeDefined();
  });
});

/**
 * The short shelf (docs/design/strings-shelf-spec.md, design 2f): price and
 * stock per string, out of stock refused, a colour when there is a choice,
 * and "Bring my own" as the last row.
 */
describe('the string list as a shelf', () => {
  const BG65 = {
    id: 'string-yx-bg65',
    category: 'string',
    brand: 'Yonex',
    model: 'BG65',
    attributes: { gaugeMm: 0.7, stringType: 'Durability', colors: 'White; Yellow; Red' },
  };
  const SHELF = {
    links: { BG65: 'string-yx-bg65' },
    prices: { BG65: 2800, Aerobite: null, Exbolt: 3400 },
    stock: { BG65: 'in', Aerobite: 'out', Exbolt: 'low' },
  };

  it('shows the price, and stock only when it changes the choice', async () => {
    mockApi(['BG65', 'Aerobite', 'Exbolt', 'House'], SHELF, [BG65]);
    wrap();
    const bg65 = await screen.findByRole('radio', { name: /BG65/ });
    expect(bg65.textContent).toContain('$28');
    // In stock is the normal case and says nothing (Grant: "Does user care
    // about stock here?"); Low on stock does.
    expect(bg65.textContent).not.toContain('In stock');
    expect(screen.getByRole('radio', { name: /Exbolt/ }).textContent).toContain('Low on stock');
    // No price set for House: nothing, not "$0" and not "Ask".
    const house = screen.getByRole('radio', { name: /House/ });
    expect(house.textContent).not.toMatch(/\$|Ask/);
  });

  it('will not let an out-of-stock string be picked', async () => {
    mockApi(['BG65', 'Aerobite'], SHELF, [BG65]);
    wrap();
    const out = await screen.findByRole('radio', { name: 'Aerobite, out of stock' });
    expect(out.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(out);
    expect(out.getAttribute('aria-checked')).toBe('false');
  });

  it('asks which colour, first one by default, and sends it apart from the label', async () => {
    const fetchMock = mockApi(['BG65'], SHELF, [BG65]);
    wrap();
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /BG65/ }));
    const colours = await screen.findByRole('radiogroup', { name: 'Available colours' });
    expect(colours.querySelector('[aria-checked="true"]')?.textContent).toBe('White');
    fireEvent.click(screen.getByRole('radio', { name: 'Yellow' }));
    toTension();
    expect(screen.getByText('BG65 · Yellow · 26 lb')).toBeDefined();
    expect(screen.getByText('$28')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({ stringLabel: 'BG65', stringColor: 'Yellow' });
  });

  it('sends no colour for a string the catalog does not know', async () => {
    const fetchMock = mockApi(['House'], {}, []);
    wrap();
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /House/ }));
    expect(screen.queryByRole('radiogroup', { name: 'Available colours' })).toBeNull();
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock).stringColor).toBeUndefined();
  });

  it('shows the stringer’s own-string price on Bring my own, read only once the sheet is open', async () => {
    // docs/plans/bench-redesign.md, PR 2: "Ask" was the only answer this row
    // could give; the bench now sets a figure for it.
    const base = mockApi(['BG65'], SHELF, [BG65]);
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/pricing')
        ? Promise.resolve({ ok: true, json: async () => ({ services: [], ownStringCents: 1500, note: '' }) } as Response)
        : base(url, init),
    );
    vi.stubGlobal('fetch', fetchMock);
    wrap();
    const own = await screen.findByRole('radio', { name: /I have my own/ });
    await waitFor(() => expect(own.textContent).toContain('$15'));
  });

  it('reads "Ask" again when the stringer changes the own-string price to Ask between opens', async () => {
    const base = mockApi(['BG65'], SHELF, [BG65]);
    let own: number | null = 1500;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) =>
        String(url).includes('/pricing')
          ? Promise.resolve({ ok: true, json: async () => ({ services: [], ownStringCents: own, note: '' }) } as Response)
          : base(url, init),
      ),
    );
    const view = (open: boolean) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open={open} onClose={() => {}} onRequested={() => {}} gear={null} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(view(true));
    const first = await screen.findByRole('radio', { name: /I have my own/ });
    await waitFor(() => expect(first.textContent).toContain('$15'));
    rerender(view(false));
    own = null;
    rerender(view(true));
    const again = await screen.findByRole('radio', { name: /I have my own/ });
    await waitFor(() => expect(again.textContent).not.toContain('$15'));
    expect(again.textContent).toContain('Ask');
  });

  it('sends what was typed for Bring my own, with no colour', async () => {
    const fetchMock = mockApi(['BG65'], SHELF, [BG65]);
    wrap();
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /I have my own/ }));
    fireEvent.change(screen.getByLabelText('Which string? e.g. BG80 white'), { target: { value: 'Exbolt 63 lime' } });
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    await waitFor(() => expect(sentBody(fetchMock)).not.toBeNull());
    expect(sentBody(fetchMock)).toMatchObject({ stringLabel: 'Exbolt 63 lime' });
    expect(sentBody(fetchMock).stringColor).toBeUndefined();
  });

  /* Design-system audit, 2026-10-12: a failure must never read as an answer. */
  it('does not say "Ask" for your own string when the price could not be read', async () => {
    const base = mockApi(['BG65'], SHELF, [BG65]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/pricing')
        ? Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response)
        : base(url, init)));
    wrap();
    const own = await screen.findByRole('radio', { name: /I have my own/ });
    await new Promise((r) => setTimeout(r, 20));
    expect(own.textContent).not.toContain('Ask');
  });

  it('says the string details did not load instead of calling each string unknown', async () => {
    const base = mockApi(['BG65'], SHELF, [BG65]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/catalog')
        ? Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response)
        : base(url, init)));
    wrap();
    expect(await screen.findByText(enMessages.home.stringing.offer.catalogError)).toBeDefined();
    expect(screen.queryByText(enMessages.home.stringing.offer.unknown)).toBeNull();
  });

  it('announces a failed send to a screen reader', async () => {
    const base = mockApi(['BG65'], SHELF, [BG65]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'nope' }) } as Response)
        : base(url, init)));
    wrap();
    await fillRacket();
    fireEvent.click(await screen.findByRole('radio', { name: /I have my own/ }));
    fireEvent.change(screen.getByLabelText('Which string? e.g. BG80 white'), { target: { value: 'Exbolt 63' } });
    toTension();
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    // And it stays on step 2 with the answer still there to send again.
    expect(screen.getByText('2 of 2')).toBeDefined();
  });
});

describe('a club list that still carries "Bring my own"', () => {
  it('shows the built-in row once, not a second unpriced copy', async () => {
    mockApi(['BG80 white', 'Bring my own']);
    wrap();
    await screen.findByRole('radiogroup', { name: 'Which string?' });
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      expect.stringContaining('BG80 white'),
      expect.stringContaining('I have my own'),
    ]);
  });
});

describe('opened from a string\'s page', () => {
  it('starts with that string picked', async () => {
    mockApi(['BG80 white', 'BG65']);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open onClose={() => {}} onRequested={() => {}} gear={null} initialString="bg65" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('radio', { name: /BG65/ }).getAttribute('aria-checked')).toBe('true'));
  });

  it('picks nothing for a string that is out of stock or not on the shelf', async () => {
    mockApi(['BG80 white', 'Aerobite'], { stock: { Aerobite: 'out' } });
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RequestStringingSheet open onClose={() => {}} onRequested={() => {}} gear={null} initialString="Aerobite" />
      </NextIntlClientProvider>,
    );
    await screen.findByRole('radiogroup', { name: 'Which string?' });
    expect(screen.getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
  });
});
