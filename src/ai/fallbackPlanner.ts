import { hasGuidance } from '../context/normalize';
import type { OutdoorContext } from '../context/types';
import type { PlannerResult, WalkPlan, WalkPlanner } from './walkPlanner';

/**
 * Deterministic walk used ONLY when the model path cannot deliver a valid plan.
 * It is NOT AI and is always reported as `fallback`. It satisfies the same rules as model output,
 * and it respects the same deterministic guidance the model is given, so a failed model call never
 * turns a poor-weather or after-dark context into a worse walk than the model would have been allowed.
 */
export class FallbackPlanner implements WalkPlanner {
  readonly kind = 'fallback' as const;

  async plan(context: OutdoorContext): Promise<PlannerResult> {
    const { minutes, energy } = context;
    const edge = Math.round(minutes * 0.4);
    const middle = minutes - edge * 2;
    const easy = energy === 'easy';

    const walk = (title: string, out: string, mid: string, back: string, notice: string): WalkPlan => ({
      title,
      steps: [
        { minutes: edge, text: out },
        { minutes: middle, text: mid },
        { minutes: edge, text: back },
      ],
      notice,
    });

    if (hasGuidance(context, 'poor_conditions')) {
      return {
        plan: walk(
          'Sheltered pause by the door',
          'Step out to a covered place right by your door.',
          'Stay under cover and listen to the weather for a while.',
          'Go back inside whenever you like.',
          'It is fine to go back in early.',
        ),
      };
    }
    if (hasGuidance(context, 'dark') || hasGuidance(context, 'low_visibility')) {
      return {
        plan: walk(
          'Short lit loop near home',
          'Walk out slowly on a lit footpath close to home.',
          'Pause briefly under good light and listen.',
          'Turn around and walk home the way you came.',
          'Notice three different sounds.',
        ),
      };
    }
    if (hasGuidance(context, 'wet')) {
      return {
        plan: walk(
          easy ? 'Easy covered loop near home' : 'Covered loop near home',
          'Walk out slowly, keeping under cover where you can.',
          'Pause somewhere sheltered and listen to the rain.',
          'Turn around and walk back unhurried.',
          'Notice how the rain sounds on different surfaces.',
        ),
      };
    }
    if (hasGuidance(context, 'hot')) {
      return {
        plan: walk(
          'Slow shady loop near home',
          'Walk out slowly, keeping to the shade.',
          'Pause in the shade and look around.',
          'Turn around and walk back slowly.',
          'Notice where the shade is coolest.',
        ),
      };
    }
    if (hasGuidance(context, 'cold')) {
      return {
        plan: walk(
          easy ? 'Short gentle loop near home' : 'Short brisk loop near home',
          'Walk out gently on a nearby footpath.',
          'Stand still only briefly, then look around.',
          'Turn around and keep moving back home.',
          'Notice how the cold air feels.',
        ),
      };
    }
    if (hasGuidance(context, 'windy')) {
      return {
        plan: walk(
          'Sheltered loop near home',
          'Walk out slowly on a sheltered footpath.',
          'Pause out of the wind and listen.',
          'Turn around and walk back.',
          'Notice what the wind moves around you.',
        ),
      };
    }

    return {
      plan: walk(
        easy ? 'Easy loop near home' : 'Steady loop near home',
        easy ? 'Walk out slowly on a nearby footpath.' : 'Walk out at a steady pace.',
        'Pause somewhere pleasant and look around.',
        'Turn around and walk back.',
        'Notice three different sounds.',
      ),
    };
  }
}
