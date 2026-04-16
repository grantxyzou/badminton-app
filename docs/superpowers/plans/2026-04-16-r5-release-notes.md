# R5 — Release Notes with AI-Assisted Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship admin-authored, AI-drafted bilingual release notes rendered in a VS Code terminal-styled bottom sheet, with a subtle always-visible version trigger on HomeTab.

**Architecture:** New `releases` Cosmos container (global PK `/id`) holds release records with bilingual title/body baked in at write-time. Admin UI reuses existing `/api/claude` endpoint for one-shot structured JSON drafting. Player surface renders an unread-aware version trigger under the page title that opens a theme-aware monospace sheet.

**Tech Stack:** Next.js 16 (App Router), React 18, Cosmos DB, `@anthropic-ai/sdk` via existing `/api/claude`, Vitest 4, `@testing-library/react`.

---

## Spec reference
Design: `docs/superpowers/specs/2026-04-16-r5-release-notes-design.md`

## Project conventions
- Vitest default env is `node`. Component tests require `// @vitest-environment jsdom` docblock.
- Vitest globals NOT configured — import `describe`, `it`, `expect`, `afterEach` explicitly from `vitest`.
- Component tests manually call `afterEach(cleanup)`.
- Components using `useTranslations()` must render inside `<NextIntlClientProvider>` in tests.
- New Cosmos containers use the `ensureContainer(name, partitionKeyPath)` lazy-promise pattern. Reference: `app/api/skills/route.ts`.
- Test helpers in `__tests__/helpers.ts`. Each API test gets a unique IP via `X-Client-IP`.
- Commit style: lowercase type prefix (`feat`, `fix`, `test`, `docs`), Co-Authored-By footer, HEREDOC formatting.
- Run `npm test` between tasks to verify no regressions.

---

### Task 1: Add Release type and i18n keys

**Files:**
- Modify: `lib/types.ts` (add `Release` type)
- Modify: `messages/en.json` (+6 keys)
- Modify: `messages/zh-CN.json` (+6 keys)

- [ ] **Step 1: Add `Release` type to `lib/types.ts`**

Add at the end of the file:

```ts
export interface Release {
  id: string;
  version: string;
  title: {
    en: string;
    'zh-CN': string;
  };
  body: {
    en: string;
    'zh-CN': string;
  };
  publishedAt: string;
  publishedBy: 'admin';
}
```

- [ ] **Step 2: Add i18n keys to `messages/en.json`**

Inside the top-level `"home"` object, add a new `"releases"` section as a sibling of the existing sections:

```json
"releases": {
  "whatsNew": "What's new in {version}",
  "sheetLabel": "Release history",
  "close": "Close"
}
```

Add a NEW top-level `"admin"` section as a sibling of `"home"`:

```json
"admin": {
  "releases": {
    "newButton": "New release",
    "draftWithAI": "Draft with AI",
    "publish": "Publish"
  }
}
```

- [ ] **Step 3: Add matching keys to `messages/zh-CN.json`**

Inside `"home"`:

```json
"releases": {
  "whatsNew": "{version} 有新内容",
  "sheetLabel": "发布历史",
  "close": "关闭"
}
```

Top-level `"admin"` section:

```json
"admin": {
  "releases": {
    "newButton": "新发布",
    "draftWithAI": "用 AI 起草",
    "publish": "发布"
  }
}
```

- [ ] **Step 4: Verify JSON parses and tests pass**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8')); console.log('ok')"
```
Expected: `ok`

Run: `npm test`
Expected: 178 tests still pass (no new tests yet).

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts messages/en.json messages/zh-CN.json
git commit -m "$(cat <<'EOF'
feat: add Release type and i18n keys for release notes (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create `/api/releases` route with GET/POST/DELETE (TDD)

**Files:**
- Create: `app/api/releases/route.ts`
- Create: `__tests__/api/releases.test.ts`

- [ ] **Step 1: Write failing test `__tests__/api/releases.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST, DELETE } from '../../app/api/releases/route';
import { NextRequest } from 'next/server';
import { resetMockStore } from '../helpers';
import { createHash } from 'crypto';

