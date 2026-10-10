import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import { OpenMeteoProvider } from '../src/context/openMeteoProvider';
import { sentryPrivacyOptions } from '../src/observability/sentryConfig';
import { WalkService } from '../src/services/walkService';
import { at, FakeWeatherProvider } from './helpers/fakeWeather';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';

/**
 * Real Sentry SDK, real tracing, the exact privacy options production uses (sentryPrivacyOptions),
 * and a transport that records what WOULD be sent. The weather provider is the real OpenMeteoProvider
 * talking real HTTP to a local server that imitates Open-Meteo, so the real outgoing-request
 * instrumentation runs. Nothing leaves the machine.
 */
const CITY = 'Jalandhar';
const LAT = 31.32559;
const LON = 75.57618;

type Ended = { op?: string; description?: string; data?: Record<string, unknown>; status?: string; id?: string; parent?: string };
const ended: Ended[] = [];
const sent: string[] = [];
let server: http.Server;
let host: string;
let mode: 'ok' | 'down' | 'slow' = 'ok';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (mode === 'down') return void res.writeHead(503).end('{}');
    const reply = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url?.startsWith('/v1/search')) {
        res.end(JSON.stringify({ results: [{ latitude: LAT, longitude: LON, timezone: 'Asia/Kolkata' }] }));
      } else {
        res.end(JSON.stringify({
          timezone: 'Asia/Kolkata',
          current: { temperature_2m: 24.2, apparent_temperature: 25, weather_code: 61, wind_speed_10m: 10 },
          daily: { sunrise: ['2026-10-07T06:00'], sunset: ['2026-10-07T18:00'] },
        }));
      }
    };
    if (mode === 'slow') setTimeout(reply, 800);
    else reply();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;

  Sentry.init({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    transport: () => ({ send: async (envelope) => { sent.push(JSON.stringify(envelope)); return {}; }, flush: async () => true }),
    ...sentryPrivacyOptions([host]), // the local stand-in is treated exactly like the real weather hosts
  });
  Sentry.getClient()?.on('spanEnd', (span) => {
    const j = Sentry.spanToJSON(span) as unknown as { name?: string; status?: string; span_id?: string; parent_span_id?: string; attributes?: Record<string, unknown> };
    ended.push({ op: j.attributes?.['sentry.op'] as string | undefined, description: j.name, data: j.attributes, status: j.status, id: j.span_id, parent: j.parent_span_id });
  });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await Sentry.close(500);
});

const provider = () => new OpenMeteoProvider({ geocodingBaseUrl: `http://${host}`, forecastBaseUrl: `http://${host}` });
const model = () => new GemmaPlanner({ client: FakeModelClient.replying(validPlanJson(20)), timeoutMs: 2000 });
const service = (weather: ContextBuilder['build'] extends never ? never : ConstructorParameters<typeof ContextBuilder>[0]) =>
  new WalkService(model(), new FallbackPlanner(), new ContextBuilder(weather));
const request = { minutes: 20 as const, energy: 'easy' as const, location: { city: CITY } };

