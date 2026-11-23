import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config/env.js';

/** Run real migrations and boot hooks without provisioning an owner in the developer schema. */
export function testSchema() {
  const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(loadConfig().DATABASE_URL);
  url.searchParams.set('schema', schema);
  return {
    url: url.href,
    migrate() {
      execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url.href },
      });
    },
    async drop() {
      const db = new PrismaClient({ datasourceUrl: url.href });
      try {
        await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await db.$disconnect();
      }
    },
  };
}
