import { describe, expect, it } from 'vitest';
import { createModelPlanner, DEFAULT_GOOGLE_GEMMA_MODEL } from '../src/ai/createPlanner';
import { loadEnv } from '../src/config/env';

describe('loadEnv (Gemma settings)', () => {
  it('defaults to no model, with safe defaults', () => {
    const env = loadEnv({});
    expect(env.GEMMA_PROVIDER).toBe('none');
    expect(env.GEMMA_TIMEOUT_MS).toBe(15000);
    expect(createModelPlanner(env)).toBeNull();
  });

  it('treats blank values from an untouched .env as unset', () => {
    const env = loadEnv({ GEMMA_PROVIDER: '', GEMINI_API_KEY: '', GEMMA_MODEL: '', GEMMA_TIMEOUT_MS: '' });
    expect(env.GEMMA_PROVIDER).toBe('none');
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('fails fast when google is selected without a key, and does not print values', () => {
    expect(() => loadEnv({ GEMMA_PROVIDER: 'google' })).toThrow(/GEMINI_API_KEY/);
    try {
      loadEnv({ GEMMA_PROVIDER: 'google', GEMMA_TIMEOUT_MS: 'SUPERSECRETVALUE' });
    } catch (e) {
      expect(String(e)).not.toContain('SUPERSECRETVALUE');
    }
  });

  it('fails fast when ollama is selected without a model tag', () => {
    expect(() => loadEnv({ GEMMA_PROVIDER: 'ollama' })).toThrow(/GEMMA_MODEL/);
  });

  it('rejects unknown providers and out-of-range timeouts', () => {
    expect(() => loadEnv({ GEMMA_PROVIDER: 'openai' })).toThrow();
    expect(() => loadEnv({ GEMMA_TIMEOUT_MS: '5' })).toThrow();
  });

  it('builds a google planner with the default hosted Gemma model', () => {
    const planner = createModelPlanner(loadEnv({ GEMMA_PROVIDER: 'google', GEMINI_API_KEY: 'k' }));
    expect(planner?.kind).toBe('model');
    expect(planner?.provider).toBe('google');
    expect(planner?.model).toBe(DEFAULT_GOOGLE_GEMMA_MODEL);
  });

  it('builds an ollama planner with the operator-supplied model tag', () => {
    const planner = createModelPlanner(loadEnv({ GEMMA_PROVIDER: 'ollama', GEMMA_MODEL: 'my-gemma' }));
    expect(planner?.provider).toBe('ollama');
    expect(planner?.model).toBe('my-gemma');
  });
});
