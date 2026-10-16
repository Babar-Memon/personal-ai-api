import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

const redisMocks = vi.hoisted(() => ({
  ping: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  connect: vi.fn(),
  status: 'ready',
}));

vi.mock('ioredis', () => ({
  Redis: class Redis {
    ping = redisMocks.ping;
    disconnect = redisMocks.disconnect;
    on = redisMocks.on;
    connect = redisMocks.connect;
    get status() {
      return redisMocks.status;
    }
  },
}));

describe('HealthService', () => {
  const queryRaw = vi.fn();
  let service: HealthService;

  beforeEach(() => {
    queryRaw.mockReset();
    redisMocks.ping.mockReset();
    redisMocks.disconnect.mockReset();
    redisMocks.on.mockReset();
    redisMocks.connect.mockReset();
    redisMocks.status = 'ready';
    service = new HealthService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      {
        getOrThrow: () => 'redis://127.0.0.1:6379',
      } as unknown as ConfigService,
    );
  });

  it('reports ok when Postgres and Redis both answer', async () => {
    queryRaw.mockResolvedValue([{ result: 1 }]);
    redisMocks.ping.mockResolvedValue('PONG');

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
      redis: 'up',
    });
  });

  it('reports degraded when either check fails', async () => {
    queryRaw.mockRejectedValue(new Error('database down'));
    redisMocks.ping.mockResolvedValue('PONG');

    await expect(service.check()).resolves.toEqual({
      status: 'degraded',
      database: 'down',
      redis: 'up',
    });

    queryRaw.mockResolvedValue([{ result: 1 }]);
    redisMocks.ping.mockRejectedValue(new Error('redis down'));

    await expect(service.check()).resolves.toEqual({
      status: 'degraded',
      database: 'up',
      redis: 'down',
    });
  });

  it('connects before ping when the client has no stream', async () => {
    const order: string[] = [];
    redisMocks.status = 'wait';
    redisMocks.connect.mockImplementation(async () => {
      order.push('connect');
    });
    redisMocks.ping.mockImplementation(async () => {
      order.push('ping');
      return 'PONG';
    });
    queryRaw.mockResolvedValue([{ result: 1 }]);

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
      redis: 'up',
    });
    expect(order).toEqual(['connect', 'ping']);
  });

  it('logs a Redis client error without throwing', () => {
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const listener = redisMocks.on.mock.calls.find(
      (call) => call[0] === 'error',
    )?.[1] as (error: unknown) => void;

    expect(() => listener(new Error('connection reset'))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('connection reset');
    errorSpy.mockRestore();
  });
});
