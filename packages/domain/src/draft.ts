import { err, ok, type Result } from './result.js';
import { sectionHash, splitSections } from './sections.js';
import { parseStatusBlock } from './status-block.js';

const lineBreak = /\r\n|\r|\n/g;
const endsWithBreak = /(?:\r\n|\r|\n)$/;

export interface Region {
  /** The editable text: the section source (heading to next root heading) or the whole body. */
  text: string;
  /** 1-based first line in the stored file (status block lines counted, D-33). */
  startLine: number;
}

function linesIn(text: string) {
  return text.match(lineBreak)?.length ?? 0;
}

/** The editable region of a stored file for a scope (system-logic §7.2.3). */
export function regionOf(markdown: string | null, section: string | null): Region | null {
  if (markdown === null) return section === null ? { text: '', startLine: 1 } : null;
  if (section === null) {
    const { body } = parseStatusBlock(markdown);
    return { text: body, startLine: linesIn(markdown.slice(0, markdown.length - body.length)) + 1 };
  }
  const found = splitSections(markdown).find((s) => s.anchor === section);
  return found ? { text: found.text, startLine: found.startLine } : null;
}

/**
 * Splice a scoped draft region into the base body (status block stripped). Byte-exact
 * outside the region; one LF is added when a following heading would otherwise join the
 * region's last line.
 */
export function composeProposed(
  baseMarkdown: string | null,
  section: string | null,
  content: string,
): Result<string, 'UNKNOWN_SECTION'> {
  if (baseMarkdown === null || section === null) {
    return baseMarkdown === null && section !== null ? err('UNKNOWN_SECTION') : ok(content);
  }
  const { body } = parseStatusBlock(baseMarkdown);
  const sections = splitSections(body);
  const index = sections.findIndex((s) => s.anchor === section);
  const found = sections[index];
  if (!found) return err('UNKNOWN_SECTION');
  const offsets = [0];
  for (const match of body.matchAll(lineBreak)) offsets.push(match.index + match[0].length);
  const start = offsets[found.startLine - 1] ?? body.length;
  const end = start + found.text.length;
  const followed = index < sections.length - 1;
  const text =
    followed && content !== '' && !endsWithBreak.test(content) ? `${content}\n` : content;
  return ok(body.slice(0, start) + text + body.slice(end));
}

export type RebaseMode = 'auto' | 'keep_mine';
export type RebaseOutcome = { kind: 'noop' } | { kind: 'repin'; content: string };
export type RebaseConflict = 'SECTION_CHANGED' | 'STALE_BASE';

export interface RebaseInput {
  section: string | null;
  content: string;
  base: { markdown: string; sha256: string } | null;
  current: { markdown: string; sha256: string } | null;
  mode: RebaseMode;
}

/** The rebase table of system-logic §7.2.3. */
export function rebasePlan(input: RebaseInput): Result<RebaseOutcome, RebaseConflict> {
  const { section, content, base, current, mode } = input;
  if (base?.sha256 === current?.sha256) return ok({ kind: 'noop' });
  if (base === null || current === null) return err('STALE_BASE');
  const before = regionOf(base.markdown, section);
  const after = regionOf(current.markdown, section);
  if (!after) return err('SECTION_CHANGED');
  if (before && content === before.text) return ok({ kind: 'repin', content: after.text });
  if (section !== null) {
    const unchanged = before !== null && sectionHash(before.text) === sectionHash(after.text);
    if (unchanged || mode === 'keep_mine') return ok({ kind: 'repin', content });
    return err('SECTION_CHANGED');
  }
  return mode === 'keep_mine' ? ok({ kind: 'repin', content }) : err('STALE_BASE');
}

/** Whether a changed target touched the scoped section (DraftDto.sectionChanged). */
export function sectionChangedBetween(
  baseMarkdown: string | null,
  currentMarkdown: string | null,
  section: string | null,
): boolean {
  if (section === null) return baseMarkdown !== currentMarkdown;
  const before = regionOf(baseMarkdown, section);
  const after = regionOf(currentMarkdown, section);
  if (!before || !after) return true;
  return sectionHash(before.text) !== sectionHash(after.text);
}
