import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/report/route';
import { resetMockStore, makeRequest, getStore } from './helpers';

const URL = 'http://localhost:3000/api/report';

describe('POST /api/report — in-app problem reports', () => {
  beforeEach(() => {
    resetMockStore();
  });

  it('stores a valid report and returns 201', async () => {
    const res = await POST(
      makeRequest('POST', URL, { message: 'Sign-up button does nothing', name: 'Lin' }),
    );
    expect(res.status).toBe(201);

    const store = getStore();
    expect(store['feedback']?.length).toBe(1);
    const saved = store['feedback'][0] as Record<string, unknown>;
    expect(saved.message).toBe('Sign-up button does nothing');
    expect(saved.name).toBe('Lin');
    expect(typeof saved.createdAt).toBe('string');
    expect(typeof saved.id).toBe('string');
  });

  it('rejects an empty / whitespace-only message with 400', async () => {
    const res = await POST(makeRequest('POST', URL, { message: '   ' }));
    expect(res.status).toBe(400);
    expect(getStore()['feedback'] ?? []).toHaveLength(0);
  });

  it('rejects an over-long message with 400', async () => {
    const res = await POST(makeRequest('POST', URL, { message: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(getStore()['feedback'] ?? []).toHaveLength(0);
  });

  it('captures optional context (tab, name) but tolerates its absence', async () => {
    const res = await POST(makeRequest('POST', URL, { message: 'broke on stats', tab: 'skills' }));
    expect(res.status).toBe(201);
    const saved = getStore()['feedback'][0] as Record<string, unknown>;
    expect(saved.tab).toBe('skills');
    expect(saved.name).toBeUndefined();
  });

  it('succeeds even when email is not configured — store is the source of truth', async () => {
    // No GMAIL_* env in the test environment, so the notifier no-ops. The
    // request must still persist the report and report success — never a
    // silent failure that drops a friend's message.
    const res = await POST(makeRequest('POST', URL, { message: 'something is broken' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(getStore()['feedback']).toHaveLength(1);
  });

  it('rate-limits abusive repeats from a single IP', async () => {
    const ip = 'report-abuse-test';
    const mk = () => makeRequest('POST', URL, { message: 'spam' }, { 'X-Client-IP': ip });
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await POST(mk())).status;
    }
    expect(last).toBe(429);
  });
});
