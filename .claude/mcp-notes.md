# MCP notes

## Playwright: use `playwright-isolated`

`.mcp.json` (checked in, so the whole team gets it) registers a second
Playwright server launched with `--isolated`.

**The problem it solves.** The `playwright` plugin server keeps a persistent
browser profile at
`~/Library/Caches/ms-playwright-mcp/mcp-chrome-<hash>`, and only one process may
hold it. A second session — or a browser window left open from an earlier one —
takes the lock, and every call after that returns:

```
Error: Browser is already in use for …, use --isolated to run multiple
instances of the same browser
```

On 2026-08-27 that lock was held for an entire working session. Four UI bugs
shipped that a screenshot would have caught immediately, including a primary
button rendered flush against its subtitle, because the browser could not be
opened once. The cost of the lock is not inconvenience — it is that visual
verification silently stops happening and nobody notices.

`--isolated` runs with an in-memory profile, so instances do not contend.

**Which to reach for.** Prefer `playwright-isolated` for screenshots and
one-off checks — it is the one that will not be locked. The persistent
`playwright` server is still worth having when you *want* state to survive
between calls, such as staying signed in across a multi-step flow.

**What NOT to fall back to.** Headless Chrome via `--screenshot`. It advances
past `load` with `--virtual-time-budget` but terminates in-flight fetches, so
data tabs render a false offline banner; and this app reads `?tab=` *after*
hydration, so `?tab=profile` reliably captures **Home** instead. Both failures
produce a plausible-looking image, which is worse than no image. See the
`verify-ui` skill and the Gotchas section of `CLAUDE.md`.

## Servers already available

`context7` (live library docs), `figma`, `desktop-commander`, `sentry`,
`vercel`, `stripe`, plus the claude.ai connectors. None are configured in this
repo — they come from the user's plugin set, so nothing here needs to declare
them.
