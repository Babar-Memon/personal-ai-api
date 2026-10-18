import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_TIMEZONE } from '../time.js';
import { RemindersService } from './reminders.service.js';
import {
  parseReminderCreate,
  parseReminderPatch,
  parseReminderQuery,
} from './reminders.validation.js';

type Authed = Request & { user: { id: string } };

@Controller('reminders')
@UseGuards(AuthGuard)
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@Req() request: Authed, @Query() query: Record<string, unknown>) {
    return this.reminders.list(
      request.user.id,
      parseReminderQuery(query),
      await this.timeZone(request.user.id),
    );
  }

  @Post()
  create(@Req() request: Authed, @Body() body: unknown) {
    return this.reminders.create(request.user.id, parseReminderCreate(body));
  }

  @Patch(':id')
  update(@Req() request: Authed, @Param('id') id: string, @Body() body: unknown) {
    return this.reminders.update(request.user.id, id, parseReminderPatch(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() request: Authed, @Param('id') id: string) {
    await this.reminders.remove(request.user.id, id);
  }

  private async timeZone(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone || DEFAULT_TIMEZONE;
  }
}
