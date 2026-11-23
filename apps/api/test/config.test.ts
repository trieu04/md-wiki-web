import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseConfig } from '../src/config/env.js';

const example = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

it('reports all missing API keys in one boot error', () => {
  const required = Object.keys(parseConfig(example)).filter(
    (key) =>
      ![
        'API_HOST',
        'INTERNAL_HOST',
        'WIKI_NAME',
        'WIKI_DESCRIPTION',
        'QUALITY_RULES_PATH',
      ].includes(key),
  );
  for (const key of required) expect(() => parseConfig({})).toThrow(key);
});

it('defaults the internal listener to loopback and accepts a private-network override', () => {
  expect(parseConfig({ ...example, API_HOST: undefined }).API_HOST).toBe('127.0.0.1');
  expect(parseConfig({ ...example, INTERNAL_HOST: undefined }).INTERNAL_HOST).toBe('127.0.0.1');
  expect(parseConfig({ ...example, INTERNAL_HOST: '0.0.0.0' }).INTERNAL_HOST).toBe('0.0.0.0');
});

it('defaults public wiki metadata when neither key is set', () => {
  expect(
    parseConfig({ ...example, WIKI_NAME: undefined, WIKI_DESCRIPTION: undefined }),
  ).toMatchObject({
    WIKI_NAME: 'Wiki',
    WIKI_DESCRIPTION: '',
  });
});

it('validates URLs, port ranges, booleans, and credentials without echoing secrets', () => {
  const invalid = {
    DATABASE_URL: 'https://secret',
    REDIS_URL: '',
    INTERNAL_PORT: '65536',
    INTERNAL_HOST: 'http://bad/path',
    API_PORT: '',
    AUTO_PUBLISH: '1',
    SERVICE_TOKEN: '',
    OWNER_PASSWORD: '',
    OWNER_EMAIL: 'bad',
    WIKI_ROOT: '',
  };
  const parse = () => parseConfig({ ...example, ...invalid });
  for (const key of Object.keys(invalid)) expect(parse).toThrow(key);
  expect(parse).not.toThrow(/secret/);
});

it('defaults the quality rules file to rules/quality.md and keeps model settings optional', () => {
  const parsed = parseConfig(example);
  expect(parsed.QUALITY_RULES_PATH.endsWith('/rules/quality.md')).toBe(true);
  expect(parsed.AI_DEFAULT__MODEL).toBeUndefined();
  expect(parseConfig({ ...example, AI_DEFAULT__MODEL: 'm' }).AI_DEFAULT__MODEL).toBe('m');
});
