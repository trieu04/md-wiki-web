import { Module } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/env.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WikiModule } from '../wiki/wiki.module.js';
import { FollowsService } from './follows.service.js';
import { MAIL_TRANSPORT, mailTransport } from './mail.js';
import {
  FollowsController,
  MeNotificationsController,
  NotificationsController,
} from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/** Follows, notifications, preferences and digests (system-logic §7.7.9). */
@Module({
  imports: [PrismaModule, WikiModule],
  controllers: [FollowsController, NotificationsController, MeNotificationsController],
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => mailTransport(config.MAIL_TRANSPORT),
    },
    NotificationsService,
    FollowsService,
  ],
  exports: [NotificationsService, FollowsService, MAIL_TRANSPORT],
})
export class NotificationsModule {}
