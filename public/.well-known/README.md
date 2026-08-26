# `.well-known`

Files here are served at the **domain root**, not under `/bpm`, via the
`basePath: false` rewrite in `next.config.js`.

## `apple-developer-domain-association.txt`

Sign in with Apple verifies domain ownership by fetching

```
https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt
```

Download that file from the Apple developer console when configuring the
Services ID (Identifiers → your Services ID → Sign In with Apple → Configure →
Domains and Subdomains), drop it in this directory, and deploy **before**
clicking Verify — the console fetches it live.

Confirm it is actually reachable first:

```bash
curl -sS https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt | head -3
```

Full walkthrough: `docs/auth-provider-setup.md`.
