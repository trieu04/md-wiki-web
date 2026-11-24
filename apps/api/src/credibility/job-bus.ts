import { Subject } from 'rxjs';

/** Credibility job kinds (system-logic §7.7.12). */
export const CREDIBILITY_JOB_KINDS = [
  'retraction_check',
  'copy_candidates',
  'relation_candidates',
  'credibility_score',
] as const;
export type CredibilityJobKind = (typeof CREDIBILITY_JOB_KINDS)[number];
export const isCredibilityJob = (kind: string): kind is CredibilityJobKind =>
  (CREDIBILITY_JOB_KINDS as readonly string[]).includes(kind);

/**
 * One bus per process (like the events bus, D-88): the internal app stores a job's output and
 * names the job here; the public app, which holds the credibility services, applies it (D-230).
 * Outputs that were stored but not applied (a crash in between) are applied at boot.
 */
export const credibilityJobBus = new Subject<string>();
