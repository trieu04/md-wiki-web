# md-wiki-web

Web rebuild of [md-wiki](../md-wiki) as a self-managed, reviewed Markdown wiki: **submit → reviewer agent reviews → publish exactly what was approved (automatically) → escalate to the page's authors when needed → trace and correct**. Each section carries a credibility label derived from evidence, not from votes or links.

The UI is wiki first: employees mostly come to read, so home, search and pages show each section's label and let readers check a source, say they used it, or report a problem. Review tools live in a separate Workspace for page authors and the owner. Mockups: [UI v4 canvas](https://claude.ai/artifact/Lxw6KDBmXBFPYTZRX7DzBh).

| Part | Stack | Role |
| --- | --- | --- |
| `apps/web` | React, Vite, TypeScript | User interaction |
| `apps/api` | NestJS, Postgres, BullMQ | All state, review, publication, credibility labels; the only wiki writer |
| `services/worker` | Python | AI work: quality check, reviewer agent, retraction check, copy/relation candidates, shadow credibility score |
| Storage | Local folder adapter | Markdown files on disk |

**Status:** planning. No code yet.

- [Architecture](docs/architecture.md)
- [UI/UX design](docs/ux.md)
- [Plan](docs/plan.md)
