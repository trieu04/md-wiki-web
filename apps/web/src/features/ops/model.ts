import type { components } from '@md-wiki/contracts';
import { formatDateTime, formatTime } from '@md-wiki/domain';

export type BlockedTargetDto = components['schemas']['BlockedTargetDto'];
export type ResolutionInput = components['schemas']['ResolutionInput'];
export type AuditEventDto = components['schemas']['AuditEventDto'];
export type AuditPageDto = components['schemas']['AuditPageDto'];

/** F-13's three drawn choices → the two contract outcomes (D-80). */
export type BlockedChoice = 'new' | 'old' | 'neither';
export const BLOCKED_CHOICES: readonly {
  value: BlockedChoice;
  label: string;
  outcome: ResolutionInput['outcome'];
}[] = [
  { value: 'new', label: 'On disk = the new version (mark published)', outcome: 'written' },
  { value: 'old', label: 'On disk = the old version (retry)', outcome: 'not_written' },
  { value: 'neither', label: 'Neither (restore from backup)', outcome: 'not_written' },
];

const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 8) : 'none');

export function blockedModel(target: BlockedTargetDto) {
  const disk =
    target.disk === null
      ? 'File could not be read'
      : target.disk.sha256 === null
        ? 'File missing on disk'
        : `File hash on disk ${short(target.disk.sha256)}`;
  return {
    key: target.publicationId,
    slug: target.slug,
    where: `${target.slug} → ${target.targetPath} · since ${formatTime(new Date(target.since))}`,
    hashes: `${disk} · expected new ${short(target.expected.sha256)} · old ${short(target.old.sha256)}`,
    waiting: target.waiting.length ? `Waiting behind it: ${target.waiting.join(', ')}` : null,
  };
}

/** The *Blocked targets* health card (the other F-13 health cards need Phase 7/8 data). */
export function blockedHealth(items: readonly BlockedTargetDto[]) {
  const pages = [...new Set(items.map(({ targetPath }) => targetPath))];
  return {
    value: String(items.length),
    note: pages.length ? pages.join(', ') : 'None',
    tone: items.length ? ('error' as const) : ('published' as const),
  };
}

/** Validates the evidence text before the resolution request (trimmed 1..4000). */
export function resolutionInput(
  choice: BlockedChoice,
  evidence: string,
): { input: ResolutionInput; error: null } | { input: null; error: string } {
  const trimmed = evidence.trim();
  if (!trimmed) return { input: null, error: 'Say what you checked on disk.' };
  if (trimmed.length > 4000)
    return { input: null, error: 'Keep the evidence under 4000 characters.' };
  const outcome = BLOCKED_CHOICES.find(({ value }) => value === choice)?.outcome ?? 'not_written';
  return { input: { outcome, evidence: trimmed }, error: null };
}

const subject = (event: AuditEventDto) =>
  event.subjectType === 'proposal' && typeof event.data['slug'] === 'string'
    ? `proposal ${event.data['slug']}`
    : `${event.subjectType} ${event.subjectId.slice(0, 8)}`;

/** Derived Audit log rows (D-16, D-101): newest first as the API returns them. */
export function auditRows(pages: readonly AuditPageDto[]) {
  return pages.flatMap(({ items }) =>
    items.map((event) => ({
      key: event.id,
      at: event.at,
      when: formatDateTime(new Date(event.at)),
      action: event.action,
      actor:
        event.actor?.name ??
        (event.actorKind === 'system'
          ? typeof event.data['decisionId'] === 'string'
            ? `system (auto-publish after ${event.data['decisionId'].slice(0, 8)})`
            : 'system'
          : '—'),
      subject: subject(event),
      details: Object.keys(event.data).length ? JSON.stringify(event.data) : '',
    })),
  );
}
