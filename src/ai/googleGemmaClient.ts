import { PlannerError } from './errors';
import {
  classifyFetchError,
  classifyHttpStatus,
  readJsonBody,
  type ModelClient,
  type ModelResponse,
} from './modelClient';

export interface GoogleGemmaOptions {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  temperature: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}
interface GeminiBody {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Gemma (open weights) hosted by Google on the Gemini API (generateContent).
 * The key goes in a header, never in the URL, so it cannot leak into access logs.
 * Instructions are sent in the user turn: no reliance on system-instruction or JSON-mode support.
 */
export class GoogleGemmaClient implements ModelClient {
  readonly provider = 'google';
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleGemmaOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens;
    this.temperature = options.temperature;
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(prompt: string, { signal }: { signal: AbortSignal }): Promise<ModelResponse> {
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: this.temperature, maxOutputTokens: this.maxOutputTokens },
        }),
        signal,
      });
    } catch (err) {
      throw classifyFetchError(err, signal);
    }
    if (!res.ok) throw classifyHttpStatus(res.status);

    const body = (await readJsonBody(res)) as GeminiBody | null;
    if (body?.promptFeedback?.blockReason) {
      throw new PlannerError('empty_response', 'Model provider blocked the prompt');
    }
    // Skip "thinking" parts if the model returns them; only the final answer is used.
    const parts = body?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('')
      .trim();
    if (!text) throw new PlannerError('empty_response', 'Model returned no text');

    return {
      text,
      usage: {
        inputTokens: body?.usageMetadata?.promptTokenCount,
        outputTokens: body?.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
