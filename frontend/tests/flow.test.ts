import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/apiError';
import { parseWalkResult } from '../src/api/parseWalkResult';
import { DEFAULT_DRAFT, flowReducer, initialState, type FlowState } from '../src/app/walkFlow';
import type { WalkRequest } from '../src/types/walk';
import { fixture } from './fixtures';

const request: WalkRequest = { minutes: 40, energy: 'normal', location: { city: 'Pune' } };
const result = parseWalkResult(fixture('model-plan-weather').body);

describe('flow state machine', () => {
  it('walks the happy path HOME -> CONFIGURING -> GENERATING -> PLAN_READY -> READY_TO_WALK', () => {
    let s: FlowState = initialState;
    s = flowReducer(s, { type: 'START' });
    expect(s).toEqual({ name: 'CONFIGURING', draft: DEFAULT_DRAFT });
    s = flowReducer(s, { type: 'SUBMIT', request });
    expect(s.name).toBe('GENERATING');
    s = flowReducer(s, { type: 'SUCCEEDED', result });
    expect(s.name).toBe('PLAN_READY');
    s = flowReducer(s, { type: 'CONFIRM_READY' });
    expect(s.name).toBe('READY_TO_WALK');
    expect(flowReducer(s, { type: 'BACK_TO_PLAN' }).name).toBe('PLAN_READY');
  });

  it('goes GENERATING -> ERROR and a retry returns to GENERATING with the same request', () => {
    let s: FlowState = { name: 'GENERATING', request };
    s = flowReducer(s, { type: 'FAILED', error: new ApiError('server', 500) });
    expect(s.name).toBe('ERROR');
    s = flowReducer(s, { type: 'SUBMIT', request });
    expect(s).toEqual({ name: 'GENERATING', request });
  });

  it('restores the last choices when editing or cancelling', () => {
    const draft = { minutes: 40, energy: 'normal', city: 'Pune' };
    expect(flowReducer({ name: 'GENERATING', request }, { type: 'CANCEL' })).toEqual({ name: 'CONFIGURING', draft });
    expect(flowReducer({ name: 'PLAN_READY', request, result }, { type: 'EDIT' })).toEqual({ name: 'CONFIGURING', draft });
  });

  it('ignores actions that are invalid for the current state', () => {
    const generating: FlowState = { name: 'GENERATING', request };
    expect(flowReducer(generating, { type: 'SUBMIT', request })).toBe(generating);
    expect(flowReducer(generating, { type: 'CONFIRM_READY' })).toBe(generating);
    expect(flowReducer(initialState, { type: 'SUCCEEDED', result })).toBe(initialState);
    expect(flowReducer(initialState, { type: 'FAILED', error: new ApiError('network') })).toBe(initialState);
  });
});

describe('walk states', () => {
  const ready: FlowState = { name: 'READY_TO_WALK', request, result };
  const t0 = 5_000;

  it('READY_TO_WALK -> WALK_ACTIVE uses the requested minutes and the given start time', () => {
    const s = flowReducer(ready, { type: 'START_WALK', now: t0 });
    expect(s).toEqual({ name: 'WALK_ACTIVE', request, result, startedAt: t0, durationMs: 40 * 60_000 });
  });

  it('a second START_WALK does not restart or move the walk', () => {
    const active = flowReducer(ready, { type: 'START_WALK', now: t0 });
    expect(flowReducer(active, { type: 'START_WALK', now: t0 + 900 })).toBe(active);
  });

  it('START_WALK is ignored everywhere except READY_TO_WALK', () => {
    for (const s of [initialState, { name: 'GENERATING', request } as FlowState, { name: 'PLAN_READY', request, result } as FlowState]) {
      expect(flowReducer(s, { type: 'START_WALK', now: t0 })).toBe(s);
    }
  });

  it('exit asks first; keeping the walk restores the same timing; confirming returns to READY_TO_WALK', () => {
    const active = flowReducer(ready, { type: 'START_WALK', now: t0 });
    const asking = flowReducer(active, { type: 'REQUEST_EXIT' });
    expect(asking.name).toBe('EXIT_CONFIRMATION');
    expect(flowReducer(asking, { type: 'KEEP_WALKING' })).toEqual(active);
    expect(flowReducer(asking, { type: 'CONFIRM_EXIT' })).toEqual(ready);
    expect(flowReducer(active, { type: 'CONFIRM_EXIT' })).toBe(active); // cannot skip the question
  });

  it('FINISH_WALK completes from active or while the exit question is open, exactly once', () => {
    const active = flowReducer(ready, { type: 'START_WALK', now: t0 });
    const done = flowReducer(active, { type: 'FINISH_WALK' });
    expect(done).toEqual({ name: 'WALK_COMPLETE', request, result });
    expect(flowReducer(done, { type: 'FINISH_WALK' })).toBe(done);
    expect(flowReducer(flowReducer(active, { type: 'REQUEST_EXIT' }), { type: 'FINISH_WALK' }).name).toBe('WALK_COMPLETE');
    expect(flowReducer(ready, { type: 'FINISH_WALK' })).toBe(ready);
  });

  it('a walk in progress cannot be edited away; only completion or Done leaves it', () => {
    const active = flowReducer(ready, { type: 'START_WALK', now: t0 });
    expect(flowReducer(active, { type: 'EDIT' })).toBe(active);
    expect(flowReducer(active, { type: 'BACK_TO_PLAN' })).toBe(active);
    expect(flowReducer(flowReducer(active, { type: 'FINISH_WALK' }), { type: 'RESET' })).toEqual(initialState);
  });
});
