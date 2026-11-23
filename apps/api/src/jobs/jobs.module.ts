import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DevPingController } from './dev-ping.controller.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { PingQueue } from './ping-queue.js';

@Module({ imports: [PrismaModule], providers: [JobsService], exports: [JobsService] })
class JobsModule {}

@Module({ imports: [JobsModule], controllers: [JobsController] })
export class InternalJobsModule {}

@Module({ imports: [JobsModule], controllers: [DevPingController], providers: [PingQueue] })
export class DevPingModule {}