const ADMIN_PIN = process.env.ADMIN_PIN ?? '9999';
const ADMIN_PIN_HASH = createHash('sha256').update(ADMIN_PIN).digest('hex');

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/releases', {
    headers: { 'X-Client-IP': `test-${Math.random()}` },
  });
}

function makePostRequest(body: unknown, opts: { admin?: boolean } = { admin: true }): NextRequest {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Client-IP': `test-${Math.random()}`,
  });
  if (opts.admin) headers.set('cookie', `admin_auth=${ADMIN_PIN_HASH}`);
  return new NextRequest('http://localhost/api/releases', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string, opts: { admin?: boolean } = { admin: true }): NextRequest {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Client-IP': `test-${Math.random()}`,
  });
  if (opts.admin) headers.set('cookie', `admin_auth=${ADMIN_PIN_HASH}`);
  return new NextRequest('http://localhost/api/releases', {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ id }),
  });
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

  it('GET returns array (public, no auth required)', async () => {
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
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run __tests__/api/releases.test.ts`
Expected: FAIL — `Cannot find module '../../app/api/releases/route'`.

- [ ] **Step 3: Implement `app/api/releases/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Lazy container bootstrap — real Cosmos doesn't auto-create containers.
let releasesReady: Promise<void> | null = null;
function ensureReleasesContainer(): Promise<void> {
  if (!releasesReady) {
    releasesReady = ensureContainer('releases', '/id').catch((err) => {
      releasesReady = null;
      throw err;
    });
  }
  return releasesReady;
}

interface ReleaseBody {
  version: string;
  title: { en: string; 'zh-CN': string };
  body: { en: string; 'zh-CN': string };
}

function validateReleaseBody(raw: unknown): ReleaseBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || !r.version.trim()) return null;
  const title = r.title as Record<string, unknown> | undefined;
  const body = r.body as Record<string, unknown> | undefined;
  if (!title || typeof title.en !== 'string' || typeof title['zh-CN'] !== 'string') return null;
  if (!body || typeof body.en !== 'string' || typeof body['zh-CN'] !== 'string') return null;
  return {
    version: r.version.trim(),
    title: { en: title.en, 'zh-CN': title['zh-CN'] },
    body: { en: body.en, 'zh-CN': body['zh-CN'] },
  };
}

