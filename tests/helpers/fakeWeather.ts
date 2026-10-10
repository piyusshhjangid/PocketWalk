import type { WeatherFailureReason, WeatherObservation } from '../../src/context/types';
import { WeatherError, type WeatherProvider } from '../../src/context/weatherProvider';

type Behaviour = (city: string, signal: AbortSignal) => Promise<WeatherObservation>;

/** A weather provider that never touches the network. Tests script exactly what it returns. */
export class FakeWeatherProvider implements WeatherProvider {
  readonly name = 'fake-weather';
  readonly cities: string[] = [];

  constructor(private readonly behaviour: Behaviour) {}

  lookup(city: string, { signal }: { signal: AbortSignal }): Promise<WeatherObservation> {
    this.cities.push(city);
    return this.behaviour(city, signal);
  }

  static observing(over: Partial<WeatherObservation> = {}): FakeWeatherProvider {
    return new FakeWeatherProvider(async () => observation(over));
  }
  static failing(reason: WeatherFailureReason): FakeWeatherProvider {
    return new FakeWeatherProvider(async () => {
      throw new WeatherError(reason, 'scripted failure');
    });
  }
  /** Never answers and ignores the abort signal: proves the timeout is enforced by the builder. */
  static hanging(): FakeWeatherProvider {
    return new FakeWeatherProvider(() => new Promise(() => {}));
  }
  /** Throws something that is NOT a WeatherError: a bug, which must still not break the walk. */
  static crashing(): FakeWeatherProvider {
    return new FakeWeatherProvider(async () => {
      throw new TypeError('boom /secret/path');
    });
  }
}

/** A comfortable day at UTC, sunrise 06:00, sunset 18:00. Override fields per test. */
export function observation(over: Partial<WeatherObservation> = {}): WeatherObservation {
  return {
    timezone: 'UTC',
    temperatureC: 21.4,
    feelsLikeC: 22,
    windKmh: 8,
    condition: 'clear',
    precipitation: 'none',
    sunriseLocal: '2026-10-07T06:00',
    sunsetLocal: '2026-10-07T18:00',
    ...over,
  };
}

/** Fixed clocks (UTC). With observation()'s timezone these are also the local times. */
export const at = (hhmm: string): (() => Date) => () => new Date(`2026-10-07T${hhmm}:00Z`);
