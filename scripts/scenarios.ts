/**
 * Offline walk-through of the five Checkpoint 3 scenarios. No network, no Gemma, no key.
 * Weather and the model are scripted stand-ins, so this proves what PocketWalk DOES with context:
 * the context it builds, the guidance it derives, what the model would be told, and what the
 * deterministic fallback serves. It does NOT show real Gemma output.
 *
 *   npm run scenarios
 */
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import type { ModelClient } from '../src/ai/modelClient';
import { PlannerError } from '../src/ai/errors';
import { ContextBuilder } from '../src/context/contextBuilder';
import type { WeatherObservation } from '../src/context/types';
import { WeatherError, type WeatherProvider } from '../src/context/weatherProvider';
import { WalkService } from '../src/services/walkService';

const obs = (over: Partial<WeatherObservation> = {}): WeatherObservation => ({
  timezone: 'UTC', temperatureC: 22, feelsLikeC: 22, windKmh: 8, condition: 'clear', precipitation: 'none',
  sunriseLocal: '2026-10-07T06:00', sunsetLocal: '2026-10-07T18:00', ...over,
});
const weather = (o: WeatherObservation | 'down'): WeatherProvider => ({
  name: 'scripted-weather',
  async lookup() {
    if (o === 'down') throw new WeatherError('unavailable', 'scripted');
    return o;
  },
});
const clock = (hhmm: string) => () => new Date(`2026-10-07T${hhmm}:00Z`);

/** A scripted model: records the prompt it was given and answers with a fixed valid plan. */
function scriptedModel(mode: 'ok' | 'down') {
  const prompts: string[] = [];
  const client: ModelClient = {
    provider: 'scripted', model: 'scripted-gemma', maxOutputTokens: 256, temperature: 0,
    async generate(prompt) {
      prompts.push(prompt);
      if (mode === 'down') throw new PlannerError('unavailable', 'scripted');
      return { text: JSON.stringify({ title: 'Scripted walk', steps: [{ minutes: 8, text: 'Walk out slowly.' }, { minutes: 4, text: 'Pause and listen.' }, { minutes: 8, text: 'Walk back.' }], notice: 'Notice the light.' }) };
    },
  };
  return { prompts, planner: new GemmaPlanner({ client, timeoutMs: 2000 }) };
}

async function run(name: string, w: WeatherProvider, now: string, model: 'ok' | 'down') {
  const { prompts, planner } = scriptedModel(model);
  const service = new WalkService(planner, new FallbackPlanner(), new ContextBuilder({ weather: w, now: clock(now) }));
  const { plan, meta } = await service.planWalk({ minutes: 20, energy: 'easy', location: { city: 'Scenario City' } });
  console.log(`\n=== ${name} ===`);
  console.log('context   :', JSON.stringify(meta.context));
  console.log('planner   :', meta.planner, meta.fallbackReason ? `(fallback: ${meta.fallbackReason})` : '');
  const sentences = (prompts[0] ?? '').split('\n').filter((l) => l.startsWith('- ') && /^- (Conditions|It is|Light|Keep)/.test(l));
  console.log('model told:', sentences.length ? sentences.map((s) => s.slice(2, 60) + '…').join(' | ') : prompts.length ? '(no condition guidance)' : '(model not reached)');
  console.log('plan      :', plan.title, '|', plan.steps.map((s) => `${s.minutes}m ${s.text}`).join(' / '), '|', plan.notice);
}

async function main(): Promise<void> {
  await run('A: comfortable weather, midday, Gemma up', weather(obs()), '12:00', 'ok');
  await run('B: rain, Gemma up', weather(obs({ condition: 'rain', precipitation: 'moderate', temperatureC: 15, feelsLikeC: 14 })), '12:00', 'ok');
  await run('B2: rain, Gemma DOWN (fallback is rain-aware)', weather(obs({ condition: 'rain', precipitation: 'moderate' })), '12:00', 'down');
  await run('C: near sunset, Gemma up', weather(obs()), '17:30', 'ok');
  await run('C2: after dark, Gemma DOWN', weather(obs()), '21:30', 'down');
  await run('D: weather unavailable, Gemma up', weather('down'), '12:00', 'ok');
  await run('E: Gemma unavailable, weather up', weather(obs()), '12:00', 'down');
  await run('E2: both unavailable', weather('down'), '12:00', 'down');
}

void main();
