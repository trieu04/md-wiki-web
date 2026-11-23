import {
  applyDecorators,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputBody, InputParams, InputQuery } from '../common/validation.js';
import { WikiIndexer } from '../wiki/indexer/wiki-indexer.js';
import { AdminService } from './admin.service.js';
import { principal, Requires } from './auth-http.js';
import type { AuthRequest } from './auth.service.js';
import {
  CreatedTokenDto,
  CreateUserInput,
  IdInput,
  PageInput,
  ReindexDto,
  TeamDto,
  TeamInput,
  TeamsDto,
  TokenInput,
  TokensDto,
  UpdateUserInput,
  UserDto,
  UsersDto,
} from './identity.dto.js';

const pagination = () =>
  applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    }),
    ApiQuery({ name: 'cursor', required: false, type: String }),
  );
const idParam = () => ApiParam({ name: 'id', type: String, format: 'uuid' });
@Controller('admin')
@Requires('admin.*')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED', 'CSRF_INVALID')
@ApiProblemResponse('VALIDATION_FAILED')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(WikiIndexer) private readonly indexer: WikiIndexer,
  ) {}
  @Post('reindex')
  @HttpCode(200)
  @ApiOkResponse({ type: ReindexDto })
  reindex() {
    return this.indexer.reindex();
  }
  @Get('users')
  @pagination()
  @ApiOkResponse({ type: UsersDto })
  users(@InputQuery(PageInput) query: PageInput) {
    return this.admin.users(query);
  }
  @Post('users')
  @ApiBody({ type: CreateUserInput })
  @ApiCreatedResponse({ type: UserDto })
  @ApiProblemResponse('EMAIL_TAKEN')
  createUser(@Req() req: AuthRequest, @InputBody(CreateUserInput) input: CreateUserInput) {
    return this.admin.createUser(principal(req).user, input);
  }
  @Patch('users/:id')
  @idParam()
  @ApiBody({ type: UpdateUserInput })
  @ApiOkResponse({ type: UserDto })
  @ApiProblemResponse('LAST_OWNER', 'EMAIL_TAKEN')
  @ApiProblemResponse('NOT_FOUND')
  updateUser(
    @Req() req: AuthRequest,
    @InputParams(IdInput) { id }: IdInput,
    @InputBody(UpdateUserInput) input: UpdateUserInput,
  ) {
    return this.admin.updateUser(principal(req).user, id, input);
  }
  @Get('teams')
  @pagination()
  @ApiOkResponse({ type: TeamsDto })
  teams(@InputQuery(PageInput) query: PageInput) {
    return this.admin.teams(query);
  }
  @Post('teams')
  @ApiBody({ type: TeamInput })
  @ApiCreatedResponse({ type: TeamDto })
  @ApiProblemResponse('ALREADY_EXISTS')
  createTeam(@Req() req: AuthRequest, @InputBody(TeamInput) input: TeamInput) {
    return this.admin.createTeam(principal(req).user, input);
  }
  @Get('tokens')
  @pagination()
  @ApiOkResponse({ type: TokensDto })
  tokens(@InputQuery(PageInput) query: PageInput) {
    return this.admin.tokens(query);
  }
  @Post('tokens')
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: TokenInput })
  @ApiCreatedResponse({ type: CreatedTokenDto })
  @ApiProblemResponse('NOT_FOUND')
  createToken(@Req() req: AuthRequest, @InputBody(TokenInput) input: TokenInput) {
    return this.admin.createToken(principal(req).user, input);
  }
  @Delete('tokens/:id')
  @idParam()
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiProblemResponse('NOT_FOUND')
  revokeToken(@Req() req: AuthRequest, @InputParams(IdInput) { id }: IdInput) {
    return this.admin.revokeToken(principal(req).user, id);
  }
}
