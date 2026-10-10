import path from 'node:path';
import type { Express } from 'express';
import { createApp } from './app';
import { createModelPlanner } from './ai/createPlanner';
import type { WalkPlanner } from './ai/walkPlanner';
import type { Env } from './config/env';
import { ContextBuilder } from './context/contextBuilder';
import { createWeatherProvider } from './context/createWeatherProvider';
import type { WeatherProvider } from './context/weatherProvider';
import { Readiness } from './lifecycle/readiness';
import { RESPONSE_RESERVE_MS } from './services/requestScope';

export interface AppRuntime {
  app: Express;
  readiness: Readiness;
  planner: WalkPlanner | null;
  weather: WeatherProvider | null;
  /** Human-readable notes for the startup log. Never contain secrets or values of secrets. */
  notes: { level: 'info' | 'warn'; text: string }[];
}

/** Default location of the built frontend, relative to src/ (tsx) and dist/ (compiled): both sit one level below the project root. */
const DEFAULT_FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');

/**
 * The one place validated environment settings become a running app: providers, limits, deadline, proxy trust,
 * frontend serving. server.ts and the tests both go through here, so what is tested is what runs.
 */
export function buildAppFromEnv(env: Env): AppRuntime {
  const notes: AppRuntime['notes'] = [];
  const planner = createModelPlanner(env);
  const weather = createWeatherProvider(env);
  const readiness = new Readiness();

  if (planner) notes.push({ level: 'info', text: `model planner: ${planner.provider ?? "?"} / ${planner.model ?? "?"} (timeout ${env.GEMMA_TIMEOUT_MS} ms)` });
  else notes.push({ level: 'warn', text: 'GEMMA_PROVIDER is none. No model is used: every walk is the deterministic fallback.' });
  if (weather) notes.push({ level: 'info', text: `weather provider: ${weather.name} (timeout ${env.WEATHER_TIMEOUT_MS} ms)` });
  else notes.push({ level: 'warn', text: 'WEATHER_PROVIDER is none. Requests with a location will report weather as unavailable.' });

  const needed = env.GEMMA_TIMEOUT_MS + env.WEATHER_TIMEOUT_MS + RESPONSE_RESERVE_MS;
  if (planner && needed > env.REQUEST_DEADLINE_MS) {
    notes.push({
      level: 'warn',
      text: `GEMMA_TIMEOUT_MS + WEATHER_TIMEOUT_MS + ${RESPONSE_RESERVE_MS} ms reserve = ${needed} ms exceeds REQUEST_DEADLINE_MS (${env.REQUEST_DEADLINE_MS} ms): the model budget will be shortened per request to fit.`,
    });
  }
  notes.push({
    level: 'info',
    text: `limits: ${env.RATE_LIMIT_MAX > 0 ? `${env.RATE_LIMIT_MAX} plans per ${env.RATE_LIMIT_WINDOW_MS} ms per client` : 'rate limit DISABLED'}, ${env.MAX_CONCURRENT_PLANS} concurrent, deadline ${env.REQUEST_DEADLINE_MS} ms, trust proxy hops ${env.TRUST_PROXY}`,
  });
  if (env.NODE_ENV === 'production') {
    if (env.RATE_LIMIT_MAX === 0) notes.push({ level: 'warn', text: 'RATE_LIMIT_MAX=0 in production: only the concurrency cap protects the model.' });
    if (!planner) notes.push({ level: 'warn', text: 'Running in production without a model: PocketWalk will only ever serve deterministic walks.' });
  }

  const frontendDir = env.SERVE_FRONTEND ? env.FRONTEND_DIST_DIR ?? DEFAULT_FRONTEND_DIR : undefined;
  notes.push({ level: 'info', text: frontendDir ? 'serving the built frontend from this process (same origin)' : 'not serving the frontend (use the Vite dev server or a static host)' });

  const app = createApp({
    nodeEnv: env.NODE_ENV,
    planner,
    contextBuilder: new ContextBuilder({ weather, weatherTimeoutMs: env.WEATHER_TIMEOUT_MS }),
    rateLimit: { max: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
    maxConcurrentPlans: env.MAX_CONCURRENT_PLANS,
    requestDeadlineMs: env.REQUEST_DEADLINE_MS,
    trustProxy: env.TRUST_PROXY,
    ...(frontendDir ? { frontendDir } : {}),
    readiness,
  });
  return { app, readiness, planner, weather, notes };
}
