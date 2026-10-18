import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, startOfZonedDay } from '../time.js';
import type { TaskQuery, TaskWrite } from './tasks.validation.js';

const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, query: TaskQuery, timeZone: string, now = new Date()) {
    const start = startOfZonedDay(now, timeZone);
    const dueAt =
      query.view === 'nodue'
        ? null
        : query.view === 'today'
          ? { gte: start, lt: addDays(start, 1) }
          : query.view === 'overdue'
            ? { lt: start }
            : query.view === 'upcoming'
              ? { gte: now }
              : undefined;
    return this.prisma.task.findMany({
      where: {
        userId,
        status: query.status,
        priority: query.priority,
        dueAt,
      },
      select: taskSelect,
      orderBy:
        query.sort === 'priority'
          ? [{ priority: query.order }, { createdAt: 'desc' }]
          : query.sort === 'createdAt'
            ? [{ createdAt: query.order }]
            : [{ dueAt: query.order }, { createdAt: 'desc' }],
      take: query.limit,
      skip: query.offset,
    });
  }

  async get(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, userId },
      select: taskSelect,
    });
    if (!task) {
      throw new NotFoundException('Task not found.');
    }
    return task;
  }

  create(userId: string, input: TaskWrite) {
    if (!input.title) {
      throw new BadRequestException('Enter a title.');
    }
    return this.prisma.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        priority: input.priority ?? 'normal',
        status: input.status ?? 'open',
      },
      select: taskSelect,
    });
  }

  async update(userId: string, id: string, input: TaskWrite) {
    await this.get(userId, id);
    return this.prisma.task.update({
      where: { id },
      data: input,
      select: taskSelect,
    });
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.task.delete({ where: { id } });
  }
}
