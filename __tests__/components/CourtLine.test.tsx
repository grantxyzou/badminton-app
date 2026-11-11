// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import CourtLine from '../../components/home/CourtLine';

describe('CourtLine (docs/plans/waitlist-court-line.md)', () => {
  afterEach(() => cleanup());

  // The idea, not the count (Grant, 2026-11-11): the counted wording is the
  // admin's, on the Next session card.
  it('says a court can be added, with no numbers in it', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CourtLine />
      </NextIntlClientProvider>,
    );
    const line = screen.getByText('Another court can be added when enough people are on the waitlist.');
    expect(line.textContent).not.toMatch(/\d/);
  });
});
