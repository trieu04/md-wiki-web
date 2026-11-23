import { verify } from '@node-rs/argon2';
import { expect, it } from 'vitest';
import { base62, equal, passwordHash, secret, sha256 } from '../src/auth/credentials.js';

it('salts each Argon2id hash using the configured work factors', async () => {
  const [a, b] = await Promise.all([passwordHash('test password'), passwordHash('test password')]);
  expect(a).not.toBe(b);
  expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  expect(await verify(a, 'test password')).toBe(true);
  expect(await verify(a, 'not that password')).toBe(false);
});

it('compares secrets without an unequal-length exception and uses the specified token alphabets', () => {
  const session = secret();
  expect(Buffer.from(session, 'base64url')).toHaveLength(32);
  expect(sha256(session)).toMatch(/^[0-9a-f]{64}$/);
  expect(equal(session, session)).toBe(true);
  for (const other of ['', session + 'x', secret()]) expect(equal(session, other)).toBe(false);
  expect(base62(8)).toMatch(/^[a-zA-Z0-9]{8}$/);
  expect(base62(32)).toMatch(/^[a-zA-Z0-9]{32}$/);
});
