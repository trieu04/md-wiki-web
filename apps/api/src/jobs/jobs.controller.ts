import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiParam } from '@nestjs/swagger';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
@ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('NOT_FOUND')
@ApiProblemResponse('PRECONDITION_FAILED')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Get(':id/input')
  input(@Param('id') id: string) {
    return this.jobs.input(id);
  }

  @Post(':id/result')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiProblemResponse('VALIDATION_FAILED')
  async result(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    await this.jobs.result(id, body);
  }
}
