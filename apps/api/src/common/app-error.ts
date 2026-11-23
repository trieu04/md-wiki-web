import type { ErrorCode } from '@md-wiki/domain';

export interface FieldProblem {
  path: string;
  code: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly fields?: FieldProblem[],
    /** Seconds for a `Retry-After` header (RATE_LIMITED). */
    readonly retryAfter?: number,
  ) {
    super(detail ?? code);
  }
}
