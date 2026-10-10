import type { RequestHandler } from 'express';
import { isIPv6 } from 'node:net';

export interface RateLimiterOptions {
  /** Requests allowed per client per window. 0 disables the limiter. */
  max: number;
  windowMs: number;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
  /** Upper bound on tracked clients, so the table cannot grow without limit. */
  maxClients?: number;
}

/**
 * The key a client is limited under. IPv4-mapped IPv6 is unwrapped, and IPv6 is reduced to its /64 (one household or
 * host usually owns a whole /64, so per-address limiting would be trivially bypassed by rotating the low bits).
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.split('%')[0]!.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const full = [...headParts, ...Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill('0'), ...tailParts];
  return `${full.slice(0, 4).map((h) => h.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Fixed-window, in-memory limiter for the expensive endpoint. It is per process: restarts reset it and several
 * instances do not share it, so on a multi-instance host a provider/edge limit should be the real control.
 * A client right at a window boundary can briefly make up to 2 x max requests; that is accepted for simplicity.
 * When the table is full of live clients, new clients are limited (fail closed) rather than evicting others.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  if (options.max <= 0) return (_req, _res, next) => next();
  const now = options.now ?? Date.now;
  const maxClients = options.maxClients ?? 10_000;
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = (t: number): void => {
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  };

  return (req, res, next) => {
    const t = now();
    const key = clientKey(req.ip);
    let entry = hits.get(key);
    if (entry && entry.resetAt <= t) {
      hits.delete(key);
      entry = undefined;
    }
    if (!entry) {
      if (hits.size >= maxClients) sweep(t);
      if (hits.size >= maxClients) return reject(res, options.windowMs);
      entry = { count: 0, resetAt: t + options.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > options.max) return reject(res, Math.max(0, entry.resetAt - t));
    next();
  };
}

function reject(res: Parameters<RequestHandler>[1], retryAfterMs: number): void {
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  res.status(429).json({ error: 'Too many requests. Please try again in a moment.' });
}
