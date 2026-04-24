import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/announcements/route';
import {
  resetMockStore,
  setupAdminPin,
  makeRequest,
  makeAdminRequest,
  seedPointer,
  seedSession,
} from './helpers';

describe('POST /api/announcements — markdown round-trip', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer('session-2026-04-24');
    seedSession('session-2026-04-24');
  });

  it('stores markdown text verbatim and returns it through GET unchanged', async () => {
    const markdown = 'Heads up **tonight**\n\n- *Arrive early*\n- Bring water';

    const postRes = await POST(
      makeAdminRequest('POST', 'http://localhost:3000/api/announcements', { text: markdown }),
    );
    expect(postRes.status).toBe(201);

    const getRes = await GET();
    const list = await getRes.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);
    expect(list[0].text).toBe(markdown);
  });

  it('accepts up to 800 chars', async () => {
    const longText = 'x'.repeat(800);
    const res = await POST(
      makeAdminRequest('POST', 'http://localhost:3000/api/announcements', { text: longText }),
    );
    expect(res.status).toBe(201);
  });

  it('rejects over 800 chars', async () => {
    const tooLong = 'x'.repeat(801);
    const res = await POST(
      makeAdminRequest('POST', 'http://localhost:3000/api/announcements', { text: tooLong }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-admin', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost:3000/api/announcements', { text: 'hello' }),
    );
    expect(res.status).toBe(401);
  });
});
