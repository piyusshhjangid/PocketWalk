import { z } from 'zod';
import { MAX_TITLE_CHARS, STEP_COUNT } from './prompt';
import type { Energy, WalkPlan } from './walkPlanner';

/**
 * Structural contract for a WalkPlan. Provider independent: it validates `unknown`, whoever produced it.
 * This stage answers only "is it the right SHAPE with sane bounds?". Business rules (do the minutes add
 * up?) and safety rules live in their own modules on purpose.
 */

/** Hard bounds. They exist to protect the server, the UI and Sentry from pathological model output. */
export const MAX_STEP_TEXT_CHARS = 200;
export const MAX_NOTICE_CHARS = 200;
export const MAX_STEP_MINUTES = 40;
/** Title + 3 steps + notice. Checked by business rules after repair. */
export const MAX_PLAN_TEXT_CHARS = 600;

const bounded = (max: number) => z.string().trim().min(1).max(max);

/** Unknown keys are stripped (and reported as a repair), so extra model output never reaches a client. */
export const planSchema = z.object({
  title: bounded(MAX_TITLE_CHARS),
  steps: z
    .array(z.object({ minutes: z.number().int().min(1).max(MAX_STEP_MINUTES), text: bounded(MAX_STEP_TEXT_CHARS) }))
    .length(STEP_COUNT),
  notice: bounded(MAX_NOTICE_CHARS),
  /**
   * Defensive and optional. The model is not asked for it. If a model volunteers one it must be a
   * supported value, and it may not exceed the requested energy. It is dropped from the output:
   * the application owns intensity (= the request's `energy`).
   */
  intensity: z.enum(['easy', 'normal']).optional(),
});

export type ShapeResult =
  | { ok: true; plan: WalkPlan; intensity?: Energy; unknownKeysDropped: boolean }
  | { ok: false; paths: string[] };

const PLAN_KEYS = new Set(['title', 'steps', 'notice', 'intensity']);
const STEP_KEYS = new Set(['minutes', 'text']);

function hasUnknownKeys(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const obj = candidate as Record<string, unknown>;
  if (Object.keys(obj).some((k) => !PLAN_KEYS.has(k))) return true;
  const steps = obj.steps;
  return Array.isArray(steps) && steps.some((s) => typeof s === 'object' && s !== null && Object.keys(s).some((k) => !STEP_KEYS.has(k)));
}

export function parsePlanShape(candidate: unknown): ShapeResult {
  const parsed = planSchema.safeParse(candidate);
  if (!parsed.success) {
    // Paths only, never values: model text is not echoed into errors or logs.
    return { ok: false, paths: [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))] };
  }
  const { title, steps, notice, intensity } = parsed.data;
  return {
    ok: true,
    plan: { title, steps: steps.map((s) => ({ minutes: s.minutes, text: s.text })), notice },
    ...(intensity ? { intensity } : {}),
    unknownKeysDropped: hasUnknownKeys(candidate),
  };
}
