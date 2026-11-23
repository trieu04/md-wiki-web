import { createHash, timingSafeEqual } from 'node:crypto';
import { authenticate } from '../auth/auth-http.js';
import { AuthService } from '../auth/auth.service.js';
import { validationPipe } from '../common/validation.js';
import type { INestApplication } from '@nestjs/common';
import type { RequestHandler } from 'express';
import { AppError } from '../common/app-error.js';
import { ProblemFilter } from '../common/problem.filter.js';
import { requestIdMiddleware } from '../common/request-id.middleware.js';

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
    app.use('/api/v1', authenticate(app.get(AuthService)));
    app.setGlobalPrefix('api/v1');
  }
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalPipes(validationPipe());
}
