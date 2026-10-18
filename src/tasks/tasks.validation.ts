import { BadRequestException } from '@nestjs/common';
import { parseOffsetInstant } from '../time.js';

const priorities = ['low', 'normal', 'high'] as const;
const statuses = ['open', 'done'] as const;
const views = ['today', 'overdue', 'upcoming', 'nodue', 'all'] as const;
const sorts = ['dueAt', 'priority', 'createdAt'] as const;

export type TaskWrite = {
  title?: string;
  description?: string | null;
  dueAt?: Date | null;
  priority?: (typeof priorities)[number];
  status?: (typeof statuses)[number];
};

export type TaskQuery = {
  status?: (typeof statuses)[number];
  priority?: (typeof priorities)[number];
  view: (typeof views)[number];
  sort: (typeof sorts)[number];
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
};

export function parseTaskCreate(body: unknown): TaskWrite {
  const record = objectBody(body);
  return {
    title: titleOf(record.title),
    description: descriptionOf(record.description, false),
    dueAt: instantOf(record.dueAt, false),
    priority: choice(record.priority, priorities, 'priority'),
    status: choice(record.status, statuses, 'status') ?? 'open',
  };
}

export function parseTaskPatch(body: unknown): TaskWrite {
  const record = objectBody(body);
  const patch: TaskWrite = {};
  if ('title' in record) {
    patch.title = titleOf(record.title);
  }
  if ('description' in record) {
    patch.description = descriptionOf(record.description, true);
  }
  if ('dueAt' in record) {
    patch.dueAt = record.dueAt == null ? null : instantOf(record.dueAt, false);
  }
  if ('priority' in record) {
    const priority = choice(record.priority, priorities, 'priority');
    if (!priority) {
      throw new BadRequestException('Choose a priority of low, normal, or high.');
    }
    patch.priority = priority;
  }
  if ('status' in record) {
    const status = choice(record.status, statuses, 'status');
    if (!status) {
      throw new BadRequestException('Choose a status of open or done.');
    }
    patch.status = status;
  }
  if (Object.keys(patch).length === 0) {
    throw new BadRequestException('Nothing to update.');
  }
  return patch;
}

export function parseTaskQuery(query: Record<string, unknown>): TaskQuery {
  return {
    status: choice(query.status, statuses, 'status'),
    priority: choice(query.priority, priorities, 'priority'),
    view: choice(query.view, views, 'view') ?? 'all',
    sort: choice(query.sort, sorts, 'sort') ?? 'dueAt',
    order: query.order === 'desc' ? 'desc' : 'asc',
    limit: pageNumber(query.limit, 50, 100),
    offset: pageNumber(query.offset, 0, 10_000),
  };
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Enter a task.');
  }
  return body as Record<string, unknown>;
}

function titleOf(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter a title.');
  }
  const title = value.trim().replace(/\s+/g, ' ');
  if (title.length < 1 || title.length > 200) {
    throw new BadRequestException('Enter a title between 1 and 200 characters.');
  }
  return title;
}

function descriptionOf(value: unknown, allowNull: boolean): string | null | undefined {
  if (value == null) {
    return allowNull ? null : undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter a description as text.');
  }
  const description = value.trim();
  if (description.length > 2000) {
    throw new BadRequestException('Keep the description under 2000 characters.');
  }
  return description.length === 0 ? null : description;
}

function instantOf(value: unknown, required: boolean): Date | null | undefined {
  if (value == null || value === '') {
    return required ? null : undefined;
  }
  const date = parseOffsetInstant(value);
  if (!date) {
    throw new BadRequestException('Enter a date and time with a timezone offset.');
  }
  return date;
}

function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BadRequestException(`Choose a valid ${name}.`);
  }
  return value as T;
}

function pageNumber(value: unknown, fallback: number, max: number): number {
  if (value == null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new BadRequestException('Page values are out of range.');
  }
  return number;
}
