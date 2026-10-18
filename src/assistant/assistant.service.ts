import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { DEFAULT_TIMEZONE, formatInZone, isValidTimeZone } from '../time.js';
import { GroqService, type GroqMessage } from './groq.service.js';
import { runTool, toolDefinitions, type ToolResult } from './tools.js';

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groq: GroqService,
    private readonly tasks: TasksService,
    private readonly reminders: RemindersService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async history(userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId, messages: { some: {} } },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
    });
    if (!conversation) {
      return { conversationId: null, messages: [] };
    }
    return {
      conversationId: conversation.id,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    };
  }

  async chat(userId: string, message: string, conversationId: string | undefined, ip: string) {
    const text = message.trim();
    if (text.length < 1 || text.length > 2000) {
      throw new BadRequestException('Enter a message under 2000 characters.');
    }
    await this.rateLimit.consume('assistant', ip, userId, 30);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timeZone =
      user?.timezone && isValidTimeZone(user.timezone) ? user.timezone : DEFAULT_TIMEZONE;
    const conversation = await this.conversationFor(userId, conversationId);
    const prior = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const messages: GroqMessage[] = [
      { role: 'system', content: systemPrompt(timeZone) },
      ...prior.map((item) => ({ role: item.role, content: item.content })),
      { role: 'user', content: text },
    ];
    const actions: ToolResult[] = [];
    let reply = '';
    for (let round = 0; round < 4; round += 1) {
      const next = await this.groq.complete(messages, toolDefinitions);
      const calls = next.tool_calls ?? [];
      if (calls.length === 0) {
        reply = next.content?.trim() || summaryOf(actions);
        break;
      }
      messages.push({
        role: 'assistant',
        content: next.content,
        tool_calls: calls,
      });
      for (const call of calls) {
        let args: unknown = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await runTool(call.function.name, args, {
          userId,
          timeZone,
          tasks: this.tasks,
          reminders: this.reminders,
        });
        actions.push(result);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: result.ok, summary: result.summary }),
        });
      }
    }
    if (!reply) {
      reply = summaryOf(actions) || 'I could not complete that.';
    }
    await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'user', content: text },
      }),
      this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'assistant', content: reply },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      }),
    ]);
    return { conversationId: conversation.id, reply, actions };
  }

  private async conversationFor(userId: string, conversationId?: string) {
    if (!conversationId) {
      return this.prisma.conversation.create({ data: { userId } });
    }
    const existing = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Conversation not found.');
    }
    return existing;
  }
}

function systemPrompt(timeZone: string): string {
  const now = formatInZone(new Date(), timeZone);
  return [
    'You are Personal AI, a calm assistant for tasks and in-app reminders.',
    `The user timezone is ${timeZone}. The current local time is ${now}.`,
    'Interpret relative times such as tomorrow in that timezone.',
    'Pass dueAt and remindAt as ISO-8601 timestamps that include a timezone offset.',
    'If a time or a target item is missing or ambiguous, ask a short question. Do not guess.',
    'Use only the provided tools. Never claim an action succeeded unless the tool result has ok true.',
    'Do not delete anything until the user confirms. If they have not confirmed, ask, then call the delete tool with confirmed true.',
    'Reminders are stored in the app. Do not say a push or email notification was sent.',
    'Do not discuss email accounts. Do not invent tasks or reminders that the tools did not return.',
  ].join(' ');
}

function summaryOf(actions: ToolResult[]): string {
  if (actions.length === 0) {
    return '';
  }
  return actions.map((action) => action.summary).join('\n');
}
