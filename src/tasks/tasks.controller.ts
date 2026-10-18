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
import { TasksService } from './tasks.service.js';
import { parseTaskCreate, parseTaskPatch, parseTaskQuery } from './tasks.validation.js';

type Authed = Request & { user: { id: string } };

@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@Req() request: Authed, @Query() query: Record<string, unknown>) {
    return this.tasks.list(
      request.user.id,
      parseTaskQuery(query),
      await this.timeZone(request.user.id),
    );
  }

  @Get(':id')
  get(@Req() request: Authed, @Param('id') id: string) {
    return this.tasks.get(request.user.id, id);
  }

  @Post()
  create(@Req() request: Authed, @Body() body: unknown) {
    return this.tasks.create(request.user.id, parseTaskCreate(body));
  }

  @Patch(':id')
  update(@Req() request: Authed, @Param('id') id: string, @Body() body: unknown) {
    return this.tasks.update(request.user.id, id, parseTaskPatch(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() request: Authed, @Param('id') id: string) {
    await this.tasks.remove(request.user.id, id);
  }

  private async timeZone(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone || DEFAULT_TIMEZONE;
  }
}
