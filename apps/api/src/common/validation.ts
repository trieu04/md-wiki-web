import {
  Body,
  Param,
  Query,
  ValidationPipe,
  type Type,
  type ValidationError,
} from '@nestjs/common';
import { AppError, type FieldProblem } from './app-error.js';

function fields(errors: ValidationError[], prefix = ''): FieldProblem[] {
  return errors.flatMap((error) => {
    const path = `${prefix}${error.property}`;
    return [
      ...Object.entries(error.constraints ?? {}).map(([code, message]) => ({
        path,
        code,
        message,
      })),
      ...fields(error.children ?? [], `${path}.`),
    ];
  });
}
export const validationPipe = (expectedType?: Type) =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    ...(expectedType && { expectedType }),
    exceptionFactory: (errors) => new AppError('VALIDATION_FAILED', undefined, fields(errors)),
  });
// tsx (dev and contract generation) doesn't emit decorator parameter types.
export const InputBody = (type: Type) => Body(validationPipe(type));
export const InputQuery = (type: Type) => Query(validationPipe(type));
export const InputParams = (type: Type) => Param(validationPipe(type));
