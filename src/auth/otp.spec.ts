import { describe, expect, it } from 'vitest';
import { createOtpCode, DEV_OTP, hashOtp, otpMatches } from './otp.js';

const secret = new TextEncoder().encode('test-only-jwt-secret-with-32-characters');

describe('createOtpCode', () => {
  it('uses the fixed code only in development', () => {
    expect(createOtpCode('development')).toBe(DEV_OTP);

    for (const env of ['production', 'test', undefined]) {
      const codes = new Set(Array.from({ length: 20 }, () => createOtpCode(env)));
      expect(codes.size).toBeGreaterThan(1);
      expect(codes.has(DEV_OTP) && codes.size === 1).toBe(false);
    }
  });

  it('does not accept the development code against another hash', () => {
    const hash = hashOtp(secret, 'person@example.com', '654321');
    expect(otpMatches(secret, 'person@example.com', DEV_OTP, hash)).toBe(false);
    expect(otpMatches(secret, 'person@example.com', '654321', hash)).toBe(true);
  });
});