export async function GET(_req: NextRequest) {
  try {
    await ensureReleasesContainer();
    const container = getContainer('releases');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c ORDER BY c.publishedAt DESC',
      })
      .fetchAll();
    return NextResponse.json(resources);
  } catch (error) {
    console.error('GET releases error:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await ensureReleasesContainer();
    const raw = await req.json();
    const validated = validateReleaseBody(raw);
    if (!validated) {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 });
    }

    const publishedAt = new Date().toISOString();
    const id = `release-${publishedAt.slice(0, 10)}-${validated.version}-${randomBytes(4).toString('hex')}`;

    const record = {
      id,
      version: validated.version,
      title: validated.title,
      body: validated.body,
      publishedAt,
      publishedBy: 'admin' as const,
    };

    const container = getContainer('releases');
    await container.items.create(record);
    return NextResponse.json(record);
  } catch (error) {
    console.error('POST releases error:', error);
    return NextResponse.json({ error: 'Failed to create release' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await ensureReleasesContainer();
    const { id } = await req.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    const container = getContainer('releases');
    await container.item(id, id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE releases error:', error);
    return NextResponse.json({ error: 'Failed to delete release' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/api/releases.test.ts`
Expected: 7 tests PASS.

Run: `npm test`
Expected: 185 tests pass (178 prior + 7 new).

- [ ] **Step 5: Commit**

```bash
git add app/api/releases/route.ts __tests__/api/releases.test.ts
git commit -m "$(cat <<'EOF'
feat: add /api/releases route with GET/POST/DELETE (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add terminal CSS to `globals.css`

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add CSS variables for dark theme**

Inside the existing `[data-theme="dark"]` (or top-level `:root`) block in `globals.css`, locate the existing custom properties section. Add these new variables alongside them:

```css
  /* Release notes terminal — dark */
  --terminal-bg: #0f1116;
  --terminal-titlebar-bg: #1e2128;
  --terminal-prompt: #6b7280;
  --terminal-accent: #f0d079;
  --terminal-date: #9ca3af;
  --terminal-title: #e5e7eb;
  --terminal-body: #d1d5db;
```

- [ ] **Step 2: Add CSS variables for light theme**

Inside the `[data-theme="light"]` block, add:

```css
  /* Release notes terminal — light */
  --terminal-bg: #ffffff;
  --terminal-titlebar-bg: #e5e7eb;
  --terminal-prompt: #6b7280;
  --terminal-accent: #b8942d;
  --terminal-date: #6b7280;
  --terminal-title: #1a2332;
  --terminal-body: #374151;
```

- [ ] **Step 3: Add terminal component classes**

Add at the end of `globals.css`, after any existing component blocks:

```css
/* ── Release notes terminal sheet ── */
.terminal-sheet {
  background: var(--terminal-bg);
  color: var(--terminal-body);
  font-family: 'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace;
  font-size: 14px;
  line-height: 1.6;
  letter-spacing: -0.01em;
}

.terminal-titlebar {
  background: var(--terminal-titlebar-bg);
  padding: 8px 16px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.terminal-prompt  { color: var(--terminal-prompt); }
.terminal-version { color: var(--terminal-accent); font-weight: 600; }
.terminal-date    { color: var(--terminal-date); }
.terminal-title   { color: var(--terminal-title); font-weight: 600; }
.terminal-body    { color: var(--terminal-body); }

.terminal-accent-text { color: var(--terminal-accent); }
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds with no CSS errors.

Run: `npm test`
Expected: 185 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "$(cat <<'EOF'
feat: add terminal-themed CSS variables and component classes (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create `ReleaseNotesSheet` component (TDD)

**Files:**
- Create: `components/ReleaseNotesSheet.tsx`
- Create: `__tests__/components/ReleaseNotesSheet.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ReleaseNotesSheet from '../../components/ReleaseNotesSheet';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';
import type { Release } from '../../lib/types';

const sampleReleases: Release[] = [
  {
    id: 'r-2',
    version: 'v0.2.0',
    title: { en: 'Second', 'zh-CN': '第二个' },
    body: { en: 'Content two', 'zh-CN': '内容二' },
    publishedAt: '2026-04-15T10:00:00Z',
    publishedBy: 'admin',
  },
  {
    id: 'r-1',
    version: 'v0.1.0',
    title: { en: 'First', 'zh-CN': '第一个' },
    body: { en: 'Content one', 'zh-CN': '内容一' },
    publishedAt: '2026-04-14T10:00:00Z',
    publishedBy: 'admin',
  },
];

function renderSheet(opts: { locale?: 'en' | 'zh-CN'; open?: boolean; releases?: Release[]; onClose?: () => void } = {}) {
  const { locale = 'en', open = true, releases = sampleReleases, onClose = vi.fn() } = opts;
  const messages = locale === 'en' ? enMessages : zhMessages;
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ReleaseNotesSheet open={open} releases={releases} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe('ReleaseNotesSheet', () => {
  afterEach(() => {
    cleanup();
    document.cookie = 'NEXT_LOCALE=; path=/bpm; max-age=0';
    localStorage.removeItem('badminton_last_read_release');
  });

  it('renders full history in EN', () => {
    renderSheet({ locale: 'en' });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText(/Content one/)).toBeTruthy();
    expect(screen.getByText(/Content two/)).toBeTruthy();
  });

  it('renders in zh-CN locale', () => {
    renderSheet({ locale: 'zh-CN' });
    expect(screen.getByText('第一个')).toBeTruthy();
    expect(screen.getByText('第二个')).toBeTruthy();
  });

  it('writes latest version to localStorage on close', () => {
    const onClose = renderSheet({ locale: 'en' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(localStorage.getItem('badminton_last_read_release')).toBe('v0.2.0');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    renderSheet({ open: false });
    expect(screen.queryByText('First')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run __tests__/components/ReleaseNotesSheet.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `components/ReleaseNotesSheet.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Release } from '@/lib/types';

interface ReleaseNotesSheetProps {
  open: boolean;
  releases: Release[];
  onClose: () => void;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function ReleaseNotesSheet({ open, releases, onClose }: ReleaseNotesSheetProps) {
  const locale = useLocale() as 'en' | 'zh-CN';
  const t = useTranslations('home.releases');

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  function handleClose() {
    if (releases.length > 0) {
      localStorage.setItem('badminton_last_read_release', releases[0].version);
    }
    onClose();
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[55]"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-2xl overflow-hidden max-h-[80vh] terminal-sheet"
        role="dialog"
        aria-label={t('sheetLabel')}
      >
        <div className="terminal-titlebar">
          <span className="terminal-prompt">bpm-changelog</span>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('close')}
            className="terminal-prompt hover:terminal-body transition-colors"
          >
            <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
          </button>
        </div>
        <div className="overflow-y-auto p-5 pb-20" style={{ maxHeight: 'calc(80vh - 40px)' }}>
          <p className="terminal-prompt mb-4">$ bpm --changelog</p>
          <ul className="space-y-6">
            {releases.map((r) => (
              <li key={r.id}>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="terminal-version">▸ {r.version}</span>
                  <span className="terminal-date">· {fmtDate(r.publishedAt)}</span>
                </div>
                <h3 className="terminal-title mb-1">{r.title[locale]}</h3>
                <p className="terminal-body whitespace-pre-line">{r.body[locale]}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/components/ReleaseNotesSheet.test.tsx`
Expected: 4 tests PASS.

Run: `npm test`
Expected: 189 tests pass (185 prior + 4 new).

- [ ] **Step 5: Commit**

```bash
git add components/ReleaseNotesSheet.tsx __tests__/components/ReleaseNotesSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat: add ReleaseNotesSheet with terminal styling (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create `ReleaseNotesTrigger` component (TDD)

**Files:**
- Create: `components/ReleaseNotesTrigger.tsx`
- Create: `__tests__/components/ReleaseNotesTrigger.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ReleaseNotesTrigger from '../../components/ReleaseNotesTrigger';
import enMessages from '../../messages/en.json';

const sampleReleases = [
  {
    id: 'r-1',
    version: 'v0.2.0',
    title: { en: 'Second', 'zh-CN': '第二' },
    body: { en: 'x', 'zh-CN': 'x' },
    publishedAt: '2026-04-15T10:00:00Z',
    publishedBy: 'admin' as const,
  },
];

function renderTrigger(opts: { releases?: unknown[]; storedVersion?: string | null; onOpen?: () => void } = {}) {
  const { releases = sampleReleases, storedVersion = null, onOpen = vi.fn() } = opts;
  if (storedVersion === null) {
    localStorage.removeItem('badminton_last_read_release');
  } else {
    localStorage.setItem('badminton_last_read_release', storedVersion);
  }
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ReleaseNotesTrigger releases={releases as never} onOpen={onOpen} />
    </NextIntlClientProvider>,
  );
  return onOpen;
}

describe('ReleaseNotesTrigger', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem('badminton_last_read_release');
  });

  it('renders "What\'s new in v0.2.0" with sparkle when no stored version', () => {
    renderTrigger({ storedVersion: null });
    expect(screen.getByText(/What's new in v0.2.0/)).toBeTruthy();
    expect(screen.getByText(/✨/)).toBeTruthy();
  });

  it('renders "What\'s new in v0.2.0" when stored version is older', () => {
    renderTrigger({ storedVersion: 'v0.1.0' });
    expect(screen.getByText(/What's new in v0.2.0/)).toBeTruthy();
  });

  it('renders plain version when stored version matches latest', () => {
    renderTrigger({ storedVersion: 'v0.2.0' });
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.queryByText(/What's new/)).toBeNull();
    expect(screen.queryByText(/✨/)).toBeNull();
  });

  it('calls onOpen when clicked', () => {
    const onOpen = renderTrigger({});
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when releases list is empty', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ReleaseNotesTrigger releases={[]} onOpen={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run __tests__/components/ReleaseNotesTrigger.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `components/ReleaseNotesTrigger.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Release } from '@/lib/types';

interface ReleaseNotesTriggerProps {
  releases: Release[];
  onOpen: () => void;
}

export default function ReleaseNotesTrigger({ releases, onOpen }: ReleaseNotesTriggerProps) {
  const t = useTranslations('home.releases');
  const [storedVersion, setStoredVersion] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setStoredVersion(localStorage.getItem('badminton_last_read_release'));
    setMounted(true);
  }, []);

  // Re-read localStorage when releases prop changes (e.g., after sheet close)
  useEffect(() => {
    if (mounted) {
      setStoredVersion(localStorage.getItem('badminton_last_read_release'));
    }
  }, [releases, mounted]);

  if (releases.length === 0) return null;

  const latest = releases[0];
  const isUnread = storedVersion !== latest.version;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`text-xs px-2 transition-colors text-left ${
        isUnread ? 'terminal-accent-text font-semibold' : 'text-gray-400'
      }`}
    >
      {isUnread ? `✨ ${t('whatsNew', { version: latest.version })}` : latest.version}
    </button>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/components/ReleaseNotesTrigger.test.tsx`
Expected: 5 tests PASS.

Run: `npm test`
Expected: 194 tests pass (189 prior + 5 new).

- [ ] **Step 5: Commit**

```bash
git add components/ReleaseNotesTrigger.tsx __tests__/components/ReleaseNotesTrigger.test.tsx
git commit -m "$(cat <<'EOF'
feat: add ReleaseNotesTrigger with unread state (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire trigger + sheet into HomeTab

**Files:**
- Modify: `components/HomeTab.tsx`

- [ ] **Step 1: Read HomeTab structure**

Open `components/HomeTab.tsx`. Identify:
- Imports at top
- State declarations (around lines 45-60)
- Data-loading `useEffect` (around lines 60-110)
- The JSX `<div className="space-y-5">` with page title (around line 225-235)

- [ ] **Step 2: Add imports and state**

Add alongside existing component imports:

```tsx
import ReleaseNotesTrigger from './ReleaseNotesTrigger';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import type { Release } from '@/lib/types';
```

After the existing state declarations (near `const [hasIdentity, setHasIdentity] = useState(false);`), add:

```tsx
const [releases, setReleases] = useState<Release[]>([]);
const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
```

- [ ] **Step 3: Fetch releases on mount**

Inside the existing `loadData` callback, alongside the other `fetch` calls in the `Promise.all`, add:

Find the `Promise.all([...])` block (around lines 61-66):

```tsx
const [sRes, pRes, aRes, mRes] = await Promise.all([
  fetch(`${BASE}/api/session`, { cache: 'no-store' }),
  fetch(`${BASE}/api/players`, { cache: 'no-store' }),
  fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
  fetch(`${BASE}/api/members`, { cache: 'no-store' }).catch(() => null),
]);
```

Change to:

```tsx
const [sRes, pRes, aRes, mRes, rRes] = await Promise.all([
  fetch(`${BASE}/api/session`, { cache: 'no-store' }),
  fetch(`${BASE}/api/players`, { cache: 'no-store' }),
  fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
  fetch(`${BASE}/api/members`, { cache: 'no-store' }).catch(() => null),
  fetch(`${BASE}/api/releases`, { cache: 'no-store' }).catch(() => null),
]);
```

After the existing `if (aRes.ok) ...` blocks, add release loading:

```tsx
if (rRes && rRes.ok) setReleases(await rRes.json());
```

- [ ] **Step 4: Render trigger + sheet**

Inside the JSX, locate the page title `<h1>` element (the "BPM Badminton" heading). Add the trigger immediately BELOW the title (but before the tile row):

```tsx
<h1 ... >
  BPM Badminton
</h1>
<ReleaseNotesTrigger releases={releases} onOpen={() => setReleaseSheetOpen(true)} />
```

At the very end of the returned JSX, just before the final closing `</div>` of the `<div className="space-y-5">`:

```tsx
      <ReleaseNotesSheet
        open={releaseSheetOpen}
        releases={releases}
        onClose={() => setReleaseSheetOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: 194 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/HomeTab.tsx
git commit -m "$(cat <<'EOF'
feat: wire ReleaseNotesTrigger and Sheet into HomeTab (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Create admin `ReleaseForm` component

**Files:**
- Create: `components/admin/ReleaseForm.tsx`

No test file — this is a form component with network + AI integration best verified via the integration smoke check. Form validation logic is simple enough to rely on manual smoke.

- [ ] **Step 1: Add `nextPatchVersion` utility inline and implement form**

Create `components/admin/ReleaseForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Release } from '@/lib/types';

function nextPatchVersion(current: string | undefined): string {
  if (!current) return 'v0.1.0';
  const m = current.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return 'v0.1.0';
  const [, major, minor, patch] = m;
  return `v${major}.${minor}.${parseInt(patch, 10) + 1}`;
}

interface ReleaseFormProps {
  latestVersion: string | undefined;
  onPublished: (release: Release) => void;
  onCancel: () => void;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function ReleaseForm({ latestVersion, onPublished, onCancel }: ReleaseFormProps) {
  const t = useTranslations('admin.releases');
  const [version, setVersion] = useState(() => nextPatchVersion(latestVersion));
  const [rawNotes, setRawNotes] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [titleZh, setTitleZh] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyZh, setBodyZh] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  async function draftWithAI() {
    if (!rawNotes.trim()) {
      setError('Paste some raw notes first.');
      return;
    }
    setDrafting(true);
    setError('');
    try {
      const prompt = `You are drafting a release note for a badminton session app.
Given these raw notes, produce a JSON object with:
  - title_en: short friendly title in English (max 8 words)
  - title_zh: same meaning in Simplified Chinese
  - body_en: bullet list in English (one bullet per line, prefix each with "• "), friendly tone, player-focused (not dev jargon)
  - body_zh: same meaning in Simplified Chinese
Output ONLY valid JSON, no prose, no markdown code fences.

Raw notes:
${rawNotes}`;

      const res = await fetch(`${BASE}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'AI request failed');
        return;
      }
      const cleaned = data.text.trim().replace(/^```json\n?|\n?```$/g, '');
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.title_en !== 'string' || typeof parsed.title_zh !== 'string' ||
          typeof parsed.body_en !== 'string' || typeof parsed.body_zh !== 'string') {
        setError('AI response was missing required fields.');
        return;
      }
      setTitleEn(parsed.title_en);
      setTitleZh(parsed.title_zh);
      setBodyEn(parsed.body_en);
      setBodyZh(parsed.body_zh);
    } catch {
      setError("AI response couldn't be parsed. Please try again or type manually.");
    } finally {
      setDrafting(false);
    }
  }

  async function publish() {
    if (!version.trim() || !titleEn.trim() || !titleZh.trim() || !bodyEn.trim() || !bodyZh.trim()) {
      setError('All fields required before publish.');
      return;
    }
    setPublishing(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: version.trim(),
          title: { en: titleEn.trim(), 'zh-CN': titleZh.trim() },
          body: { en: bodyEn.trim(), 'zh-CN': bodyZh.trim() },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Publish failed');
        return;
      }
      onPublished(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Version</label>
        <input
          type="text"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="input w-full"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Raw notes</label>
        <textarea
          value={rawNotes}
          onChange={(e) => setRawNotes(e.target.value)}
          className="input w-full min-h-[100px]"
          placeholder="Paste commit messages, rough notes, bullet points..."
        />
      </div>

      <button
        type="button"
        onClick={draftWithAI}
        disabled={drafting}
        className="btn-secondary w-full"
      >
        {drafting ? 'Drafting…' : t('draftWithAI')}
      </button>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Title (EN)</label>
          <input type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Title (中文)</label>
          <input type="text" value={titleZh} onChange={(e) => setTitleZh(e.target.value)} className="input w-full" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Body (EN)</label>
        <textarea value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} className="input w-full min-h-[100px]" />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Body (中文)</label>
        <textarea value={bodyZh} onChange={(e) => setBodyZh(e.target.value)} className="input w-full min-h-[100px]" />
      </div>

      {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
        <button type="button" onClick={publish} disabled={publishing} className="btn-primary flex-1">
          {publishing ? 'Publishing…' : t('publish')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests and build**

Run: `npm test`
Expected: 194 tests still pass.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/admin/ReleaseForm.tsx
git commit -m "$(cat <<'EOF'
feat: add admin ReleaseForm with AI draft + bilingual publish (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Create `ReleasesView` and wire into `AdminDashboard`

**Files:**
- Create: `components/admin/ReleasesView.tsx`
- Modify: `components/admin/types.ts` (add `'releases'` to AdminView union)
- Modify: `components/admin/AdminDashboard.tsx` (route + entry button)

- [ ] **Step 1: Add `'releases'` to AdminView union**

In `components/admin/types.ts`, update:

```ts
export type AdminView =
  | 'dashboard'
  | 'session-details'
  | 'date-time'
  | 'members'
  | 'birds'
  | 'advance'
  | 'players-full'
  | 'releases';
```

- [ ] **Step 2: Create `components/admin/ReleasesView.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from './AdminBackHeader';
import ReleaseForm from './ReleaseForm';
import type { Release } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface Props {
  onBack: () => void;
}

export default function ReleasesView({ onBack }: Props) {
  const t = useTranslations('admin.releases');
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/releases`, { cache: 'no-store' });
      if (res.ok) setReleases(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this release?')) return;
    try {
      const res = await fetch(`${BASE}/api/releases`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) load();
      else setError('Failed to delete');
    } catch {
      setError('Network error');
    }
  }

  return (
    <div className="space-y-4">
      <AdminBackHeader onBack={onBack} title="Releases" />

      {showForm ? (
        <ReleaseForm
          latestVersion={releases[0]?.version}
          onPublished={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-primary w-full"
          >
            {t('newButton')}
          </button>

          {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : releases.length === 0 ? (
            <p className="text-sm text-gray-400">No releases yet.</p>
          ) : (
            <ul className="space-y-2">
              {releases.map((r) => (
                <li key={r.id} className="glass-card p-3 flex justify-between items-start">
                  <div>
                    <p className="text-sm font-semibold text-white">{r.version} · {r.title.en}</p>
                    <p className="text-xs text-gray-400">{new Date(r.publishedAt).toLocaleDateString()}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="text-red-400 text-xs"
                    aria-label={`Delete ${r.version}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into `AdminDashboard`**

In `components/admin/AdminDashboard.tsx`:

Add import near other view imports:

```tsx
import ReleasesView from './ReleasesView';
```

In the `AdminDashboard` drill-down routing section (around line 57-61), add a new conditional:

```tsx
if (view === 'releases') return <div className="animate-slideInRight"><ReleasesView onBack={goBack} /></div>;
```

In the `Dashboard` component's JSX (around lines 487-491, near the Members and Birds buttons), add a new button. Find:

```tsx
<button onClick={() => setView('members')} className="btn-ghost flex-1">
  ...
</button>
<button onClick={() => setView('birds')} className="btn-ghost flex-1">
  ...
</button>
```

Add a new button below them (or in the same row if there's a multi-row pattern):

```tsx
<button onClick={() => setView('releases')} className="btn-ghost flex-1">
  Releases
</button>
```

(If buttons are in a `grid grid-cols-2` or similar, wrap appropriately to keep alignment. Otherwise a full-width row is fine.)

- [ ] **Step 4: Run tests and build**

Run: `npm test`
Expected: 194 tests pass.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`
Visit `http://localhost:3000/bpm` → tap BPM title 5 times to reveal admin tab → enter admin PIN → navigate to Admin tab → tap "Releases" → tap "New release" → fill in raw notes → tap "Draft with AI" → review fields → tap "Publish" → verify new release appears in list. On Home, a sparkle trigger should appear below "BPM Badminton" title. Tap it → terminal sheet opens with the release content.

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add components/admin/types.ts components/admin/ReleasesView.tsx components/admin/AdminDashboard.tsx
git commit -m "$(cat <<'EOF'
feat: add ReleasesView to AdminDashboard (R5)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan checklist (before PR)

- [ ] All 8 tasks committed.
- [ ] `npm test` green (~194 tests total — started at 178, +7 API + 4 Sheet + 5 Trigger = 194).
- [ ] `npm run build` succeeds.
- [ ] Manual smoke: admin creates a release via "Draft with AI" flow; HomeTab shows sparkle trigger; tapping opens terminal sheet; closing sets localStorage; reopening shows "read" state.
- [ ] No scope creep: `app/api/players/route.ts`, existing components other than HomeTab/AdminDashboard, and other API routes untouched.
- [ ] Canary i18n count: 28 total (22 prior + 6 R5).
- [ ] Push to main (or open PR).
