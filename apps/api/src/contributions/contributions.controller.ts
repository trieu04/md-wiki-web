import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody, InputParams, InputQuery } from '../common/validation.js';
import { apiPagination } from '../wiki/read.dto.js';
import {
  AddSourceInput,
  ContributionDto,
  ContributionInput,
  CreateDraftInput,
  CursorInput,
  DraftDto,
  DraftIdInput,
  DraftsDto,
  ImportInput,
  ProposalDto,
  RebaseInput,
  SuggestionsDto,
  UpdateDraftInput,
} from './contributions.dto.js';
import { ContributionsService } from './contributions.service.js';
import { DraftsService } from './drafts.service.js';
import type { Frozen } from './freezer.service.js';
import { ifMatch } from './pins.js';

const idParam = () => ApiParam({ name: 'id', type: String, format: 'uuid' });
const ifMatchHeader = () =>
  ApiHeader({ name: 'If-Match', required: true, description: 'DraftDto.updatedAt' });
function etag(res: Response, draft: { updatedAt: string }) {
  res.setHeader('ETag', `"${draft.updatedAt}"`);
  return draft;
}

@Controller('drafts')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class DraftsController {
  constructor(
    @Inject(DraftsService) private readonly drafts: DraftsService,
    @Inject(ContributionsService) private readonly contributions: ContributionsService,
  ) {}

  @Get()
  @Requires('draft.read')
  @apiPagination()
  @ApiOkResponse({ type: DraftsDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  list(@Req() req: AuthRequest, @InputQuery(CursorInput) query: CursorInput) {
    return this.drafts.list(principal(req).user, query);
  }

  @Post()
  @Requires('draft.create')
  @ApiBody({ type: CreateDraftInput })
  @ApiCreatedResponse({ type: DraftDto, description: 'New draft' })
  @ApiOkResponse({ type: DraftDto, description: 'The existing draft for this page (resumed)' })
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('STORAGE_ERROR')
  async create(
    @Req() req: AuthRequest,
    @InputBody(CreateDraftInput) input: CreateDraftInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, draft } = await this.drafts.create(principal(req).user, input);
    res.status(created ? 201 : 200);
    return etag(res, draft);
  }

  @Get(':id')
  @idParam()
  @Requires('draft.read')
  @ApiOkResponse({ type: DraftDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  async get(
    @Req() req: AuthRequest,
    @InputParams(DraftIdInput) { id }: DraftIdInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return etag(res, await this.drafts.get(principal(req).user, id));
  }

  @Patch(':id')
  @idParam()
  @ApiBody({ type: UpdateDraftInput })
  @Requires('draft.update')
  @ifMatchHeader()
  @ApiOkResponse({ type: DraftDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED')
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  async update(
    @Req() req: AuthRequest,
    @InputParams(DraftIdInput) { id }: DraftIdInput,
    @InputBody(UpdateDraftInput) input: UpdateDraftInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = ifMatch(req.get('If-Match'));
    return etag(res, await this.drafts.update(principal(req).user, id, expected, input));
  }

  @Delete(':id')
  @idParam()
  @Requires('draft.delete')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  async remove(@Req() req: AuthRequest, @InputParams(DraftIdInput) { id }: DraftIdInput) {
    await this.drafts.remove(principal(req).user, id);
  }

  @Post(':id/sources')
  @idParam()
  @ApiBody({ type: AddSourceInput })
  @Requires('draft.update')
  @HttpCode(200)
  @ApiOkResponse({ type: DraftDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  @ApiProblemResponse('PRECONDITION_FAILED')
  async addSource(
    @Req() req: AuthRequest,
    @InputParams(DraftIdInput) { id }: DraftIdInput,
    @InputBody(AddSourceInput) input: AddSourceInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return etag(res, await this.drafts.addSource(principal(req).user, id, input));
  }

  @Delete(':id/sources/:path')
  @idParam()
  @Requires('draft.update')
  @ApiParam({ name: 'path', type: String, description: 'URL-encoded wiki path' })
  @ApiOkResponse({ type: DraftDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED')
  @ApiProblemResponse('PRECONDITION_FAILED')
  async removeSource(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('path') path: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return etag(res, await this.drafts.removeSource(principal(req).user, id, path));
  }

  @Post(':id/rebase')
  @idParam()
  @ApiBody({ type: RebaseInput, required: false })
  @Requires('draft.update')
  @HttpCode(200)
  @ApiOkResponse({ type: DraftDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('SECTION_CHANGED', 'STALE_BASE', 'PRECONDITION_FAILED')
  @ApiProblemResponse('VALIDATION_FAILED')
  async rebase(
    @Req() req: AuthRequest,
    @InputParams(DraftIdInput) { id }: DraftIdInput,
    @InputBody(RebaseInput) input: RebaseInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return etag(res, await this.drafts.rebase(principal(req).user, id, input.mode ?? 'auto'));
  }

  @Post(':id/submit')
  @idParam()
  @Requires('proposal.submit')
  @ifMatchHeader()
  @ApiCreatedResponse({ type: ProposalDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  @ApiProblemResponse('PRECONDITION_FAILED', 'STALE_BASE', 'SOURCE_CHANGED', 'ALREADY_EXISTS')
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  async submit(@Req() req: AuthRequest, @InputParams(DraftIdInput) { id }: DraftIdInput) {
    const expected = ifMatch(req.get('If-Match'));
    const frozen = await this.drafts.submit(principal(req).user, id, expected);
    return this.contributions.proposalDto(frozen.proposalId);
  }

  @Get(':id/export')
  @idParam()
  @Requires('draft.read')
  @ApiProduces('text/markdown')
  @ApiOkResponse({ schema: { type: 'string' }, description: '.contribution.md v3' })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('PRECONDITION_FAILED')
  @ApiProblemResponse('VALIDATION_FAILED')
  async export(
    @Req() req: AuthRequest,
    @InputParams(DraftIdInput) { id }: DraftIdInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { slug, file } = await this.drafts.export(principal(req).user, id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.contribution.md"`);
    return file;
  }
}

async function respond(service: ContributionsService, res: Response, frozen: Promise<Frozen>) {
  const { proposalId, replay } = await frozen;
  res.status(replay ? 200 : 201);
  return service.proposalDto(proposalId);
}

@Controller()
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
export class ContributionsController {
  constructor(@Inject(ContributionsService) private readonly contributions: ContributionsService) {}

  @Post('contributions')
  @ApiBody({ type: ContributionInput })
  @Requires('proposal.submit')
  @ApiCreatedResponse({ type: ProposalDto })
  @ApiOkResponse({ type: ProposalDto, description: 'Idempotent replay of an explicit slug' })
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  @ApiProblemResponse('STALE_BASE', 'SOURCE_CHANGED', 'ALREADY_EXISTS')
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  create(
    @Req() req: AuthRequest,
    @InputBody(ContributionInput) input: ContributionInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(this.contributions, res, this.contributions.submit(principal(req).user, input));
  }

  @Post('contributions/import')
  @ApiBody({ type: ImportInput })
  @Requires('proposal.submit')
  @ApiCreatedResponse({ type: ProposalDto })
  @ApiOkResponse({ type: ProposalDto, description: 'Idempotent replay of the same file' })
  @ApiProblemResponse('VALIDATION_FAILED', 'INVALID_PATH')
  @ApiProblemResponse('STALE_BASE', 'SOURCE_CHANGED', 'ALREADY_EXISTS')
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  import(
    @Req() req: AuthRequest,
    @InputBody(ImportInput) input: ImportInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(
      this.contributions,
      res,
      this.contributions.import(principal(req).user, input.file),
    );
  }

  @Get('contributions/:slug')
  @ApiParam({ name: 'slug', type: String })
  @Requires('wiki.read')
  @ApiOkResponse({ type: ContributionDto })
  @ApiProblemResponse('NOT_FOUND')
  get(@Req() req: AuthRequest, @Param('slug') slug: string) {
    return this.contributions.get(principal(req).user, slug);
  }

  @Get('me/suggestions')
  @Requires('wiki.read')
  @apiPagination()
  @ApiOkResponse({ type: SuggestionsDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  suggestions(@Req() req: AuthRequest, @InputQuery(CursorInput) query: CursorInput) {
    return this.contributions.suggestions(principal(req).user, query);
  }
}
