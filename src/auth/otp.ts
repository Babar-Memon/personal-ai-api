import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const DEV_OTP = '123456';

/** Fixed OTP is accepted only when the API process is explicitly development. */
export function createOtpCode(env: string | undefined = process.env.NODE_ENV): string {
  if (env === 'development') {
    return DEV_OTP;
  }
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtp(secret: Uint8Array, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

export function otpMatches(
  secret: Uint8Array,
  email: string,
  code: string,
  codeHash: string,
): boolean {
  const next = Buffer.from(hashOtp(secret, email, code), 'hex');
  const stored = Buffer.from(codeHash, 'hex');
  if (next.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(next, stored);
}
