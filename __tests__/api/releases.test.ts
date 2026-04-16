import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST, DELETE } from '../../app/api/releases/route';
import { NextRequest } from 'next/server';
import { resetMockStore, makeAdminRequest, makeRequest, setupAdminPin } from '../helpers';

setupAdminPin();

function makeGetRequest(): NextRequest {
  return makeRequest('GET', 'http://localhost/api/releases');
}

function makePostRequest(body: unknown, opts: { admin?: boolean } = { admin: true }): NextRequest {
  if (opts.admin) {
    return makeAdminRequest('POST', 'http://localhost/api/releases', body as Record<string, unknown>);
  }
  return makeRequest('POST', 'http://localhost/api/releases', body as Record<string, unknown>);
}

function makeDeleteRequest(id: string, opts: { admin?: boolean } = { admin: true }): NextRequest {
  if (opts.admin) {
    return makeAdminRequest('DELETE', 'http://localhost/api/releases', { id });
  }
  return makeRequest('DELETE', 'http://localhost/api/releases', { id });
}

const validBody = {
  version: 'v0.1.0',
  title: { en: 'First release', 'zh-CN': '首次发布' },
  body: { en: 'initial content', 'zh-CN': '初始内容' },
};

describe('/api/releases', () => {
  beforeEach(() => {
    resetMockStore();
  });

  it('GET returns array (public)', async () => {
    const res = await GET(makeGetRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('POST creates release with admin auth', async () => {
    const res = await POST(makePostRequest(validBody));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.version).toBe('v0.1.0');
    expect(data.title.en).toBe('First release');
    expect(data.publishedAt).toBeTruthy();
    expect(data.id).toMatch(/^release-/);
  });

  it('POST rejected without admin auth (401)', async () => {
    const res = await POST(makePostRequest(validBody, { admin: false }));
    expect(res.status).toBe(401);
  });

  it('POST validates required fields', async () => {
    const res = await POST(makePostRequest({ version: 'v0.1.0', title: { en: 'X' } }));
    expect(res.status).toBe(400);
  });

  it('GET returns releases sorted newest-first', async () => {
    await POST(makePostRequest({ ...validBody, version: 'v0.1.0' }));
    await new Promise(r => setTimeout(r, 5));
    await POST(makePostRequest({ ...validBody, version: 'v0.2.0' }));
    const res = await GET(makeGetRequest());
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].version).toBe('v0.2.0');
    expect(data[1].version).toBe('v0.1.0');
  });

  it('DELETE removes release with admin auth', async () => {
    const created = await (await POST(makePostRequest(validBody))).json();
    const delRes = await DELETE(makeDeleteRequest(created.id));
    expect(delRes.status).toBe(200);
    const list = await (await GET(makeGetRequest())).json();
    expect(list).toHaveLength(0);
  });

  it('DELETE rejected without admin auth (401)', async () => {
    const created = await (await POST(makePostRequest(validBody))).json();
    const delRes = await DELETE(makeDeleteRequest(created.id, { admin: false }));
    expect(delRes.status).toBe(401);
  });
});
