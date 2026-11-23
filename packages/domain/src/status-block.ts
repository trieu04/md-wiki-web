const marker = '<!-- md-wiki:status';

export interface StatusBlock {
  proposal: string;
  decision: string;
  reviewer: 'agent' | 'person';
  decided_at: string;
  /** Canonical blocks use LF; retain the delimiter when reading a CRLF artifact. */
  lineEnding?: '\n' | '\r\n';
}

export interface ParsedStatusBlock {
  block: StatusBlock | null;
  body: string;
  warning?: 'MALFORMED_STATUS_BLOCK';
}

export function containsReservedMarker(md: string): boolean {
  return md.includes(marker);
}

export function renderStatusBlock(block: StatusBlock): string {
  return [
    marker,
    `proposal: ${block.proposal}`,
    `decision: ${block.decision}`,
    `reviewer: ${block.reviewer}`,
    `decided_at: ${block.decided_at}`,
    '-->',
    '',
    '',
  ].join(block.lineEnding ?? '\n');
}

// Match only a complete header, including its blank separator. Do not split or
// normalise the body: publication receipts bind to the original bytes.
const header =
  /^<!-- md-wiki:status(\r?\n)proposal: ([a-z0-9]+(?:-[a-z0-9]+)*)\1decision: ([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})\1reviewer: (agent|person)\1decided_at: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\1-->\1\1/;

export function parseStatusBlock(md: string): ParsedStatusBlock {
  if (!md.startsWith(marker)) return { block: null, body: md };
  const match = header.exec(md);
  if (match) {
    const [, eol, proposal, decision, reviewer, decided_at] = match;
    if (proposal && decision && (reviewer === 'agent' || reviewer === 'person') && decided_at) {
      const date = new Date(decided_at);
      // Date.parse rolls some invalid days/hours forward instead of returning NaN.
      if (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 19) === decided_at.slice(0, 19)
      ) {
        return {
          block: {
            proposal,
            decision,
            reviewer,
            decided_at,
            ...(eol === '\r\n' && { lineEnding: eol }),
          },
          body: md.slice(match[0].length),
        };
      }
    }
  }
  return { block: null, body: md, warning: 'MALFORMED_STATUS_BLOCK' };
}
