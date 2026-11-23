import { Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { QUEUE_TYPES } from '@md-wiki/domain';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody, InputParams, InputQuery } from '../common/validation.js';
import { apiPagination, apiWikiPath } from '../wiki/read.dto.js';
import { AttestationsService } from './attestations.service.js';
import {
  ActivityDto,
  ActivityInput,
  AnchorLinkDto,
  AnchorLinkInput,
  AttestationDto,
  AttestationInput,
  AttestationResultDto,
  CredibilityGateDto,
  CredibilityGatesDto,
  CredibilityPagesDto,
  CredibilityQueueDto,
  CredibilitySourcesDto,
  CredibilityDecisionInput,
  EdgeCandidateInput,
  GateInput,
  GateParams,
  IdDto,
  IdParams,
  InvalidationInput,
  InvalidationResultDto,
  ListInput,
  MaintenanceDto,
  OwnerConfirmationInput,
  PageFeedbackDto,
  PageFeedbackInput,
  PeopleDto,
  PeopleInput,
  QueueInput,
  QueueItemDetailDto,
  QueueItemParams,
  ReportInput,
  SourceCheckInput,
  SourceCheckResultDto,
  SourcesInput,
  SourceTiersDto,
  SourceWarningsDto,
  SourceWarningsInput,
  SummaryDto,
  WhyDto,
  WhyInput,
  AttestationWithdrawInput,
} from './credibility.dto.js';
import { EvidenceService } from './evidence.service.js';
import { CredibilityGates } from './gates.service.js';
import { CredibilityMaintenance } from './maintenance.service.js';
import { QueueService } from './queue.service.js';

