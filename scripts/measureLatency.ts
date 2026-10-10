/**
 * Latency measurement for the walk-plan workflow, using the SAME service the HTTP route calls.
 * Per-stage numbers come from the real timings the service already records (meta.*LatencyMs); Sentry
 * ingestion is not part of them (spans are sent asynchronously after the response).
 *
 *   npm run measure:latency -- [runs] [city]
 *
 * LIVE mode   : GEMMA_PROVIDER is google|ollama in .env -> real model (and real Open-Meteo if a city is given).
 * SYNTHETIC   : GEMMA_PROVIDER=none -> scripted stand-ins with fixed artificial delays. This measures
 *               only PocketWalk's OWN overhead (validation, orchestration). It says NOTHING about Gemma
 *               or Open-Meteo latency, and its model/context numbers are the delays chosen below, not measurements.
 */
import 'dotenv/config';
import { createModelPlanner } from '../src/ai/createPlanner';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import type { ModelClient } from '../src/ai/modelClient';
import { loadEnv } from '../src/config/env';
import { ContextBuilder } from '../src/context/contextBuilder';
import { createWeatherProvider } from '../src/context/createWeatherProvider';
import type { WeatherProvider } from '../src/context/weatherProvider';
import { WalkService } from '../src/services/walkService';

const SYNTH_MODEL_MS = 800;
const SYNTH_WEATHER_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
};
const row = (name: string, xs: number[]) =>
  xs.length === 0
    ? `| ${name} | n/a | n/a | n/a | n/a |`
    : `| ${name} | ${pct(xs, 50).toFixed(1)} | ${pct(xs, 95).toFixed(1)} | ${Math.min(...xs).toFixed(1)} | ${Math.max(...xs).toFixed(1)} |`;

async function main(): Promise<void> {
  const runs = Number(process.argv[2] ?? 20);
  const city = process.argv[3];
  const env = loadEnv();
  const live = env.GEMMA_PROVIDER !== 'none';

  let service: WalkService;
  let label: string;
  if (live) {
    const planner = createModelPlanner(env);
    const weather = city ? createWeatherProvider(env) : null;
    service = new WalkService(planner, new FallbackPlanner(), new ContextBuilder({ weather, weatherTimeoutMs: env.WEATHER_TIMEOUT_MS }));
    label = `LIVE: ${planner?.provider}/${planner?.model}, weather=${city && weather ? weather.name : 'none'}`;
  } else {
    const client: ModelClient = {
      provider: 'synthetic', model: 'synthetic-gemma', maxOutputTokens: 256, temperature: 0,
      async generate() {
        await sleep(SYNTH_MODEL_MS);
        return { text: JSON.stringify({ title: 'Quiet block loop', steps: [{ minutes: 8, text: 'Walk out slowly along the footpath.' }, { minutes: 4, text: 'Stop and listen for birds.' }, { minutes: 8, text: 'Return the way you came.' }], notice: 'Notice the light.' }) };
      },
    };
    const weather: WeatherProvider = {
      name: 'synthetic-weather',
      async lookup() {
        await sleep(SYNTH_WEATHER_MS);
        return { timezone: 'UTC', temperatureC: 21, feelsLikeC: 21, windKmh: 8, condition: 'clear', precipitation: 'none', sunriseLocal: '2026-10-07T06:00', sunsetLocal: '2026-10-07T18:00' };
      },
    };
    service = new WalkService(new GemmaPlanner({ client, timeoutMs: 5000 }), new FallbackPlanner(), new ContextBuilder({ weather, now: () => new Date('2026-10-07T12:00:00Z') }));
    label = `SYNTHETIC (artificial delays: model ${SYNTH_MODEL_MS} ms, weather ${SYNTH_WEATHER_MS} ms; NOT a measurement of Gemma or Open-Meteo)`;
  }

  const request = { minutes: 20 as const, energy: 'normal' as const, ...(city ? { location: { city } } : { location: { city: 'Synthetic City' } }) };
  const total: number[] = [], ctx: number[] = [], model: number[] = [], val: number[] = [], fb: number[] = [];
  let fallbacks = 0;
  const wall: number[] = [];
  await service.planWalk(request); // warm-up run, discarded (module/JIT warm)
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const { meta } = await service.planWalk(request);
    wall.push(performance.now() - t);
    total.push(meta.durationMs);
    ctx.push(meta.contextLatencyMs);
    if (meta.modelLatencyMs !== undefined) model.push(meta.modelLatencyMs);
    if (meta.validationLatencyMs !== undefined) val.push(meta.validationLatencyMs);
    if (meta.fallbackLatencyMs !== undefined) fb.push(meta.fallbackLatencyMs);
    if (meta.planner === 'fallback') fallbacks++;
  }
  console.log(`mode: ${label}`);
  console.log(`runs: ${runs} (+1 discarded warm-up), sequential, in-process (no HTTP), Sentry ${process.env.SENTRY_DSN ? 'configured' : 'not configured'}`);
  console.log(`fallbacks: ${fallbacks}/${runs}\n`);
  console.log('| stage (ms) | p50 | p95 | min | max |\n|---|---:|---:|---:|---:|');
  console.log(row('total (durationMs)', total));
  console.log(row('context', ctx));
  console.log(row('model', model));
  console.log(row('validation', val));
  console.log(row('fallback', fb));
  console.log(row('wall clock around call', wall));
}
void main();
