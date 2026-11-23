import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import type { AiJob } from '@prisma/client';
import type { JobResult } from '@md-wiki/contracts';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readJobError, readJobResult, readPingInput, readPingOutput } from './job-contracts.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const active = ['queued', 'running'] as const;

@Injectable()
export class JobsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createPing(body: unknown) {
    return this.prisma.aiJob.create({ data: { kind: 'ping', input: { ...readPingInput(body) } } });
  }

  private async getJob(id: string): Promise<AiJob> {
    if (!uuid.test(id)) throw new AppError('NOT_FOUND');
    const row = await this.prisma.aiJob.findUnique({ where: { id } });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  async getPing(id: string) {
    const row = await this.getJob(id);
    return {
      id: row.id,
      status: row.status,
      input: readPingInput(row.input),
      output: row.output === null ? undefined : readPingOutput(row.output),
      error: row.error === null ? undefined : readJobError(row.error),
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString(),
    };
  }

  async input(id: string) {
    let row = await this.getJob(id);
    if (row.status === 'queued') {
      const updated = await this.prisma.aiJob.updateMany({
        where: { id, status: 'queued' },
        data: { status: 'running', startedAt: new Date() },
      });
      if (updated.count === 0) row = await this.getJob(id);
    }
    if (row.status !== 'queued' && row.status !== 'running') {
      throw new AppError('PRECONDITION_FAILED');
    }
    return { jobId: row.id, kind: row.kind, input: readPingInput(row.input) };
  }

  async result(id: string, body: unknown): Promise<void> {
    const row = await this.getJob(id);
    if (row.status === 'succeeded' || row.status === 'failed') {
      this.checkReplay(row, body);
      return;
    }
    const result: JobResult = readJobResult(body);
    if (result.status === 'ok' && result.output.echo !== readPingInput(row.input).message) {
      throw new AppError('VALIDATION_FAILED', undefined, [
        {
          path: 'output.echo',
          code: 'echoMismatch',
          message: 'Echo must equal the original message',
        },
      ]);
    }
    // A competing result may finish the job after the initial read. Only one write wins.
    const updated = await this.prisma.aiJob.updateMany({
      where: { id, status: { in: [...active] } },
      data:
        result.status === 'ok'
          ? { status: 'succeeded', output: { ...result.output }, finishedAt: new Date() }
          : { status: 'failed', error: { ...result.error }, finishedAt: new Date() },
    });
    if (updated.count === 0) this.checkReplay(await this.getJob(id), body);
  }

  private checkReplay(row: AiJob, body: unknown): void {
    const stored =
      row.status === 'succeeded'
        ? { status: 'ok', output: row.output }
        : { status: 'failed', error: row.error };
    if (!isDeepStrictEqual(stored, body)) throw new AppError('PRECONDITION_FAILED');
  }
}
