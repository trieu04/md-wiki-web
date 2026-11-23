import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputParams, InputQuery } from '../common/validation.js';
import { SlugInput } from '../review/review.dto.js';
import { apiPagination } from '../wiki/read.dto.js';
import { QualityJobs } from './quality-jobs.service.js';
import {
  JOB_KINDS,
  JobListDto,
  JobListInput,
  ModelsDto,
  QualityReportDto,
  QualityRunDto,
  RulesDto,
  RUN_STATUSES,
} from './quality.dto.js';

/** Proposal quality check (system-logic §7.6.5). */
@Controller('proposals')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class QualityController {
  constructor(@Inject(QualityJobs) private readonly quality: QualityJobs) {}

  @Post(':slug/quality-check')
  @ApiParam({ name: 'slug', type: String })
  @Requires('proposal.read')
  @ApiAcceptedResponse({ type: QualityRunDto, description: 'A new run was queued' })
  @ApiOkResponse({ type: QualityRunDto, description: 'A run is already queued or running' })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED')
  async rerun(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, run } = await this.quality.rerun(principal(req), slug);
    res.status(created ? 202 : 200);
    return run;
  }

  @Get(':slug/findings')
  @ApiParam({ name: 'slug', type: String })
  @Requires('wiki.read')
  @ApiOkResponse({ type: QualityReportDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  findings(@Req() req: AuthRequest, @InputParams(SlugInput) { slug }: SlugInput) {
    return this.quality.proposalReport(principal(req), slug);
  }
}

/** Settings › Models and the rules file (owner, §7.6.7). */
@Controller('admin')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED')
export class QualityAdminController {
  constructor(@Inject(QualityJobs) private readonly quality: QualityJobs) {}

  @Get('models')
  @Requires('admin.models')
  @ApiOkResponse({ type: ModelsDto })
  models() {
    return this.quality.models();
  }

  @Get('rules')
  @Requires('admin.rules')
  @ApiOkResponse({ type: RulesDto })
  rules() {
    return this.quality.rulesDto();
  }
}

/** Operations › Background jobs (owner, §7.6.7). */
@Controller('ops')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED')
export class JobsOpsController {
  constructor(@Inject(QualityJobs) private readonly quality: QualityJobs) {}

  @Get('jobs')
  @Requires('admin.jobs')
  @apiPagination()
  @ApiQuery({ name: 'kind', enum: JOB_KINDS, required: false })
  @ApiQuery({ name: 'status', enum: RUN_STATUSES, required: false })
  @ApiOkResponse({ type: JobListDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  jobs(@InputQuery(JobListInput) query: JobListInput) {
    return this.quality.jobs(query);
  }
}
