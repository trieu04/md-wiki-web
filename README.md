# md-wiki-web

Web rebuild of [md-wiki](../md-wiki) as a self-managed, reviewed Markdown wiki: **submit → reviewer agent reviews → publish exactly what was approved (automatically) → escalate to the page's authors when needed → trace and correct**. Each section carries a credibility label derived from evidence, not from votes or links.

The UI is wiki first: employees mostly come to read, so home, search and pages show each section's label and let readers check a source, say they used it, or report a problem. Review tools live in a separate Workspace for page authors and the owner. Mockups: [UI v4 canvas](https://claude.ai/artifact/Lxw6KDBmXBFPYTZRX7DzBh).

| Part | Stack | Role |
| --- | --- | --- |
| `apps/web` | React, Vite, TypeScript | User interaction |
| `apps/api` | NestJS, Postgres, BullMQ | All state, review, publication, credibility labels; the only wiki writer |
| `services/worker` | Python | AI work: quality check, reviewer agent, retraction check, copy/relation candidates, shadow credibility score |
| Storage | Local folder adapter | Markdown files on disk |

**Status:** phases 0–10 implemented (docs/progress.md); ready for the pilot.

- [Architecture](docs/architecture.md) · [UI/UX design](docs/ux.md) · [Plan](docs/plan.md)
- [System logic](docs/system-logic.md) (binding contract) · [API overview](docs/api.md) · [Design system](docs/design-system.md)
- [Operations](docs/operations.md) (run, production checklist, backup/restore) · [Security review](docs/security.md)
- Agent skill: [skills/wiki-knowledge-workflow](skills/wiki-knowledge-workflow/SKILL.md)

## Commands

| Command | What |
| --- | --- |
| `pnpm install` / `pnpm build` | install, build all packages |
| `make up` / `make down` | dev Postgres + Redis (Docker) |
| `make dev` | API, web and worker with `.env` (`tools/dev.py`) |
| `pnpm check` | lint, typecheck, unit and integration tests (needs `make up`) |
| `cd services/worker && uv run pytest` | worker tests |
| `pnpm e2e` | Playwright flows against a throwaway stack (below) |
| `pnpm a11y` | axe WCAG 2.1 AA + keyboard checks on every screen of the fixture build |
| `make backup` / `make restore FROM=…` / `make rehearse-backup` | backup and restore (docs/operations.md) |

## End-to-end tests (Playwright)

`pnpm e2e` runs the reader flow against a live, throwaway stack. It needs the dev Postgres and
Redis (`make up`) and the `DATABASE_URL`/`REDIS_URL` from `.env`; nothing in the developer schema or
in `wiki-sample/` is touched. `e2e/run.mjs`:

1. builds `@md-wiki/api` and `@md-wiki/web` (skip with `E2E_SKIP_BUILD=1` when they are fresh);
2. runs `prisma migrate deploy` into a new schema `e2e_<uuid>` and copies `wiki-sample/` to a temp dir;
3. starts the built API on free loopback ports with a generated owner password (the owner is seeded
   on boot), then creates a reader account through `POST /api/v1/admin/users`;
4. serves the production web build with `vite preview`, which proxies `/api/v1` to that API;
5. runs `playwright test -c e2e/playwright.config.mjs` (extra arguments are passed through, e.g.
   `pnpm e2e --headed`), then stops both servers, drops the schema and deletes the temp wiki.

Specs live in `e2e/*.spec.mjs`: a reader searches "objective" from Home, opens the first result and
lands on its section anchor, has no Workspace link and gets no Settings content; the owner opens
Settings and creates a token whose secret is shown once and authenticates an API call.
`E2E_VERBOSE=1` streams the API and preview logs; traces of failed tests go to `test-results/e2e/`.
