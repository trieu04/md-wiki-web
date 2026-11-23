import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pino } from 'pino';

export const logger = pino();

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const requestId = req.get('X-Request-Id') || randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    logger.info({ requestId, method: req.method, status: res.statusCode }, 'request completed');
  });
  next();
};
