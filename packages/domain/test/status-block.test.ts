import { expect, it } from 'vitest';
import {
  containsReservedMarker,
  parseStatusBlock,
  renderStatusBlock,
  type StatusBlock,
} from '../src/status-block.js';

const block: StatusBlock = {
  proposal: 'change-title-2',
  decision: '019ab789-97fd-72dc-b74c-2321af809fe6',
  reviewer: 'agent',
  decided_at: '2026-11-23T10:42:00Z',
};
const header = `<!-- md-wiki:status\nproposal: change-title-2\ndecision: 019ab789-97fd-72dc-b74c-2321af809fe6\nreviewer: agent\ndecided_at: 2026-11-23T10:42:00Z\n-->\n\n`;
const body = '\n# New title  \r\n\nContent with no final newline';

it.each(['\n', '\r\n'])(
  'round trips a header with %j delimiters without touching the body',
  (eol) => {
    const source = header.replaceAll('\n', eol) + body;
    const parsed = parseStatusBlock(source);
    expect(parsed).toEqual({
      block: { ...block, ...(eol === '\r\n' && { lineEnding: eol }) },
      body,
    });
    if (!parsed.block) throw new Error('expected a status block');
  expect(renderStatusBlock(parsed.block) + parsed.body).toBe(source);
  },
);

it('renders the specified artifact prefix and reads person decisions with UTC milliseconds', () => {
  expect(renderStatusBlock(block)).toBe(header);
  const person = { ...block, reviewer: 'person', decided_at: '2026-11-23T10:42:00.123Z' } as const;
  expect(parseStatusBlock(renderStatusBlock(person))).toEqual({ block: person, body: '' });
});

it.each([
  header.trimEnd(),
  header.slice(0, -1),
  header.replace('agent', 'owner'),
  header.replace('change-title-2', 'change title'),
  header.replace(block.decision, 'not-a-uuid'),
  header.replace('11-23', '02-30'),
  header.replace('decided_at:', 'time:'),
  header.replace('-->', ''),
])('retains malformed input and warns', (invalid) => {
  expect(parseStatusBlock(invalid + body.trimStart())).toEqual({
    block: null,
    body: invalid + body.trimStart(),
    warning: 'MALFORMED_STATUS_BLOCK',
  });
});

it('distinguishes no block from a reserved marker later in content', () => {
  expect(containsReservedMarker(body)).toBe(false);
  const content = body + '\n```\n<!-- md-wiki:status\n```';
  expect(containsReservedMarker(content)).toBe(true);
  expect(parseStatusBlock(content)).toEqual({ block: null, body: content });
});
