/**
 * Captures REAL responses from the CP4 backend (real Express app, real validation + safety pipeline,
 * real JSON over the supertest HTTP layer) and writes them to frontend/tests/fixtures/.
 * Only the model and the weather service are scripted stand-ins, so the SHAPE of every fixture is
 * the shape the backend actually produces. The frontend contract tests parse these files.
 *
 *   npm run fixtures:frontend
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import type { ModelClient } from '../src/ai/modelClient';
import { PlannerError } from '../src/ai/errors';
import { ContextBuilder } from '../src/context/contextBuilder';
import type { WalkPlanner } from '../src/ai/walkPlanner';
import type { WeatherObservation } from '../src/context/types';

const outDir = join(__dirname, '..', 'frontend', 'tests', 'fixtures');
mkdirSync(outDir, { recursive: true });

const obs = (over: Partial<WeatherObservation> = {}): WeatherObservation => ({
  timezone: 'UTC', temperatureC: 18.2, feelsLikeC: 17, windKmh: 8, condition: 'rain', precipitation: 'light',
  sunriseLocal: '2026-10-07T06:00', sunsetLocal: '2026-10-07T18:00', ...over,
});
const clock = (hhmm: string) => () => new Date(`2026-10-07T${hhmm}:00Z`);

function model(reply: string | 'down'): WalkPlanner {
  const client: ModelClient = {
    provider: 'google', model: 'gemma-4-26b-a4b-it', maxOutputTokens: 256, temperature: 0,
    async generate() {
      if (reply === 'down') throw new PlannerError('timeout', 'scripted');
      return { text: reply, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
  return new GemmaPlanner({ client, timeoutMs: 2000 });
}
const goodPlan = (minutes: number) => {
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
};
const weather = (o: WeatherObservation) => ({ name: 'scripted-weather', async lookup() { return o; } });
const builder = (o: WeatherObservation, now: string) => new ContextBuilder({ weather: weather(o), now: clock(now) });

async function save(name: string, status: number, body: unknown): Promise<void> {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ status, body }, null, 2) + '\n');
  console.log(`captured ${name} (HTTP ${status})`);
}

async function main(): Promise<void> {
  const post = (app: ReturnType<typeof createApp>, body: unknown) => request(app).post('/walks/plan').send(body as object);

  let res = await post(createApp({ quiet: true, nodeEnv: 'test', planner: model(goodPlan(20)), contextBuilder: builder(obs(), '16:50') }), { minutes: 20, energy: 'easy', location: { city: 'Jalandhar' } });
  await save('model-plan-weather', res.status, res.body);

  res = await post(createApp({ quiet: true, nodeEnv: 'test', planner: model(goodPlan(10)) }), { minutes: 10, energy: 'normal' });
  await save('model-plan-no-location', res.status, res.body);

  res = await post(createApp({ quiet: true, nodeEnv: 'test', planner: null }), { minutes: 20, energy: 'easy' });
  await save('fallback-not-configured', res.status, res.body);

  res = await post(createApp({ quiet: true, nodeEnv: 'test', planner: model('down'), contextBuilder: builder(obs({ condition: 'clear', precipitation: 'none', temperatureC: 24 }), '12:00') }), { minutes: 40, energy: 'normal', location: { city: 'Jalandhar' } });
  await save('fallback-model-unavailable', res.status, res.body);

  const unsafe = JSON.stringify({ title: 'Wall climb', steps: [{ minutes: 8, text: 'Climb the wall by the park.' }, { minutes: 4, text: 'Pause.' }, { minutes: 8, text: 'Walk back.' }], notice: 'Notice the view.' });
  res = await post(createApp({ quiet: true, nodeEnv: 'test', planner: model(unsafe) }), { minutes: 20, energy: 'easy' });
  await save('fallback-safety-rejected', res.status, res.body);

  res = await post(createApp({ quiet: true, nodeEnv: 'test', planner: null }), { minutes: 15, energy: 'easy' });
  await save('error-400-invalid-request', res.status, res.body);

  const crashing: WalkPlanner = { kind: 'fallback', async plan() { throw new Error('boom /secret/path'); } };
  const quietLog = console.error; console.error = () => {};
  res = await post(createApp({ quiet: true, nodeEnv: 'test', planner: null, fallbackPlanner: crashing }), { minutes: 20, energy: 'easy' });
  console.error = quietLog;
  await save('error-500-internal', res.status, res.body);

  res = await request(createApp({ quiet: true, nodeEnv: 'test' })).get('/nope');
  await save('error-404', res.status, res.body);
}

void main();
