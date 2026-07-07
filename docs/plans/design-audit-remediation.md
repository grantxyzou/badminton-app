# Design-System Audit — Remediation Record & Backlog

Status of the design-token/consistency cleanup that followed the design audit
(`design-audit-report.html`, generated 2026-07-07). The audit cross-referenced
`app/` + `components/` against the `app/globals.css` design-system contract and
found ~1,200 drift instances, ~95% of which the ESLint guardrail did not catch.

The remediation below was shipped as 8 commits, gate-green throughout
(`npm run lint && npm test && npm run build` → 0 lint errors, build ok). Every
mechanical, low-risk transform was done; the genuinely design-judgment work
(item #6 + the colored-rgba pass) is documented here for follow-up.

## Done

| Stage | Summary |
|---|---|
| **P0–P2** | Defined **10 phantom tokens** (`--color-red/-amber`, `--text`, `--border/-subtle`, `--sev-warn`, `--bg-surface/-elevated`, `--ease-out-quart`, `--font-mono`) with `[data-theme=light]` values — dark mode is a no-op, light mode becomes correct. `--font-mono` was a **live defect** (~47 bare `var(--font-mono)` sites inheriting the sans body font). Extended the ESLint guardrail (`EXTRA_TOKEN_SELECTORS`: numeric `fontSize` + bare `rgba()`). Tokenized 293 exact-match inline `fontSize` → `var(--fs-*)`. Stripped 51 dead hex fallbacks. |
| **#1** | Adopted `.field-error` for the 32 sanctioned `text-red-400 text-xs` inline error messages (theme-aware; interactive red buttons excluded). |
| **#2** | Tokenized 53 white-tint `rgba(255,255,255,X)` → `rgba(var(--glass-tint), X)` (dark no-op; light → `0,0,0`, matching the 21 existing globals.css uses). **Visually verified light + dark.** |
| **#3** | Added the `--icon-*` ladder (mirror of `.icon-*` classes); snapped 30 icon sizes → `--icon-*` and 28 off-scale text sizes → `--fs-*` (all ≤1px). |
| **#4a** | Migrated 225 exact-value Tailwind `text-xs/sm/base` → `.fs-sm/md/lg` (font-size identical). |
| **#4b** | Palette color classes are already theme-aware via `[data-theme=light]` overrides (DESIGN.md §8) — closed the 4 real `hover:` override gaps instead of converting. |
| **#5** | Added a bare-text-size guardrail selector; graduated `components/{primitives,home,BottomSheet}` to **error** on the full selector set. |

New tokens/classes live in `app/globals.css`; the contract is pinned in
`__tests__/design-canary.test.ts`.

## Not done — needs design judgment (do NOT bulk-automate)

### Item #6 — primitive / button consolidation
Investigated and deliberately deferred. There is **no safe mechanical transform**:

- **Legacy `btn-primary`/`btn-ghost` → `cc-btn` (104 uses).** `.btn-primary` (solid
  gradient, 14px radius, prominent filled CTA) and `.cc-btn` (translucent, compact
  admin action) are **distinct visual roles**. A blind sweep would shrink primary
  CTAs like "I'm in this week" and "Finalize cost" — a regression, not a cleanup.
  Migrate per-button only where the compact role is actually wanted.
- **`<CardHeader>` adoption.** All headers matching CardHeader's shape (icon +
  `bpm-h3` title row) already use it (11 files). The remaining `bpm-h3` usages are
  *different* patterns — standalone card titles without a leading icon
  (`NextSessionCard`, `AnomalyFeed`), list-row labels (`CheckInSheet`), sheet titles
  (`InstallSheet`), warning banners (`AdvanceSessionForm`). Forcing them into
  CardHeader changes structure/color.
- **`<ListRow>` adoption (2 importers).** Per-component JSX restructuring with visual
  impact.

**How to pick this up:** target one component at a time, decide whether its
header/button/row *should* change, make the edit, and verify visually in light +
dark (boot `PORT=3100 npm run dev:next:mock`, admin `Grant`/`1130`).

### Colored / black rgba semantic pass
`rgba(0,0,0,X)` shadows/overlays and colored accent/severity rgba
(green/amber/red/purple, heaviest in `components/admin/CommandCenter`) were **not**
tokenized — they need per-color judgment (map to `--accent` / `--sev-*` / a shadow
token), unlike the mechanical white-tint swap. ~146 remain (surfaced as lint warnings).

### Off-scale display sizes
18px body text and the 24/28/40/56 hero/display numbers were left as-is (intentional
sizes with no `--fs-*` rung). recharts font sizes stay numeric (SVG can't read `var()`).

## Guardrail state
`eslint.config.mjs`: `warn` app-wide on `DESIGN_TOKEN_SELECTORS` + `EXTRA_TOKEN_SELECTORS`;
`error` in `components/stats` (hex/radius) and `components/{primitives,home,BottomSheet}`
(full set). The ~405 remaining warnings are the guardrail **surfacing** the backlog
above by design — add areas to the `error` override as each reaches zero drift.
