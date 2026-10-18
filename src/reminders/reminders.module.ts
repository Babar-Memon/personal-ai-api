import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RemindersController],
  providers: [RemindersService, AuthGuard],
  exports: [RemindersService],
})
export class RemindersModule {}
