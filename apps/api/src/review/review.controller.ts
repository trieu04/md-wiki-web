import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody, InputParams, InputQuery } from '../common/validation.js';
import { apiPagination } from '../wiki/read.dto.js';
import { ConflictsService } from './conflicts.service.js';
import { OpsService } from './ops.service.js';
import {
  AuditInput,
  AuditPageDto,
  BlockedListDto,
  ConflictInput,
  ConflictResultDto,
  DecisionInput,
  DiffInput,
  ProposalDetailDto,
  ProposalDiffDto,
  ProposalListDto,
  ProposalListInput,
  ResolutionInput,
  SlugInput,
  TABS,
  WithdrawInput,
} from './review.dto.js';
import { ReviewService } from './review.service.js';

const slugParam = () => ApiParam({ name: 'slug', type: String });

@Controller('proposals')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class ProposalsController {
  constructor(
    @Inject(ReviewService) private readonly review: ReviewService,
    @Inject(ConflictsService) private readonly conflicts: ConflictsService,
  ) {}

  @Get()
  @Requires('proposal.read')
  @apiPagination()
  @ApiQuery({ name: 'tab', enum: TABS, required: false, schema: { default: 'open' } })
  @ApiQuery({
    name: 'state',
    enum: ['pending', 'approved', 'published', 'rejected', 'stale'],
    required: false,
  })
  @ApiQuery({ name: 'targetPath', type: String, required: false })
  @ApiOkResponse({ type: ProposalListDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  list(@InputQuery(ProposalListInput) query: ProposalListInput) {
    return this.review.list(query);
  }

  @Get(':slug')
  @slugParam()
  @Requires('wiki.read')
  @ApiOkResponse({ type: ProposalDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  detail(@Req() req: AuthRequest, @InputParams(SlugInput) { slug }: SlugInput) {
    return this.review.detail(principal(req), slug);
  }

  @Get(':slug/diff')
  @slugParam()
  @Requires('wiki.read')
  @ApiQuery({
    name: 'against',
    enum: ['base', 'current'],
    required: false,
    schema: { default: 'base' },
  })
  @ApiOkResponse({ type: ProposalDiffDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  diff(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputQuery(DiffInput) query: DiffInput,
  ) {
    return this.review.diff(principal(req), slug, query.against ?? 'base');
  }

  @Post(':slug/decisions')
  @slugParam()
  @ApiBody({ type: DecisionInput })
  @ApiCreatedResponse({
    type: ProposalDetailDto,
    description: 'Decision recorded (and, with AUTO_PUBLISH, the publish attempted)',
  })
  @ApiOkResponse({ type: ProposalDetailDto, description: 'Replay of an already recorded decision' })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse(
    'PRECONDITION_FAILED',
    'NOT_ASSIGNED',
    'SELF_REVIEW',
    'DISPUTED',
    'DECISION_BINDING_MISMATCH',
    'DISCUSSION_CHANGED',
    'STALE_BASE',
    'SOURCE_CHANGED',
    'TARGET_BLOCKED',
    'ESCALATION_REQUIRED',
  )
  @ApiProblemResponse('STORAGE_ERROR')
  async decide(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputBody(DecisionInput) input: DecisionInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = principal(req);
    const { replay } = await this.review.decide(identity, slug, input);
    res.status(replay ? 200 : 201);
    return this.review.detail(identity, slug);
  }

  @Post(':slug/publish')
  @slugParam()
  @HttpCode(200)
  @ApiOkResponse({
    type: ProposalDetailDto,
    description: 'Published, stale or blocked: see publication',
  })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED', 'TARGET_BLOCKED')
  @ApiProblemResponse('STORAGE_ERROR')
  async publish(@Req() req: AuthRequest, @InputParams(SlugInput) { slug }: SlugInput) {
    const identity = principal(req);
    await this.review.publish(identity, slug);
    return this.review.detail(identity, slug);
  }

  @Post(':slug/withdraw')
  @slugParam()
  @Requires('proposal.submit')
  @HttpCode(200)
  @ApiBody({ type: WithdrawInput })
  @ApiOkResponse({ type: ProposalDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED')
  async withdraw(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputBody(WithdrawInput) input: WithdrawInput,
  ) {
    const identity = principal(req);
    await this.review.withdraw(identity, slug, input.reason);
    return this.review.detail(identity, slug);
  }

  @Post(':slug/conflict')
  @slugParam()
  @ApiBody({ type: ConflictInput })
  @ApiCreatedResponse({ type: ConflictResultDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED', 'ALREADY_EXISTS', 'SOURCE_CHANGED', 'STALE_BASE')
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  conflict(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputBody(ConflictInput) input: ConflictInput,
  ) {
    return this.conflicts.resolve(principal(req), slug, input);
  }
}

@Controller('ops')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class OpsController {
  constructor(
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(ReviewService) private readonly review: ReviewService,
  ) {}

  @Get('blocked')
  @Requires('admin.recovery')
  @ApiOkResponse({ type: BlockedListDto })
  blocked() {
    return this.ops.blocked();
  }

  @Post('blocked/:slug/resolution')
  @slugParam()
  @Requires('admin.recovery')
  @HttpCode(200)
  @ApiBody({ type: ResolutionInput })
  @ApiOkResponse({ type: ProposalDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED')
  @ApiProblemResponse('STORAGE_ERROR')
  async resolve(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputBody(ResolutionInput) input: ResolutionInput,
  ) {
    const identity = principal(req);
    await this.ops.resolve(identity, slug, input);
    return this.review.detail(identity, slug);
  }
}

@Controller('audit')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED')
export class AuditController {
  constructor(@Inject(OpsService) private readonly ops: OpsService) {}

  @Get()
  @Requires('admin.audit')
  @apiPagination()
  @ApiQuery({ name: 'action', type: String, required: false })
  @ApiQuery({ name: 'subjectType', type: String, required: false })
  @ApiQuery({ name: 'subjectId', type: String, required: false })
  @ApiQuery({ name: 'actorId', type: String, required: false })
  @ApiOkResponse({ type: AuditPageDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  audit(@InputQuery(AuditInput) query: AuditInput) {
    return this.ops.audit(query);
  }
}
