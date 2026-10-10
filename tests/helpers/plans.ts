import type { OutdoorContext } from '../../src/context/types';

/** A plan object (not JSON text) that satisfies every rule for `minutes`. Override fields per test. */
export function planObj(minutes = 20, over: Record<string, unknown> = {}): Record<string, any> {
  const a = Math.round(minutes * 0.4);
  return {
    title: 'Quiet block loop',
    steps: [
      { minutes: a, text: 'Walk out slowly along the nearest footpath.' },
      { minutes: minutes - 2 * a, text: 'Stop and listen for distant birds.' },
      { minutes: a, text: 'Return the way you came, unhurried.' },
    ],
    notice: 'Notice how many shades of green you can find.',
    ...over,
  };
}

/**
 * A plan whose middle step carries `text`. Everything else is deliberately neutral (no light, weather
 * or distance words), so a verdict can only come from `text`.
 */
export function planWithStep(text: string, minutes = 20): Record<string, any> {
  const p = planObj(minutes, { notice: 'Notice three different sounds.' });
  p.steps[1].text = text;
  return p;
}

/** A plan that satisfies the strictest context (poor conditions + dark + wet + wind): by the door, listening only. */
export function shelteredPlan(minutes = 20): Record<string, any> {
  const a = Math.round(minutes * 0.4);
  return {
    title: 'Pause by the door',
    steps: [
      { minutes: a, text: 'Step out to a covered place by your door.' },
      { minutes: minutes - 2 * a, text: 'Stand under cover and listen.' },
      { minutes: a, text: 'Go back inside when you like.' },
    ],
    notice: 'It is fine to go back in early.',
  };
}

export const ctx = (over: Partial<OutdoorContext> = {}): OutdoorContext => ({ minutes: 20, energy: 'normal', guidance: [], ...over });
