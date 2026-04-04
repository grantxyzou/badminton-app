import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST, DELETE } from '@/app/api/admin/route';
import {
  resetMockStore,
  setupAdminPin,
  getTestPin,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
  adminCookieValue,
} from './helpers';

// ---- TESTS ----

describe('POST /api/admin (login)', () => {
  // ARRANGE (shared): reset store and pin before every test so each
  // starts from a clean, known state — same idea as resetting a prototype
  // before each usability session.
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  // TEST 1: The happy path — correct PIN returns success and a cookie
  it('returns 200 and success:true with Set-Cookie on correct PIN', async () => {
    // ARRANGE: nothing extra — setupAdminPin already loaded the correct PIN

    // ACT
    const res = await POST(makeRequest('POST', 'http://localhost:3000/api/admin', { pin: getTestPin() }));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // The Set-Cookie header must be present so the browser can persist the session
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('admin_session=');
  });

  // TEST 2: Wrong PIN — rejected
  it('returns 401 on wrong PIN', async () => {
    // ACT
    const res = await POST(makeRequest('POST', 'http://localhost:3000/api/admin', { pin: 'wrong-pin' }));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(401);
    expect(data.error).toBeDefined();
  });

  // TEST 3: Empty string PIN — rejected without leaking timing info
  it('returns 401 on empty PIN', async () => {
    // ACT
    const res = await POST(makeRequest('POST', 'http://localhost:3000/api/admin', { pin: '' }));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(401);
    expect(data.error).toBeDefined();
  });

  // TEST 4: Missing pin field entirely — should not crash, should reject
  it('returns 401 when pin field is absent', async () => {
    // ACT: body has no "pin" key at all
    const res = await POST(makeRequest('POST', 'http://localhost:3000/api/admin', {}));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(401);
    expect(data.error).toBeDefined();
  });
});

// ---- GET ----

describe('GET /api/admin (auth check)', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  // TEST 5: No cookie → not authenticated
  it('returns { authed: false } without a cookie', async () => {
    // ACT: plain request, no Cookie header
    const res = await GET(makeGetRequest('http://localhost:3000/api/admin'));
    const data = await res.json();

    // ASSERT
    expect(data.authed).toBe(false);
  });

  // TEST 6: Valid admin cookie → authenticated
  it('returns { authed: true } with a valid admin cookie', async () => {
    // ACT: admin request includes the correct hashed cookie value
    const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/admin'));
    const data = await res.json();

    // ASSERT
    expect(data.authed).toBe(true);
  });
});

// ---- DELETE ----

describe('DELETE /api/admin (logout)', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  // TEST 7: Logout with valid admin cookie → 200 and success:true
  it('returns 200 and success:true when logged out as admin', async () => {
    // ACT
    const res = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/admin'));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
