import { Injectable } from '@nestjs/common';

const deliveredForTests = new Map<string, string>();

/**
 * OTP delivery boundary. A real provider replaces the body of `send`.
 * Development does not send mail; the code is the fixed development OTP.
 * Tests keep the code in memory so the suite can verify it. Production
 * does not record or log the code.
 */
@Injectable()
export class OtpDeliveryService {
  async send(email: string, code: string): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      deliveredForTests.set(email, code);
    }
  }
}

export function readDeliveredOtpForTests(email: string): string {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('OTP mailbox is only available in tests');
  }
  const code = deliveredForTests.get(email);
  if (!code) {
    throw new Error(`No OTP was delivered for ${email}`);
  }
  return code;
}
