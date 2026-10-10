import type { ApiError } from '../api/apiError';
import type { Energy, WalkMinutes, WalkRequest, WalkResult } from '../types/walk';
import { minutesToMs } from './walkTimer';

/** What the configuration form holds. `city` is raw text; '' means "no location". */
export interface WalkDraft {
  minutes: WalkMinutes;
  energy: Energy;
  city: string;
}

export const DEFAULT_DRAFT: WalkDraft = { minutes: 20, energy: 'easy', city: '' };

/**
 * The whole UI is exactly one of these states. Data that only exists in some states (the request,
 * the result, the error) lives inside those states, so "loading AND error" or "plan without a
 * result" cannot be represented.
 */
export type FlowState =
  | { name: 'HOME' }
  | { name: 'CONFIGURING'; draft: WalkDraft }
  | { name: 'GENERATING'; request: WalkRequest }
  | { name: 'PLAN_READY'; request: WalkRequest; result: WalkResult }
  | { name: 'READY_TO_WALK'; request: WalkRequest; result: WalkResult }
  | { name: 'WALK_ACTIVE'; request: WalkRequest; result: WalkResult; startedAt: number; durationMs: number }
  | { name: 'EXIT_CONFIRMATION'; request: WalkRequest; result: WalkResult; startedAt: number; durationMs: number }
  | { name: 'WALK_COMPLETE'; request: WalkRequest; result: WalkResult }
  | { name: 'ERROR'; request: WalkRequest; error: ApiError };

export type FlowAction =
  | { type: 'START' }
  | { type: 'SUBMIT'; request: WalkRequest }
  | { type: 'SUCCEEDED'; result: WalkResult }
  | { type: 'FAILED'; error: ApiError }
  | { type: 'CANCEL' }
  | { type: 'CONFIRM_READY' }
  | { type: 'BACK_TO_PLAN' }
  | { type: 'START_WALK'; now: number }
  | { type: 'REQUEST_EXIT' }
  | { type: 'KEEP_WALKING' }
  | { type: 'CONFIRM_EXIT' }
  | { type: 'FINISH_WALK' }
  | { type: 'EDIT' }
  | { type: 'RESET' };

export const initialState: FlowState = { name: 'HOME' };

export function draftFromRequest(request: WalkRequest): WalkDraft {
  return { minutes: request.minutes, energy: request.energy, city: request.location?.city ?? '' };
}

/** Pure transition function. An action that is not valid in the current state changes nothing. */
export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'START':
      return state.name === 'HOME' ? { name: 'CONFIGURING', draft: DEFAULT_DRAFT } : state;
    case 'SUBMIT':
      return state.name === 'CONFIGURING' || state.name === 'ERROR' ? { name: 'GENERATING', request: action.request } : state;
    case 'SUCCEEDED':
      return state.name === 'GENERATING' ? { name: 'PLAN_READY', request: state.request, result: action.result } : state;
    case 'FAILED':
      return state.name === 'GENERATING' ? { name: 'ERROR', request: state.request, error: action.error } : state;
    case 'CANCEL':
      return state.name === 'GENERATING' ? { name: 'CONFIGURING', draft: draftFromRequest(state.request) } : state;
    case 'CONFIRM_READY':
      return state.name === 'PLAN_READY' ? { name: 'READY_TO_WALK', request: state.request, result: state.result } : state;
    case 'BACK_TO_PLAN':
      return state.name === 'READY_TO_WALK' ? { name: 'PLAN_READY', request: state.request, result: state.result } : state;
    case 'START_WALK':
      // Only valid from READY_TO_WALK, so a second click/keypress (state is already WALK_ACTIVE) changes nothing.
      return state.name === 'READY_TO_WALK'
        ? { name: 'WALK_ACTIVE', request: state.request, result: state.result, startedAt: action.now, durationMs: minutesToMs(state.request.minutes) }
        : state;
    case 'REQUEST_EXIT':
      return state.name === 'WALK_ACTIVE' ? { ...state, name: 'EXIT_CONFIRMATION' } : state;
    case 'KEEP_WALKING':
      return state.name === 'EXIT_CONFIRMATION' ? { ...state, name: 'WALK_ACTIVE' } : state;
    case 'CONFIRM_EXIT':
      return state.name === 'EXIT_CONFIRMATION' ? { name: 'READY_TO_WALK', request: state.request, result: state.result } : state;
    case 'FINISH_WALK':
      // The timer ends the walk even while the exit question is open; once complete, further calls are ignored.
      return state.name === 'WALK_ACTIVE' || state.name === 'EXIT_CONFIRMATION'
        ? { name: 'WALK_COMPLETE', request: state.request, result: state.result }
        : state;
    case 'EDIT':
      return state.name === 'PLAN_READY' || state.name === 'READY_TO_WALK' || state.name === 'ERROR'
        ? { name: 'CONFIGURING', draft: draftFromRequest(state.request) }
        : state;
    case 'RESET':
      return { name: 'HOME' };
  }
}
