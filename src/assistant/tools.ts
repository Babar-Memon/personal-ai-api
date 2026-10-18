import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RemindersService } from '../reminders/reminders.service.js';
import {
  parseReminderCreate,
  parseReminderPatch,
  parseReminderQuery,
} from '../reminders/reminders.validation.js';
import { TasksService } from '../tasks/tasks.service.js';
import { parseTaskCreate, parseTaskPatch, parseTaskQuery } from '../tasks/tasks.validation.js';
import { formatInZone } from '../time.js';

export type ToolResult = {
  name: string;
  ok: boolean;
  summary: string;
};

type ToolContext = {
  userId: string;
  timeZone: string;
  tasks: TasksService;
  reminders: RemindersService;
};

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a task for the signed-in user.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          dueAt: { type: 'string', description: 'ISO-8601 with a timezone offset.' },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List the signed-in user tasks.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'done'] },
          view: { type: 'string', enum: ['today', 'overdue', 'upcoming', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark one task done by its id.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Update a task. Use status open to reopen it.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          dueAt: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          status: { type: 'string', enum: ['open', 'done'] },
        },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete a task only after the user has confirmed.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          confirmed: { type: 'boolean' },
        },
        required: ['taskId', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description: 'Save an in-app reminder. This does not send a push or email.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          remindAt: { type: 'string', description: 'ISO-8601 with a timezone offset.' },
        },
        required: ['title', 'remindAt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: 'List the signed-in user reminders.',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['upcoming', 'past', 'today', 'all'] },
          status: { type: 'string', enum: ['scheduled', 'done', 'dismissed'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_reminder',
      description: 'Reschedule or update a reminder by id.',
      parameters: {
        type: 'object',
        properties: {
          reminderId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          remindAt: { type: 'string' },
          status: { type: 'string', enum: ['scheduled', 'done', 'dismissed'] },
        },
        required: ['reminderId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_reminder',
      description: 'Delete a reminder only after the user has confirmed.',
      parameters: {
        type: 'object',
        properties: {
          reminderId: { type: 'string' },
          confirmed: { type: 'boolean' },
        },
        required: ['reminderId', 'confirmed'],
      },
    },
  },
];

export async function runTool(
  name: string,
  raw: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const args = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  try {
    switch (name) {
      case 'create_task': {
        const created = await context.tasks.create(context.userId, parseTaskCreate(args));
        return { name, ok: true, summary: `Task created: ${created.title}` };
      }
      case 'list_tasks': {
        const tasks = await context.tasks.list(
          context.userId,
          parseTaskQuery({ ...args, limit: 20 }),
          context.timeZone,
        );
        const lines = tasks.map(
          (task) =>
            `${task.id} | ${task.title} | ${task.status} | ${task.dueAt ? formatInZone(task.dueAt, context.timeZone) : 'no due date'}`,
        );
        return {
          name,
          ok: true,
          summary: lines.length ? lines.join('\n') : 'No tasks match.',
        };
      }
      case 'complete_task': {
        const updated = await context.tasks.update(context.userId, idOf(args.taskId), {
          status: 'done',
        });
        return { name, ok: true, summary: `Task completed: ${updated.title}` };
      }
      case 'update_task': {
        const { taskId, ...rest } = args;
        const updated = await context.tasks.update(
          context.userId,
          idOf(taskId),
          parseTaskPatch(rest),
        );
        return { name, ok: true, summary: `Task updated: ${updated.title}` };
      }
      case 'delete_task': {
        if (args.confirmed !== true) {
          return {
            name,
            ok: false,
            summary: 'Deletion was not confirmed. Ask the user before trying again.',
          };
        }
        const existing = await context.tasks.get(context.userId, idOf(args.taskId));
        await context.tasks.remove(context.userId, existing.id);
        return { name, ok: true, summary: `Task deleted: ${existing.title}` };
      }
      case 'create_reminder': {
        const created = await context.reminders.create(
          context.userId,
          parseReminderCreate(args),
        );
        return {
          name,
          ok: true,
          summary: `Reminder saved for ${formatInZone(created.remindAt, context.timeZone)}: ${created.title}. No notification was sent.`,
        };
      }
      case 'list_reminders': {
        const reminders = await context.reminders.list(
          context.userId,
          parseReminderQuery({ ...args, limit: 20 }),
          context.timeZone,
        );
        const lines = reminders.map(
          (reminder) =>
            `${reminder.id} | ${reminder.title} | ${reminder.status} | ${formatInZone(reminder.remindAt, context.timeZone)}`,
        );
        return {
          name,
          ok: true,
          summary: lines.length ? lines.join('\n') : 'No reminders match.',
        };
      }
      case 'update_reminder': {
        const { reminderId, ...rest } = args;
        const updated = await context.reminders.update(
          context.userId,
          idOf(reminderId),
          parseReminderPatch(rest),
        );
        return {
          name,
          ok: true,
          summary: `Reminder updated: ${updated.title} at ${formatInZone(updated.remindAt, context.timeZone)}`,
        };
      }
      case 'delete_reminder': {
        if (args.confirmed !== true) {
          return {
            name,
            ok: false,
            summary: 'Deletion was not confirmed. Ask the user before trying again.',
          };
        }
        const existing = await context.reminders.get(context.userId, idOf(args.reminderId));
        await context.reminders.remove(context.userId, existing.id);
        return { name, ok: true, summary: `Reminder deleted: ${existing.title}` };
      }
      default:
        return { name, ok: false, summary: 'That action is not supported.' };
    }
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof response === 'object' && response && 'message' in response
            ? String((response as { message: unknown }).message)
            : 'That action did not complete.';
      return { name, ok: false, summary: message };
    }
    throw error;
  }
}

function idOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 8) {
    throw new BadRequestException('Choose an item from the list.');
  }
  return value.trim();
}
