# R5 — Release Notes with AI-Assisted Authoring (Design Spec)

**Date:** 2026-04-16
**Roadmap item:** P1.6 R5 (user-added; AI candidate)
**Status:** Design approved; awaiting plan

---

## 1. Purpose

Players today have no way to learn what changed between weekly visits. When the app ships a new feature (like the `C1` language toggle or `R2` welcome card), the change just appears — no context, no highlight, no way for a returning player to think "oh, that's new". This spec adds a lightweight, subtle release-notes surface with an admin authoring flow that uses Claude to draft bilingual summaries from raw notes.

Secondary purpose: extend the existing admin-only AI surface (`/api/claude`) to a new authoring use case. Player-facing AI stays out of scope — admin writes and reviews; players only read the committed result.

## 2. Goals

- Players returning after a week see a subtle cue when something changed, can dismiss by reading.
- Players who don't care scroll past without noticing.
- Admin can draft a release in under 2 minutes: paste raw notes → AI generates bilingual summary → review → publish.
- Release notes persist across sessions (unlike announcements which vanish on session advance).
- Rendered content is aesthetically distinctive (VS Code terminal styling) — visual cue that it's developer-authored product news, not session chatter.

## 3. Non-goals

- Auto-generation from commit log (explicitly rejected — needs admin review gate).
- Player-facing AI (on-demand translation, on-demand summarization, etc.) — AI remains admin-only per security rule #5.
- Push notifications when a release is published.
- Per-release dismiss (sheet-level tap = read; can't mark individual entries as read).
- Pagination (release count stays small — ~50 entries after a year of weekly releases is trivial).
- Edit flow (admin can delete + re-publish if they need to fix a typo; full edit is future scope).

## 4. Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Persistence | New `releases` Cosmos container, PK `/id` (global, not session-scoped) |
| Trigger form | Static text link under BPM Badminton title |
| Trigger states | Unread: `✨ What's new in v0.2.1` (accent color). Read: `v0.2.1` (muted gray). |
| Expansion | Bottom sheet (SkillsRadar pattern) |
| Read signal | Tap = read; `localStorage.badminton_last_read_release = <version>` on sheet close |
| Admin authoring | New `ReleasesView` in `AdminDashboard`; `ReleaseForm` with "Draft with AI" button |
| AI shape | One-shot; `/api/claude` returns structured JSON `{ version, title_en, title_zh, body_en, body_zh }` |
| Versioning | Auto-suggest next patch from latest release; admin can override; seed v0.1.0 |
| Sheet content | Full history, newest-first |
| Visual style | VS Code terminal aesthetic, honors theme (dark + light variants) |
| Accent color | Bright gold — `#f0d079` dark / `#b8942d` light |
| Terminal chrome | Filename only (`bpm-changelog`), no traffic lights |

## 5. Architecture

```
┌─ Admin authoring (AdminTab → ReleasesView) ────────┐
│  1. Type raw notes in textarea                      │
│  2. Tap "Draft with AI" → POST /api/claude          │
│  3. AI returns JSON { version, title_en, title_zh,  │
│                       body_en, body_zh }            │
│  4. Admin reviews/edits all 4 fields + version      │
│  5. Tap "Publish" → POST /api/releases              │
└──────────────┬──────────────────────────────────────┘
               │
               ▼ (writes Cosmos `releases` container, PK /id)
┌─ Player surface (HomeTab) ──────────────────────────┐
│  Below BPM Badminton title:                         │
│   • If localStorage.last_read != latest.version →   │
│       "✨ What's new in v0.2.1"  (gold accent)       │
│   • Else →  "v0.2.1"  (muted gray)                  │
│                                                     │
│  Tap → bottom sheet opens (terminal aesthetic):     │
│   ┌───────────────────────────────────┐             │
│   │  bpm-changelog               ✕    │             │
│   ├───────────────────────────────────┤             │
│   │ $ bpm --changelog                  │             │
│   │                                    │             │
│   │ ▸ v0.2.1 · Apr 15, 2026            │             │
│   │   What's new                       │             │
│   │   • Translated cost card           │             │
│   │   • Added language toggle          │             │
│   │                                    │             │
│   │ ▸ v0.2.0 · Apr 14, 2026            │             │
│   │   ...                              │             │
│   └───────────────────────────────────┘             │
│  On close → localStorage.last_read = latest.version │
└─────────────────────────────────────────────────────┘
```

### Cosmos document shape

```ts
interface Release {
  id: string;              // e.g., 'release-2026-04-15-v0.2.1'
  version: string;         // semver 'v0.2.1'
  title: {
    en: string;
    'zh-CN': string;
  };
  body: {
    en: string;            // newline-separated bullets or paragraphs
    'zh-CN': string;
  };
  publishedAt: string;     // ISO 8601
  publishedBy: 'admin';
}
```

Bilingual is **stored at write-time** — admin reviews both languages before publish; renderer just reads `body[currentLocale]`. No client-side Claude calls; security posture unchanged.

## 6. File structure

```
app/api/releases/
  route.ts                     [NEW]  GET (public) + POST (admin) + DELETE (admin)
lib/
  cosmos.ts                    [MODIFY] lazy-init `releases` container (PK /id)
components/
  ReleaseNotesTrigger.tsx      [NEW]  "What's new in v0.2.1" text link + unread logic
  ReleaseNotesSheet.tsx        [NEW]  bottom sheet with terminal aesthetic + history render
  HomeTab.tsx                  [MODIFY] render <ReleaseNotesTrigger /> below BPM title
  admin/
    AdminDashboard.tsx         [MODIFY] add "Releases" section entry
    ReleasesView.tsx           [NEW]  list published releases + "New release" button + delete
    ReleaseForm.tsx            [NEW]  form with AI draft + bilingual review + publish
app/globals.css                [MODIFY] + terminal-sheet, terminal-version, terminal-title styles
                                         (light + dark variants via CSS custom properties)
messages/
  en.json                      [MODIFY] +3 keys (home.releases.* + admin.releases.*)
  zh-CN.json                   [MODIFY] +3 keys (same structure)
__tests__/
  components/
    ReleaseNotesTrigger.test.tsx   [NEW]  ~4 tests (unread/read state, onOpen, empty list)
    ReleaseNotesSheet.test.tsx     [NEW]  ~4 tests (history render, locale, localStorage, close)
  api/
    releases.test.ts               [NEW]  ~5 tests (GET public, POST admin, validation, DELETE, sort)
```

### Component boundaries

- **`ReleaseNotesTrigger`** — owns the "unread vs read" decision. Reads `localStorage.badminton_last_read_release`. Fetches `/api/releases`. Renders text link. Emits `onOpen` prop. ~40 lines.
- **`ReleaseNotesSheet`** — owns terminal rendering + history display. Receives `releases: Release[]`, `open: boolean`, `onClose: () => void`. Writes localStorage on close. ~80 lines.
- **`ReleasesView`** (admin) — list + delete + "New release" button. ~60 lines.
- **`ReleaseForm`** (admin) — textarea + Draft-with-AI + bilingual review + Publish. ~120 lines.
- **`app/api/releases/route.ts`** — CRUD; admin-gated for POST/DELETE. ~80 lines.

## 7. Data flow

### Player: first visit, no releases yet
1. `ReleaseNotesTrigger` fetches `/api/releases` → empty array
2. Renders nothing. No trigger appears below BPM title.

### Player: first visit, releases exist
1. Fetch returns sorted releases (newest first)
2. `localStorage.badminton_last_read_release` is null → consider "unread"
3. Render: `✨ What's new in v0.2.1` in gold

### Player: returning, has read latest
1. Fetch returns releases; latest is `v0.2.1`
2. localStorage stored is `v0.2.1` → "read"
3. Render: `v0.2.1` in muted gray

### Player: returning, admin has published new version
1. Fetch returns releases; latest is `v0.2.2`
2. localStorage stored is `v0.2.1` → "unread" (mismatch)
3. Render: `✨ What's new in v0.2.2` in gold

### Player: opens sheet
1. Parent sets `sheetOpen = true`
2. Sheet renders with body scroll lock (position:fixed pattern per CLAUDE.md)
3. Full history rendered in terminal styling (`body[currentLocale]`)
4. On close (backdrop tap, X button, or drag-down):
   - `localStorage.badminton_last_read_release = latest.version`
   - `onClose()` called; parent sets `sheetOpen = false`
5. Trigger re-renders as "read" state

### Admin: create new release
1. Admin tab → Dashboard → "Releases" section → list of published entries
2. Tap "New release" → `ReleaseForm` opens
3. Version field pre-fills with next-patch from latest (e.g., if `v0.2.1` exists, field shows `v0.2.2`). Admin can edit.
4. Admin pastes raw notes into "Raw notes" textarea (e.g., "added language toggle, fixed cost card, bumped font sizes for older players")
5. Tap "Draft with AI" → loading spinner
6. `POST /api/claude` with prompt:
   ```
   You are drafting a release note for a badminton session app.
   Given these raw notes, produce a JSON object with:
     - version: use "<admin-typed-version>" (don't change)
     - title_en: short friendly title in English (max 8 words)
     - title_zh: same meaning in Simplified Chinese
     - body_en: bullet list in English, friendly tone, player-focused language (not dev jargon)
     - body_zh: same meaning in Simplified Chinese
   Output ONLY valid JSON, no prose.

   Raw notes: <admin's textarea content>
   ```
7. AI response parsed; 4 fields populated into the form. Admin reviews, edits any of them.
8. Tap "Publish" → `POST /api/releases` with `{ version, title: {en, zh-CN}, body: {en, zh-CN} }`
9. API route adds `id`, `publishedAt`, `publishedBy`. Persists to Cosmos. Returns the saved record.
10. Form closes; ReleasesView list refreshes; new entry at top.

### Admin: delete a release
1. ReleasesView shows each entry with a delete button
2. Tap delete → confirm modal
3. `DELETE /api/releases` with `{ id }` → Cosmos hard-delete
4. List refreshes

## 8. VS Code terminal styling

CSS custom properties for theme variants in `globals.css`:

```css
/* Dark theme */
[data-theme="dark"] {
  --terminal-bg: #0f1116;
  --terminal-titlebar-bg: #1e2128;
  --terminal-prompt: #6b7280;
  --terminal-accent: #f0d079;   /* brighter gold */
  --terminal-date: #9ca3af;
  --terminal-title: #e5e7eb;
  --terminal-body: #d1d5db;
}

/* Light theme */
[data-theme="light"] {
  --terminal-bg: #ffffff;
  --terminal-titlebar-bg: #e5e7eb;
  --terminal-prompt: #6b7280;
  --terminal-accent: #b8942d;   /* darker gold for WCAG AA on white */
  --terminal-date: #6b7280;
  --terminal-title: #1a2332;
  --terminal-body: #374151;
}

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
```

Semantic markup underneath stays proper HTML (`<h3>` for release title, `<ul>`/`<li>` for bullets) — terminal font is decorative only. Screen readers read normal content.

## 9. Error handling

| Case | Behavior |
|---|---|
| `/api/releases` GET fails (network, Cosmos down) | Trigger renders nothing. No error shown. Players don't need to know about release notes infrastructure failures. |
| `/api/releases` returns empty array | Trigger renders nothing. Not "v0.0.0" — no releases means no visible surface. |
| localStorage is unavailable (private browsing) | Trigger always renders as "unread". Dismissal doesn't persist but the app works. |
| AI draft returns invalid JSON | Form shows error "AI response couldn't be parsed. Please try again or type manually." Admin retypes fields. |
| AI draft times out (30s+) | Form shows error "AI request timed out. Please try again." Admin can retry. |
| POST /releases without admin auth | 401 Unauthorized (existing `isAdminAuthed` pattern) |
| POST /releases with missing required fields | 400 with specific field name |
| DELETE non-existent id | 404 |

## 10. Accessibility

- Sheet uses `role="dialog"` with `aria-label` from `t('releases.sheet.label')` — "Release history" / "发布历史"
- Close button has `aria-label` from `t('releases.sheet.close')` — "Close" / "关闭"
- Focus trap on open (follows SkillsRadar sheet pattern)
- Body scroll lock via `position: fixed` (CLAUDE.md gotcha)
- Terminal monospace is visual only — underlying DOM is semantic HTML
- Gold accent colors meet WCAG AA:
  - `#f0d079` on `#0f1116` → contrast ratio ~9.1 ✓
  - `#b8942d` on `#ffffff` → contrast ratio ~4.6 ✓

## 11. i18n keys (+6)

| Key | EN | zh-CN (first pass) |
|---|---|---|
| `home.releases.whatsNew` | `What's new in {version}` | `{version} 有新内容` |
| `home.releases.sheetLabel` | `Release history` | `发布历史` |
| `home.releases.close` | `Close` | `关闭` |
| `admin.releases.newButton` | `New release` | `新发布` |
| `admin.releases.draftWithAI` | `Draft with AI` | `用 AI 起草` |
| `admin.releases.publish` | `Publish` | `发布` |

Release titles and bodies themselves are not i18n keys — they're content stored in Cosmos with both locales baked in.

Canary total after R5: 22 (current) + 6 = **28 keys**.

## 12. Testing

### New test files

- **`__tests__/components/ReleaseNotesTrigger.test.tsx`** (~4 tests, jsdom)
  1. Renders "What's new in v0.2.1" when localStorage has no stored version
  2. Renders "What's new in v0.2.1" when stored version differs from latest
  3. Renders plain "v0.2.1" when stored version matches latest
  4. Calls `onOpen` when tapped

- **`__tests__/components/ReleaseNotesSheet.test.tsx`** (~4 tests, jsdom)
  1. Renders full history newest-first
  2. Renders release body from current locale
  3. Writes `localStorage.badminton_last_read_release` on close
  4. Close button calls `onClose` callback

- **`__tests__/api/releases.test.ts`** (~5 tests, node)
  1. GET returns array sorted newest-first (public, no auth)
  2. POST creates release with admin auth
  3. POST rejected without admin auth (401)
  4. POST validates required fields (version, title.en, title.zh-CN, body.en, body.zh-CN)
  5. DELETE removes by id with admin auth; rejects without

### Not tested (deliberate)
- AI integration call itself — the `/api/claude` endpoint is already tested; `ReleaseForm` uses the response but the AI call is mocked in tests
- Terminal CSS visual correctness — class names asserted; pixel fidelity not automatable
- Semver auto-increment — trivial utility; covered implicitly by admin-flow integration test

### Test count projection
Current: 178 · New: ~13 · **After R5: ~191 tests**

## 13. Rollout

Single PR. No feature flag. No Cosmos migration (new container bootstrapped lazily on first use).

- Deploy: no release notes exist → player surface shows nothing.
- Admin creates first release — sets version to `v0.1.0` (seed suggestion).
- All players see `✨ What's new in v0.1.0` on their next visit.
- Dismissal is per-device (localStorage).

If something regresses:
- Revert the PR; no data migration needed.
- `releases` container left empty / deleted-safe (Cosmos handles).

## 14. Out of scope / future

- Edit existing release (delete + re-publish is the interim workaround)
- Push notifications when a release publishes
- Per-release dismiss (current: sheet-level only)
- Auto-generation from git commit log on deploy
- Player-facing AI (translation on demand, summarization, etc.)
- Release notes search / filter
- Category/tag taxonomy (breaking change, new feature, bug fix)
