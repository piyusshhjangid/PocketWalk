import type { Env } from '../config/env';
import { GemmaPlanner } from './gemmaPlanner';
import { GoogleGemmaClient } from './googleGemmaClient';
import { OllamaGemmaClient } from './ollamaGemmaClient';
import type { WalkPlanner } from './walkPlanner';

/** Default hosted Gemma model id (from Google's Gemma-on-Gemini-API docs). Override with GEMMA_MODEL. */
export const DEFAULT_GOOGLE_GEMMA_MODEL = 'gemma-4-26b-a4b-it';

/** Build the model planner from validated env. Returns null when no provider is configured. */
export function createModelPlanner(env: Env): WalkPlanner | null {
  const common = { maxOutputTokens: env.GEMMA_MAX_OUTPUT_TOKENS, temperature: env.GEMMA_TEMPERATURE };
  switch (env.GEMMA_PROVIDER) {
    case 'google':
      return new GemmaPlanner({
        client: new GoogleGemmaClient({
          ...common,
          apiKey: env.GEMINI_API_KEY as string, // presence enforced in loadEnv
          model: env.GEMMA_MODEL ?? DEFAULT_GOOGLE_GEMMA_MODEL,
        }),
        timeoutMs: env.GEMMA_TIMEOUT_MS,
      });
    case 'ollama':
      return new GemmaPlanner({
        client: new OllamaGemmaClient({
          ...common,
          model: env.GEMMA_MODEL as string, // presence enforced in loadEnv
          baseUrl: env.OLLAMA_BASE_URL,
        }),
        timeoutMs: env.GEMMA_TIMEOUT_MS,
      });
    default:
      return null;
  }
}
