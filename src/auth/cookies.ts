import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

export const ACCESS_COOKIE = 'pai_access';
export const REFRESH_COOKIE = 'pai_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function wantsBearer(request: Request): boolean {
  return request.header('x-token-delivery') === 'bearer';
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}

export function bearerToken(request: Request): string | undefined {
  const header = request.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  const token = header.slice('Bearer '.length).trim();
  return token || undefined;
}

function baseOptions(config: ConfigService) {
  return {
    httpOnly: true,
    secure: config.get<string>('NODE_ENV') === 'production',
    sameSite: 'lax' as const,
  };
}

export function writeSessionCookies(
  response: Response,
  config: ConfigService,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresIn: number;
    refreshTokenExpiresIn: number;
  },
) {
  const base = baseOptions(config);
  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: tokens.accessTokenExpiresIn * 1000,
    path: '/',
  });
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: tokens.refreshTokenExpiresIn * 1000,
    path: REFRESH_COOKIE_PATH,
  });
}

export function clearSessionCookies(response: Response, config: ConfigService) {
  const base = baseOptions(config);
  response.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  response.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
}
