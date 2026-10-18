import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { AssistantService } from './assistant.service.js';

type Authed = Request & { user: { id: string } };

@Controller('assistant')
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('conversation')
  history(@Req() request: Authed) {
    return this.assistant.history(request.user.id);
  }

  @Post('chat')
  chat(@Req() request: Authed, @Body() body: unknown) {
    const record =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const message = typeof record.message === 'string' ? record.message : '';
    const conversationId =
      typeof record.conversationId === 'string' ? record.conversationId : undefined;
    return this.assistant.chat(request.user.id, message, conversationId, clientIp(request));
  }
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}
