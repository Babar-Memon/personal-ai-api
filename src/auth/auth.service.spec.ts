import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { OtpDeliveryService } from './otp-delivery.js';
import { RateLimitService } from './rate-limit.service.js';
import { TokenService } from './token.service.js';

const tokens = {
  accessTtl: 900,
  refreshTtl: 3600,
  signAccess: vi.fn(async (userId: string, sessionId: string) => {
    return `access.${userId}.${sessionId}`;
  }),
  verifyAccess: vi.fn(),
  newRefreshToken: vi.fn(() => 'refresh-token-value'),
  hashRefreshToken: vi.fn((token: string) => `hash:${token}`),
  hashOtp: vi.fn((email: string, code: string) => `otp:${email}:${code}`),
  otpMatches: vi.fn(
    (email: string, code: string, codeHash: string) =>
      codeHash === `otp:${email}:${code}`,
  ),
  signRegistration: vi.fn(async (email: string) => `registration.${email}`),
  verifyRegistration: vi.fn(async (token: string) => {
    if (!token.startsWith('registration.')) {
      throw new Error('invalid');
    }
    return token.slice('registration.'.length);
  }),
} as unknown as TokenService;

const rateLimit = {
  consume: vi.fn(async () => undefined),
} as unknown as RateLimitService;

const delivery = {
  send: vi.fn(async () => undefined),
} as unknown as OtpDeliveryService;

describe('AuthService', () => {
  const prisma = {
    user: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    otpChallenge: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    ),
  };

  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokens,
      rateLimit,
      delivery,
    );
  });

  it('stores a hash of the OTP and does not return the code', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue(null);

    await expect(service.requestOtp('person@example.com', '127.0.0.1')).resolves.toBeUndefined();

    expect(prisma.otpChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'person@example.com',
          codeHash: expect.stringMatching(/^otp:person@example.com:\d{6}$/),
        }),
      }),
    );
    const sent = vi.mocked(delivery.send).mock.calls[0]?.[1];
    expect(sent).toMatch(/^\d{6}$/);
    expect(JSON.stringify(prisma.otpChallenge.create.mock.calls[0][0])).not.toContain(
      `"code":"${sent}"`,
    );
  });

  it('refuses a resend during the cooldown', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValue({ createdAt: new Date() });

    await expect(service.requestOtp('person@example.com', '127.0.0.1')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
  });

  it('signs in an existing user and does not issue a session for a new email', async () => {
    prisma.otpChallenge.findFirst
      .mockResolvedValueOnce({
        id: 'challenge-1',
        attempts: 0,
        codeHash: 'otp:person@example.com:123456',
      })
      .mockResolvedValueOnce({
        id: 'challenge-2',
        attempts: 0,
        codeHash: 'otp:new@example.com:123456',
      });
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'person@example.com',
      name: 'Ada',
    });

    const existing = await service.verifyOtp('person@example.com', '123456', '127.0.0.1');
    expect(existing.status).toBe('authenticated');
    if (existing.status === 'authenticated') {
      expect(existing.session.user).toEqual({
        id: 'user-1',
        email: 'person@example.com',
        name: 'Ada',
      });
      expect(existing.session).not.toHaveProperty('codeHash');
    }

    prisma.user.findUnique.mockResolvedValue(null);
    const created = await service.verifyOtp('new@example.com', '123456', '127.0.0.1');
    expect(created).toEqual({
      status: 'registration_required',
      email: 'new@example.com',
      registrationToken: 'registration.new@example.com',
    });
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid, reused, or exhausted OTP', async () => {
    prisma.otpChallenge.findFirst.mockResolvedValueOnce({
      id: 'challenge-1',
      attempts: 0,
      codeHash: 'otp:person@example.com:654321',
    });

    await expect(
      service.verifyOtp('person@example.com', '000000', '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.otpChallenge.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attempts: 1 }) }),
    );

    prisma.otpChallenge.findFirst.mockResolvedValueOnce({
      id: 'challenge-1',
      attempts: 4,
      codeHash: 'otp:person@example.com:654321',
    });
    await expect(
      service.verifyOtp('person@example.com', '000000', '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.otpChallenge.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 5, consumedAt: expect.any(Date) }),
      }),
    );

    prisma.otpChallenge.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.verifyOtp('person@example.com', '654321', '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    prisma.otpChallenge.findFirst.mockResolvedValueOnce({
      id: 'challenge-2',
      attempts: 0,
      codeHash: 'otp:person@example.com:654321',
    });
    prisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.verifyOtp('person@example.com', '654321', '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates an account only after a verified registration token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      name: 'Ada Lovelace',
    });

    const session = await service.completeRegistration(
      'registration.new@example.com',
      'Ada Lovelace',
      '127.0.0.1',
    );

    expect(session.user.name).toBe('Ada Lovelace');
    expect(prisma.session.create).toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    await expect(
      service.completeRegistration('registration.new@example.com', 'Ada', '127.0.0.1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rotates a refresh token and revokes the previous session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-old',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedById: null,
      user: { id: 'user-1', email: 'person@example.com', name: null },
    });

    const session = await service.refresh('refresh-token-value');

    expect(session.refreshToken).toBe('refresh-token-value');
    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-old' },
        data: expect.objectContaining({ replacedById: expect.any(String) }),
      }),
    );
  });

  it('revokes the session family when a rotated token is reused', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-old',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      replacedById: 'session-new',
      user: { id: 'user-1', email: 'person@example.com', name: null },
    });

    await expect(service.refresh('stolen-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('returns the stored time zone with the current user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'person@example.com',
      name: 'Ada',
      timezone: 'Asia/Karachi',
    });

    await expect(service.currentUser('user-1')).resolves.toEqual({
      id: 'user-1',
      email: 'person@example.com',
      name: 'Ada',
      timezone: 'Asia/Karachi',
    });
  });

  it('updates only the time zone', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'person@example.com',
      name: 'Ada',
      timezone: 'Asia/Karachi',
    });

    await expect(service.updateTimezone('user-1', 'Asia/Karachi')).resolves.toMatchObject({
      timezone: 'Asia/Karachi',
      name: 'Ada',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { timezone: 'Asia/Karachi' },
      select: { id: true, email: true, name: true, timezone: true },
    });
  });
});
