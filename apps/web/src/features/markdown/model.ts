import type { components } from '@md-wiki/contracts';
import { validateWikiPath } from '@md-wiki/domain';
import type { Element, Root, RootContent } from 'hast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkWikiLink from 'remark-wiki-link';
import { unified } from 'unified';

export type PageDto = components['schemas']['PageDto'];
type SectionDto = PageDto['sections'][number];

export function wikiLinkHref(target: string): string | undefined {
  const [rawPath, anchor, ...extra] = target.trim().split('#');
  if (!rawPath || extra.length || Array.from(target).some((char) => char.charCodeAt(0) < 32))
    return;
  const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
  if (!validateWikiPath(path).ok) return;
  try {
    return `/wiki/${path}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
  } catch {
    return undefined;
  }
}

const headingAttributes = Object.fromEntries(
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => [
    tag,
    [...(defaultSchema.attributes?.[tag] ?? []), 'id'],
  ]),
);
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkWikiLink, {
    aliasDivider: '|',
    pageResolver: (target: string) => [target],
    hrefTemplate: wikiLinkHref,
  })
  .use(remarkRehype, { clobberPrefix: '', footnoteLabel: 'Sources', footnoteLabelProperties: {} })
  .use(rehypeSanitize, {
    ...defaultSchema,
    attributes: { ...defaultSchema.attributes, ...headingAttributes },
  })
  .freeze();

function repairFootnoteLinks(node: Root | RootContent) {
  if (node.type === 'element' && node.tagName === 'a') {
    const { dataFootnoteRef, dataFootnoteBackref, href } = node.properties;
    if (
      (dataFootnoteRef != null || dataFootnoteBackref != null) &&
      typeof href === 'string' &&
      href.startsWith('#')
    ) {
      // Sanitize prefixes generated IDs to prevent DOM clobbering, but not URL fragments.
      node.properties.href = `#${defaultSchema.clobberPrefix ?? ''}${href.slice(1)}`;
    }
  }
  if ('children' in node) node.children.forEach(repairFootnoteLinks);
}

function root(children: RootContent[] = []): Root {
  return { type: 'root', children };
}

export interface MarkdownSection {
  section: SectionDto | undefined;
  content: Root;
}

export function markdownModel({ markdown, sections }: Pick<PageDto, 'markdown' | 'sections'>) {
  const tree = processor.runSync(processor.parse(markdown));
  repairFootnoteLinks(tree);
  // The API partitions by top-level headings in document order (D-1). Keep one
  // parse for the entire file, so reference links and footnotes work across sections.
  const groups: MarkdownSection[] = [];
  let index = 0;
  let group: MarkdownSection = {
    section: sections[0]?.level === 0 ? sections[index++] : undefined,
    content: root(),
  };
  let footnotes: Element | undefined;
  for (const node of tree.children) {
    if (node.type === 'element') {
      if (node.tagName === 'section' && Object.hasOwn(node.properties, 'dataFootnotes')) {
        footnotes = node;
        continue;
      }
      if (/^h[1-6]$/.test(node.tagName)) {
        if (
          group.section ||
          group.content.children.some((child) => child.type !== 'text' || child.value.trim())
        ) {
          groups.push(group);
        }
        const section = sections[index++];
        group = {
          section: section?.level === Number(node.tagName.slice(1)) ? section : undefined,
          content: root(),
        };
      }
    }
    group.content.children.push(node);
  }
  if (group.section || group.content.children.length) groups.push(group);
  return { groups, footnotes: footnotes ? root([footnotes]) : undefined };
}
