// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import MemberAvatar from '../../components/primitives/MemberAvatar';
import { racketSrc } from '../../lib/racketLook';
import { racketAvatarIds } from '../../lib/memberAvatar';
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
    expect(container.querySelector('img')?.getAttribute('src')).toBe(racketSrc(RACKET));
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
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(racketSrc(RACKET)));
  });

  it('a save shows up at once, everywhere the name is drawn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { container } = render(<MemberAvatar name="Kento" />);
    expect(container.querySelector('img')).toBeNull();
    setMemberAvatar('Kento', { kind: 'racket', racketId: RACKET });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
  });
});
