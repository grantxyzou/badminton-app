// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import MemberAvatar from '../../components/primitives/MemberAvatar';
import { racketAvatarSrc, racketSrc } from '../../lib/racketLook';
import { birdieSrc, racketAvatarIds } from '../../lib/memberAvatar';
import { resetMemberAvatars, setMemberAvatar } from '../../lib/useMemberAvatars';

const RACKET = racketAvatarIds()[0];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetMemberAvatars();
});

describe('MemberAvatar', () => {
  it('draws the racket head when the member picked one', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { container } = render(<MemberAvatar name="Lin" avatar={{ kind: 'racket', racketId: RACKET }} />);
    // A roster-sized circle takes the head crop (~3 KB, not the ~18 KB picture).
    expect(container.querySelector('img')?.getAttribute('src')).toBe(racketAvatarSrc(RACKET));
  });

  it('a large circle (Profile’s) keeps the full picture so it stays sharp', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { container } = render(<MemberAvatar name="Lin" size={112} avatar={{ kind: 'racket', racketId: RACKET }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(racketSrc(RACKET));
  });

  it('draws a birdie as its own picture, filling the circle', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { container } = render(<MemberAvatar name="Lin" avatar={{ kind: 'birdie', colour: 'orange' }} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(birdieSrc('orange'));
    expect(img?.className).toBe('member-avatar__birdie');
    const circle = container.querySelector('.member-avatar') as HTMLElement;
    expect(circle.dataset.avatar).toBe('birdie');
    // The picture carries its own ground; no per-name colour behind it.
    expect(circle.style.background).toBe('');
  });

  it('draws the initial otherwise', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { container } = render(<MemberAvatar name="viktor" avatar={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('V');
  });

  it('looks a name up from the roster when the caller has no avatar to give', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ name: 'Akane', active: true, avatar: { kind: 'racket', racketId: RACKET } }] }),
    );
    const { container } = render(<MemberAvatar name="akane" />);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(racketAvatarSrc(RACKET)));
  });

  it('a save shows up at once, everywhere the name is drawn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { container } = render(<MemberAvatar name="Kento" />);
    expect(container.querySelector('img')).toBeNull();
    setMemberAvatar('Kento', { kind: 'racket', racketId: RACKET });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
  });
});
