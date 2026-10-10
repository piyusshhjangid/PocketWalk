import type { WeatherFailureReason, WeatherObservation } from './types';

/**
 * The seam between PocketWalk and any weather service. PocketWalk code never builds a weather URL
 * or reads a weather JSON field: it calls this interface and gets a WeatherObservation or a WeatherError.
 */
export interface WeatherProvider {
  readonly name: string;
  /**
   * Look up current conditions for a city. Implementations must honour `signal` (abort the request)
   * and must throw WeatherError for every expected failure.
   */
  lookup(city: string, options: { signal: AbortSignal }): Promise<WeatherObservation>;
}

export class WeatherError extends Error {
  constructor(
    public readonly reason: WeatherFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'WeatherError';
  }
}
