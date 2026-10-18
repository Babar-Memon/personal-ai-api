import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { GroqService } from './groq.service.js';

@Module({
  imports: [PrismaModule, AuthModule, TasksModule, RemindersModule],
  controllers: [AssistantController],
  providers: [AssistantService, GroqService, AuthGuard],
})
export class AssistantModule {}
