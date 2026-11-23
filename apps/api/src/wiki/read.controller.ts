import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { InputQuery } from '../common/validation.js';
import {
  apiPagination,
  apiRecentScope,
  apiSearchQuery,
  apiWikiPath,
  ContextDto,
  ContextInput,
  HistoryDto,
  PageDto,
  RecentDto,
  RecentInput,
  SearchDto,
  SearchInput,
  SnapshotPageInput,
  TreeDto,
  TreeInput,
} from './read.dto.js';
import { SearchService } from './search.service.js';
import { WikiReadService } from './wiki-read.service.js';

@Controller()
@Requires('wiki.read')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED')
export class WikiReadController {
  constructor(
    @Inject(WikiReadService) private readonly wiki: WikiReadService,
    @Inject(SearchService) private readonly finder: SearchService,
  ) {}

  @Get('wiki/tree')
  @ApiQuery({ name: 'topic', required: false, type: String })
  @ApiOkResponse({ type: TreeDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  tree(@InputQuery(TreeInput) { topic }: TreeInput) {
    return this.wiki.tree(topic);
  }

  @Get('wiki/pages/:path')
  @apiWikiPath()
  @ApiOkResponse({ type: PageDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('INVALID_PATH')
  page(@Param('path') path: string) {
    return this.wiki.page(path);
  }

  @Get('wiki/pages/:path/history')
  @Requires('history.read')
  @apiWikiPath()
  @apiPagination(true)
  @ApiOkResponse({ type: HistoryDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  history(@Param('path') path: string, @InputQuery(SnapshotPageInput) query: SnapshotPageInput) {
    return this.wiki.history(path, query);
  }

  @Get('wiki/pages/:path/versions/:label')
  @Requires('history.read')
  @apiWikiPath()
  @ApiParam({ name: 'label', type: String })
  @ApiOkResponse({ type: PageDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('INVALID_PATH')
  version(@Param('path') path: string, @Param('label') label: string) {
    return this.wiki.page(path, label);
  }

  @Get('wiki/recent')
  @apiPagination(true)
  @apiRecentScope()
  @ApiOkResponse({ type: RecentDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  recent(@Req() req: AuthRequest, @InputQuery(RecentInput) query: RecentInput) {
    return this.wiki.recent(query, principal(req).user);
  }

  @Get('context')
  @ApiQuery({ name: 'path', type: String })
  @ApiOkResponse({ type: ContextDto })
  @ApiProblemResponse('NOT_FOUND')
  @ApiProblemResponse('INVALID_PATH', 'VALIDATION_FAILED')
  context(@InputQuery(ContextInput) { path }: ContextInput) {
    return this.wiki.context(path);
  }

  @Get('search')
  @Requires('search')
  @apiSearchQuery()
  @ApiOkResponse({ type: SearchDto })
  @ApiProblemResponse('VALIDATION_FAILED')
  search(@InputQuery(SearchInput) query: SearchInput) {
    return this.finder.search(query);
  }
}
