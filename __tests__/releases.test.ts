import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST, PATCH, DELETE } from '@/app/api/releases/route';
import {
  resetMockStore,
  setupAdminPin,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
} from './helpers';

function releaseBody(version = 'v1.0.0') {
  return {
    version,
    title: { en: 'Hello', 'zh-CN': '你好' },
    body: { en: '• First bullet', 'zh-CN': '• 第一条' },
  };
}

describe('POST /api/releases', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  it('creates a release with env stamp when admin', async () => {
    const res = await POST(
      makeAdminRequest('POST', 'http://localhost:3000/api/releases', releaseBody()),
    );
    expect(res.status).toBe(200);
    const rec = await res.json();
    expect(rec.version).toBe('v1.0.0');
    expect(rec.publishedAt).toBeTruthy();
    expect(rec.id).toMatch(/^release-/);
  });

  it('rejects non-admin', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost:3000/api/releases', releaseBody()),
    );
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/releases', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  it('updates existing record and stamps editedAt', async () => {
    const postRes = await POST(
      makeAdminRequest('POST', 'http://localhost:3000/api/releases', releaseBody('v1.0.0')),
    );
    const created = await postRes.json();
    expect(created.id).toBeTruthy();
    expect(created.editedAt).toBeUndefined();

    const patchRes = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/releases', {
        id: created.id,
        version: 'v1.0.0',
        title: { en: 'Updated title', 'zh-CN': '更新标题' },
        body: { en: '• fixed typo', 'zh-CN': '• 修正' },
      }),
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.title.en).toBe('Updated title');
    expect(updated.body.en).toBe('• fixed typo');
    expect(updated.editedAt).toBeTruthy();
    // publishedAt preserved
    expect(updated.publishedAt).toBe(created.publishedAt);
  });

  it('rejects non-admin', async () => {
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost:3000/api/releases', {
        id: 'whatever',
        ...releaseBody(),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when id is missing', async () => {
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/releases', releaseBody()),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when record not found', async () => {
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/releases', {
        id: 'release-does-not-exist',
        ...releaseBody(),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/releases after PATCH', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  it('returns the edited version after PATCH', async () => {
    const postRes = await POST(
      makeAdminRequest('POST', 'http://localhost:3000/api/releases', releaseBody('v1.0.0')),
    );
    const created = await postRes.json();

    await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/releases', {
        id: created.id,
        version: 'v1.0.0',
        title: { en: 'Edited', 'zh-CN': '已编辑' },
        body: { en: '• updated', 'zh-CN': '• 更新' },
      }),
    );

    const listRes = await GET(makeGetRequest('http://localhost:3000/api/releases'));
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].title.en).toBe('Edited');
  });
});

describe('DELETE /api/releases', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  it('deletes a release when admin', async () => {
    const postRes = await POST(
      makeAdminRequest('POST', 'http://localhost:3000/api/releases', releaseBody()),
    );
    const created = await postRes.json();
    const res = await DELETE(
      makeAdminRequest('DELETE', 'http://localhost:3000/api/releases', { id: created.id }),
    );
    expect(res.status).toBe(200);
  });
});
