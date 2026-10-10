import type { ErrorRequestHandler, RequestHandler } from 'express';
import { captureUnexpected, describeUnexpected } from '../observability/tracing';
import { HttpError } from '../utils/httpError';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

/**
 * Final error handler. Clients always get `{ error: <fixed text> }`; stack traces and exception text never leave the server.
 *  - HttpError: an expected, client-safe message (400 and friends).
 *  - 4xx from body-parser (malformed JSON, too large, wrong charset): "Bad request", original status kept.
 *  - anything else: a bug. Reported to Sentry WITHOUT its message (class + stage + stack frames only) and logged by class name only.
 * This is the only place unexpected Express errors are reported; Sentry's own Express error handler is
 * deliberately not installed because it would send the raw exception.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error(`[pocketwalk] unhandled error (${describeUnexpected(err)}); see Sentry for the stack`);
    captureUnexpected(err, 'http');
  }
  res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Bad request' });
};