describe('Sentry: context trace shape', () => {
  it('context.build is a child of the agent span, with weather.fetch and daylight.calculate beneath it', async () => {
    ended.length = 0; mode = 'ok';
    const result = await service({ weather: provider(), now: at('06:30') }).planWalk(request);
    expect(result.meta).toMatchObject({ planner: 'model', context: { weather: 'ok', daylight: 'ok' } });

    const agent = ended.find((s) => s.op === 'gen_ai.invoke_agent');
    const ctx = ended.find((s) => s.description === 'execute_tool context.build');
    const weather = ended.find((s) => s.description === 'weather.fetch');
    const daylight = ended.find((s) => s.description === 'daylight.calculate');
    expect(ctx?.op).toBe('gen_ai.execute_tool');
    expect(ctx?.parent).toBe(agent?.id);
    expect(weather?.parent).toBe(ctx?.id);
    expect(daylight?.parent).toBe(ctx?.id);
    // ordering of the workflow: context.build finishes before the model call starts
    expect(ended.find((s) => s.op === 'gen_ai.chat')?.parent).toBe(agent?.id);

    expect(weather?.data).toMatchObject({ 'pocketwalk.weather.provider': 'open-meteo', 'pocketwalk.weather.status': 'ok' });
    expect(daylight?.data).toMatchObject({ 'pocketwalk.daylight.status': 'ok', 'pocketwalk.daylight.phase': 'day', 'pocketwalk.time_of_day': 'afternoon' });
    expect(agent?.data).toMatchObject({ 'pocketwalk.weather': 'ok', 'pocketwalk.daylight': 'ok', 'pocketwalk.fallback': false });
    expect(typeof agent?.data?.['pocketwalk.context_ms']).toBe('number');
  });

  it('weather latency is real elapsed time: two sequential 800 ms provider calls are reported as >= 1.5 s', async () => {
    ended.length = 0; mode = 'slow';
    const result = await service({ weather: provider(), now: at('06:30'), weatherTimeoutMs: 5000 }).planWalk(request);
    mode = 'ok';
    expect(result.meta.context.weather).toBe('ok');
    expect(result.meta.weatherLatencyMs).toBeGreaterThanOrEqual(1500); // geocode, then forecast
    expect(result.meta.contextLatencyMs).toBeGreaterThanOrEqual(result.meta.weatherLatencyMs ?? Infinity);
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(result.meta.contextLatencyMs);
  });

  it('failure path is traceable: failed status, reason attribute, and the walk still completes', async () => {
    ended.length = 0; mode = 'down';
    const result = await service({ weather: provider(), now: at('06:30') }).planWalk(request);
    expect(result.meta).toMatchObject({ planner: 'model', context: { weather: 'unavailable', weatherFailure: 'unavailable' } });

    const weather = ended.find((s) => s.description === 'weather.fetch');
    expect(weather?.data).toMatchObject({ 'pocketwalk.weather.status': 'failed', 'pocketwalk.weather.failure_reason': 'unavailable' });
    expect(weather?.status).not.toBe('ok');
    expect(ended.some((s) => s.description === 'daylight.calculate')).toBe(false); // nothing to calculate from
    const agent = ended.find((s) => s.op === 'gen_ai.invoke_agent');
    expect(agent?.data).toMatchObject({ 'pocketwalk.weather': 'unavailable', 'pocketwalk.weather_failure': 'unavailable' });
    mode = 'ok';
  });

  it('timeout path: reason "timeout" on the span', async () => {
    ended.length = 0;
    const result = await service({ weather: FakeWeatherProvider.hanging(), weatherTimeoutMs: 60 }).planWalk(request);
    expect(result.meta.context.weatherFailure).toBe('timeout');
    expect(ended.find((s) => s.description === 'weather.fetch')?.data).toMatchObject({ 'pocketwalk.weather.failure_reason': 'timeout' });
  });
});

describe('Test 13: privacy / telemetry filtering', () => {
  it('no city, coordinates, time zone or raw provider data appears anywhere in what Sentry would send', async () => {
    ended.length = 0; sent.length = 0; mode = 'ok';
    await service({ weather: provider(), now: at('06:30') }).planWalk(request);
    // also force an error event, which carries breadcrumbs (where outgoing request URLs would otherwise end up)
    Sentry.captureException(new Error('probe'));
    await Sentry.flush(1000);

    const everything = sent.join('\n') + JSON.stringify(ended);
    expect(everything).toContain('weather.fetch'); // the telemetry really was captured: this is not a vacuous pass
    expect(everything).toContain('context.build');
    expect(everything).toContain('probe');
    for (const secret of [CITY, 'jalandhar', '31.32', '31.33', '75.57', '75.58', 'Asia/Kolkata', 'latitude', 'longitude', 'name=']) {
      expect(everything, `telemetry leaked "${secret}"`).not.toContain(secret);
    }
    // neither the prompt nor the model output is attached either (Checkpoint 2 boundary still holds)
    expect(everything).not.toContain('You plan a short outdoor walk');
    expect(everything).not.toContain('Quiet block loop');
  });

  it('automatic outgoing-request spans for the weather hosts are suppressed (only our own spans remain)', async () => {
    ended.length = 0; mode = 'ok';
    await service({ weather: provider(), now: at('06:30') }).planWalk(request);
    expect(ended.filter((s) => s.op === 'http.client')).toHaveLength(0);
    expect(ended.filter((s) => s.description?.startsWith('weather.fetch'))).toHaveLength(1);
  });
});
