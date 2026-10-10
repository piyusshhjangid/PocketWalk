import { describe, expect, it } from 'vitest';
import { failureStage } from '../src/ai/errors';
import { emergencyPlan } from '../src/ai/emergencyPlan';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { PlannerError } from '../src/ai/errors';
import { checkBusiness } from '../src/ai/businessRules';
import { repairPlan } from '../src/ai/planRepair';
import { MAX_RAW_CHARS, extractJsonDetailed, parseAndValidate, validatePlan } from '../src/ai/planValidation';
import { runModelOutputPipeline, validateDomainPlan } from '../src/ai/validationPipeline';
import type { WalkPlan } from '../src/ai/walkPlanner';
import type { Guidance } from '../src/context/types';
import { defaultSafetyEngine } from '../src/safety/engine';
import { ctx, planObj, planWithStep } from './helpers/plans';

const run = (raw: string, context = ctx()) => runModelOutputPipeline(raw, context, defaultSafetyEngine);
const failure = async (raw: string, context = ctx()): Promise<PlannerError> => {
  try {
    await run(raw, context);
  } catch (e) {
    return e as PlannerError;
  }
  throw new Error('expected the pipeline to reject');
};

describe('repair: harmless normalisation only', () => {
  const repair = (over: Record<string, unknown>) => repairPlan({ ...(planObj(20) as WalkPlan), ...over } as WalkPlan, false);

  it('leaves a clean plan untouched and reports no repairs', () => {
    const { plan, repairs } = repair({});
    expect(repairs).toEqual([]);
    expect(plan).toEqual(planObj(20));
  });
  it('collapses whitespace runs', () => {
    const { plan, repairs } = repair({ title: 'Quiet   block \t loop' });
    expect(plan.title).toBe('Quiet block loop');
    expect(repairs).toEqual(['whitespace_normalised']);
  });
  it('strips markdown emphasis, backticks and list bullets', () => {
    const { plan, repairs } = repair({ title: '**Quiet** `loop`', notice: '- Notice the _light_.' });
    expect(plan.title).toBe('Quiet loop');
    expect(plan.notice).toBe('Notice the light.');
    expect(repairs).toContain('markdown_stripped');
  });
  it('removes zero-width, bidi and control characters', () => {
    const { plan, repairs } = repair({ title: 'Qu\u200Biet lo\u202Eop\u0007' });
    expect(plan.title).toBe('Quiet loop');
    expect(repairs).toContain('invisible_chars_removed');
  });
  it('never touches minutes, never truncates, never adds words', () => {
    const before = planObj(20) as WalkPlan;
    const { plan } = repairPlan(before, false);
    expect(plan.steps.map((s) => s.minutes)).toEqual(before.steps.map((s) => s.minutes));
    const long = 'word '.repeat(30).trim();
    expect(repair({ notice: long }).plan.notice).toBe(long); // too long is REJECTED later, never silently shortened
  });
  it('reports dropped unknown keys', () => {
    expect(repairPlan(planObj(20) as WalkPlan, true).repairs).toEqual(['unknown_keys_dropped']);
  });
  it('a plan that is only whitespace and invisible characters becomes empty and is then rejected', async () => {
    const e = await failure(JSON.stringify(planObj(20, { title: '\u200B\u200B' })));
    // schema min(1) passes (zero-width is not whitespace to trim), repair empties it, business rejects it
    expect(e.reason).toBe('business_rule');
    expect(e.report?.failureCodes).toContain('empty_text');
  });
});

describe('pipeline: stages and reports', () => {
  it('valid output passes every stage', async () => {
    const { plan, report } = await run(JSON.stringify(planObj(20)));
    expect(plan.title).toBe('Quiet block loop');
    expect(report).toMatchObject({ parse: 'passed', schema: 'passed', business: 'passed', safety: 'passed', repaired: false, repairs: [] });
    for (const k of ['parseMs', 'schemaMs', 'repairMs', 'businessMs', 'safetyMs', 'totalMs'] as const) {
      expect(report.timingsMs[k], k).toBeGreaterThanOrEqual(0);
    }
  });
  it('repairable output passes and says so', async () => {
    const dirty = planObj(20, { title: '**Quiet**   loop', debug: 1 });
    const { plan, report } = await run('```json\n' + JSON.stringify(dirty) + '\n```');
    expect(plan.title).toBe('Quiet loop');
    expect(report.repaired).toBe(true);
    expect(report.repairs).toEqual(expect.arrayContaining(['markdown_stripped', 'whitespace_normalised', 'unknown_keys_dropped']));
    expect(report.safety).toBe('passed');
  });
  it('parse failure stops at parse; later stages are not_run', async () => {
    const e = await failure('Sure! Here is a walk.');
    expect(e.reason).toBe('invalid_json');
    expect(e.report).toMatchObject({ parse: 'failed', schema: 'not_run', business: 'not_run', safety: 'not_run' });
  });
  it('schema failure stops at schema', async () => {
    const e = await failure(JSON.stringify(planObj(20, { steps: 'walk around' })));
    expect(e.reason).toBe('schema_invalid');
    expect(e.report).toMatchObject({ parse: 'passed', schema: 'failed', business: 'not_run', safety: 'not_run' });
  });
  it('business failure stops at business: safety never sees a plan with the wrong duration', async () => {
    const bad = planObj(20);
    bad.steps[0].minutes = 12;
    const e = await failure(JSON.stringify(bad));
    expect(e.reason).toBe('business_rule');
    expect(e.report).toMatchObject({ schema: 'passed', business: 'failed', safety: 'not_run' });
    expect(e.report?.failureCodes).toContain('duration_exceeds_request');
  });
  it('safety failure is last, and carries the rule ids', async () => {
    const e = await failure(JSON.stringify(planWithStep('Climb the structure.')));
    expect(e.reason).toBe('safety_violation');
    expect(e.report).toMatchObject({ parse: 'passed', schema: 'passed', business: 'passed', safety: 'failed' });
    expect(e.report?.failureCodes).toContain('climbing');
  });
  it('oversize raw output is rejected before it is parsed', async () => {
    const e = await failure('x'.repeat(MAX_RAW_CHARS + 1));
    expect(e.reason).toBe('schema_invalid');
    expect(e.report?.failureCodes).toEqual(['output_too_long']);
    expect(e.report).toMatchObject({ parse: 'failed', schema: 'not_run' }); // never claims a parse that did not happen
  });
  it('failure reports never contain model text', async () => {
    const e = await failure(JSON.stringify(planWithStep('Climb the SECRETWORD structure.')));
    expect(JSON.stringify(e.report)).not.toContain('SECRETWORD');
    expect(e.message).not.toContain('SECRETWORD');
  });
  it('extractJsonDetailed says when JSON had to be cut out of surrounding text', () => {
    expect(extractJsonDetailed('{"a":1}').extracted).toBe(false);
    expect(extractJsonDetailed('Here: {"a":1} enjoy').extracted).toBe(true);
    expect(extractJsonDetailed('```json\n{"a":1}\n```').extracted).toBe(true);
  });
});

