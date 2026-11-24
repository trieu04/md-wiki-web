import { createHash, timingSafeEqual } from 'node:crypto';
import { authenticate } from '../auth/auth-http.js';
import { AuthService } from '../auth/auth.service.js';
import { validationPipe } from '../common/validation.js';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
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

/**
 * Response headers for every API response (P10-02, D-251). JSON only, never framed, never cached
 * unless a handler says otherwise (ETag'd drafts set their own validators; no-store still applies).
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  next();
};

export function configureHttp(
  app: INestApplication,
  listener: { public: true } | { serviceToken: string },
): void {
  (app as NestExpressApplication).disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  if ('serviceToken' in listener) {
    app.use(serviceAuth(listener.serviceToken));
    app.setGlobalPrefix('internal/v1');
  } else {
    // A .contribution.md may be 4 MiB + 64 KiB inside a JSON string (system-logic §7.2.6).
    (app as NestExpressApplication).useBodyParser('json', { limit: '5mb' });
    app.use('/api/v1', authenticate(app.get(AuthService)));
    // The MCP endpoint (system-logic §7.5.8) authenticates its bearer token itself.
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'mcp', method: RequestMethod.ALL }] });
  }
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalPipes(validationPipe());
}
