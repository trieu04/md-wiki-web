import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ERROR_STATUS } from '@md-wiki/domain';
import type { ErrorCode } from '@md-wiki/domain';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { AppError } from './app-error.js';

const httpErrors: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

function errorCode(exception: unknown): ErrorCode {
  if (exception instanceof HttpException) return httpErrors[exception.getStatus()] ?? 'INTERNAL';
  // Express parser failures can reach the filter without a Nest HttpException wrapper.
  if (exception instanceof Error && 'status' in exception && 'type' in exception) {
    if (exception.status === 413 && exception.type === 'entity.too.large')
      return 'PAYLOAD_TOO_LARGE';
    if (exception.status === 400 && exception.type === 'entity.parse.failed')
      return 'VALIDATION_FAILED';
  }
  return 'INTERNAL';
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = exception instanceof AppError ? exception : new AppError(errorCode(exception));
    const status = ERROR_STATUS[problem.code];
    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: STATUS_CODES[status],
        status,
        code: problem.code,
        detail: problem.detail,
        fields: problem.fields,
        requestId: res.getHeader('X-Request-Id'),
      });
  }
}
