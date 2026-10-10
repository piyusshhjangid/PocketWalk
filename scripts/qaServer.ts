/**
 * Browser-QA harness for the frontend. It runs the REAL CP4 app (routes, controller, WalkService,
 * context builder, validation pipeline, safety engine, fallback planner) with two scripted stand-ins:
 * the model and the weather service. A tiny control endpoint switches behaviour while it runs:
 *
 *   GET /__qa/set?model=ok|slow|down|unsafe|hang&weather=clear|rain|sunset|dark|down&mode=normal|malformed|crash
 *
 * `mode=malformed` answers /walks/plan with 200 + garbage, and `mode=crash` makes the fallback planner
 * throw (a real HTTP 500). These simulate a misbehaving server; they are NOT live Gemma or Open-Meteo.
 *
 *   npx tsx scripts/qaServer.ts   (PORT, default 3000)
 */
import express from 'express';
import { createApp } from '../src/app';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import type { ModelClient } from '../src/ai/modelClient';
import { PlannerError } from '../src/ai/errors';
import type { WalkPlanner } from '../src/ai/walkPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import type { WeatherObservation } from '../src/context/types';
import { WeatherError } from '../src/context/weatherProvider';

const qa = { model: 'ok', weather: 'rain', mode: 'normal' };

function goodPlan(minutes: number): string {
  const a = Math.round(minutes * 0.4);
  return JSON.stringify({
    title: 'Slow loop, listening walk',
    steps: [
      { minutes: a, text: 'Walk out slowly along the nearest footpath.' },
      { minutes: minutes - 2 * a, text: 'Stop and listen for distant birds.' },
      { minutes: a, text: 'Return the way you came, unhurried.' },
    ],
    notice: 'Notice how many shades of green you can find.',
  });
}

const client: ModelClient = {
  provider: 'qa-stub', model: 'qa-gemma', maxOutputTokens: 256, temperature: 0,
  async generate(prompt, { signal }) {
    const minutes = Number(/"minutes":\s*(\d+)/.exec(prompt)?.[1] ?? 20);
    if (qa.model === 'down') throw new PlannerError('unavailable', 'scripted');
    if (qa.model === 'slow') await new Promise((r) => setTimeout(r, 6000));
    if (qa.model === 'hang') await new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new PlannerError('timeout', 'aborted'))));
    if (qa.model === 'unsafe') {
      return { text: JSON.stringify({ title: 'Wall climb', steps: [{ minutes: Math.round(minutes * 0.4), text: 'Climb the wall by the park.' }, { minutes: minutes - 2 * Math.round(minutes * 0.4), text: 'Pause.' }, { minutes: Math.round(minutes * 0.4), text: 'Walk back.' }], notice: 'Notice the view.' }) };
    }
    return { text: goodPlan(minutes), usage: { inputTokens: 100, outputTokens: 50 } };
  },
};

const weatherByScenario = (): { obs?: WeatherObservation; now: string } => {
  const base = { timezone: 'UTC', feelsLikeC: 17, windKmh: 8, sunriseLocal: '2026-10-07T06:00', sunsetLocal: '2026-10-07T18:00' };
  switch (qa.weather) {
    case 'clear': return { now: '12:00', obs: { ...base, temperatureC: 24, condition: 'clear', precipitation: 'none' } };
    case 'sunset': return { now: '17:40', obs: { ...base, temperatureC: 19, condition: 'cloudy', precipitation: 'none' } };
    case 'dark': return { now: '21:00', obs: { ...base, temperatureC: 14, condition: 'clear', precipitation: 'none' } };
    case 'down': return { now: '12:00' };
    default: return { now: '16:30', obs: { ...base, temperatureC: 18.2, condition: 'rain', precipitation: 'light' } };
  }
};

let nowStr = '16:30';
const contextBuilder = new ContextBuilder({
  weather: {
    name: 'qa-weather',
    async lookup() {
      const s = weatherByScenario();
      nowStr = s.now;
      if (!s.obs) throw new WeatherError('unavailable', 'scripted');
      return s.obs;
    },
  },
  now: () => new Date(`2026-10-07T${nowStr}:00Z`),
});

const crashing: WalkPlanner = { kind: 'fallback', async plan() { throw new Error('qa crash'); } };
const real = new FallbackPlanner();
const fallbackSwitch: WalkPlanner = { kind: 'fallback', plan: (c) => (qa.mode === 'crash' ? crashing.plan(c) : real.plan(c)) };

// QA_FRONTEND_DIR=frontend/dist serves the built frontend from this same origin, like production (used by the CP9 browser runs).
const inner = createApp({ nodeEnv: 'development', planner: new GemmaPlanner({ client, timeoutMs: 20000 }), fallbackPlanner: fallbackSwitch, contextBuilder, ...(process.env.QA_FRONTEND_DIR ? { frontendDir: process.env.QA_FRONTEND_DIR } : {}) });

const outer = express();
outer.get('/__qa/set', (req, res) => {
  for (const k of ['model', 'weather', 'mode'] as const) if (typeof req.query[k] === 'string') qa[k] = req.query[k] as string;
  res.json(qa);
});
outer.post('/walks/plan', (req, res, next) => {
  if (qa.mode !== 'malformed') return next();
  res.status(200).json({ unexpected: 'shape', plan: 'not an object' });
});
outer.use(inner);

const port = Number(process.env.PORT ?? 3000);
outer.listen(port, () => console.log(`[qa-server] real CP4 app with scripted model + weather on http://localhost:${port}`));
