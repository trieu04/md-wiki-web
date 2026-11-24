# Security review (P10-02, 2026-11-24)

Scope from plan.md Phase 8: auth, CSRF, token scopes, sanitizer, internal API exposure, rate limits, attestation privacy and retention. Each row names the rule, where it is enforced and the test that proves it. "Fixed" rows were changed in this pass (D-251).

| Area | Rule | Enforced in | Evidence |
| --- | --- | --- | --- |
| Passwords | argon2id `m=19456, t=2, p=1`, per-hash salt | `auth/credentials.ts` | `credentials.test.ts` |
| Login | Same `INVALID_CREDENTIALS` for unknown e-mail and wrong password; 5 failures / 15 min per (e-mail, IP) → `429` + `Retry-After` | `auth.service.ts` | `identity.integration.test.ts` › *reports invalid credentials uniformly and throttles…* |
| Session cookie | `mw_session` HttpOnly, SameSite=Lax, Secure in production; idle and absolute expiry; logout consumes it; disabled users lose access at once | `auth.controller.ts`, `auth.service.ts` | `identity.integration.test.ts` › *clears missing, unknown, idle-expired…*, *sets Secure…* |
| CSRF | Every non-GET with a session cookie needs `X-CSRF-Token` (constant-time compare); bearer callers have no cookie surface; MCP takes bearer tokens only | `auth/auth-http.ts`, `mcp.controller.ts` | `identity.integration.test.ts` (`CSRF_INVALID`), `mcp.integration.test.ts` |
| CORS | Not enabled: the browser app is same-origin (`/api/v1` proxied) | `config/http.ts` | — |
| API tokens | Scopes limited by the account's roles; shown once; stored hashed; expiry, revocation and live user state checked per request; bearer wins over cookie | `auth.service.ts`, domain `can` | `identity.integration.test.ts` › *validates scopes, shows a token once…* |
| Token callers and agents | May not attest, report or check sources (humans in a session only) | domain `can`, `attestations.service.ts` | `credibility.integration.test.ts` › *refuses attestations and reports from API-token callers* (new) |
| Markdown | No raw HTML (`remark-rehype` without `allowDangerousHtml`), `rehype-sanitize` default schema, wiki links only to valid wiki paths; other UI text is rendered as React text, links are built from internal paths | `apps/web/src/features/markdown/model.ts` | `apps/web/test/markdown.test.tsx` (`<script>`, `javascript:` links) |
| Wiki storage | Paths validated; no traversal, no symlinks (reads, listing, writes, temp files) | `wiki/storage/local-folder-storage.ts` | `storage.test.ts` |
| Internal API | Separate listener, loopback by default (`INTERNAL_HOST`), never published by compose; every route needs `Bearer SERVICE_TOKEN` (constant-time); not reachable through the public prefix | `main.ts`, `config/http.ts` | `app.test.ts`, `ping.integration.test.ts`, `credibility-jobs.integration.test.ts` |
| Secrets in production | **Fixed:** the API refuses to start with `NODE_ENV=production` when `SERVICE_TOKEN` is shorter than 32 characters or an `.env.example` value, or `OWNER_PASSWORD` is the example value; config errors name keys, never values | `config/env.ts` | `config.test.ts` › *refuses the example secrets…* |
| Response headers (API) | **Fixed:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `CSP: default-src 'none'; frame-ancestors 'none'`, `Cache-Control: no-store` unless a handler sets one; `X-Powered-By` removed (both listeners) | `config/http.ts` | `http.test.ts` › *sends security headers…* |
| Response headers (web) | **Fixed:** CSP `default-src 'self'` (scripts self only, inline styles allowed for React style attributes, `object-src 'none'`, `frame-ancestors 'none'`), `nosniff`, `DENY`, `Referrer-Policy: same-origin` from `vite preview`; the production web server must send the same (docs/operations.md) | `apps/web/vite.config.ts` (`webSecurityHeaders`) | `pnpm e2e` runs the whole app under this CSP (7/7) |
| Request ids / logs | **Fixed:** a caller's `X-Request-Id` is kept only if it matches `[A-Za-z0-9._:-]{1,128}`, else replaced, so it cannot forge log lines; logs carry method/status/id, never bodies, cookies or tokens; unexpected errors are logged with stack, the response is a bare `INTERNAL` problem | `common/request-id.middleware.ts`, `problem.filter.ts` | `http.test.ts` › *keeps a plain caller request id…*, *…unexpected…* |
| Body size | JSON ≤ 5 MB (bundle limit is 4 MiB + 64 KiB); larger → `413 PAYLOAD_TOO_LARGE` | `config/http.ts` | `contribute.integration.test.ts` |
| Report rate limit | 5 reports per person per page per 7 days → `429` + `Retry-After` | domain `reportRateLimit`, `attestations.service.ts` | domain tests; `credibility.integration.test.ts` › *limits reports to 5…* (new) |
| Attestation privacy | People counts are team counts, never names; hidden until the reader acted or asked (`reveal`); a person's activity is visible only to them; audit data never carries passwords or tokens | `credibility` services | `credibility.integration.test.ts` › *hides counts…*; `identity.integration.test.ts` (audit without credentials) |
| Retention | Final raw attestations and page feedback older than `CREDIBILITY_RETENTION_DAYS` (90) are folded into `CredibilityAggregate` and deleted under `md_wiki.purge`; append-only triggers block every other update/delete | domain `retentionPlan`, maintenance job, migrations | domain tests; `credibility.integration.test.ts` › *retention folds old feedback…* (new) |
| Backups | Contain password and token hashes and every page: stored like the database (docs/operations.md) | `tools/backup` | `make rehearse-backup` |

## Not changed (accepted for the pilot)

- Rate limits exist for login and reports only. Other writes need a signed-in person with the right role; add limits if abuse is observed.
- No HSTS header from the API: TLS terminates at the production web server, which should send `Strict-Transport-Security`.
- `style-src 'unsafe-inline'` stays while components use React `style` attributes.
