// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import type { MemberAvatar } from '@/lib/memberAvatar';

// The picker offers "My racket" from the member's Equipment set-up.
const gearState = vi.hoisted(() => ({ value: { active: null as null | { catalogId: string }, loaded: true } }));
vi.mock('@/components/stats/useGear', () => ({ useGear: () => gearState.value }));

import EditProfilePage, { avatarChoices, fmtMemberSince } from '@/components/profile/EditProfilePage';

const RACKET = 'racket-yonex-astrox-88d-pro';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  gearState.value = { active: { catalogId: RACKET }, loaded: true };
});

function renderPage(extra: Partial<Parameters<typeof EditProfilePage>[0]> = {}) {
  const props = {
    name: 'Lin',
    clubName: 'BPM Core',
    rank: 'admin' as const,
    isAdmin: true,
    avatar: null as MemberAvatar | null,
    memberCreatedAt: '2026-11-02T20:00:00.000Z',
    onAvatarSaved: vi.fn(),
    onEditName: vi.fn(),
    onDeleteAccount: vi.fn(),
    onBack: vi.fn(),
    ...extra,
  };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      <EditProfilePage {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe('avatarChoices', () => {
  const labels = { initial: 'Initial', myRacket: 'My racket', current: 'Current' };

  it('offers the initial, then the member’s own racket', () => {
    expect(avatarChoices(null, RACKET, labels).map((c) => c.label)).toEqual(['Initial', 'My racket']);
  });

  it('keeps a racket worn today that is not theirs, so choosing never loses it', () => {
    const other: MemberAvatar = { kind: 'racket', racketId: 'racket-li-ning-3d-calibar-900' };
    const out = avatarChoices(other, RACKET, labels);
    expect(out.map((c) => c.label)).toEqual(['Initial', 'My racket', 'Current']);
    expect(out[2].avatar).toEqual(other);
  });

  it('offers only the initial when there is no racket on the set-up', () => {
    expect(avatarChoices(null, null, labels)).toHaveLength(1);
  });
});

describe('fmtMemberSince', () => {
  it('reads the month and year in Vancouver time and the app’s locale', () => {
    // 2026-12-01T05:00Z is still November 30 in Vancouver.
    expect(fmtMemberSince('2026-12-01T05:00:00.000Z', 'en')).toBe('November 2026');
  });

  it('is null for a missing or broken date', () => {
    expect(fmtMemberSince(null, 'en')).toBeNull();
    expect(fmtMemberSince('not a date', 'en')).toBeNull();
  });
});

describe('EditProfilePage', () => {
  it('shows the picture, the club card and the delete row', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Edit profile' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Yours' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Birdies' })).toBeTruthy();
    expect(screen.getAllByRole('radio', { name: /birdie$/ }).map((r) => r.getAttribute('aria-label'))).toEqual([
      'Green birdie', 'Yellow birdie', 'Pink birdie', 'Blue birdie', 'Purple birdie', 'Orange birdie',
    ]);
    expect(screen.getByRole('radio', { name: 'Your initial' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'My racket' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('BPM Core')).toBeTruthy();
    expect(screen.getByText('Display name')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByText('Mark payments and settle the bill')).toBeTruthy();
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete my account/ })).toBeTruthy();
  });

  it('a player sees what a player can do; an unknown rank shows no role row', () => {
    renderPage({ rank: 'member', isAdmin: false });
    expect(screen.getByText('Player')).toBeTruthy();
    expect(screen.getByText('Ask for a restring')).toBeTruthy();
    cleanup();
    renderPage({ rank: null, isAdmin: false });
    expect(screen.queryByText('Account role')).toBeNull();
  });

  it('saves a picture on tap, with no Save button', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const props = renderPage();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'My racket' }));
    });
    // Other reads may share the stub (the avatar cache); the save is the one PATCH.
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patches).toHaveLength(1);
    const [url, init] = patches[0];
    expect(String(url)).toMatch(/\/api\/members\/me$/);
    expect(JSON.parse(init.body)).toEqual({ name: 'Lin', avatar: { kind: 'racket', racketId: RACKET } });
    expect(props.onAvatarSaved).toHaveBeenCalledWith({ kind: 'racket', racketId: RACKET });
    expect(screen.getByRole('radio', { name: 'My racket' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Picture saved')).toBeTruthy();
  });

  it('saves a birdie the same way, and only one picture is ever checked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const props = renderPage({ avatar: { kind: 'racket', racketId: RACKET } });
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Blue birdie' }));
    });
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patch![1].body).avatar).toEqual({ kind: 'birdie', colour: 'blue' });
    expect(props.onAvatarSaved).toHaveBeenCalledWith({ kind: 'birdie', colour: 'blue' });
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.map((r) => r.getAttribute('aria-label'))).toEqual(['Blue birdie']);
  });

  it('puts the old picture back and says so when the save fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const props = renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'My racket' }));
    });
    expect(screen.getByRole('radio', { name: 'Your initial' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't save your picture/);
    expect(props.onAvatarSaved).not.toHaveBeenCalled();
  });

  it('tapping the picture already worn sends nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Your initial' }));
    });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  });

  it('points to Equipment when there is no racket to wear', () => {
    gearState.value = { active: null, loaded: true };
    renderPage();
    expect(screen.queryByRole('radio', { name: 'My racket' })).toBeNull();
    expect(screen.getByText(/Add your racket under Stats/)).toBeTruthy();
  });

  it('the name row and the delete row hand off to their own flows', () => {
    const props = renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Display name/ }));
    expect(props.onEditName).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    expect(props.onDeleteAccount).toHaveBeenCalledOnce();
  });
});
