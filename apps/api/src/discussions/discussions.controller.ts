import { Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TOPIC_FILTERS } from '@md-wiki/domain';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody, InputParams, InputQuery } from '../common/validation.js';
import { SlugInput } from '../review/review.dto.js';
import { apiPagination } from '../wiki/read.dto.js';
import {
  CommentInput,
  DisputeInput,
  DisputeLogDto,
  EntryPageInput,
  ProposalDiscussionDto,
  ProposalDiscussionInput,
  TopicCloseInput,
  TopicCreateInput,
  TopicDetailDto,
  TopicEntryPageDto,
  TopicIdInput,
  TopicListDto,
  TopicListInput,
  TopicReopenInput,
} from './discussions.dto.js';
import { DiscussionsService } from './discussions.service.js';

const idParam = () => ApiParam({ name: 'id', type: String, format: 'uuid' });
const slugParam = () => ApiParam({ name: 'slug', type: String });

/** File/section topics (system-logic §7.5.5). Writes check permissions in the service (MCP too). */
@Controller('topics')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class TopicsController {
  constructor(@Inject(DiscussionsService) private readonly discussions: DiscussionsService) {}

  @Get()
  @Requires('wiki.read')
  @apiPagination()
  @ApiQuery({ name: 'filter', enum: TOPIC_FILTERS, required: false, schema: { default: 'open' } })
  @ApiQuery({ name: 'path', type: String, required: false })
  @ApiQuery({ name: 'anchor', type: String, required: false })
  @ApiQuery({ name: 'proposal', type: String, required: false, description: 'Proposal slug' })
  @ApiOkResponse({ type: TopicListDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  list(@Req() req: AuthRequest, @InputQuery(TopicListInput) query: TopicListInput) {
    return this.discussions.list(principal(req), query);
  }

  @Post()
  @ApiBody({ type: TopicCreateInput })
  @ApiCreatedResponse({ type: TopicDetailDto })
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  @ApiProblemResponse('NOT_FOUND')
  create(@Req() req: AuthRequest, @InputBody(TopicCreateInput) input: TopicCreateInput) {
    return this.discussions.create(principal(req), input);
  }

  @Get(':id')
  @idParam()
  @Requires('wiki.read')
  @ApiOkResponse({ type: TopicDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  get(@Req() req: AuthRequest, @InputParams(TopicIdInput) { id }: TopicIdInput) {
    return this.discussions.detail(principal(req), id);
  }

  @Get(':id/comments')
  @idParam()
  @Requires('wiki.read')
  @apiPagination()
  @ApiOkResponse({ type: TopicEntryPageDto, description: 'Entries oldest first; cursor = seq' })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  entries(
    @Req() req: AuthRequest,
    @InputParams(TopicIdInput) { id }: TopicIdInput,
    @InputQuery(EntryPageInput) query: EntryPageInput,
  ) {
    return this.discussions.entries(principal(req), id, query);
  }

  @Post(':id/comments')
  @idParam()
  @ApiBody({ type: CommentInput })
  @ApiCreatedResponse({ type: TopicDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED', 'DISCUSSION_CHANGED')
  comment(
    @Req() req: AuthRequest,
    @InputParams(TopicIdInput) { id }: TopicIdInput,
    @InputBody(CommentInput) input: CommentInput,
  ) {
    return this.discussions.comment(principal(req), id, input);
  }

  @Post(':id/close')
  @idParam()
  @HttpCode(200)
  @ApiBody({ type: TopicCloseInput })
  @ApiOkResponse({ type: TopicDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED', 'DISCUSSION_CHANGED', 'SELF_REVIEW')
  close(
    @Req() req: AuthRequest,
    @InputParams(TopicIdInput) { id }: TopicIdInput,
    @InputBody(TopicCloseInput) input: TopicCloseInput,
  ) {
    return this.discussions.close(principal(req), id, input);
  }

  @Post(':id/reopen')
  @idParam()
  @HttpCode(200)
  @ApiBody({ type: TopicReopenInput })
  @ApiOkResponse({ type: TopicDetailDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED', 'DISCUSSION_CHANGED', 'SELF_REVIEW')
  reopen(
    @Req() req: AuthRequest,
    @InputParams(TopicIdInput) { id }: TopicIdInput,
    @InputBody(TopicReopenInput) input: TopicReopenInput,
  ) {
    return this.discussions.reopen(principal(req), id, input);
  }
}

/** Proposal discussion and dispute log (system-logic §7.5.5). */
@Controller('proposals')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class ProposalDiscussionController {
  constructor(@Inject(DiscussionsService) private readonly discussions: DiscussionsService) {}

  @Get(':slug/discussion')
  @slugParam()
  @Requires('wiki.read')
  @ApiOkResponse({ type: ProposalDiscussionDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  get(@Req() req: AuthRequest, @InputParams(SlugInput) { slug }: SlugInput) {
    return this.discussions.proposalDiscussion(principal(req), slug);
  }

  @Post(':slug/discussion')
  @slugParam()
  @ApiBody({ type: ProposalDiscussionInput })
  @ApiCreatedResponse({ type: ProposalDiscussionDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED', 'ALREADY_EXISTS')
  open(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputBody(ProposalDiscussionInput) input: ProposalDiscussionInput,
  ) {
    return this.discussions.openProposalDiscussion(principal(req), slug, input);
  }

  @Get(':slug/disputes')
  @slugParam()
  @Requires('wiki.read')
  @ApiOkResponse({ type: DisputeLogDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  disputes(@Req() req: AuthRequest, @InputParams(SlugInput) { slug }: SlugInput) {
    return this.discussions.disputes(principal(req), slug);
  }

  @Post(':slug/disputes')
  @slugParam()
  @ApiBody({ type: DisputeInput })
  @ApiCreatedResponse({ type: DisputeLogDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED', 'DISCUSSION_CHANGED', 'SELF_REVIEW')
  record(
    @Req() req: AuthRequest,
    @InputParams(SlugInput) { slug }: SlugInput,
    @InputBody(DisputeInput) input: DisputeInput,
  ) {
    return this.discussions.recordDispute(principal(req), slug, input);
  }
}
