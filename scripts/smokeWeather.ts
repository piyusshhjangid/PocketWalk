/**
 * One real weather + daylight lookup through the exact production path (provider -> normalise -> context).
 * Run it yourself; it needs internet access to Open-Meteo and no key:
 *
 *   npm run smoke:weather -- Jalandhar
 *
 * Prints the normalised context (never coordinates) and the measured timings.
 * Exit code 0 = weather was available. It never prints the location back as coordinates.
 */
import 'dotenv/config';
import { loadEnv } from '../src/config/env';
import { ContextBuilder } from '../src/context/contextBuilder';
import { createWeatherProvider } from '../src/context/createWeatherProvider';

async function main(): Promise<void> {
  const city = process.argv.slice(2).join(' ').trim();
  if (city.length < 2) {
    console.error('Usage: npm run smoke:weather -- <city>');
    process.exit(2);
  }
  const env = loadEnv();
  const weather = createWeatherProvider(env);
  if (!weather) {
    console.error('WEATHER_PROVIDER is "none". Set WEATHER_PROVIDER=open-meteo.');
    process.exit(2);
  }
  console.log(`provider=${weather.name} timeout=${env.WEATHER_TIMEOUT_MS}ms`);
  const builder = new ContextBuilder({ weather, weatherTimeoutMs: env.WEATHER_TIMEOUT_MS });
  const { context, timings } = await builder.build({ minutes: 20, energy: 'easy', location: { city } });
  console.log(JSON.stringify(context, null, 2));
  console.log(`timings: context=${timings.contextMs} ms, weather=${timings.weatherMs ?? 'n/a'} ms`);
  if (context.availability?.weather !== 'ok') {
    console.error(`FAILED: reason=${context.weatherFailure}`);
    process.exitCode = 1;
  }
}

void main();
