import { z } from 'zod';

/** Treat an empty string (e.g. `GEMINI_API_KEY=` in .env) as "not set". */
const blankAsUndefined = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    SENTRY_DSN: z.string().optional(),
    // Unset: 1 (trace everything) in development, 0.1 in production. Set it explicitly to override either.
    SENTRY_TRACES_SAMPLE_RATE: z.preprocess(blankAsUndefined, z.coerce.number().min(0).max(1).optional()),

    // --- Deployment (Checkpoint 9) ---
    // Interface to bind. Unset: all interfaces in production (what a container host expects); Node's default otherwise.
    HOST: z.preprocess(blankAsUndefined, z.string().trim().min(1).optional()),
    // Serve the built frontend (frontend/dist) from this process. Unset: true in production, false in development (Vite serves it).
    SERVE_FRONTEND: z.preprocess(blankAsUndefined, z.enum(['true', 'false']).optional()),
    FRONTEND_DIST_DIR: z.preprocess(blankAsUndefined, z.string().trim().min(1).optional()),
    // Reverse proxies in front of this process whose X-Forwarded-For is trusted: 0 = none (use the socket address),
    // N = trust exactly N hops. REQUIRED in production: a wrong value either makes every user share one rate-limit
    // bucket (too low) or lets clients spoof their address (too high).
    TRUST_PROXY: z.preprocess(blankAsUndefined, z.coerce.number().int().min(0).max(10).optional()),
    // Whole-request server deadline. Must fit inside the browser's 30 s wait (VITE_REQUEST_TIMEOUT_MS), so 28 s is the ceiling; below 5 s no model call could fit after the 1.5 s response reserve.
    REQUEST_DEADLINE_MS: z.preprocess(blankAsUndefined, z.coerce.number().int().min(5_000).max(28_000).default(25_000)),
    // POST /walks/plan per client address per window. 0 disables the limiter (not recommended in production).
    RATE_LIMIT_MAX: z.preprocess(blankAsUndefined, z.coerce.number().int().min(0).max(10_000).default(20)),
    RATE_LIMIT_WINDOW_MS: z.preprocess(blankAsUndefined, z.coerce.number().int().min(1_000).max(3_600_000).default(60_000)),
    // Simultaneous walk plans in this process. Excess requests get 503 instead of queueing.
    MAX_CONCURRENT_PLANS: z.preprocess(blankAsUndefined, z.coerce.number().int().min(1).max(100).default(8)),
    // On SIGTERM/SIGINT: how long in-flight requests may finish before connections are closed.
    SHUTDOWN_GRACE_MS: z.preprocess(blankAsUndefined, z.coerce.number().int().min(1_000).max(60_000).default(8_000)),

    // --- Gemma (Checkpoint 2) ---
    // none = no model; every walk is served by the labelled deterministic fallback.
    GEMMA_PROVIDER: z.preprocess(blankAsUndefined, z.enum(['none', 'google', 'ollama']).default('none')),
    GEMINI_API_KEY: z.preprocess(blankAsUndefined, z.string().trim().optional()),
    GEMMA_MODEL: z.preprocess(blankAsUndefined, z.string().trim().optional()),
    OLLAMA_BASE_URL: z.preprocess(blankAsUndefined, z.url().default('http://localhost:11434')),
    GEMMA_TIMEOUT_MS: z.preprocess(blankAsUndefined, z.coerce.number().int().min(500).max(120_000).default(15_000)),
    GEMMA_MAX_OUTPUT_TOKENS: z.preprocess(blankAsUndefined, z.coerce.number().int().min(64).max(8192).default(1024)),
    GEMMA_TEMPERATURE: z.preprocess(blankAsUndefined, z.coerce.number().min(0).max(2).default(0.7)),

    // --- Weather context (Checkpoint 3). No API key: Open-Meteo needs none. ---
    // none = location requests report weather as unavailable. open-meteo = free tier, non-commercial use.
    WEATHER_PROVIDER: z.preprocess(blankAsUndefined, z.enum(['none', 'open-meteo']).default('open-meteo')),
    WEATHER_TIMEOUT_MS: z.preprocess(blankAsUndefined, z.coerce.number().int().min(200).max(15_000).default(3_000)),
  })
  .superRefine((v, ctx) => {
    if (v.GEMMA_PROVIDER === 'google' && !v.GEMINI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['GEMINI_API_KEY'], message: 'required when GEMMA_PROVIDER=google' });
    }
    if (v.GEMMA_PROVIDER === 'ollama' && !v.GEMMA_MODEL) {
      ctx.addIssue({ code: 'custom', path: ['GEMMA_MODEL'], message: 'required when GEMMA_PROVIDER=ollama' });
    }
    if (v.NODE_ENV === 'production' && v.TRUST_PROXY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'required in production: the number of reverse proxies in front of this process (0 if clients connect directly)',
      });
    }
  })
  .transform((v) => ({
    ...v,
    SENTRY_TRACES_SAMPLE_RATE: v.SENTRY_TRACES_SAMPLE_RATE ?? (v.NODE_ENV === 'production' ? 0.1 : 1),
    TRUST_PROXY: v.TRUST_PROXY ?? 0,
    SERVE_FRONTEND: (v.SERVE_FRONTEND ?? (v.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
    HOST: v.HOST ?? (v.NODE_ENV === 'production' ? '0.0.0.0' : undefined),
  }));

export type Env = z.infer<typeof schema>;

/** Parse and validate environment variables once, failing fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Paths and messages only. Values (which may be keys) are never printed.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return parsed.data;
}
