import { PlannerError, type PlannerFailureReason } from './errors';
import { checkBusiness } from './businessRules';
import { parsePlanShape } from './planSchema';
import { repairPlan } from './planRepair';
import { extractJsonDetailed, MAX_RAW_CHARS } from './planValidation';
import { type ValidationReport, notRunReport } from './validationReport';
import type { WalkPlan } from './walkPlanner';
import type { OutdoorContext } from '../context/types';
import { withStageSpan, withStepSpan } from '../observability/tracing';
import type { SafetyEngine } from '../safety/engine';

const ms = (since: number): number => Math.round((performance.now() - since) * 100) / 100;

/**
 * Untrusted model text -> safe WalkPlan, one traced stage at a time:
 *
 *   parse -> schema -> repair -> business rules -> safety rules
 *
 * Every stage is its own span under one `pocketwalk.validate` span, so a trace answers "which stage
 * rejected it, and why". Spans carry stage results and closed-set rule ids only: never model text.
 * Throws PlannerError carrying a ValidationReport. Returns a plan only if every layer passed.
 */
export async function runModelOutputPipeline(
  raw: string,
  context: OutdoorContext,
  engine: SafetyEngine,
): Promise<{ plan: WalkPlan; report: ValidationReport }> {
  const report = notRunReport();
  const started = performance.now();
  const request = { minutes: context.minutes, energy: context.energy };

  const fail = (reason: PlannerFailureReason, message: string, codes: string[]): never => {
    report.failureCodes = codes;
    report.timingsMs.totalMs = ms(started);
    throw new PlannerError(reason, message, report);
  };

  return withStepSpan('pocketwalk.validate', 'validate plan', async () => {
    // 1. PARSE ---------------------------------------------------------------------------------
    const parsed = await withStageSpan('pocketwalk.parse', 'parse model output', (span) => {
      const t = performance.now();
      try {
        if (raw.length > MAX_RAW_CHARS) throw new PlannerError('schema_invalid', 'Model output is too long');
        const out = extractJsonDetailed(raw);
        span.setAttributes({ 'pocketwalk.stage.result': 'passed', 'pocketwalk.parse.json_extracted': out.extracted });
        report.parse = 'passed';
        return { ok: true as const, value: out.value };
      } catch (err) {
        const tooLong = err instanceof PlannerError && err.reason === 'schema_invalid';
        report.parse = 'failed'; // oversize is refused BEFORE parsing: the parse stage did not succeed, so it must not say it did
        span.setAttributes({ 'pocketwalk.stage.result': 'failed', 'pocketwalk.stage.failure_code': tooLong ? 'output_too_long' : 'invalid_json' });
        return { ok: false as const, tooLong };
      } finally {
        report.timingsMs.parseMs = ms(t);
      }
    });
    if (!parsed.ok) {
      return parsed.tooLong
        ? fail('schema_invalid', 'Model output is too long', ['output_too_long'])
        : fail('invalid_json', 'Model output is not valid JSON', ['invalid_json']);
    }

    // 2. SCHEMA --------------------------------------------------------------------------------
    const shape = await withStageSpan('pocketwalk.schema', 'schema validation', (span) => {
      const t = performance.now();
      const result = parsePlanShape(parsed.value);
      report.timingsMs.schemaMs = ms(t);
      report.schema = result.ok ? 'passed' : 'failed';
      span.setAttributes({
        'pocketwalk.stage.result': result.ok ? 'passed' : 'failed',
        ...(result.ok ? {} : { 'pocketwalk.stage.failure_code': 'schema_invalid', 'pocketwalk.schema.failed_paths': result.paths.join(',') }),
      });
      return result;
    });
    if (!shape.ok) return fail('schema_invalid', `Plan failed schema validation at: ${shape.paths.join(', ')}`, ['schema_invalid']);

    // 3. REPAIR (harmless normalisation only) -----------------------------------------------------
    const repaired = await withStageSpan('pocketwalk.repair', 'normalise plan', (span) => {
      const t = performance.now();
      const out = repairPlan(shape.plan, shape.unknownKeysDropped);
      report.timingsMs.repairMs = ms(t);
      report.repairs = out.repairs;
      report.repaired = out.repairs.length > 0;
      span.setAttributes({ 'pocketwalk.repair.applied': report.repaired, 'pocketwalk.repair.codes': out.repairs.join(',') });
      return out.plan;
    });

    // 4. BUSINESS RULES ------------------------------------------------------------------------
    const business = await withStageSpan('pocketwalk.business', 'business validation', (span) => {
      const t = performance.now();
      const issues = checkBusiness(repaired, request, shape.intensity);
      report.timingsMs.businessMs = ms(t);
      report.business = issues.length === 0 ? 'passed' : 'failed';
      span.setAttributes({
        'pocketwalk.stage.result': report.business,
        ...(issues.length > 0 ? { 'pocketwalk.stage.failure_code': [...new Set(issues.map((i) => i.code))].join(',') } : {}),
      });
      return issues;
    });
    if (business.length > 0) {
      return fail('business_rule', 'Plan broke business rules', [...new Set(business.map((i) => i.code))]);
    }

    // 5. SAFETY RULES --------------------------------------------------------------------------
    const safety = await withStageSpan('pocketwalk.safety', 'safety validation', (span) => {
      const t = performance.now();
      const result = engine.validate(repaired, context, request);
      report.timingsMs.safetyMs = ms(t);
      report.safety = result.ok ? 'passed' : 'failed';
      span.setAttributes({
        'pocketwalk.stage.result': report.safety,
        ...(result.ok
          ? {}
          : {
              'pocketwalk.safety.violation_rules': [...new Set(result.violations.map((v) => v.rule))].join(','),
              'pocketwalk.safety.violation_categories': [...new Set(result.violations.map((v) => v.category))].join(','),
            }),
      });
      return result;
    });
    if (!safety.ok) {
      return fail('safety_violation', 'Plan broke safety rules', [...new Set(safety.violations.map((v) => v.rule))]);
    }

    report.timingsMs.totalMs = ms(started);
    return { plan: repaired, report };
  });
}

/**
 * Business + safety check for a plan that is ALREADY a typed WalkPlan (the deterministic fallback).
 * No parsing or schema stage: those answer questions about untrusted text. Never throws.
 */
export async function validateDomainPlan(
  plan: WalkPlan,
  context: OutdoorContext,
  engine: SafetyEngine,
): Promise<{ ok: true; ms: number } | { ok: false; stage: 'business' | 'safety'; codes: string[]; ms: number }> {
  const started = performance.now();
  const request = { minutes: context.minutes, energy: context.energy };
  return withStageSpan('pocketwalk.fallback_validate', 'validate fallback plan', (span) => {
    const issues = checkBusiness(plan, request);
    if (issues.length > 0) {
      const codes = [...new Set(issues.map((i) => i.code))];
      span.setAttributes({ 'pocketwalk.stage.result': 'failed', 'pocketwalk.stage.failure_code': codes.join(',') });
      return { ok: false as const, stage: 'business' as const, codes, ms: ms(started) };
    }
    const safety = engine.validate(plan, context, request);
    if (!safety.ok) {
      const codes = [...new Set(safety.violations.map((v) => v.rule))];
      span.setAttributes({ 'pocketwalk.stage.result': 'failed', 'pocketwalk.safety.violation_rules': codes.join(',') });
      return { ok: false as const, stage: 'safety' as const, codes, ms: ms(started) };
    }
    span.setAttribute('pocketwalk.stage.result', 'passed');
    return { ok: true as const, ms: ms(started) };
  });
}
