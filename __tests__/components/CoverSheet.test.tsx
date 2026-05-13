// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import CoverSheet from '@/components/admin/CoverSheet';

afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('<CoverSheet />', () => {
  it('renders the cover-only confirm when open', () => {
    wrap(
      <CoverSheet
        open
        mode="cover-only"
        playerName="Bruce"
        amount={8}
        sessionLabel="Tue, May 14"
        playerId="bruce-1"
        sessionId="session-2026-05-14"
        onClose={() => {}}
        onCovered={() => {}}
      />,
    );
    expect(screen.getByText(/Cover Bruce's \$8/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /I got it/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeTruthy();
  });
});
