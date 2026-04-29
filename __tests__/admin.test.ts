import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, POST, DELETE } from '@/app/api/admin/route';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  getTestPin,
  getTestAdminName,
  seedMember,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
  getStore,
} from './helpers';

const URL_PATH = 'http://localhost:3000/api/admin';

describe('POST /api/admin (login) — unified per-player auth', () => {
  beforeEach(async () => {
    setupAdminPin();
    resetMockStore();
    await seedTestAdminMember();
  });

  afterEach(() => {
    delete process.env.ADMIN_NAMES;
  });

  it('returns 200 + Set-Cookie for the seeded admin Member with correct name + PIN', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: getTestAdminName(), pin: getTestPin() }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.name).toBe(getTestAdminName());
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('admin_session=');
  });

  it('returns 401 on wrong PIN', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: getTestAdminName(), pin: '9999' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 on unknown name (constant-time miss path)', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Nobody', pin: getTestPin() }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when name is missing', async () => {
    const res = await POST(makeRequest('POST', URL_PATH, { pin: getTestPin() }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when PIN is missing', async () => {
    const res = await POST(makeRequest('POST', URL_PATH, { name: getTestAdminName() }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when PIN is malformed (not 4 digits)', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: getTestAdminName(), pin: '123' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when member exists with role=member (no auto-promotion without ADMIN_NAMES)', async () => {
    resetMockStore();
    setupAdminPin();
    seedMember('Casual Carol', { pinHash: 'unused' });
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casual Carol', pin: getTestPin() }),
    );
    expect(res.status).toBe(401);
  });

  describe('ADMIN_NAMES bootstrap', () => {
    it('promotes a non-admin member to admin when their name is in ADMIN_NAMES + correct PIN', async () => {
      resetMockStore();
      setupAdminPin();
      const { hashPin } = await import('../lib/recoveryHash');
      const pinHash = await hashPin(getTestPin());
      seedMember('Bootstrap Bob', { pinHash });
      process.env.ADMIN_NAMES = 'Bootstrap Bob, someone-else';
      try {
        const res = await POST(
          makeRequest('POST', URL_PATH, { name: 'Bootstrap Bob', pin: getTestPin() }),
        );
        expect(res.status).toBe(200);
        const store = getStore();
        const member = (store['members'] as Array<{ name: string; role: string }>).find(
          (m) => m.name === 'Bootstrap Bob',
        );
        expect(member?.role).toBe('admin');
      } finally {
        delete process.env.ADMIN_NAMES;
      }
    });

    it('still 401s when name is in ADMIN_NAMES but PIN is wrong', async () => {
      resetMockStore();
      setupAdminPin();
      const { hashPin } = await import('../lib/recoveryHash');
      const pinHash = await hashPin('1357');
      seedMember('Bootstrap Bob', { pinHash });
      process.env.ADMIN_NAMES = 'Bootstrap Bob';
      try {
        const res = await POST(
          makeRequest('POST', URL_PATH, { name: 'Bootstrap Bob', pin: getTestPin() }),
        );
        expect(res.status).toBe(401);
      } finally {
        delete process.env.ADMIN_NAMES;
      }
    });

    it('returns 401 when ADMIN_NAMES is empty (no bootstrap path)', async () => {
      resetMockStore();
      setupAdminPin();
      const { hashPin } = await import('../lib/recoveryHash');
      const pinHash = await hashPin(getTestPin());
      seedMember('Casual Carol', { pinHash });
      delete process.env.ADMIN_NAMES;
      const res = await POST(
        makeRequest('POST', URL_PATH, { name: 'Casual Carol', pin: getTestPin() }),
      );
      expect(res.status).toBe(401);
    });
  });
});

describe('GET /api/admin (auth check)', () => {
  beforeEach(async () => {
    setupAdminPin();
    resetMockStore();
    await seedTestAdminMember();
  });

  it('returns { authed: false } without a cookie', async () => {
    const res = await GET(makeGetRequest(URL_PATH));
    const data = await res.json();
    expect(data.authed).toBe(false);
  });

  it('returns { authed: true, name } with a valid admin cookie', async () => {
    const res = await GET(makeAdminRequest('GET', URL_PATH));
    const data = await res.json();
    expect(data.authed).toBe(true);
    expect(data.name).toBe(getTestAdminName());
  });

  it('returns { authed: false } when cookie is valid but Member is demoted', async () => {
    const store = getStore();
    const members = store['members'] as Array<{ id: string; role: string }>;
    const admin = members.find((m) => m.id === 'member-test-admin');
    if (admin) admin.role = 'member';
    const res = await GET(makeAdminRequest('GET', URL_PATH));
    const data = await res.json();
    expect(data.authed).toBe(false);
  });

  it('returns { authed: false } when cookie is valid but Member was deactivated', async () => {
    const store = getStore();
    const members = store['members'] as Array<{ id: string; active: boolean }>;
    const admin = members.find((m) => m.id === 'member-test-admin');
    if (admin) admin.active = false;
    const res = await GET(makeAdminRequest('GET', URL_PATH));
    const data = await res.json();
    expect(data.authed).toBe(false);
  });
});

describe('DELETE /api/admin (logout)', () => {
  beforeEach(async () => {
    setupAdminPin();
    resetMockStore();
    await seedTestAdminMember();
  });

  it('returns 200 and success:true when logged out as admin', async () => {
    const res = await DELETE(makeAdminRequest('DELETE', URL_PATH));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('returns 401 without a cookie', async () => {
    const res = await DELETE(makeRequest('DELETE', URL_PATH));
    expect(res.status).toBe(401);
  });
});
