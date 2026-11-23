import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const port = z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(0).max(65535));
const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  API_PORT: port,
  INTERNAL_PORT: port,
  INTERNAL_HOST: z.union([z.hostname(), z.ipv6()]).default('127.0.0.1'),
  SERVICE_TOKEN: z.string().min(1),
  OWNER_EMAIL: z.email(),
  OWNER_PASSWORD: z.string().min(1),
  WIKI_ROOT: z
    .string()
    .min(1)
    .transform((path) => resolve(root, path)),
  AUTO_PUBLISH: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

export type ApiConfig = z.infer<typeof schema>;
export const API_CONFIG = Symbol('API_CONFIG');

export function parseConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report every bad key, but never echo credentials or connection strings.
    throw new Error(
      `Missing or invalid API configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return result.data;
}

export function loadConfig(): ApiConfig {
  const path = resolve(root, '.env');
  return parseConfig({
    ...(existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}),
    ...process.env,
  });
}
