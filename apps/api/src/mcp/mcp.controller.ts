import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { McpTools } from './mcp-tools.js';

/**
 * MCP over streamable HTTP at `/mcp` (system-logic §7.5.8): stateless JSON responses, one
 * server per request, bearer API token only (no cookies, so no CSRF surface).
 */
@ApiExcludeController()
@Controller('mcp')
export class McpController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(McpTools) private readonly tools: McpTools,
  ) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response) {
    const header = req.get('authorization');
    if (!header?.match(/^Bearer /i)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      throw new AppError('UNAUTHENTICATED', 'An API token is required');
    }
    const identity = await this.auth.bearer(header);
    const server = this.tools.server(identity);
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
