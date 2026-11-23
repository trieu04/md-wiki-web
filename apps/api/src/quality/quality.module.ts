import { Module } from '@nestjs/common';
import { QueueModule } from '../jobs/jobs.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { QualityRulesFile } from './quality-config.js';
import { QualityJobs } from './quality-jobs.service.js';
import {
  JobsOpsController,
  QualityAdminController,
  QualityController,
} from './quality.controller.js';

/** Quality check runs, findings, models and rules (system-logic §7.6). */
@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [QualityController, QualityAdminController, JobsOpsController],
  providers: [QualityRulesFile, QualityJobs],
  exports: [QualityJobs],
})
export class QualityModule {}
