import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type GroqToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type GroqMessage = {
  role: string;
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
};

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);
  private readonly key: string;
  readonly model: string;
  private modelChecked = false;

  constructor(config: ConfigService) {
    this.key = config.get<string>('GROQ_API_KEY')?.trim() ?? '';
    const model = config.get<string>('GROQ_MODEL')?.trim() || DEFAULT_MODEL;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,40})?$/.test(model)) {
      throw new Error('GROQ_MODEL must be a model id');
    }
    this.model = model;
    if (process.env.NODE_ENV === 'production' && !this.key) {
      throw new Error('GROQ_API_KEY must be set in production');
    }
  }

  async complete(messages: GroqMessage[], tools: unknown[]): Promise<GroqMessage> {
    if (!this.key) {
      throw new ServiceUnavailableException('The assistant is not configured.');
    }
    await this.assertModel();
    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      this.logger.error(
        'Groq request failed',
        error instanceof Error ? error.name : 'error',
      );
      throw new ServiceUnavailableException('The assistant could not reply.');
    }
    if (response.status === 429) {
      throw new HttpException(
        'The assistant is busy. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!response.ok) {
      const detail = await safeError(response, this.key);
      this.logger.error(`Groq status ${response.status}`);
      throw new ServiceUnavailableException(detail);
    }
    const body = (await response.json()) as {
      choices?: { message?: GroqMessage }[];
    };
    const message = body.choices?.[0]?.message;
    if (!message) {
      throw new ServiceUnavailableException('The assistant returned an empty response.');
    }
    return message;
  }

  private async assertModel() {
    if (this.modelChecked) {
      return;
    }
    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ServiceUnavailableException('The assistant model could not be verified.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('The assistant model could not be verified.');
    }
    const body = (await response.json()) as { data?: { id?: string }[] };
    const ids = new Set((body.data ?? []).map((item) => item.id));
    if (!ids.has(this.model)) {
      throw new ServiceUnavailableException('The configured assistant model is not available.');
    }
    this.modelChecked = true;
  }
}

async function safeError(response: Response, key: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    const message = body.error?.message;
    if (typeof message === 'string' && message.length > 0 && !message.includes(key)) {
      return message.slice(0, 200);
    }
  } catch {
    return 'The assistant could not reply.';
  }
  return 'The assistant could not reply.';
}
