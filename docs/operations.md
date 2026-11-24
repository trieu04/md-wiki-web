# Operations

How to run, back up and restore md-wiki. Contracts and rules: `system-logic.md`. Architecture: `architecture.md`.

## Production checklist

- `NODE_ENV=production`. The API then refuses example secrets: `SERVICE_TOKEN` needs 32+ random characters (`openssl rand -hex 32`), shared with the worker; `OWNER_PASSWORD` must not be the example value (docs/security.md).
- `INTERNAL_HOST` stays on loopback or the private compose network; never publish `INTERNAL_PORT`.
- Serve `apps/web/dist` and proxy `/api/v1` (and `/mcp` for agents) to `API_PORT` from one origin over TLS. The web server sends the headers in `apps/web/vite.config.ts` (`webSecurityHeaders`: CSP, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`) plus `Strict-Transport-Security`, and answers unknown paths with `index.html`.
- Disable response buffering for `/api/v1/events` (server-sent events).
- Schedule `make backup` and copy the folder off the host.

## Backup and restore

A backup is a folder with three files:

| File | What |
| --- | --- |
| `database.dump` | `pg_dump -Fc` of the app schema (the `?schema=` of `DATABASE_URL`, default `public`) plus its extensions (`citext`), without owners or grants, so it restores on a clean host |
| `wiki.tar.gz` | the whole `WIKI_ROOT` folder, including `.wiki-system/` (publication receipts); `.wiki-system/tmp/` is left out |
| `manifest.json` | format, time, app commit, sha-256 and size of both archives, the row count of every table, and the sha-256 of every wiki file (mode 0600) |

### Take a backup

```sh
make backup                          # → backups/<UTC stamp>/ (git-ignored)
make backup BACKUP_DIR=/srv/backups/mdwiki-2026-11-24
```

`make` runs `pg_dump`/`psql` inside the compose Postgres container. Without Docker (Postgres client 17 on the PATH): `node tools/backup/backup.mjs <out-dir>`. Both read `DATABASE_URL` and `WIKI_ROOT` from `.env` or the environment. The output folder must be empty.

For a consistent copy stop the API first (or take the backup when nothing is being published). An online backup is still usable: at boot the restored API reindexes the wiki folder and runs publish recovery (system-logic §7.4.5), so a publication caught between the file write and the database update is finished or, when it cannot be classified, shown in Operations › Blocked publications for a decision.

Copy the backup folder off the host. It contains every page, account names and e-mails, password hashes and token hashes: store it like the database.

### Restore on a clean host

1. Install the app at the commit in `manifest.json` (`app.commit`) or a later one; `pnpm install && pnpm build`.
2. Start Postgres (`make up`) with an empty database; do **not** run `prisma migrate deploy` (the dump carries the migrations table).
3. Point `.env` at the target: `DATABASE_URL` (same `?schema=` as `manifest.json` `database.schema`) and an empty or missing `WIKI_ROOT`.
4. `make restore FROM=backups/<stamp>` (or `node tools/backup/restore.mjs <dir>`).
5. Start the API. Boot recovery reconciles publications; then run `prisma migrate deploy` if the app is newer than the backup.

The restore refuses to run when the archives do not match the manifest, the schema already has tables, or the wiki folder is not empty. It applies the dump in one transaction, unpacks the wiki, then checks every table's row count and every file's sha-256 against the manifest and fails with the differences.

### Rehearsal

```sh
make rehearse-backup
```

Creates two throwaway databases on the dev server, runs the built API on the first with a copy of `wiki-sample`, writes state through the API (follow, page feedback, team) and a `.wiki-system/` receipt, backs up, restores into the second database and a new folder, checks that a second restore onto the used target is refused, boots the API on the restored copy and compares what it serves (page, section labels, follows, audit trail). Both databases and folders are dropped afterwards. Last run: 2026-11-24, PASS.
