import type { components } from '@md-wiki/contracts';
import { formatDateTime, formatTime } from '@md-wiki/domain';
import type { StatusTone } from '../../ui/StatusDot';
import { durationText, jobErrorText } from '../quality/model';

export type JobListDto = components['schemas']['JobListDto'];
export type JobListItemDto = components['schemas']['JobListItemDto'];
export type JobKindSummaryDto = components['schemas']['JobKindSummaryDto'];
export type JobStatus = components['schemas']['JobStatus'];
export type JobKind = components['schemas']['JobKind'];

export const JOB_KINDS = ['quality_check', 'ping'] as const satisfies readonly JobKind[];
export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
] as const satisfies readonly JobStatus[];

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/** The run's outcome in words, and its dot (F-13 *Background jobs* › Result). */
export function jobResult(
  job: JobListItemDto,
  { findings = true }: { findings?: boolean } = {},
): { text: string; tone: StatusTone } {
  switch (job.status) {
    case 'queued':
      return { text: 'Waiting', tone: 'pending' };
    case 'running':
      return { text: 'Running', tone: 'publishing' };
    case 'failed':
      return { text: `Failed: ${jobErrorText(job.error)}`, tone: 'error' };
    case 'succeeded':
      return {
        text: findings && job.findings ? `OK · ${plural(job.findings, 'finding')}` : 'OK',
        tone: 'published',
      };
  }
}

/** F-13 *Background jobs* rows, one per job kind (D-152). */
export function jobKindRows(kinds: readonly JobKindSummaryDto[]) {
  return kinds.map((kind) => {
    const { last } = kind;
    // The frame's Result is the run's health ("OK"); findings are not a job failure.
    const result = last
      ? jobResult(last, { findings: false })
      : { text: 'No runs yet', tone: 'closed' as const };
    const failed = kind.failed24h ? ` · ${String(kind.failed24h)} failed in 24 h` : '';
    const queue = [
      kind.queued && `${String(kind.queued)} waiting`,
      kind.running && `${String(kind.running)} running`,
    ].filter(Boolean);
    return {
      key: kind.kind,
      name: kind.kind,
      last: last
        ? [formatTime(new Date(last.finishedAt ?? last.createdAt)), durationText(last.durationMs)]
            .filter(Boolean)
            .join(' · ')
        : '—',
      result: `${result.text}${failed}`,
      tone: kind.failed24h && result.tone === 'published' ? ('pending' as const) : result.tone,
      queue: queue.length ? queue.join(' · ') : '0',
    };
  });
}

/** F-13 *Worker queue* health card: active runs and the age of the oldest waiting one. */
export function workerQueueHealth(
  kinds: readonly JobKindSummaryDto[],
  items: readonly JobListItemDto[],
  now: Date,
) {
  const active = kinds.reduce((sum, kind) => sum + kind.queued + kind.running, 0);
  const waiting = items
    .filter(({ status }) => status === 'queued')
    .map(({ createdAt }) => Date.parse(createdAt));
  const oldest = waiting.length ? Math.min(...waiting) : null;
  return {
    value: plural(active, 'job'),
    note:
      oldest === null
        ? active
          ? 'None waiting'
          : 'Nothing waiting'
        : `Oldest ${durationText(Math.max(0, now.getTime() - oldest)) ?? ''}`,
    tone: 'published' as const,
  };
}

const TRIGGER_TEXT: Record<JobListItemDto['trigger'], string> = {
  dev: 'Dev ping',
  submit: 'On submit',
  rerun: 'Re-run',
  self_check: 'Self-check',
};

/** Derived *AI jobs* rows (D-16, D-152): metadata only; drafts stay private (D-141). */
export function jobRows(pages: readonly JobListDto[]) {
  return pages.flatMap(({ items }) =>
    items.map((job) => {
      const result = jobResult(job);
      return {
        key: job.id,
        at: job.createdAt,
        when: formatDateTime(new Date(job.createdAt)),
        kind: job.kind,
        trigger: TRIGGER_TEXT[job.trigger],
        subject:
          job.subject?.kind === 'proposal'
            ? { text: job.subject.slug ?? '—', slug: job.subject.slug }
            : job.subject?.kind === 'draft'
              ? { text: 'Private draft', slug: null }
              : { text: '—', slug: null },
        result: result.text,
        tone: result.tone,
        model: [job.model, job.promptVersion].filter(Boolean).join(' · ') || '—',
        tokens:
          job.tokensIn === null && job.tokensOut === null
            ? '—'
            : `${String(job.tokensIn ?? 0)} in · ${String(job.tokensOut ?? 0)} out`,
        duration: durationText(job.durationMs) ?? '—',
      };
    }),
  );
}

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