describe('validatePlan / parseAndValidate (sync composition used by tests and scripts)', () => {
  it('runs every layer in order and throws the matching reason', () => {
    expect(() => validatePlan(planObj(20), { minutes: 20, energy: 'normal' })).not.toThrow();
    const reason = (candidate: unknown) => {
      try {
        validatePlan(candidate, { minutes: 20, energy: 'normal' });
      } catch (e) {
        return (e as PlannerError).reason;
      }
      return 'none';
    };
    expect(reason(planObj(20, { steps: [] }))).toBe('schema_invalid');
    expect(reason(planObj(20, { notice: 'word '.repeat(30) }))).toBe('business_rule');
    expect(reason(planWithStep('Walk onto the highway.'))).toBe('safety_violation');
  });
  it('parseAndValidate rejects oversize text and non-JSON', () => {
    expect(() => parseAndValidate('x'.repeat(MAX_RAW_CHARS + 1), { minutes: 20, energy: 'normal' })).toThrow(PlannerError);
    expect(() => parseAndValidate('nope', { minutes: 20, energy: 'normal' })).toThrow(PlannerError);
  });
});

describe('error categories map onto the closed reason set', () => {
  it('failureStage', () => {
    expect(failureStage('invalid_json')).toBe('parse');
    expect(failureStage('schema_invalid')).toBe('schema');
    expect(failureStage('business_rule')).toBe('business');
    expect(failureStage('safety_violation')).toBe('safety');
    expect(failureStage('not_configured')).toBe('none');
    for (const r of ['timeout', 'unavailable', 'rate_limited', 'misconfigured', 'empty_response', 'unknown'] as const) expect(failureStage(r)).toBe('model');
  });
});

describe('fallback and emergency plans are held to the same rules', () => {
  const CODES: Guidance[] = ['poor_conditions', 'dark', 'low_visibility', 'wet', 'hot', 'cold', 'windy'];

  it('EVERY subset of guidance x duration x energy: fallback AND emergency pass business + safety', async () => {
    const fb = new FallbackPlanner();
    let checked = 0;
    for (let mask = 0; mask < 1 << CODES.length; mask++) {
      const guidance = CODES.filter((_, i) => mask & (1 << i));
      for (const minutes of [10, 20, 40] as const) {
        for (const energy of ['easy', 'normal'] as const) {
          const context = ctx({ minutes, energy, guidance });
          const request = { minutes, energy };
          for (const [label, plan] of [['fallback', (await fb.plan(context)).plan], ['emergency', emergencyPlan(minutes)]] as const) {
            const issues = checkBusiness(plan, request);
            const safety = defaultSafetyEngine.validate(plan, context, request);
            expect({ label, guidance, minutes, energy, issues, safety: safety.ok }).toEqual({ label, guidance, minutes, energy, issues: [], safety: true });
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(128 * 3 * 2 * 2);
  });
  it('validateDomainPlan reports ok / business / safety without throwing', async () => {
    expect((await validateDomainPlan(planObj(20) as WalkPlan, ctx(), defaultSafetyEngine)).ok).toBe(true);
    const bad = planObj(20);
    bad.steps[0].minutes = 1;
    expect(await validateDomainPlan(bad as WalkPlan, ctx(), defaultSafetyEngine)).toMatchObject({ ok: false, stage: 'business' });
    expect(await validateDomainPlan(planWithStep('Climb it.') as WalkPlan, ctx(), defaultSafetyEngine)).toMatchObject({ ok: false, stage: 'safety', codes: ['climbing'] });
  });
});
