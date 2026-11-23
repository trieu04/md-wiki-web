import type { JobResult, PingInput, PingOutput } from '@md-wiki/contracts';
import inputSchema from '@md-wiki/contracts/jobs/ping.input.schema.json' with { type: 'json' };
import outputSchema from '@md-wiki/contracts/jobs/ping.output.schema.json' with { type: 'json' };
import resultSchema from '@md-wiki/contracts/jobs/result.schema.json' with { type: 'json' };
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import type { ApiBodyOptions } from '@nestjs/swagger';
import { AppError } from '../common/app-error.js';

export type SchemaObject = Exclude<
  Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  { $ref: string }
>;

const validator = new Ajv2020({ allErrors: true });
validator.addSchema(outputSchema, 'ping.output.schema.json');
const pingInput = validator.compile<PingInput>(inputSchema);
const pingOutput = validator.compile<PingOutput>(outputSchema);
const jobResult = validator.compile<JobResult>(resultSchema);
const jobError = validator.compile<Extract<JobResult, { status: 'failed' }>['error']>(
  resultSchema.$defs.JobError,
);

function read<T>(validate: ValidateFunction<T>, body: unknown): T {
  if (validate(body)) return body;
  throw new AppError(
    'VALIDATION_FAILED',
    undefined,
    validate.errors?.map((error) => ({
      path: error.instancePath.slice(1).replaceAll('/', '.'),
      code: error.keyword,
      message: error.message ?? 'Invalid value',
    })),
  );
}

export const readPingInput = (body: unknown): PingInput => read(pingInput, body);
export const readPingOutput = (body: unknown): PingOutput => read(pingOutput, body);
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
