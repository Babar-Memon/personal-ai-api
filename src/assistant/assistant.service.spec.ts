import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantService } from './assistant.service.js';
import { GroqService } from './groq.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('AssistantService', () => {
  const tasks = {
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
  };
  const reminders = {
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
  };
  const groq = { complete: vi.fn() };
  const rateLimit = { consume: vi.fn(async () => undefined) };
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ timezone: 'UTC' })) },
    conversation: {
      create: vi.fn(async () => ({ id: 'conversation-1' })),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    message: { findMany: vi.fn(async () => []), create: vi.fn() },
    $transaction: vi.fn(async () => undefined),
  };

  let service: AssistantService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AssistantService(
      prisma as unknown as PrismaService,
      groq as unknown as GroqService,
      tasks as unknown as TasksService,
      reminders as unknown as RemindersService,
      rateLimit as unknown as RateLimitService,
    );
  });

  it('creates a task only after the tool succeeds, then stores the reply', async () => {
    tasks.create.mockResolvedValue({ id: 'task-1', title: 'Finish the project' });
    groq.complete
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'create_task',
              arguments: JSON.stringify({ title: 'Finish the project' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Task created: Finish the project', tool_calls: [] });

    const result = await service.chat('user-1', 'Add a task to finish my project.', undefined, '127.0.0.1');

    expect(tasks.create).toHaveBeenCalled();
    expect(result.actions).toEqual([
      { name: 'create_task', ok: true, summary: 'Task created: Finish the project' },
    ]);
    expect(result.reply).toBe('Task created: Finish the project');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('does not delete when the model has not confirmed', async () => {
    groq.complete
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'delete_task',
              arguments: JSON.stringify({ taskId: 'task-12345678', confirmed: false }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Should I delete that task?', tool_calls: [] });

    const result = await service.chat('user-1', 'Delete that task.', undefined, '127.0.0.1');

    expect(tasks.remove).not.toHaveBeenCalled();
    expect(result.actions[0]?.ok).toBe(false);
    expect(result.reply).toBe('Should I delete that task?');
  });

  it('does not store a success reply when the provider fails', async () => {
    groq.complete.mockRejectedValue(new ServiceUnavailableException('The assistant could not reply.'));

    await expect(service.chat('user-1', 'Help me plan my day.', undefined, '127.0.0.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unsupported tool instead of executing it', async () => {
    groq.complete
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'send_email', arguments: '{}' },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'I cannot do that.', tool_calls: [] });

    const result = await service.chat('user-1', 'Email my boss.', undefined, '127.0.0.1');

    expect(result.actions[0]).toMatchObject({ name: 'send_email', ok: false });
    expect(tasks.create).not.toHaveBeenCalled();
  });
});
