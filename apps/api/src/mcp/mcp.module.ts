import { Module } from '@nestjs/common';
import { IdentityModule } from '../auth/identity.module.js';
import { ContributionsModule } from '../contributions/contributions.module.js';
import { DiscussionsModule } from '../discussions/discussions.module.js';
import { ReviewModule } from '../review/review.module.js';
import { WikiModule } from '../wiki/wiki.module.js';
import { McpTools } from './mcp-tools.js';
import { McpController } from './mcp.controller.js';

/** MCP server for agents (system-logic §7.5.8): a protocol adapter over the REST services. */
@Module({
  imports: [IdentityModule, WikiModule, ContributionsModule, DiscussionsModule, ReviewModule],
  controllers: [McpController],
  providers: [McpTools],
})
export class McpModule {}
