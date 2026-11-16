import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/legal/[doc]/route';

/** The legal copy as data, for the marketing site (one copy, two surfaces). */
let ip = 0;
function call(doc: string, query = '') {
  const req = new NextRequest(`http://localhost/bpm/api/legal/${doc}${query}`, {
    headers: { 'x-client-ip': `10.77.0.${++ip}` },
  });
  return GET(req, { params: Promise.resolve({ doc }) });
}

afterEach(() => {
  delete process.env.SUPPORT_EMAIL;
});

describe('GET /api/legal/[doc]', () => {
  it('privacy: title, date and sections, with the brand filled in', async () => {
    const res = await call('privacy');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBeTruthy();
    expect(body.updatedLabel).toContain(body.updated);
    expect(body.sections.length).toBeGreaterThan(2);
    for (const s of body.sections) {
      expect(typeof s.h).toBe('string');
      expect(Array.isArray(s.p)).toBe(true);
    }
    expect(JSON.stringify(body)).not.toMatch(/%APP/);
    expect(res.headers.get('cache-control')).toContain('public');
  });

  it('terms in Chinese', async () => {
    const body = await (await call('terms', '?locale=zh-CN')).json();
    expect(body.locale).toBe('zh-CN');
    expect(body.title).toMatch(/[一-鿿]/);
  });

  it('support carries the operator address only when set', async () => {
    expect((await (await call('support')).json()).supportEmail).toBeNull();
    process.env.SUPPORT_EMAIL = 'help@example.test';
    const body = await (await call('support')).json();
    expect(body.supportEmail).toBe('help@example.test');
    expect(body.emailLabel).toBeTruthy();
    expect((await (await call('privacy')).json()).supportEmail).toBeNull();
  });

  it('anything else is a 404', async () => {
    expect((await call('help')).status).toBe(404);
    expect((await call('__proto__')).status).toBe(404);
  });
});
