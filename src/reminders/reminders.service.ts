import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, startOfZonedDay } from '../time.js';
import type { ReminderQuery, ReminderWrite } from './reminders.validation.js';

const reminderSelect = {
  id: true,
  title: true,
  description: true,
  remindAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, query: ReminderQuery, timeZone: string, now = new Date()) {
    const start = startOfZonedDay(now, timeZone);
    const remindAt =
      query.view === 'today'
        ? { gte: start, lt: addDays(start, 1) }
        : query.view === 'upcoming'
          ? { gte: now }
          : query.view === 'past'
            ? { lt: now }
            : undefined;
    return this.prisma.reminder.findMany({
      where: { userId, status: query.status, remindAt },
      select: reminderSelect,
      orderBy: [{ remindAt: query.order }, { createdAt: 'desc' }],
      take: query.limit,
      skip: query.offset,
    });
  }

  async get(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id, userId },
      select: reminderSelect,
    });
    if (!reminder) {
      throw new NotFoundException('Reminder not found.');
    }
    return reminder;
  }

  create(userId: string, input: ReminderWrite & { title: string; remindAt: Date }) {
    return this.prisma.reminder.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        remindAt: input.remindAt,
        status: input.status ?? 'scheduled',
      },
      select: reminderSelect,
    });
  }

  async update(userId: string, id: string, input: ReminderWrite) {
    await this.get(userId, id);
    return this.prisma.reminder.update({
      where: { id },
      data: input,
      select: reminderSelect,
    });
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.reminder.delete({ where: { id } });
  }
}
