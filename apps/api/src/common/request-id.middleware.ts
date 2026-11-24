import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pino } from 'pino';

export const logger = pino();

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  // A caller's id is kept only when it is a plain token, so logs and headers cannot be forged.
  const given = req.get('X-Request-Id');
  const requestId = given && /^[A-Za-z0-9._:-]{1,128}$/.test(given) ? given : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    logger.info({ requestId, method: req.method, status: res.statusCode }, 'request completed');
  });
  next();
};
