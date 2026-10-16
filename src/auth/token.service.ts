import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { hashOtp as hmacOtp, otpMatches as otpEquals } from './otp.js';

export type AccessClaims = {
  sub: string;
  sid: string;
};

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  readonly accessTtl: number;
  readonly refreshTtl: number;

  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET')?.trim();
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be set to at least 32 characters');
    }
    this.secret = new TextEncoder().encode(secret);
    this.issuer = config.get<string>('JWT_ISSUER')?.trim() || 'personal-ai-api';
    this.audience = config.get<string>('JWT_AUDIENCE')?.trim() || 'personal-ai';
    this.accessTtl = readTtl(config, 'ACCESS_TOKEN_TTL_SECONDS', 900);
    this.refreshTtl = readTtl(config, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000);
  }

  async signAccess(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ token_use: 'access', sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtl}s`)
      .sign(this.secret);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['HS256'],
    });
    if (
      payload.token_use !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw new Error('Invalid access token');
    }
    return { sub: payload.sub, sid: payload.sid };
  }

  newRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  hashOtp(email: string, code: string): string {
    return hmacOtp(this.secret, email, code);
  }

  otpMatches(email: string, code: string, codeHash: string): boolean {
    return otpEquals(this.secret, email, code, codeHash);
  }

  async signRegistration(email: string): Promise<string> {
    return new SignJWT({ token_use: 'registration', email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(this.secret);
  }

  async verifyRegistration(token: string): Promise<string> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['HS256'],
    });
    if (payload.token_use !== 'registration' || typeof payload.email !== 'string') {
      throw new Error('Invalid registration token');
    }
    return payload.email;
  }
}

function readTtl(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  const value = raw == null || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 60) {
    throw new Error(`${key} must be an integer of at least 60`);
  }
  return value;
}
