import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { OtpDeliveryService } from './otp-delivery.js';
import { RateLimitService } from './rate-limit.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, TokenService, RateLimitService, OtpDeliveryService],
})
export class AuthModule {}
