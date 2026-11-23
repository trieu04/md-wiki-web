import type { QualityCheckInput } from '@md-wiki/contracts';
import { parseStatusBlock } from '@md-wiki/domain';

/** Total block text a run may carry; larger inputs fail as `input_too_large` (§7.6.3). */
export const INPUT_TEXT_LIMIT = 2_000_000;

type Block = QualityCheckInput['blocks'][number];
export interface BlockSources {
  targetPath: string;
  title: string;
  reason: string;
  proposed: Uint8Array;
  base: { versionLabel: string | null; content: Uint8Array } | null;
  sources: { path: string; versionLabel: string; content: Uint8Array }[];
}

const utf8 = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
/** Status blocks are review metadata, not page text (§7.6.3). */
const body = (bytes: Uint8Array) => parseStatusBlock(utf8(bytes)).body;

/** The fenced data blocks of a run, in contract order (§7.6.3, D-133). */
export function qualityBlocks(src: BlockSources): Block[] {
  const blocks: Block[] = [];
  if (src.title.trim())
    blocks.push({ id: 'title', kind: 'proposal', label: 'title', text: src.title });
  if (src.reason.trim())
    blocks.push({ id: 'reason', kind: 'proposal', label: 'reason', text: src.reason });
  blocks.push({
    id: 'proposed',
    kind: 'proposal',
    label: `${src.targetPath} (proposed)`,
    text: utf8(src.proposed),
  });
  if (src.base)
    blocks.push({
      id: 'base',
      kind: 'base',
      label: `${src.targetPath}@${src.base.versionLabel ?? 'base'}`,
      text: body(src.base.content),
    });
  src.sources.forEach((s, i) =>
    blocks.push({
      id: `source-${String(i + 1)}`,
      kind: 'source',
      label: `${s.path}@${s.versionLabel}`,
      text: body(s.content),
    }),
  );
  return blocks;
}

export const blockTextLength = (blocks: readonly Block[]) =>
  blocks.reduce((n, b) => n + b.text.length, 0);
