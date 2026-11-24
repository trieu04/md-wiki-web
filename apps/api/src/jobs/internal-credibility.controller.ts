import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiAcceptedResponse } from '@nestjs/swagger';
import { normalizeSourceRef } from '@md-wiki/domain';
import { AppError } from '../common/app-error.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { CredibilityResults } from './credibility-results.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Internal credibility inputs (system-logic §7.7.12, service token): the same bodies as
 * `/credibility/invalidations` and `/credibility/candidates`, plus scores. Each is recorded as a
 * finished job and applied by the public app like a worker result (D-230).
 */
@Controller('credibility')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('VALIDATION_FAILED')
export class InternalCredibilityController {
  constructor(@Inject(CredibilityResults) private readonly results: CredibilityResults) {}

  @Post('invalidations')
  @HttpCode(202)
  @ApiAcceptedResponse()
  invalidation(@Body() body: unknown) {
    const b = record(body);
    if (typeof b.ref !== 'string')
      throw new AppError('VALIDATION_FAILED', undefined, [
        { path: 'ref', code: 'type', message: 'ref must be a string' },
      ]);
    return this.results.record('retraction_check', {
      checked: 0,
      hits: [
        {
          ref: normalizeSourceRef(b.ref),
          kind: b.kind,
          detail: b.detail,
          source: 'internal',
          noticeDoi: null,
        },
      ],
    });
  }

  @Post('candidates')
  @HttpCode(202)
  @ApiAcceptedResponse()
  candidate(@Body() body: unknown) {
    const b = record(body);
    const candidate = {
      kind: b.kind,
      src: b.src,
      dst: b.dst,
      score: b.score,
      detail: b.detail ?? {},
    };
    return this.results.record(b.kind === 'copy' ? 'copy_candidates' : 'relation_candidates', {
      candidates: [candidate],
    });
  }

  @Post('scores')
  @HttpCode(202)
  @ApiAcceptedResponse()
  scores(@Body() body: unknown) {
    return this.results.record('credibility_score', body);
  }
}
