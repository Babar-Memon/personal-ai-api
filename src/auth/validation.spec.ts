import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseEmail, parseOtp, parseRefreshToken, parseRegistration } from './validation.js';

describe('parseEmail', () => {
  it('trims and lowercases the address', () => {
    expect(parseEmail({ email: '  Person@Example.com ' })).toBe('person@example.com');
  });

  it('rejects a malformed email', () => {
    expect(() => parseEmail({ email: 'not-an-email' })).toThrow(BadRequestException);
  });
});

describe('parseOtp', () => {
  it('accepts a six-digit code', () => {
    expect(parseOtp({ email: 'person@example.com', code: '123456' })).toEqual({
      email: 'person@example.com',
      code: '123456',
    });
  });

  it('rejects anything that is not six digits', () => {
    expect(() => parseOtp({ email: 'person@example.com', code: '12345' })).toThrow(
      BadRequestException,
    );
  });
});

describe('parseRegistration', () => {
  it('trims the name', () => {
    expect(
      parseRegistration({
        registrationToken: 'registration-token-value-long',
        name: '  Ada   Lovelace  ',
      }),
    ).toEqual({
      registrationToken: 'registration-token-value-long',
      name: 'Ada Lovelace',
    });
  });
});

describe('parseRefreshToken', () => {
  it('returns undefined when the body has no token', () => {
    expect(parseRefreshToken({})).toBeUndefined();
    expect(parseRefreshToken(undefined)).toBeUndefined();
  });
});
