import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { HealthDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({ type: HealthDto })
  @ApiProblemResponse('INTERNAL')
  report(): Promise<HealthDto> {
    return this.health.report();
  }
}
