import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { OtpDeliveryService } from './otp-delivery.js';
import { createOtpCode } from './otp.js';
import { RateLimitService } from './rate-limit.service.js';
import { TokenService } from './token.service.js';

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
};

export type IssuedSession = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
};

export type VerifyResult =
  | { status: 'authenticated'; session: IssuedSession }
  | { status: 'registration_required'; email: string; registrationToken: string };

const invalidCode = 'That code is incorrect or has expired.';
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
    private readonly delivery: OtpDeliveryService,
  ) {}

  async requestOtp(email: string, ip: string): Promise<void> {
    await this.rateLimit.consume('request-otp', ip, email);
    const latest = await this.prisma.otpChallenge.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < resendCooldownMs()) {
      throw new HttpException(
        'Wait a minute before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = createOtpCode();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.otpChallenge.updateMany({
        where: { email, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.otpChallenge.create({
        data: {
          email,
          codeHash: this.tokens.hashOtp(email, code),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
      });
    });
    await this.delivery.send(email, code);
  }

  async verifyOtp(email: string, code: string, ip: string): Promise<VerifyResult> {
    await this.rateLimit.consume('verify-otp', ip, email);
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException(invalidCode);
    }
    if (!this.tokens.otpMatches(email, code, challenge.codeHash)) {
      const attempts = challenge.attempts + 1;
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts,
          consumedAt: attempts >= MAX_OTP_ATTEMPTS ? new Date() : null,
        },
      });
      throw new UnauthorizedException(invalidCode);
    }

    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException(invalidCode);
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (user) {
      return { status: 'authenticated', session: await this.issueSession(user) };
    }
    return {
      status: 'registration_required',
      email,
      registrationToken: await this.tokens.signRegistration(email),
    };
  }

  async completeRegistration(
    registrationToken: string,
    name: string,
    ip: string,
  ): Promise<IssuedSession> {
    let email: string;
    try {
      email = await this.tokens.verifyRegistration(registrationToken);
    } catch {
      throw new UnauthorizedException('Request a new code.');
    }
    await this.rateLimit.consume('complete-registration', ip, email);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
          throw new ConflictException('An account with that email already exists.');
        }
        return tx.user.create({
          data: { email, name },
          select: { id: true, email: true, name: true },
        });
      });
      return this.issueSession(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with that email already exists.');
      }
      throw error;
    }
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!session) {
      throw new UnauthorizedException('Sign in again.');
    }
    if (session.revokedAt || session.replacedById) {
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Refresh token reuse for user ${session.userId}`);
      throw new UnauthorizedException('Sign in again.');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Sign in again.');
    }
    return this.issueSession(session.user, session.id);
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) {
      return;
    }
    await this.prisma.session.updateMany({
      where: {
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccess(token: string | undefined) {
    if (!token) {
      throw new UnauthorizedException('Sign in again.');
    }
    let claims;
    try {
      claims = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedException('Sign in again.');
    }
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
    });
    if (
      !session ||
      session.revokedAt ||
      session.userId !== claims.sub ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Sign in again.');
    }
    return { id: claims.sub, sessionId: claims.sid };
  }

  async currentUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      throw new UnauthorizedException('Sign in again.');
    }
    return user;
  }

  private async issueSession(
    user: PublicUser,
    previousSessionId?: string,
  ): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const refreshToken = this.tokens.newRefreshToken();
    const expiresAt = new Date(Date.now() + this.tokens.refreshTtl * 1000);

    await this.prisma.$transaction(async (tx) => {
      if (previousSessionId) {
        await tx.session.update({
          where: { id: previousSessionId },
          data: { revokedAt: new Date(), replacedById: sessionId },
        });
      }
      await tx.session.create({
        data: {
          id: sessionId,
          userId: user.id,
          tokenHash: this.tokens.hashRefreshToken(refreshToken),
          expiresAt,
        },
      });
    });

    return {
      user,
      accessToken: await this.tokens.signAccess(user.id, sessionId),
      refreshToken,
      accessTokenExpiresIn: this.tokens.accessTtl,
      refreshTokenExpiresIn: this.tokens.refreshTtl,
    };
  }
}

function resendCooldownMs(): number {
  const raw = process.env.OTP_RESEND_SECONDS;
  const seconds = raw == null || raw.trim() === '' ? 60 : Number(raw);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
    throw new Error('OTP_RESEND_SECONDS must be an integer from 0 to 3600');
  }
  return seconds * 1000;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
