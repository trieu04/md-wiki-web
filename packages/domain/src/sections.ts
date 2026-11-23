import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parseStatusBlock } from './status-block.js';

export interface Section {
  anchor: string;
  title: string;
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

const parser = unified().use(remarkParse).use(remarkGfm).freeze();
const lineBreak = /\r\n|\r|\n/g;

export function sectionHash(text: string): string {
  const lines = text.split(lineBreak).map((line) => line.trimEnd());
  while (lines.at(-1) === '') lines.pop();
  return bytesToHex(sha256(lines.join('\n') + '\n'));
}

export function splitSections(markdown: string): Section[] {
  const { body } = parseStatusBlock(markdown);
  if (!body.trim()) return [];
  const prefix = markdown.slice(0, markdown.length - body.length);
  const removedLines = prefix.match(lineBreak)?.length ?? 0;
  // Slice the original source, not re-serialised mdast: keep BOM, line endings,
  // and setext underlines in text. A terminal newline ends the last physical line.
  const offsets = [0];
  for (const match of body.matchAll(lineBreak)) {
    const next = match.index + match[0].length;
    if (next < body.length) offsets.push(next);
  }

  const slugger = new GithubSlugger();
  slugger.slug('lead');
  const starts: Pick<Section, 'anchor' | 'level' | 'title' | 'startLine'>[] = [
    { anchor: 'lead', level: 0, title: 'Lead', startLine: 1 },
  ];
  for (const node of parser.parse(body).children) {
    if (node.type !== 'heading' || !node.position) continue;
    const title = toString(node, { includeHtml: false });
    starts.push({
      anchor: slugger.slug(title),
      level: node.depth,
      title,
      startLine: node.position.start.line,
    });
  }

  const sections: Section[] = [];
  for (const [i, start] of starts.entries()) {
    const endLine = (starts[i + 1]?.startLine ?? offsets.length + 1) - 1;
    const text = body.slice(offsets[start.startLine - 1], offsets[endLine]);
    if (start.level === 0 && !text.trim()) continue;
    sections.push({
      ...start,
      startLine: start.startLine + removedLines,
      endLine: endLine + removedLines,
      text,
      hash: sectionHash(text),
    });
  }
  return sections;
}

export function pageTitle(path: string, sections: readonly Section[]): string {
  const h1 = sections.find((section) => section.level === 1);
  if (h1) return h1.title;
  const name = path.slice(path.lastIndexOf('/') + 1, -3).replace(/[-_]/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
