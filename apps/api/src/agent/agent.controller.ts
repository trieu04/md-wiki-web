import { Controller, Get, HttpCode, Inject, Patch, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { INBOX_TABS } from '@md-wiki/domain';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody, InputParams, InputQuery } from '../common/validation.js';
import { SlugInput } from '../review/review.dto.js';
import { apiPagination } from '../wiki/read.dto.js';
import { AgentRuns } from './agent-runs.service.js';
import {
  AgentMetricsDto,
  AgentMetricsInput,
  AgentPauseInput,
  EscalationInput,
  EscalationStateDto,
  InboxDto,
  InboxInput,
  ReviewSettingsDto,
  ReviewSettingsInput,
  SpotCheckDto,
  SpotCheckIdInput,
  SpotCheckInput,
} from './agent.dto.js';
import { EscalationsService } from './escalations.service.js';
import { InboxService } from './inbox.service.js';
import { AgentMetricsService } from './metrics.service.js';
import { ReviewSettingsService } from './settings.service.js';
import { SpotChecksService } from './spot-checks.service.js';

/** Escalations of a proposal (system-logic §7.8.5). */
@Controller('proposals')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class EscalationsController {
  constructor(@Inject(EscalationsService) private readonly escalations: EscalationsService) {}

  @ApiBody({ type: EscalationInput })
  @Post(':slug/escalations')
  @ApiParam({ name: 'slug', type: String })
  @Requires('wiki.read')
  @ApiCreatedResponse({ type: EscalationStateDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('NOT_ASSIGNED', 'SELF_REVIEW', 'PRECONDITION_FAILED', 'ALREADY_EXISTS')
  escalate(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputBody(EscalationInput) input: EscalationInput,
  ) {
    return this.escalations.escalate(principal(req), slug, input);
  }

  @Get(':slug/escalation')
  @ApiParam({ name: 'slug', type: String })
  @Requires('wiki.read')
  @ApiOkResponse({ type: EscalationStateDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  state(@Req() req: AuthRequest, @InputParams(SlugInput) { slug }: SlugInput) {
    return this.escalations.state(principal(req), slug);
  }
}

/** F-08 Inbox (system-logic §7.8.8). */
@Controller('inbox')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED')
export class InboxController {
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}

  @Get()
  @Requires('wiki.read')
  @apiPagination()
  @ApiQuery({ name: 'tab', enum: INBOX_TABS, required: false })
  @ApiOkResponse({ type: InboxDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  list(@Req() req: AuthRequest, @InputQuery(InboxInput) query: InboxInput) {
    return this.inbox.inbox(principal(req), query);
  }
}

/** Spot checks of agent approvals (system-logic §7.8.7). */
@Controller('spot-checks')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class SpotChecksController {
  constructor(@Inject(SpotChecksService) private readonly spots: SpotChecksService) {}

  @Get(':id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Requires('wiki.read')
  @ApiOkResponse({ type: SpotCheckDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  get(@Req() req: AuthRequest, @InputParams(SpotCheckIdInput) { id }: SpotCheckIdInput) {
    return this.spots.get(principal(req), id);
  }

  @ApiBody({ type: SpotCheckInput })
  @Post(':id/outcome')
  @HttpCode(200)
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Requires('wiki.read')
  @ApiOkResponse({ type: SpotCheckDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('NOT_ASSIGNED', 'SELF_REVIEW', 'PRECONDITION_FAILED')
  decide(
    @Req() req: AuthRequest,
    @InputParams(SpotCheckIdInput) { id }: SpotCheckIdInput,
    @InputBody(SpotCheckInput) input: SpotCheckInput,
  ) {
    return this.spots.decide(principal(req), id, input);
  }
}

/** Settings › Review and publishing, the stop switch (owner, system-logic §7.8.9). */
@Controller('admin')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class ReviewAdminController {
  constructor(
    @Inject(ReviewSettingsService) private readonly settings: ReviewSettingsService,
    @Inject(AgentRuns) private readonly runs: AgentRuns,
  ) {}

  @Get('review-settings')
  @Requires('admin.settings')
  @ApiOkResponse({ type: ReviewSettingsDto })
  get() {
    return this.settings.dto();
  }

  @ApiBody({ type: ReviewSettingsInput })
  @Patch('review-settings')
  @Requires('admin.settings')
  @ApiOkResponse({ type: ReviewSettingsDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  update(@Req() req: AuthRequest, @InputBody(ReviewSettingsInput) input: ReviewSettingsInput) {
    return this.settings.update(principal(req), input);
  }

  @ApiBody({ type: AgentPauseInput })
  @Post('agent/pause')
  @HttpCode(200)
  @Requires('admin.settings')
  @ApiOkResponse({ type: ReviewSettingsDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  async pause(@Req() req: AuthRequest, @InputBody(AgentPauseInput) input: AgentPauseInput) {
    const changed = await this.settings.setPaused(principal(req), input);
    if (changed) {
      if (input.paused) await this.runs.stopActive();
      else await this.runs.reconcileAll();
    }
    return this.settings.dto();
  }
}

/** Operations › Reviewer agent (owner). */
@Controller('ops')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED')
export class AgentOpsController {
  constructor(@Inject(AgentMetricsService) private readonly metrics: AgentMetricsService) {}

  @Get('agent')
  @Requires('admin.jobs')
  @ApiQuery({ name: 'days', type: 'integer', required: false, minimum: 1, maximum: 90 })
  @ApiOkResponse({ type: AgentMetricsDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  get(@InputQuery(AgentMetricsInput) query: AgentMetricsInput) {
    return this.metrics.metrics(query.days ?? 30);
  }
}
