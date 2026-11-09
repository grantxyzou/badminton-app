// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import ReportProblemPage from '@/components/profile/ReportProblemPage';
import { REPORT_CATEGORIES } from '@/lib/reportCategories';

/**
 * Report a problem as a page with starters (spec §6): a chip fills the box and
 * tags the report; a member's own words are never replaced without asking.
 */

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  const onBack = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ReportProblemPage name="Lin" onBack={onBack} />
    </NextIntlClientProvider>,
  );
  return { onBack, box: screen.getByRole('textbox', { name: 'What went wrong?' }) as HTMLTextAreaElement };
}

describe('ReportProblemPage', () => {
  it('offers a chip for every category the server keeps, in order', () => {
    renderPage();
    const labels = REPORT_CATEGORIES.map((c) => enMessages.report.chips[c].label);
    expect(screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(labels);
  });

  it('a chip fills the box with its starter and tags the report', async () => {
    const { box } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Payment not showing' }));
    expect(box.value).toBe(enMessages.report.chips.payment.starter);
    expect(screen.getByRole('button', { name: 'Payment not showing' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(box, { target: { value: `${box.value}It was Nov 3.` } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ category: 'payment', name: 'Lin' });
    expect(body.message).toMatch(/still shows as owing\. It was Nov 3\.$/);
    expect(screen.getByText('Thanks. We’ll look at it soon.')).toBeTruthy();
  });

  it('switching from an untouched starter just swaps it; Something else clears', () => {
    const { box } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Couldn’t sign up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slow or stuck' }));
    expect(box.value).toBe(enMessages.report.chips.performance.starter);
    expect(screen.queryByText('Replace what you wrote?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Something else' }));
    expect(box.value).toBe('');
  });

  it('asks before replacing the member’s own words, and keeps them on Keep mine', () => {
    const { box } = renderPage();
    fireEvent.change(box, { target: { value: 'The Stats tab shows the wrong week.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Amount looks wrong' }));
    expect(screen.getByText('Replace what you wrote?')).toBeTruthy();
    expect(box.value).toBe('The Stats tab shows the wrong week.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep mine' })[0]);
    expect(box.value).toBe('The Stats tab shows the wrong week.');
    fireEvent.click(screen.getByRole('button', { name: 'Amount looks wrong' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(box.value).toBe(enMessages.report.chips.money.starter);
  });

  it('Send waits for words; the counter shows near the limit', () => {
    const { box } = renderPage();
    expect((screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'x'.repeat(1850) } });
    expect(screen.getByText('1850/2000')).toBeTruthy();
  });

  it('a refused send says so and keeps the words', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    const { box } = renderPage();
    fireEvent.change(box, { target: { value: 'Broken' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/a lot of reports/);
    expect(box.value).toBe('Broken');
  });
});
