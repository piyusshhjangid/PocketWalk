import type { WalkPlan } from './walkPlanner';

/**
 * The last line of defence: a fixed plan that stays by the person's own door. It is used only when
 * even the deterministic fallback fails validation (which would be a bug). It is a constant of this
 * codebase, not model output, and tests prove it passes every business and safety rule under every
 * guidance combination, duration and energy. It is reported as `fallbackSource: "emergency"`.
 */
export function emergencyPlan(minutes: number): WalkPlan {
  const edge = Math.round(minutes * 0.4);
  const middle = minutes - edge * 2;
  return {
    title: 'Quiet pause by the door',
    steps: [
      { minutes: edge, text: 'Step just outside your door.' },
      { minutes: middle, text: 'Stand by the door and listen to the sounds around you.' },
      { minutes: edge, text: 'Go back inside when you are ready.' },
    ],
    notice: 'It is fine to go back in early.',
  };
}