const auth = [ApiProblemResponse('UNAUTHENTICATED'), ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')];
const Authenticated = (): ClassDecorator => (target) => {
  for (const d of auth) d(target);
};

/** Evidence writes (system-logic §7.7.3). */
@Controller()
@Requires('wiki.read')
@Authenticated()
export class EvidenceController {
  constructor(@Inject(EvidenceService) private readonly evidence: EvidenceService) {}

  @ApiBody({ type: SourceCheckInput })
  @Post('source-checks')
  @ApiCreatedResponse({ type: SourceCheckResultDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('SELF_REVIEW', 'SECTION_CHANGED')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  sourceCheck(@Req() req: AuthRequest, @InputBody(SourceCheckInput) input: SourceCheckInput) {
    return this.evidence.recordSourceCheck(principal(req), input);
  }

  @ApiBody({ type: OwnerConfirmationInput })
  @Post('owner-confirmations')
  @ApiCreatedResponse({ type: SourceCheckResultDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('SECTION_CHANGED')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  confirm(@Req() req: AuthRequest, @InputBody(OwnerConfirmationInput) input: OwnerConfirmationInput) {
    return this.evidence.confirm(principal(req), input);
  }

  @ApiBody({ type: AnchorLinkInput })
  @Post('credibility/anchor-links')
  @ApiCreatedResponse({ type: AnchorLinkDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('PRECONDITION_FAILED', 'ALREADY_EXISTS')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  link(@Req() req: AuthRequest, @InputBody(AnchorLinkInput) input: AnchorLinkInput) {
    return this.evidence.linkAnchors(principal(req), input);
  }

  @Get('credibility/source-tiers')
  @ApiOkResponse({ type: SourceTiersDto })
  tiers() {
    return this.evidence.sourceTiers();
  }

  @ApiBody({ type: SourceWarningsInput })
  @Post('credibility/source-warnings')
  @HttpCode(200)
  @ApiOkResponse({ type: SourceWarningsDto })
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  warnings(@InputBody(SourceWarningsInput) input: SourceWarningsInput) {
    return this.evidence.sourceWarnings(input);
  }
}

/** Why this label and people who rely on it (system-logic §7.7.4). */
@Controller('sections')
@Requires('wiki.read')
@Authenticated()
export class SectionsController {
  constructor(
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(AttestationsService) private readonly attestations: AttestationsService,
  ) {}

  @Get(':path/:anchor/why')
  @apiWikiPath()
  @ApiParam({ name: 'anchor', type: String })
  @ApiQuery({ name: 'versionLabel', type: String, required: false })
  @ApiOkResponse({ type: WhyDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  why(
    @Req() req: AuthRequest,
    @Param('path') path: string,
    @Param('anchor') anchor: string,
    @InputQuery(WhyInput) query: WhyInput,
  ) {
    return this.evidence.why(principal(req), path, anchor, query.versionLabel);
  }

  @Get(':path/:anchor/people')
  @apiWikiPath()
  @ApiParam({ name: 'anchor', type: String })
  @ApiQuery({ name: 'reveal', enum: ['true', 'false'], required: false })
  @ApiOkResponse({ type: PeopleDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  people(
    @Req() req: AuthRequest,
    @Param('path') path: string,
    @Param('anchor') anchor: string,
    @InputQuery(PeopleInput) query: PeopleInput,
  ) {
    return this.attestations.people(principal(req), path, anchor, query.reveal === 'true');
  }
}

/** Reader actions (system-logic §7.7.6). */
@Controller()
@Requires('wiki.read')
@Authenticated()
export class ReaderActionsController {
  constructor(@Inject(AttestationsService) private readonly attestations: AttestationsService) {}

  @ApiBody({ type: AttestationInput })
  @Post('attestations')
  @ApiCreatedResponse({ type: AttestationResultDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('SECTION_CHANGED', 'ALREADY_EXISTS')
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  attest(@Req() req: AuthRequest, @InputBody(AttestationInput) input: AttestationInput) {
    return this.attestations.attest(principal(req), input);
  }

  @ApiBody({ type: AttestationWithdrawInput })
  @Post('attestations/:id/withdraw')
  @HttpCode(200)
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AttestationDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('PRECONDITION_FAILED')
  @ApiProblemResponse('VALIDATION_FAILED')
  withdraw(
    @Req() req: AuthRequest,
    @InputParams(IdParams) { id }: IdParams,
    @InputBody(AttestationWithdrawInput) input: AttestationWithdrawInput,
  ) {
    return this.attestations.withdraw(principal(req), id, input.reason);
  }

  @ApiBody({ type: ReportInput })
  @Post('reports')
  @ApiCreatedResponse({ type: AttestationResultDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('SECTION_CHANGED')
  @ApiProblemResponse('RATE_LIMITED')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  report(@Req() req: AuthRequest, @InputBody(ReportInput) input: ReportInput) {
    return this.attestations.report(principal(req), input);
  }

  @ApiBody({ type: PageFeedbackInput })
  @Post('page-feedback')
  @ApiCreatedResponse({ type: PageFeedbackDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  feedback(@Req() req: AuthRequest, @InputBody(PageFeedbackInput) input: PageFeedbackInput) {
    return this.attestations.feedback(principal(req), input);
  }
}

/** You › activity and summary (system-logic §7.7.9). */
@Controller('me')
@Requires('wiki.read')
@Authenticated()
export class MeCredibilityController {
  constructor(@Inject(AttestationsService) private readonly attestations: AttestationsService) {}

  @Get('activity')
  @apiPagination()
  @ApiQuery({ name: 'kind', enum: ['checks', 'reports', 'all'], required: false })
  @ApiOkResponse({ type: ActivityDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  activity(@Req() req: AuthRequest, @InputQuery(ActivityInput) query: ActivityInput) {
    return this.attestations.activity(principal(req), query);
  }

  @Get('summary')
  @ApiOkResponse({ type: SummaryDto })
  summary(@Req() req: AuthRequest) {
    return this.attestations.summary(principal(req));
  }
}

/** Workspace › Credibility (system-logic §7.7.8). */
@Controller('credibility')
@Requires('wiki.read')
@Authenticated()
export class CredibilityQueueController {
  constructor(
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
  ) {}

  @Get('queue')
  @apiPagination()
  @ApiQuery({ name: 'type', enum: QUEUE_TYPES, required: false })
  @ApiOkResponse({ type: CredibilityQueueDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  list(@Req() req: AuthRequest, @InputQuery(QueueInput) query: QueueInput) {
    return this.queue.queue(principal(req), query);
  }

  @Get('queue/:type/:id')
  @ApiParam({ name: 'type', enum: QUEUE_TYPES })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: QueueItemDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  detail(@Req() req: AuthRequest, @InputParams(QueueItemParams) params: QueueItemParams) {
    return this.queue.detail(principal(req), params.type, params.id);
  }

  @ApiBody({ type: CredibilityDecisionInput })
  @Post('decisions')
  @HttpCode(200)
  @ApiOkResponse({ type: QueueItemDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('PRECONDITION_FAILED', 'SELF_REVIEW')
  @ApiProblemResponse('VALIDATION_FAILED')
  decide(@Req() req: AuthRequest, @InputBody(CredibilityDecisionInput) input: CredibilityDecisionInput) {
    return this.queue.decide(principal(req), input);
  }

  @Get('pages')
  @apiPagination()
  @ApiOkResponse({ type: CredibilityPagesDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  pages(@Req() req: AuthRequest, @InputQuery(ListInput) query: ListInput) {
    return this.queue.pages(principal(req), query);
  }

  @Get('sources')
  @apiPagination()
  @ApiQuery({ name: 'state', type: String, required: false })
  @ApiOkResponse({ type: CredibilitySourcesDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  sources(@Req() req: AuthRequest, @InputQuery(SourcesInput) query: SourcesInput) {
    return this.queue.sources(principal(req), query);
  }

  @ApiBody({ type: EdgeCandidateInput })
  @Post('candidates')
  @ApiCreatedResponse({ type: IdDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  candidate(@Req() req: AuthRequest, @InputBody(EdgeCandidateInput) input: EdgeCandidateInput) {
    return this.evidence.candidate(principal(req), input);
  }

  @ApiBody({ type: InvalidationInput })
  @Post('invalidations')
  @ApiCreatedResponse({ type: InvalidationResultDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  invalidation(@Req() req: AuthRequest, @InputBody(InvalidationInput) input: InvalidationInput) {
    return this.evidence.invalidation(principal(req), input);
  }
}

/** Settings › Trust labels gates and maintenance (owner, system-logic §7.7.7, §7.7.10). */
@Controller('admin')
@Authenticated()
export class CredibilityAdminController {
  constructor(
    @Inject(CredibilityGates) private readonly gates: CredibilityGates,
    @Inject(CredibilityMaintenance) private readonly maintenance: CredibilityMaintenance,
  ) {}

  @Get('credibility-gates')
  @Requires('admin.settings')
  @ApiOkResponse({ type: CredibilityGatesDto })
  list() {
    return this.gates.list();
  }

  @ApiBody({ type: GateInput })
  @Put('credibility-gates/:capability')
  @Requires('admin.settings')
  @ApiParam({ name: 'capability', type: String })
  @ApiOkResponse({ type: CredibilityGateDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  set(
    @Req() req: AuthRequest,
    @InputParams(GateParams) { capability }: GateParams,
    @InputBody(GateInput) input: GateInput,
  ) {
    return this.gates.set(principal(req), capability, input);
  }

  @Post('credibility/maintenance')
  @HttpCode(200)
  @Requires('admin.settings')
  @ApiOkResponse({ type: MaintenanceDto })
  run(@Req() req: AuthRequest) {
    return this.maintenance.run(new Date(), principal(req));
  }
}
