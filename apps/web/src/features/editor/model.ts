import type { components } from '@md-wiki/contracts';
import { diffStats, formatTime, lineDiff, splitLines } from '@md-wiki/domain';
import { ApiError } from '../../lib/api';
import type { DiffRow } from '../../ui/DiffView';
import type { MarkdownFormat } from '../../ui/MarkdownToolbar';
import { editorHref, pageHref } from '../page/model';

export type DraftDto = components['schemas']['DraftDto'];
export type ProposalDto = components['schemas']['ProposalDto'];
export type AppliesTo = DraftDto['appliesTo'][number];
/** The locally edited fields that autosave sends (system-logic §7.2.9). */
export type DraftPatch = Partial<Pick<DraftDto, 'content' | 'reason' | 'appliesTo'>>;

export const AUTOSAVE_MS = 800;

export { editorHref };

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

export function editorHeaderModel(draft: DraftDto, { saving }: { saving: boolean }) {
  const scope = draft.section ? `section #${draft.section}` : 'whole page';
  const from = draft.base ? `editing from version ${draft.base.versionLabel}` : 'new page';
  return {
    path: draft.targetPath,
    pageHref: pageHref(draft.targetPath),
    title: draft.sectionTitle ? `Suggest an edit · ${draft.sectionTitle}` : 'Suggest an edit',
    subtitle: `${saving ? 'Saving…' : `Draft saved ${formatTime(new Date(draft.updatedAt))}`} · ${from} · ${scope}`,
    wholePageAction: draft.section !== null,
    canExport: draft.base !== null,
  };
}

/** The frame's `baseChanged` banner; copy depends on whether the edited section moved. */
export function baseChangedModel(draft: DraftDto) {
  if (!draft.baseChanged) return null;
  const version = draft.current ? `Version ${draft.current.versionLabel}` : 'A newer version';
  const what =
    draft.current === null
      ? 'The page was removed since you started.'
      : draft.sectionChanged && draft.section
        ? `${version} touched #${draft.section}.`
        : `${version} changed other parts of the page.`;
  return {
    title: draft.current === null ? 'The page is gone.' : 'The page changed since you started.',
    text: `${what} Rebase before submitting; your text is kept.`,
  };
}

/**
 * Changes tab rows: the changed lines only, numbered in the page (F-06). With `againstCurrent`
 * (after SECTION_CHANGED) the comparison is the current section text → the draft.
 */
export function changesModel(draft: DraftDto, content: string, againstCurrent = false) {
  const before = againstCurrent && draft.currentText !== null ? draft.currentText : draft.baseText;
  const lines = lineDiff(before, content, draft.baseStartLine);
  const rows: DiffRow[] = lines.flatMap((line) =>
    line.kind === 'same'
      ? []
      : [
          {
            kind: line.kind,
            number: line.kind === 'add' ? line.newLine : line.oldLine,
            text: line.text,
          },
        ],
  );
  const stats = diffStats(lines);
  const parts = [
    stats.changed && `${plural(stats.changed, 'line')} changed`,
    stats.added && `${plural(stats.added, 'line')} added`,
    stats.removed && `${plural(stats.removed, 'line')} removed`,
    stats.footnotesAdded && `${plural(stats.footnotesAdded, 'footnote')} added`,
  ].filter((part): part is string => typeof part === 'string');
  return {
    rows,
    summary: parts.length ? parts.join(' · ') : 'No changes',
    scope: draft.section ? `Only #${draft.section} is in scope` : 'The whole page is in scope',
  };
}

/** One gutter number per source line, offset by where the region starts in the page. */
export function gutterModel(startLine: number, content: string) {
  const count = Math.max(1, splitLines(content).length + (content.endsWith('\n') ? 1 : 0));
  return Array.from({ length: count }, (_, index) => startLine + index);
}

export function sourcesModel(draft: DraftDto) {
  return [
    ...draft.sources.map((source) => ({
      path: source.path,
      meta: source.changed
        ? `Version ${source.versionLabel} · changed since you pinned it`
        : `Version ${source.versionLabel} · pinned when you added it`,
      changed: source.changed,
      removable: true,
    })),
    ...(draft.base
      ? [
          {
            path: `${draft.targetPath} (target)`,
            meta: `Version ${draft.base.versionLabel} · read when you opened the editor`,
            changed: false,
            removable: false,
          },
        ]
      : []),
  ];
}

