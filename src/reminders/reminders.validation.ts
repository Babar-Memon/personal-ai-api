import { BadRequestException } from '@nestjs/common';
import { parseOffsetInstant } from '../time.js';

const statuses = ['scheduled', 'done', 'dismissed'] as const;
const views = ['upcoming', 'past', 'today', 'all'] as const;

export type ReminderWrite = {
  title?: string;
  description?: string | null;
  remindAt?: Date;
  status?: (typeof statuses)[number];
};

export type ReminderQuery = {
  status?: (typeof statuses)[number];
  view: (typeof views)[number];
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
};

export function parseReminderCreate(body: unknown): Required<Pick<ReminderWrite, 'title' | 'remindAt'>> &
  ReminderWrite {
  const record = objectBody(body, 'Enter a reminder.');
  const remindAt = parseOffsetInstant(record.remindAt);
  if (!remindAt) {
    throw new BadRequestException('Enter a date and time with a timezone offset.');
  }
  return {
    title: titleOf(record.title),
    description: textOrNull(record.description),
    remindAt,
    status: choice(record.status, statuses) ?? 'scheduled',
  };
}

export function parseReminderPatch(body: unknown): ReminderWrite {
  const record = objectBody(body, 'Nothing to update.');
  const patch: ReminderWrite = {};
  if ('title' in record) {
    patch.title = titleOf(record.title);
  }
  if ('description' in record) {
    patch.description = textOrNull(record.description);
  }
  if ('remindAt' in record) {
    const remindAt = parseOffsetInstant(record.remindAt);
    if (!remindAt) {
      throw new BadRequestException('Enter a date and time with a timezone offset.');
    }
    patch.remindAt = remindAt;
  }
  if ('status' in record) {
    const status = choice(record.status, statuses);
    if (!status) {
      throw new BadRequestException('Choose a status of scheduled, done, or dismissed.');
    }
    patch.status = status;
  }
  if (Object.keys(patch).length === 0) {
    throw new BadRequestException('Nothing to update.');
  }
  return patch;
}

export function parseReminderQuery(query: Record<string, unknown>): ReminderQuery {
  return {
    status: choice(query.status, statuses),
    view: choice(query.view, views) ?? 'all',
    order: query.order === 'desc' ? 'desc' : 'asc',
    limit: pageNumber(query.limit, 50, 100),
    offset: pageNumber(query.offset, 0, 10_000),
  };
}

function objectBody(body: unknown, message: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException(message);
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

function textOrNull(value: unknown): string | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > 2000) {
    throw new BadRequestException('Keep the description under 2000 characters.');
  }
  return value.trim();
}

function choice<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BadRequestException('Choose a valid value.');
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
