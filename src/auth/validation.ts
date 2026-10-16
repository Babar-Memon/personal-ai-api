import { BadRequestException } from '@nestjs/common';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Enter a valid email.');
  }
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== 'string') {
    throw new BadRequestException('Enter a valid email.');
  }
  return normalizeEmail(email);
}

export function parseOtp(body: unknown): { email: string; code: string } {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Enter the 6-digit code.');
  }
  const record = body as Record<string, unknown>;
  if (typeof record.email !== 'string' || typeof record.code !== 'string') {
    throw new BadRequestException('Enter the 6-digit code.');
  }
  const code = record.code.trim();
  if (!/^\d{6}$/.test(code)) {
    throw new BadRequestException('Enter the 6-digit code.');
  }
  return { email: normalizeEmail(record.email), code };
}

export function parseRegistration(body: unknown): {
  registrationToken: string;
  name: string;
} {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Enter your name.');
  }
  const record = body as Record<string, unknown>;
  const registrationToken = record.registrationToken;
  const name = record.name;
  if (typeof registrationToken !== 'string' || registrationToken.length < 20) {
    throw new BadRequestException('Request a new code.');
  }
  if (typeof name !== 'string') {
    throw new BadRequestException('Enter your name.');
  }
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new BadRequestException('Enter a name between 1 and 80 characters.');
  }
  return { registrationToken, name: trimmed };
}

export function parseRefreshToken(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const token = (body as Record<string, unknown>).refreshToken;
  if (token == null) {
    return undefined;
  }
  if (typeof token !== 'string' || token.length < 20 || token.length > 512) {
    throw new BadRequestException('Refresh token is invalid.');
  }
  return token;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!emailPattern.test(normalized) || normalized.length > 254) {
    throw new BadRequestException('Enter a valid email.');
  }
  return normalized;
}