const joinNames = new Intl.ListFormat('en-GB');

/** *After you submit* (D-67, D-150): the quality check runs on every submission (Phase 7). */
export function afterSubmitModel(maintainers: readonly string[] | null | undefined) {
  const who = maintainers?.length ? joinNames.format(maintainers) : "the page's authors";
  return [
    'Quality check (about 2 min)',
    `A reviewer decides, or escalates to ${who}`,
    'If approved: published automatically',
  ];
}

export function submitModel(draft: DraftDto) {
  return draft.baseChanged
    ? { label: 'Rebase before submitting', disabled: true }
    : { label: 'Submit proposal', disabled: false };
}

/** Drop the fields the server has stored; keep anything typed after the request was sent. */
export function settlePatch(pending: DraftPatch, sent: DraftPatch): DraftPatch {
  const next: DraftPatch = { ...pending };
  if ('content' in sent && next.content === sent.content) delete next.content;
  if ('reason' in sent && next.reason === sent.reason) delete next.reason;
  if ('appliesTo' in sent && next.appliesTo === sent.appliesTo) delete next.appliesTo;
  return next;
}

export function isEmptyPatch(patch: DraftPatch) {
  return Object.keys(patch).length === 0;
}

/** The submit/save failure shown in the aside, and the field it belongs to. */
export function submitErrorModel(error: unknown) {
  if (!(error instanceof ApiError)) return { field: null, code: 'INTERNAL' as const };
  if (error.fields.includes('reason')) return { field: 'reason' as const, code: error.code };
  return { field: null, code: error.code };
}

export function addAppliesTo(rows: readonly AppliesTo[], name: string, version: string) {
  const row = { name: name.trim(), version: version.trim() };
  if (!row.name || !row.version)
    return { ok: false as const, error: 'Enter a name and a version.' };
  if (rows.some((existing) => existing.name.toLowerCase() === row.name.toLowerCase()))
    return { ok: false as const, error: `${row.name} is already listed.` };
  return { ok: true as const, rows: [...rows, row] };
}

export type Selection = { text: string; start: number; end: number };

/** Apply a toolbar format to the selection, returning the new text and selection. */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): Selection {
  const selected = text.slice(start, end);
  const wrap = (before: string, after: string, placeholder: string) => {
    const inner = selected || placeholder;
    return {
      text: text.slice(0, start) + before + inner + after + text.slice(end),
      start: start + before.length,
      end: start + before.length + inner.length,
    };
  };
  switch (format) {
    case 'bold':
      return wrap('**', '**', 'bold text');
    case 'italic':
      return wrap('_', '_', 'text');
    case 'link':
      return wrap('[', '](page.md)', 'link text');
    case 'heading': {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const prefix = text.startsWith('#', lineStart) ? '#' : '## ';
      return {
        text: text.slice(0, lineStart) + prefix + text.slice(lineStart),
        start: start + prefix.length,
        end: end + prefix.length,
      };
    }
    case 'footnote': {
      const used = new Set(Array.from(text.matchAll(/\[\^(\d+)\]/g), (match) => Number(match[1])));
      let n = 1;
      while (used.has(n)) n++;
      const marker = `[^${String(n)}]`;
      const body = text.slice(0, end) + marker + text.slice(end);
      const definition = `${body.endsWith('\n') ? '' : '\n'}\n${marker}: `;
      return {
        text: body + definition,
        start: body.length + definition.length,
        end: body.length + definition.length,
      };
    }
    case 'table': {
      const table = '| Column | Column |\n| --- | --- |\n| Value | Value |\n';
      const before = start === 0 || text[start - 1] === '\n' ? '' : '\n';
      const inserted = `${before}${table}`;
      return {
        text: text.slice(0, start) + inserted + text.slice(end),
        start: start + before.length,
        end: start + inserted.length,
      };
    }
  }
}
