# API

The binding contract is `system-logic.md` (endpoints, DTOs, rules, error codes). The machine-readable form is `packages/contracts/openapi.json`, generated from the API's DTOs (`pnpm contracts:gen`; `pnpm contracts:check` fails when it is out of date). The web client's types come from it (`@md-wiki/contracts`). This page is the overview.

## Endpoints

| Base | Who | Auth |
| --- | --- | --- |
| `/api/v1` (port `API_PORT`) | browser, scripts, agents | session cookie + CSRF header, or `Authorization: Bearer mwt_…` |
| `/mcp` (same port) | agents (MCP, streamable HTTP, stateless) | bearer token only |
| `/internal/v1` (port `INTERNAL_PORT`, private) | the Python worker | `Authorization: Bearer <SERVICE_TOKEN>` |

## Authentication

- **Browser:** `POST /api/v1/auth/login { email, password }` sets the `mw_session` cookie (HttpOnly, SameSite=Lax, Secure in production) and returns `csrfToken`. Every non-GET request with the cookie must send `X-CSRF-Token: <csrfToken>`, else `403 CSRF_INVALID`. `GET /auth/session` returns the current user and token; `POST /auth/logout` ends it. Five failed logins per e-mail and IP in 15 minutes → `429 RATE_LIMITED` with `Retry-After`.
- **Tokens:** the owner creates them in Settings › Agents and tokens (`POST /admin/tokens`); the secret is shown once. Scopes (`read`, `discuss`, `contribute`, `review`, `publish`) are intersected with the account's roles. A bearer header wins over a cookie. Attestations (*useful*, *I used it*), reports and page feedback are for people only; a source check needs the reviewer role (or a token with `review` scope).

## Conventions

- JSON in and out; unknown fields are rejected (`400 VALIDATION_FAILED` with `fields`).
- Errors are `application/problem+json`: `{ type, title, status, code, detail?, fields?, requestId }`. Branch on `code` (system-logic §9), never on `title`.
- Lists use cursors: `?limit=1..100&cursor=…` → `{ items, nextCursor }`.
- IDs are UUIDv7; proposals also have a `slug`. Times are ISO-8601 UTC.
- Writes that depend on what you read send it back (version label + sha256, section hash, preview binding, discussion version). A mismatch is a `409` with a specific code (`STALE_BASE`, `SECTION_CHANGED`, `DISCUSSION_CHANGED`, …): reread, never retry blindly.
- `X-Request-Id` is echoed (yours if it is a plain token of up to 128 characters, else a new one) and appears in every problem body and log line.
- Responses are `Cache-Control: no-store` unless stated, with `nosniff`, `X-Frame-Options: DENY` and a `default-src 'none'` CSP.

## Main groups

| Group | Paths (under `/api/v1`) | system-logic |
| --- | --- | --- |
| Wiki | `/wiki/tree`, `/wiki/pages/{path}`, `…/history`, `…/versions/{label}`, `/wiki/recent`, `/search`, `/context` | §3, §7.1 |
| Contributions | `/contributions`, `/drafts…` | §7.2 |
| Review and publish | `/proposals…`, `/ops/blocked…`, `/audit`, `/events` (SSE) | §7.4 |
| Discussions | `/topics…`, proposal discussions, dispute log | §7.5 |
| Quality check | `/proposals/{slug}/quality…`, `/admin/models` | §7.6 |
| Credibility | `/sections/{path}/{anchor}/why`, `…/people`, `/attestations`, `/reports`, `/source-checks`, `/page-feedback`, `/follows`, `/me/…`, `/notifications…`, `/credibility/…`, `/admin/credibility-gates` | §7.7 |
| Reviewer agent | `/inbox`, `/admin/review-settings`, `/ops/agent` | §7.8 |
| Admin | `/admin/users`, `/admin/teams`, `/admin/tokens`, `/admin/reindex` | §3 |
| Health | `/health` (db, redis, storage) | §2 |

## Events

`GET /api/v1/events` is a `text/event-stream` of `EventDto` messages (`event: <type>`), sent after commits, with a `ping` every 25 s. The web app uses them only to refresh queries; clients must still read the resource.

## Agents

Agents use the MCP server or REST with a token. The how-to, including which tool needs which scope, is the agent skill: `skills/wiki-knowledge-workflow/SKILL.md`.
