// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import GroupsPage from '@/components/profile/GroupsPage';
import type { GroupListEntry } from '@/lib/useCurrentGroup';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bpm: GroupListEntry = { id: 'bpm', name: 'BPM Badminton', role: 'member', rosterName: 'Lin', joinedAt: '2026-01-01', current: true };
const other: GroupListEntry = { id: 'g2', name: 'Shuttle Club', role: 'admin', rosterName: 'Lin D', joinedAt: '2026-02-01', current: false };

function renderPage(groups: GroupListEntry[], extra: Partial<Parameters<typeof GroupsPage>[0]> = {}) {
  const props = {
    onBack: vi.fn(),
    groups,
    onSwitched: vi.fn(),
    onJoinAnother: vi.fn(),
    onCreateAnother: vi.fn(),
    ...extra,
  };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GroupsPage {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe('GroupsPage', () => {
  it('lists clubs as rows in one field card, the current one marked with a tick', () => {
    renderPage([bpm, other]);
    const current = screen.getByRole('button', { name: 'BPM Badminton' });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.closest('.glass-card.is-flush')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Current' })).toBeTruthy();
    // The admin-card class that made each club a padless pill is gone.
    expect(document.querySelector('.cc-mini-card')).toBeNull();
    expect(screen.getByText('Player · Lin')).toBeTruthy();
    expect(screen.getByText('Admin · Lin D')).toBeTruthy();
  });

  it('Join and Create are equal settings rows, not a button and a ghost button', () => {
    const props = renderPage([bpm]);
    const join = screen.getByRole('button', { name: /Join another group/ });
    const create = screen.getByRole('button', { name: /Create another group/ });
    expect(join.className).not.toMatch(/cc-btn/);
    expect(create.className).not.toMatch(/cc-btn/);
    fireEvent.click(join);
    fireEvent.click(create);
    expect(props.onJoinAnother).toHaveBeenCalledOnce();
    expect(props.onCreateAnother).toHaveBeenCalledOnce();
    expect(screen.getByText("You're only in one group right now.")).toBeTruthy();
  });

  it('tapping another club switches to it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const props = renderPage([bpm, other]);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Shuttle Club' }));
    await vi.waitFor(() => expect(props.onSwitched).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ groupId: 'g2' });
  });

  it('a failed load says so instead of listing nothing', () => {
    renderPage([], { loadError: true });
    expect(screen.getByText("Couldn't load your groups.")).toBeTruthy();
    expect(screen.queryByText("You're only in one group right now.")).toBeNull();
  });

  it('SettingsList has one home, shared by Profile and this page', () => {
    const profile = readFileSync('components/ProfileTab.tsx', 'utf8');
    expect(profile).not.toMatch(/function SettingsList\(/);
    expect(profile).toMatch(/from '\.\/profile\/SettingsList'/);
  });
});
