import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { WikiPath } from './paths.js';
import { parseStatusBlock } from './status-block.js';

const parser = unified().use(remarkParse).use(remarkGfm).freeze();
export function topicId(path: WikiPath): string {
  const slash = path.path.indexOf('/');
  return slash < 0 ? 'general' : path.path.slice(0, slash);
}
export function topicNames(markdown: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const node of parser.parse(parseStatusBlock(markdown).body).children) {
    if (node.type !== 'table') continue;
    const [header, ...rows] = node.children;
    const keys = header?.children.map((cell) => toString(cell).trim().toLowerCase()) ?? [];
    const folder = keys.indexOf('folder');
    const name = keys.indexOf('name');
    if (folder < 0 || name < 0) continue;
    for (const row of rows) {
      const cells = row.children.map((cell) => toString(cell).trim());
      const id = cells[folder];
      const label = cells[name];
      if (id && label) names.set(id, label);
    }
  }
  return names;
}
export function topicName(id: string, names: ReadonlyMap<string, string>): string {
  return names.get(id) ?? id.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
