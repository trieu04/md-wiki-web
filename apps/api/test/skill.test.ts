import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpTools } from '../src/mcp/mcp-tools.js';

/** The agent skill (P6-03) names only tools and endpoints that exist, and documents every tool. */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const skill = join(root, 'skills/wiki-knowledge-workflow');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
  );
const text = files(skill)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const tools = new McpTools(
  ...([null, null, null, null, null] as unknown as ConstructorParameters<typeof McpTools>),
).tools.map((t) => t.name);
const openapi = JSON.parse(readFileSync(join(root, 'packages/contracts/openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};

describe('agent skill', () => {
  it('has the entry point with front matter', () => {
    const main = readFileSync(join(skill, 'SKILL.md'), 'utf8');
    expect(main).toMatch(/^---\nname: wiki-knowledge-workflow\ndescription: .+\n---\n/);
    for (const link of main.matchAll(/\]\((references\/[a-z-]+\.md)\)/g))
      expect(() => readFileSync(join(skill, link[1] ?? ''), 'utf8')).not.toThrow();
  });

  it('documents every MCP tool and names no unknown one', () => {
    const named = new Set(
      [
        ...text.matchAll(
          /`((?:wiki|contribution|topic|proposal_discussion|dispute|review)_[a-z_]+)/g,
        ),
      ].map((m) => m[1]),
    );
    for (const tool of tools) expect(named, tool).toContain(tool);
    for (const name of named) expect(tools, name).toContain(name);
  });

  it('names only REST endpoints that exist', () => {
    const known = Object.entries(openapi.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${path.replace(/^\/api\/v1/, '')}`),
    );
    const pattern = (p: string) =>
      new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+').replace(/\//g, '\\/')}$`);
    const used = [...text.matchAll(/`(GET|POST|PATCH|DELETE) (\/[^`?\s]+)/g)].map(
      (m) => `${m[1] ?? ''} ${m[2] ?? ''}`,
    );
    expect(used.length).toBeGreaterThan(10);
    for (const endpoint of used)
      expect(
        known.some((k) => pattern(k).test(endpoint)),
        endpoint,
      ).toBe(true);
  });
});
