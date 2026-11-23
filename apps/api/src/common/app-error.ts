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
  ) {
    super(detail ?? code);
  }
}
