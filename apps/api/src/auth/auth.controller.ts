import { Controller, Get, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody } from '../common/validation.js';
import { AuthService, sessionLifetime, type AuthRequest } from './auth.service.js';
import { LoginLimited } from './credentials.js';
import { LoginDto, LoginInput, SessionDto } from './identity.dto.js';

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
});
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get('session')
  @ApiOkResponse({ type: SessionDto })
  @Header('Cache-Control', 'no-store')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('ACCOUNT_DISABLED')
  session(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const identity = req.identity;
    if (!identity) res.clearCookie('mw_session', cookieOptions());
    return {
      user: identity?.user ?? null,
      csrfToken: identity?.kind === 'session' ? identity.csrfToken : null,
    };
  }
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: LoginInput })
  @ApiOkResponse({ type: LoginDto })
  @ApiProblemResponse('INVALID_CREDENTIALS', 'UNAUTHENTICATED')
  @ApiProblemResponse('ACCOUNT_DISABLED', 'CSRF_INVALID')
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('VALIDATION_FAILED')
  async login(
    @InputBody(LoginInput) body: LoginInput,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.auth.login(
        body,
        req.socket.remoteAddress ?? 'unknown',
        req.get('User-Agent') ?? '',
      );
      res.cookie('mw_session', result.cookie, { ...cookieOptions(), maxAge: sessionLifetime });
      return result.body;
    } catch (error) {
      if (error instanceof LoginLimited) res.set('Retry-After', String(error.seconds));
      throw error;
    }
  }
  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('CSRF_INVALID', 'ACCOUNT_DISABLED')
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.identity);
    res.clearCookie('mw_session', cookieOptions());
  }
}
