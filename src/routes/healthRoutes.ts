import { Router } from 'express';
import { Readiness } from '../lifecycle/readiness';

/**
 * /health  liveness: the process is up and serving. Always 200 while it runs, including while draining; it never
 *          touches Google, Open-Meteo or Sentry, so a provider outage cannot make a platform restart a healthy process.
 * /ready   readiness: 200 once listening, 503 while starting or shutting down, so traffic is routed away from a draining instance.
 *          It makes no outbound calls. Response bodies hold fixed words only (no config, no env, no versions).
 */
export function createHealthRouter(readiness: Readiness = ((r) => (r.markReady(), r))(new Readiness())): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'pocketwalk', uptimeSeconds: Math.round(process.uptime()) });
  });
  router.get('/ready', (_req, res) => {
    const state = readiness.state;
    if (state === 'ready') {
      res.json({ status: 'ready', service: 'pocketwalk' });
      return;
    }
    res.status(503).json({ status: 'unavailable', service: 'pocketwalk', reason: state });
  });
  return router;
}
