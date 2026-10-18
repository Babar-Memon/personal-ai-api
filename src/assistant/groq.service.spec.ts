import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroqService } from './groq.service.js';

const key = 'test-groq-key-not-real';

function service() {
  return new GroqService({
    get: (name: string) =>
      ({
        GROQ_API_KEY: key,
        GROQ_MODEL: 'llama-3.3-70b-versatile',
      })[name],
  } as ConfigService);
}

describe('GroqService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed when the key is missing', async () => {
    const groq = new GroqService({
      get: () => '',
    } as unknown as ConfigService);
    await expect(groq.complete([], [])).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects a model that Groq does not list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: 'other-model' }] }),
      })),
    );
    await expect(service().complete([], [])).rejects.toThrow(
      'The configured assistant model is not available.',
    );
  });

  it('returns the model message and does not leak the key', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Hello' } }] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const groq = service();
    await expect(groq.complete([{ role: 'user', content: 'Hi' }], [])).resolves.toMatchObject({
      content: 'Hello',
    });
    const calls = JSON.stringify(fetchMock.mock.calls);
    expect(calls).toContain(key);
    expect(calls).not.toContain('GROQ_API_KEY');
  });

  it('accepts a provider model id and rejects a spaced id', () => {
    expect(
      () =>
        new GroqService({
          get: (name: string) => (name === 'GROQ_MODEL' ? 'openai/gpt-oss-120b' : ''),
        } as ConfigService),
    ).not.toThrow();
    expect(
      () =>
        new GroqService({
          get: (name: string) => (name === 'GROQ_MODEL' ? 'bad model' : ''),
        } as ConfigService),
    ).toThrow('GROQ_MODEL must be a model id');
  });

  it('surfaces a provider failure without the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }) };
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { message: `bad ${key}` } }),
        };
      }),
    );
    await expect(service().complete([], [])).rejects.toThrow('The assistant could not reply.');
  });
});
