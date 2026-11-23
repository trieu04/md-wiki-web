import { Controller, Inject, Req, Sse } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProduces, getSchemaPath } from '@nestjs/swagger';
import { principal, Requires } from '../auth/auth-http.js';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiProblemResponse } from '../common/problem.dto.js';
import { EventDto } from '../review/review.dto.js';
import { EventsService } from './events.service.js';

@Controller('events')
@ApiProblemResponse('UNAUTHENTICATED')
@ApiProblemResponse('FORBIDDEN', 'ACCOUNT_DISABLED')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  /** Server-sent events that tell the web which queries to invalidate (system-logic §7.4.11). */
  @Sse()
  @Requires('wiki.read')
  @ApiProduces('text/event-stream')
  @ApiExtraModels(EventDto)
  @ApiOkResponse({
    description: 'One `event: <type>` + `data: EventDto` message per state change',
    content: { 'text/event-stream': { schema: { $ref: getSchemaPath(EventDto) } } },
  })
  stream(@Req() req: AuthRequest) {
    const { user } = principal(req);
    return this.events.stream({ id: user.id, roles: user.roles });
  }
}
