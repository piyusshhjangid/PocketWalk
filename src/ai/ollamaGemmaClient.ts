import { PlannerError } from './errors';
import {
  classifyFetchError,
  classifyHttpStatus,
  readJsonBody,
  type ModelClient,
  type ModelResponse,
} from './modelClient';

export interface OllamaGemmaOptions {
  model: string;
  maxOutputTokens: number;
  temperature: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface OllamaBody {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Gemma running locally through Ollama. This is the "real" open-weight path: the weights run on
 * your own machine. The model tag is supplied by the operator (GEMMA_MODEL); none is assumed.
 */
export class OllamaGemmaClient implements ModelClient {
  readonly provider = 'ollama';
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaGemmaOptions) {
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens;
    this.temperature = options.temperature;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(prompt: string, { signal }: { signal: AbortSignal }): Promise<ModelResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          format: 'json',
          options: { temperature: this.temperature, num_predict: this.maxOutputTokens },
        }),
        signal,
      });
    } catch (err) {
      throw classifyFetchError(err, signal);
    }
    if (!res.ok) throw classifyHttpStatus(res.status);

    const body = (await readJsonBody(res)) as OllamaBody | null;
    const text = body?.message?.content?.trim();
    if (!text) throw new PlannerError('empty_response', 'Model returned no text');
    return { text, usage: { inputTokens: body?.prompt_eval_count, outputTokens: body?.eval_count } };
  }
}
