import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import morgan from 'morgan';
import { FallbackPlanner } from './ai/fallbackPlanner';
import { ContextBuilder } from './context/contextBuilder';
import type { WalkPlanner } from './ai/walkPlanner';
import { Readiness } from './lifecycle/readiness';
import type { Budgets } from './services/requestScope';
import { ConcurrencyGate } from './middleware/concurrencyGate';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRateLimiter, type RateLimiterOptions } from './middleware/rateLimiter';
import { securityHeaders } from './middleware/securityHeaders';
import { createHealthRouter } from './routes/healthRoutes';
import { createWalkRouter } from './routes/walkRoutes';
import { WalkService } from './services/walkService';
import type { SafetyEngine } from './safety/engine';

export interface AppOptions {
  /** Model planner. Omit or pass null for "no model configured": every walk uses the fallback. */
  planner?: WalkPlanner | null;
  /** Deterministic fallback planner. Defaults to FallbackPlanner. */
  fallbackPlanner?: WalkPlanner;
  /** Builds the outdoor context (weather, daylight). Omit for "no weather provider": location requests report weather as unavailable. */
  contextBuilder?: ContextBuilder;
  /** Deterministic safety layer. Defaults to the standard rule set. */
  safetyEngine?: SafetyEngine;
  nodeEnv?: string;
  /** Silence HTTP logging (used by tests). */
  quiet?: boolean;
  /** Per-client limit on POST /walks/plan. Omit for none (tests); buildAppFromEnv always sets it. */
  rateLimit?: RateLimiterOptions;
  /** Simultaneous walk plans; excess requests get 503. Default 8. */
  maxConcurrentPlans?: number;
  /** Whole-request server deadline in ms. Default 25000 (must stay under the browser's 30 s wait). */
  requestDeadlineMs?: number;
  /** Time kept back for the response, and the least time worth giving the model. Defaults suit production; tests shrink them. */
  budgets?: Budgets;
  /** Reverse proxies whose X-Forwarded-For is trusted (0 = none). Default 0. */
  trustProxy?: number;
  /** Directory of the built frontend (contains index.html). When set, it is served from this same origin. */
  frontendDir?: string;
  /** Readiness state shared with the server lifecycle. Default: ready. */
  readiness?: Readiness;
}

export const DEFAULT_REQUEST_DEADLINE_MS = 25_000;
export const DEFAULT_MAX_CONCURRENT_PLANS = 8;

export function createApp(options: AppOptions = {}): Express {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const app = express();
  app.disable('x-powered-by');
  // Number of trusted proxy hops, never `true`: trusting every hop lets a client spoof its address and dodge the rate limit.
  app.set('trust proxy', options.trustProxy ?? 0);
  if (options.frontendDir && !fs.existsSync(path.join(options.frontendDir, 'index.html'))) {
    throw new Error('Frontend build not found (index.html missing). Run "npm run build:all", or set SERVE_FRONTEND=false.');
  }
  if (!options.quiet) {
    // Path only: the API has no query parameters, so anything after "?" is client-supplied noise that must not be retained
    // in logs (it could hold a token). No referrer or user-agent either: PocketWalk does not need them.
    morgan.token('path', (req) => (req as { originalUrl?: string }).originalUrl?.split('?')[0] ?? '-');
    app.use(morgan(nodeEnv === 'production'
      ? ':remote-addr [:date[clf]] ":method :path HTTP/:http-version" :status :res[content-length] :response-time ms'
      : ':method :path :status :response-time ms - :res[content-length]'));
  }
  app.use(securityHeaders);
  const readiness = options.readiness ?? ((r) => (r.markReady(), r))(new Readiness());
  // While draining, ask clients to close their keep-alive connections so shutdown is not held open by idle sockets.
  app.use((_req, res, next) => {
    if (readiness.state === 'shutting_down') res.setHeader('Connection', 'close');
    next();
  });
  // Before body parsing: every POST to the expensive route counts, including malformed ones. /health and /ready are never limited.
  if (options.rateLimit) app.post('/walks/plan', createRateLimiter(options.rateLimit));
  app.use(express.json({ limit: '10kb' }));

  app.use(createHealthRouter(readiness));
  app.use(createWalkRouter(new WalkService(
      options.planner ?? null,
      options.fallbackPlanner ?? new FallbackPlanner(),
      options.contextBuilder ?? new ContextBuilder(),
      options.safetyEngine,
      options.budgets,
    ), {
    gate: new ConcurrencyGate(options.maxConcurrentPlans ?? DEFAULT_MAX_CONCURRENT_PLANS),
    deadlineMs: options.requestDeadlineMs ?? DEFAULT_REQUEST_DEADLINE_MS,
  }));

  // Development-only route to prove errors reach Sentry. Not registered in production.
  if (nodeEnv !== 'production') {
    app.get('/debug-sentry', () => {
      throw new Error('PocketWalk test error (/debug-sentry)');
    });
  }

  // Same-origin frontend. The app has no client-side routes, so there is no catch-all: only real files are served, and any
  // other path (including every API path that does not exist) stays a JSON 404 rather than an HTML page.
  if (options.frontendDir) {
    app.use(express.static(options.frontendDir, {
      index: 'index.html',
      dotfiles: 'ignore',
      setHeaders: (res, file) => {
        // Hashed build assets never change; the HTML shell must always be re-checked so a new deploy is picked up.
        res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
