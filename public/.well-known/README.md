# `.well-known`

**Nothing here is currently reachable at the domain root.** `next.config.js`
sets `basePath: '/bpm'`, so files in `public/` are served under `/bpm/...`, and
Sign in with Apple verifies domain ownership by fetching

```
https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt
```

A `rewrites()` entry with `basePath: false` does **not** work — Next refuses it
at boot ("rewrites urls outside of the basePath… use a destination that starts
with http:// or https://"), because escaping the basePath makes the destination
external too.

See the "Domain verification" section of `docs/auth-provider-setup.md` for the
remaining options. The most promising is serving the token from `proxy.ts`,
which already runs on paths outside the basePath.

This directory is kept so the file has an obvious home once that is solved.
It blocks **Apple only** — Google needs none of it.
