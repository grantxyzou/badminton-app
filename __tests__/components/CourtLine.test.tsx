// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import CourtLine from '../../components/home/CourtLine';

function renderLine(waiting: number, more: number, perCourt = 6) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourtLine line={{ perCourt, waiting, more }} />
    </NextIntlClientProvider>,
  );
}

describe('CourtLine (docs/plans/waitlist-court-line.md)', () => {
  afterEach(() => cleanup());

  it('with nobody waiting, says how many would make a court', () => {
    renderLine(0, 6);
    expect(screen.getByText('Filled up early? Another court can be added once 6 are on the waitlist.')).toBeTruthy();
  });

  it('with some waiting, says how many more', () => {
    renderLine(3, 3);
    expect(screen.getByText('Filled up early? Another court can be added: 3 on the waitlist, 3 more would fill one.')).toBeTruthy();
  });

  it("with enough waiting, says it is a court's worth", () => {
    renderLine(7, 0);
    expect(screen.getByText("Filled up early? 7 on the waitlist is a court's worth, so another court can be added.")).toBeTruthy();
  });
});
