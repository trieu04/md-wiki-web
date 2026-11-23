import { createHash, timingSafeEqual } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication, ValidationError } from '@nestjs/common';
import type { RequestHandler } from 'express';
import { AppError } from '../common/app-error.js';
import type { FieldProblem } from '../common/app-error.js';
import { ProblemFilter } from '../common/problem.filter.js';
import { requestIdMiddleware } from '../common/request-id.middleware.js';

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

function serviceAuth(token: string): RequestHandler {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${token}`);
  return (req, _res, next) => {
    next(
      timingSafeEqual(expected, digest(req.get('Authorization') ?? ''))
        ? undefined
        : new AppError('UNAUTHENTICATED'),
    );
  };
}

export function configureHttp(
  app: INestApplication,
  listener: { public: true } | { serviceToken: string },
): void {
  app.use(requestIdMiddleware);
  if ('serviceToken' in listener) {
    app.use(serviceAuth(listener.serviceToken));
    app.setGlobalPrefix('internal/v1');
  } else {
    app.setGlobalPrefix('api/v1');
  }
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => new AppError('VALIDATION_FAILED', undefined, fields(errors)),
    }),
  );
}
