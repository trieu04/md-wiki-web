import { Fragment, useMemo, type ReactElement } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Root } from 'hast';
import { markdownModel, type PageDto } from './model';
import './markdown.css';

export function renderMarkdown(tree: Root) {
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    // Match DOM widths without emitting invalid `align` attributes in React.
    tableCellAlignToStyle: true,
  }) as ReactElement;
}

/** The markdown region of F-03; the page shell and trust controls belong to P3-04. */
export function MarkdownArticle({ markdown, sections }: Pick<PageDto, 'markdown' | 'sections'>) {
  const model = useMemo(() => markdownModel({ markdown, sections }), [markdown, sections]);
  return (
    <div className="wiki-markdown flex min-w-0 flex-col gap-22px">
      {model.groups.map(({ section, content }, index) => (
        <section
          key={section?.anchor ?? index}
          id={section?.anchor}
          aria-label={section?.title || undefined}
        >
          {renderMarkdown(content)}
        </section>
      ))}
      {model.footnotes && renderMarkdown(model.footnotes)}
    </div>
  );
}
