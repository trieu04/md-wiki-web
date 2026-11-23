import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { visualPage } from '../src/dev/fixtures/reading';
import { frameSamples } from '../src/dev/fixtures/samples';
import { MarkdownArticle } from '../src/features/markdown/MarkdownArticle';
import { markdownModel, type PageDto } from '../src/features/markdown/model';

afterEach(cleanup);

function section(anchor: string, level: number, title = anchor): PageDto['sections'][number] {
  return {
    anchor,
    level,
    title,
    hash: '0'.repeat(64),
    label: { label: 'not_reviewed', since: null, reviewerKind: null, reason: null },
    warn: null,
  };
}

it('uses API anchors in document order for duplicates and setext with BOM and CRLF', () => {
  const markdown =
    '\uFEFFLead text\r\n\r\nRepeated\r\n--------\r\n\r\n```md\r\n# Not a heading\r\n```\r\n\r\n> ## Nested heading\r\n\r\n## Repeated\r\nSecond';
  const sections = [
    section('lead', 0),
    section('from-api', 2, 'Repeated'),
    section('from-api-2', 2, 'Repeated'),
  ];
  const { container } = render(<MarkdownArticle markdown={markdown} sections={sections} />);
  expect([...container.querySelectorAll('section')].map(({ id }) => id)).toEqual([
    'lead',
    'from-api',
    'from-api-2',
  ]);
  expect(container.querySelector('#from-api')).toHaveTextContent('# Not a heading');
  expect(container.querySelector('#from-api')).toHaveTextContent('Nested heading');
  expect(container.querySelector('#from-api-2')).toHaveTextContent('Second');
});

it('keeps reference links and footnotes working across sections', () => {
  const markdown =
    'Lead [ref][link] and a note[^1].\n\n## Other\n\n[link]: /wiki/reference.md\n\n[^1]: Note.';
  render(
    <MarkdownArticle markdown={markdown} sections={[section('lead', 0), section('other', 2)]} />,
  );
  expect(screen.getByRole('link', { name: 'ref' })).toHaveAttribute('href', '/wiki/reference.md');
  for (const link of document.querySelectorAll('[data-footnote-ref], [data-footnote-backref]')) {
    const id = link.getAttribute('href')?.slice(1) ?? '';
    expect(document.getElementById(id)).toBeInTheDocument();
  }
  expect(document.querySelector('[data-footnote-ref]')).toBeInTheDocument();
  expect(document.querySelector('[data-footnote-backref]')).toBeInTheDocument();
});

it('returns no sections for empty content and keeps an API lead for lead-only content', () => {
  expect(markdownModel({ markdown: ' \n', sections: [] }).groups).toHaveLength(0);
  const lead = section('lead', 0);
  expect(markdownModel({ markdown: 'Only lead', sections: [lead] }).groups[0]?.section).toBe(lead);
});

it('omits script tags', () => {
  const { container } = render(
    <MarkdownArticle
      markdown={'<script>example()</script>\n\nSafe'}
      sections={[section('lead', 0)]}
    />,
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container).not.toHaveTextContent('example()');
});

it('strips javascript: hrefs but preserves link text', () => {
  render(
    <MarkdownArticle markdown="[Example](javascript:example())" sections={[section('lead', 0)]} />,
  );
  expect(screen.getByText('Example')).not.toHaveAttribute('href');
});

it('omits event-handler attributes', () => {
  const { container } = render(
    <MarkdownArticle
      markdown={'Text <img src="/safe.png" onerror="example()">'}
      sections={[section('lead', 0)]}
    />,
  );
  expect(container.querySelector('[onerror]')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
});

it('does not render raw HTML elements even if ordinarily allowed by the schema', () => {
  const { container } = render(
    <MarkdownArticle markdown="A <strong>raw</strong> tag." sections={[section('lead', 0)]} />,
  );
  expect(container.querySelector('strong')).toBeNull();
});

it('strips data: URLs from images and links', () => {
  render(
    <MarkdownArticle
      markdown="![Image](data:image/png;base64,AAAA) [Link](data:text/plain;base64,AAAA)"
      sections={[section('lead', 0)]}
    />,
  );
  expect(screen.getByRole('img', { name: 'Image' })).not.toHaveAttribute('src');
  expect(screen.getByText('Link')).not.toHaveAttribute('href');
});

it('maps portable wikilinks to local pages and leaves unsafe or invalid targets inert', () => {
  const markdown =
    '[[lab-notes/basics#élève|Basics]] [[guide.md]] [[../secret|Traversal]] [[//example.test|Host]] [[javascript:example()|Scheme]] [[%2e%2e/secret|Encoded]] [[Bad File|Bad]] `[[not-a-link]]`';
  render(<MarkdownArticle markdown={markdown} sections={[section('lead', 0)]} />);
  expect(screen.getByRole('link', { name: 'Basics' })).toHaveAttribute(
    'href',
    '/wiki/lab-notes/basics.md#%C3%A9l%C3%A8ve',
  );
  expect(screen.getByRole('link', { name: 'guide.md' })).toHaveAttribute('href', '/wiki/guide.md');
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.getByText('[[not-a-link]]').tagName).toBe('CODE');
});

it('renders the F-03 section text verbatim, with structured citations deferred (D-47)', () => {
  const { container } = render(<MarkdownArticle {...visualPage} />);
  for (const { id, title, body } of frameSamples.Page.data) {
    const wrapper = container.querySelector(`#${id}`);
    expect(wrapper).toHaveTextContent(title);
    expect(wrapper?.querySelector('p')?.textContent).toBe(body);
  }
  expect(screen.queryByRole('heading', { name: 'Sources' })).not.toBeInTheDocument();
});
