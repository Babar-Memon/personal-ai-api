import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { TokenService } from './token.service.js';

const secret = 'test-only-jwt-secret-with-32-characters';

function service() {
  return new TokenService({
    get: (key: string) =>
      ({
        JWT_SECRET: secret,
        JWT_ISSUER: 'personal-ai-api',
        JWT_AUDIENCE: 'personal-ai',
        ACCESS_TOKEN_TTL_SECONDS: '900',
        REFRESH_TOKEN_TTL_SECONDS: '2592000',
      })[key],
  } as ConfigService);
}

describe('TokenService', () => {
  it('rejects a token whose use is not access', async () => {
    const tokens = service();
    const foreign = await new SignJWT({ token_use: 'refresh', sid: 'session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user')
      .setIssuer('personal-ai-api')
      .setAudience('personal-ai')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));

    await expect(tokens.verifyAccess(foreign)).rejects.toThrow(
      'Invalid access token',
    );
  });

  it('round-trips an access token and rejects the wrong audience', async () => {
    const tokens = service();
    const access = await tokens.signAccess('user-1', 'session-1');
    await expect(tokens.verifyAccess(access)).resolves.toEqual({
      sub: 'user-1',
      sid: 'session-1',
    });

    const otherAudience = await new SignJWT({
      token_use: 'access',
      sid: 'session-1',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('personal-ai-api')
      .setAudience('someone-else')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));

    await expect(tokens.verifyAccess(otherAudience)).rejects.toThrow();
  });

  it('does not accept a registration token as an access token', async () => {
    const tokens = service();
    const registration = await tokens.signRegistration('person@example.com');
    await expect(tokens.verifyRegistration(registration)).resolves.toBe(
      'person@example.com',
    );
    await expect(tokens.verifyAccess(registration)).rejects.toThrow(
      'Invalid access token',
    );
  });

  it('hashes refresh tokens without keeping the raw value', () => {
    const tokens = service();
    const refresh = tokens.newRefreshToken();
    const hash = tokens.hashRefreshToken(refresh);
    expect(hash).not.toBe(refresh);
    expect(hash).toHaveLength(64);
  });
});
