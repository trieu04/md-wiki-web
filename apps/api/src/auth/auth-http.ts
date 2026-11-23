import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Action } from '@md-wiki/domain';
import type { RequestHandler } from 'express';
import { AppError } from '../common/app-error.js';
import { AuthService, type AuthRequest, type Identity } from './auth.service.js';
import { equal } from './credentials.js';

export function authenticate(auth: AuthService): RequestHandler {
  return async (req: AuthRequest, _res, next) => {
    try {
      const header = req.get('authorization');
      const cookie = req
        .get('cookie')
        ?.split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('mw_session='))
        ?.slice('mw_session='.length);
      const identity =
        header !== undefined
          ? await auth.bearer(header)
          : cookie
            ? await auth.session(cookie)
            : undefined;
      if (
        identity?.kind === 'session' &&
        req.method !== 'GET' &&
        !equal(identity.csrfToken, req.get('X-CSRF-Token') ?? '')
      )
        throw new AppError('CSRF_INVALID');
      if (identity) req.identity = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
}
const required = Symbol('required-action');
export const Requires = (action: Action) => SetMetadata(required, action);
export function principal(req: AuthRequest): Identity {
  if (!req.identity) throw new AppError('UNAUTHENTICATED');
  return req.identity;
}
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const action = this.reflector.getAllAndOverride<Action | undefined>(required, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!action) return true;
    const identity = principal(ctx.switchToHttp().getRequest<AuthRequest>());
    const decision = can(
      { kind: identity.user.kind, roles: identity.user.roles, auth: identity },
      action,
      {},
    );
    if (!decision.ok) throw new AppError(decision.code);
    return true;
  }
}
