import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';

type CheckState = 'up' | 'down';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (error: unknown) => {
      this.logger.error(
        error instanceof Error ? error.message : 'Redis client error',
      );
    });
  }

  async check() {
    const [database, redis] = await Promise.all([
      this.pingDatabase(),
      this.pingRedis(),
    ]);

    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'degraded',
      database,
      redis,
    };
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  private async pingDatabase(): Promise<CheckState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async pingRedis(): Promise<CheckState> {
    try {
      // lazyConnect leaves no stream, and enableOfflineQueue rejects ping before connect finishes.
      if (
        this.redis.status === 'wait' ||
        this.redis.status === 'end' ||
        this.redis.status === 'close'
      ) {
        await this.redis.connect();
      }
      const result = await this.redis.ping();
      return result === 'PONG' ? 'up' : 'down';
    } catch (error) {
      this.logger.error(
        'Redis health check failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 'down';
    }
  }
}
