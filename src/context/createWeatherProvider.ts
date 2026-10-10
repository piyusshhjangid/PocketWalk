import type { Env } from '../config/env';
import { OpenMeteoProvider } from './openMeteoProvider';
import type { WeatherProvider } from './weatherProvider';

/** Build the weather provider from validated env. Returns null when weather is switched off. */
export function createWeatherProvider(env: Env): WeatherProvider | null {
  switch (env.WEATHER_PROVIDER) {
    case 'open-meteo':
      return new OpenMeteoProvider();
    default:
      return null;
  }
}
