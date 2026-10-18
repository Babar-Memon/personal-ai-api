import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
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

  async consume(
    action: 'request-otp' | 'verify-otp' | 'complete-registration' | 'assistant',
    ip: string,
    email: string,
    max = MAX_ATTEMPTS,
  ) {
    try {
      if (
        this.redis.status === 'wait' ||
        this.redis.status === 'end' ||
        this.redis.status === 'close'
      ) {
        await this.redis.connect();
      }
      for (const key of [
        `auth:rl:${action}:ip:${ip}`,
        `auth:rl:${action}:email:${email}`,
      ]) {
        const count = await this.redis.incr(key);
        if (count === 1) {
          await this.redis.expire(key, WINDOW_SECONDS);
        }
        if (count > max) {
          throw new HttpException(
            'Too many attempts. Try again later.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        'Auth rate limit unavailable',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Try again shortly.');
    }
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
