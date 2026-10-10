import type { RequestHandler } from 'express';

/**
 * Headers for a service that now serves HTML and JS from the same origin as the API. The app loads only its own scripts and
 * styles, talks only to its own origin, and needs no camera, microphone or location (PocketWalk asks for none of them).
 * `style-src 'unsafe-inline'` is for React's inline style attributes; scripts stay strictly same-origin.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  next();
};
