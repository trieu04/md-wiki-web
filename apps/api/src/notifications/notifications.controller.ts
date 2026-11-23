import { Controller, Delete, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest, Identity } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody, InputQuery } from '../common/validation.js';
import { FollowsService, requireHuman } from './follows.service.js';
import {
  FollowDto,
  FollowedPagesDto,
  FollowInput,
  MarkReadInput,
  NoticeListDto,
  NotificationListDto,
  NotificationListInput,
  NotificationPrefsDto,
  PageListInput,
  UnfollowInput,
  UnreadDto,
} from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

const pagination = () => [
  ApiQuery({ name: 'cursor', type: String, required: false }),
  ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } }),
];
const Paginated = (): MethodDecorator => (target, key, descriptor) => {
  for (const d of pagination()) d(target, key, descriptor);
};
const human = (identity: Identity) => {
  if (identity.user.kind !== 'human') throw new AppError('FORBIDDEN');
  return identity;
};

/** Follows (system-logic §7.7.9). */
@Controller('follows')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class FollowsController {
  constructor(@Inject(FollowsService) private readonly follows: FollowsService) {}

  @Post()
  @ApiBody({ type: FollowInput })
  @ApiCreatedResponse({ type: FollowDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  follow(@Req() req: AuthRequest, @InputBody(FollowInput) input: FollowInput) {
    return this.follows.follow(principal(req), input);
  }

  @Delete()
  @HttpCode(204)
  @ApiQuery({ name: 'path', type: String })
  @ApiQuery({ name: 'anchor', type: String, required: false })
  @ApiNoContentResponse()
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  async unfollow(@Req() req: AuthRequest, @InputQuery(UnfollowInput) input: UnfollowInput) {
    await this.follows.unfollow(principal(req), input);
  }
}

/** In-app notifications (system-logic §7.7.9). */
@Controller('notifications')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @Requires('wiki.read')
  @Paginated()
  @ApiQuery({ name: 'unread', enum: ['true', 'false'], required: false })
  @ApiOkResponse({ type: NotificationListDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  list(@Req() req: AuthRequest, @InputQuery(NotificationListInput) query: NotificationListInput) {
    return this.notifications.list(human(principal(req)).user.id, query);
  }

  @Post('read')
  @HttpCode(200)
  @Requires('wiki.read')
  @ApiBody({ type: MarkReadInput })
  @ApiOkResponse({ type: UnreadDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  read(@Req() req: AuthRequest, @InputBody(MarkReadInput) input: MarkReadInput) {
    return this.notifications.markRead(human(principal(req)).user.id, input);
  }
}

/** You › follows, notification preferences and notices (system-logic §7.7.9). */
@Controller('me')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class MeNotificationsController {
  constructor(
    @Inject(FollowsService) private readonly follows: FollowsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get('follows')
  @Paginated()
  @ApiOkResponse({ type: FollowedPagesDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  mine(@Req() req: AuthRequest, @InputQuery(PageListInput) query: PageListInput) {
    return this.follows.mine(principal(req), query);
  }

  @Get('notification-preferences')
  @ApiOkResponse({ type: NotificationPrefsDto })
  prefs(@Req() req: AuthRequest) {
    const identity = principal(req);
    requireHuman(identity, 'follow');
    return this.notifications.prefs(identity.user.id);
  }

  @Put('notification-preferences')
  @ApiBody({ type: NotificationPrefsDto })
  @ApiOkResponse({ type: NotificationPrefsDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  setPrefs(@Req() req: AuthRequest, @InputBody(NotificationPrefsDto) input: NotificationPrefsDto) {
    const identity = principal(req);
    requireHuman(identity, 'follow');
    return this.notifications.setPrefs(identity.user.id, input);
  }

  @Get('notices')
  @ApiOkResponse({ type: NoticeListDto })
  notices(@Req() req: AuthRequest) {
    const identity = principal(req);
    requireHuman(identity, 'follow');
    return this.notifications.notices(identity.user.id);
  }
}
