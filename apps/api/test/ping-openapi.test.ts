import { ERROR_STATUS } from '@md-wiki/domain';
import { expect, it } from 'vitest';
import openapi from '../../../packages/contracts/openapi.json' with { type: 'json' };

it('documents ping, health and internal job errors as the shared problem response', () => {
  const paths = openapi.paths;
  const operations = [
    [paths['/api/v1/dev/ping'].post, ['VALIDATION_FAILED']],
    [paths['/api/v1/dev/ping/{id}'].get, ['NOT_FOUND']],
    [paths['/api/v1/health'].get, ['INTERNAL']],
    [
      paths['/internal/v1/jobs/{id}/input'].get,
      ['UNAUTHENTICATED', 'NOT_FOUND', 'PRECONDITION_FAILED'],
    ],
    [
      paths['/internal/v1/jobs/{id}/result'].post,
      ['VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND', 'PRECONDITION_FAILED'],
    ],
  ] as const;

  for (const [operation, codes] of operations) {
    const errors = Object.fromEntries(
      Object.entries(operation.responses).filter(([status]) => Number(status) >= 400),
    );
    expect(errors).toEqual(
      Object.fromEntries(
        codes.map((code) => [
          ERROR_STATUS[code],
          {
            description: code,
            content: {
              'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDto' } },
            },
          },
        ]),
      ),
    );
  }
});

it('documents the required and optional problem fields and the closed error code enum', () => {
  const { ProblemDto, ErrorCode, FieldProblemDto } = openapi.components.schemas;
  expect(ProblemDto).toEqual({
    type: 'object',
    required: ['type', 'title', 'status', 'code', 'requestId'],
    properties: {
      type: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'integer' },
      code: { allOf: [{ $ref: '#/components/schemas/ErrorCode' }] },
      detail: { type: 'string' },
      requestId: { type: 'string' },
      fields: { type: 'array', items: { $ref: '#/components/schemas/FieldProblemDto' } },
    },
  });
  expect(ErrorCode).toEqual({ type: 'string', enum: Object.keys(ERROR_STATUS) });
  expect(FieldProblemDto).toEqual({
    type: 'object',
    required: ['path', 'code', 'message'],
    properties: { path: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } },
  });
});
