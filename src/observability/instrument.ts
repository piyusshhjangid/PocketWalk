/**
 * Sentry initialisation. This file MUST be the first import in server.ts so the SDK can
 * instrument Express and Node's http module before they are loaded.
 * It is intentionally NOT imported by app.ts, so tests never talk to Sentry.
 */
import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { loadEnv } from '../config/env';
import { sentryPrivacyOptions } from './sentryConfig';

const env = loadEnv();
const dsn = env.SENTRY_DSN?.trim();

Sentry.init({
  // An empty DSN disables sending. The app still runs normally.
  dsn: dsn ? dsn : undefined,
  environment: env.NODE_ENV,
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  // Privacy settings live in sentryConfig.ts so the privacy test exercises the exact same options.
  ...sentryPrivacyOptions(),
});

if (!dsn) {
  console.warn('[pocketwalk] SENTRY_DSN is not set. Sentry is disabled.');
}

// Sampling is explicit, not silent. Unset means 1 in development and 0.1 in production (see config/env.ts).
// Only the number is printed: the DSN is a credential-like value and never reaches the logs.
console.log(`[pocketwalk] traces sample rate: ${env.SENTRY_TRACES_SAMPLE_RATE}`);
if (env.NODE_ENV === 'production' && env.SENTRY_TRACES_SAMPLE_RATE === 1) {
  console.warn('[pocketwalk] SENTRY_TRACES_SAMPLE_RATE=1 in production traces every request (set explicitly).');
}
