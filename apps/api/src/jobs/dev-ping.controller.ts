import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { pingInputDoc, pingOutputDoc, jobErrorDoc } from './job-contracts.js';
import type { SchemaObject } from './job-contracts.js';
import { JobsService } from './jobs.service.js';
import { PingQueue } from './ping-queue.js';

const id = { type: 'string', format: 'uuid' } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;
const status: SchemaObject = { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed'] };

@Controller('dev/ping')
export class DevPingController {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(PingQueue) private readonly queue: PingQueue,
  ) {}

  @Post()
  @ApiBody({ schema: pingInputDoc })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['id', 'status'],
      properties: { id, status: { type: 'string', enum: ['queued'] } },
    },
  })
  @ApiProblemResponse('VALIDATION_FAILED')
  async create(@Body() body: unknown) {
    const row = await this.jobs.createPing(body);
    await this.queue.enqueue({ v: 1, jobId: row.id, kind: row.kind });
    return { id: row.id, status: row.status };
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: id })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['id', 'status', 'input', 'createdAt'],
      properties: {
        id,
        status,
        input: pingInputDoc,
        output: pingOutputDoc,
        error: jobErrorDoc,
        createdAt: timestamp,
        finishedAt: timestamp,
      },
    },
  })
  @ApiProblemResponse('NOT_FOUND')
  get(@Param('id') jobId: string) {
    return this.jobs.getPing(jobId);
  }
}
