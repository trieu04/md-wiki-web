import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseConfig, weakSecrets } from '../src/config/env.js';

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
        'REVIEWER_AGENT_EMAIL',
        'REVIEWER_AGENT_TOKEN',
        'MAIL_TRANSPORT',
        'CREDIBILITY_RETENTION_DAYS',
      ].includes(key),
  );
  for (const key of required) expect(() => parseConfig({})).toThrow(key);
});

it('defaults the credibility settings (system-logic §7.7.7, §7.7.9)', () => {
  const config = parseConfig({
    ...example,
    MAIL_TRANSPORT: undefined,
    CREDIBILITY_RETENTION_DAYS: undefined,
  });
  expect(config.MAIL_TRANSPORT).toBe('log');
  expect(config.CREDIBILITY_RETENTION_DAYS).toBe(90);
  expect(
    parseConfig({ ...example, CREDIBILITY_RETENTION_DAYS: '30' }).CREDIBILITY_RETENTION_DAYS,
  ).toBe(30);
  expect(() => parseConfig({ ...example, CREDIBILITY_RETENTION_DAYS: '0' })).toThrow(
    'CREDIBILITY_RETENTION_DAYS',
  );
  expect(() => parseConfig({ ...example, MAIL_TRANSPORT: 'smtp' })).toThrow('MAIL_TRANSPORT');
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

it('refuses the example secrets and short service tokens in production only (D-251)', () => {
  const strong = { SERVICE_TOKEN: 'k'.repeat(32), OWNER_PASSWORD: 'correct horse' };
  expect(weakSecrets(strong)).toEqual([]);
  expect(weakSecrets({ ...strong, SERVICE_TOKEN: 'k'.repeat(31) })).toEqual(['SERVICE_TOKEN']);
  expect(
    weakSecrets({
      SERVICE_TOKEN: example.SERVICE_TOKEN ?? '',
      OWNER_PASSWORD: example.OWNER_PASSWORD ?? '',
    }),
  ).toEqual(['SERVICE_TOKEN', 'OWNER_PASSWORD']);
  expect(() => parseConfig({ ...example, NODE_ENV: 'production' })).toThrow(
    'SERVICE_TOKEN, OWNER_PASSWORD',
  );
  expect(() => parseConfig({ ...example, NODE_ENV: 'production' })).not.toThrow(/replace-with/);
  expect(parseConfig({ ...example, NODE_ENV: 'production', ...strong }).SERVICE_TOKEN).toBe(
    'k'.repeat(32),
  );
  expect(parseConfig({ ...example, NODE_ENV: 'development' }).SERVICE_TOKEN).toBe(
    example.SERVICE_TOKEN,
  );
});
