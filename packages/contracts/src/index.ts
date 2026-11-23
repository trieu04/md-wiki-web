export { createApiClient } from './client.js';
export type { ApiClientOptions } from './client.js';
export type { paths, components, operations } from './schema.js';
export type { JobEnvelope, JobKind } from './jobs/envelope.js';
export type { PingInput } from './jobs/ping.input.js';
export type { PingOutput } from './jobs/ping.output.js';
export type { JobResult } from './jobs/result.js';
export type { QualityCheckInput } from './jobs/quality_check.input.js';
export type { QualityCheckOutput } from './jobs/quality_check.output.js';

export const contractsPlaceholder = 'md-wiki-contracts';
