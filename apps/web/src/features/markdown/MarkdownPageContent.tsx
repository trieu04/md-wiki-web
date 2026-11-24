import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { PageArticleModel } from '../page/model';
import { Callout } from '../../ui/Callout';
import { TrustBadge } from '../../ui/TrustBadge';
import { renderMarkdown } from './MarkdownArticle';

export function MarkdownPageContent({
  markdown,
  selected,
  onSelectSection,
  sectionFooter,
}: {
  markdown: PageArticleModel['markdown'];
  selected: string;
  onSelectSection: (anchor: string) => void;
  /** Rendered under the selected section (F-03 *This section:* row). */
  sectionFooter?: (anchor: string) => ReactNode;
}) {
  return (
    <div className="wiki-markdown flex min-w-0 flex-col gap-22px">
      {markdown.groups.map(({ section, heading, warning, content }, index) => (
        <section
          id={section?.anchor}
          key={section?.anchor ?? index}
          aria-label={section?.title || undefined}
          className={`-mx-14px rounded-10 px-14px ${section?.anchor === selected ? 'bg-subtle-section' : ''}`}
        >
          {(heading || section) && (
            <div className="flex flex-wrap items-center justify-between gap-x-14px gap-y-8px">
              {heading && renderMarkdown({ type: 'root', children: [heading] })}
              {section && (
                <span className="inline-flex font-ui">
                  <TrustBadge
                    variant="section"
                    label={section.label.label}
                    context={section.title}
                    onClick={() => {
                      onSelectSection(section.anchor);
                    }}
                  />
                </span>
              )}
            </div>
          )}
          {warning && (
            <div className="font-ui leading-base">
              <Callout tone="warn" title={warning.title}>
                <span>
                  {warning.reason}
                  {warning.fixHref && (
                    <>
                      {' '}
                      <Link
                        to={warning.fixHref}
                        className="font-semibold text-trust-recheck-fg underline hover:text-trust-recheck-note-fg"
                      >
                        See the proposed fix
                      </Link>
                    </>
                  )}
                </span>
              </Callout>
            </div>
          )}
          {renderMarkdown(content)}
          {section && section.anchor === selected && sectionFooter?.(section.anchor)}
        </section>
      ))}
      {markdown.footnotes && renderMarkdown(markdown.footnotes)}
    </div>
  );
}
