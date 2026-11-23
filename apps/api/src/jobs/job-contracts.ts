import type {
  AgentReviewInput,
  AgentReviewOutput,
  JobResult,
  PingInput,
  PingOutput,
  QualityCheckInput,
  QualityCheckOutput,
} from '@md-wiki/contracts';
import inputSchema from '@md-wiki/contracts/jobs/ping.input.schema.json' with { type: 'json' };
import outputSchema from '@md-wiki/contracts/jobs/ping.output.schema.json' with { type: 'json' };
import qualityInputSchema from '@md-wiki/contracts/jobs/quality_check.input.schema.json' with { type: 'json' };
import qualityOutputSchema from '@md-wiki/contracts/jobs/quality_check.output.schema.json' with { type: 'json' };
import agentInputSchema from '@md-wiki/contracts/jobs/agent_review.input.schema.json' with { type: 'json' };
import agentOutputSchema from '@md-wiki/contracts/jobs/agent_review.output.schema.json' with { type: 'json' };
import resultSchema from '@md-wiki/contracts/jobs/result.schema.json' with { type: 'json' };
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import type { ApiBodyOptions } from '@nestjs/swagger';
import { AppError } from '../common/app-error.js';

export type SchemaObject = Exclude<
  Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  { $ref: string }
>;

const validator = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  formats: { uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
});
validator.addSchema(outputSchema, 'ping.output.schema.json');
validator.addSchema(qualityOutputSchema, 'quality_check.output.schema.json');
validator.addSchema(agentOutputSchema, 'agent_review.output.schema.json');
const pingInput = validator.compile<PingInput>(inputSchema);
const pingOutput = validator.getSchema<PingOutput>('ping.output.schema.json');
const qualityInput = validator.compile<QualityCheckInput>(qualityInputSchema);
const qualityOutput = validator.getSchema<QualityCheckOutput>('quality_check.output.schema.json');
const agentInput = validator.compile<AgentReviewInput>(agentInputSchema);
const agentOutput = validator.getSchema<AgentReviewOutput>('agent_review.output.schema.json');
const jobResult = validator.compile<JobResult>(resultSchema);
const jobError = validator.compile<Extract<JobResult, { status: 'failed' }>['error']>(
  resultSchema.$defs.JobError,
);
if (!pingOutput || !qualityOutput || !agentOutput) throw new Error('job output schemas did not compile');

function read<T>(validate: ValidateFunction<T>, body: unknown, prefix = ''): T {
  if (validate(body)) return body;
  throw new AppError(
    'VALIDATION_FAILED',
    undefined,
    validate.errors?.map((error) => ({
      path: `${prefix}${error.instancePath.slice(1).replaceAll('/', '.')}`,
      code: error.keyword,
      message: error.message ?? 'Invalid value',
    })),
  );
}

export const readPingInput = (body: unknown): PingInput => read(pingInput, body);
export const readPingOutput = (body: unknown): PingOutput => read(pingOutput, body);
export const readQualityInput = (body: unknown): QualityCheckInput => read(qualityInput, body);
export const readQualityOutput = (body: unknown): QualityCheckOutput =>
  read(qualityOutput, body, 'output.');
export const readAgentInput = (body: unknown): AgentReviewInput => read(agentInput, body);
export const readAgentOutput = (body: unknown): AgentReviewOutput =>
  read(agentOutput, body, 'output.');
export const readJobResult = (body: unknown): JobResult => read(jobResult, body);
export const readJobError = (body: unknown) => read(jobError, body);

// Ping's canonical schemas use only JSON Schema keywords also supported by OpenAPI 3.0.
function openApiObject(schema: typeof inputSchema | typeof outputSchema): SchemaObject {
  return {
    title: schema.title,
    type: 'object',
    properties: schema.properties,
    required: schema.required,
    additionalProperties: schema.additionalProperties,
  };
}
export const pingInputDoc = openApiObject(inputSchema);
export const pingOutputDoc = openApiObject(outputSchema);
export const jobErrorDoc: SchemaObject = { ...resultSchema.$defs.JobError, type: 'object' };
