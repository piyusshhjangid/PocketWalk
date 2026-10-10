import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ApiError } from '../api/apiError';
import type { WalkApi } from '../api/walkApi';
import { flowReducer, initialState, type FlowState } from '../app/walkFlow';
import { systemClock, type Clock } from '../time/clock';
import type { WalkRequest } from '../types/walk';

/**
 * Owns the flow state and the single in-flight request.
 *
 * One user action = one POST: `inFlight` is a ref (not state) so a second click that lands before
 * React re-renders is still rejected. Leaving GENERATING (cancel/unmount) aborts the request, and a
 * late answer from an abandoned request is ignored.
 */
export function useWalkFlow(api: WalkApi, clock: Clock = systemClock) {
  const [state, dispatch] = useReducer(flowReducer, initialState);
  const stateRef = useRef<FlowState>(state);
  stateRef.current = state;
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const runId = useRef(0);

  const abortCurrent = useCallback(() => {
    runId.current += 1;
    controller.current?.abort();
    controller.current = null;
    inFlight.current = false;
  }, []);

  useEffect(() => abortCurrent, [abortCurrent]);

  const submit = useCallback(
    (request: WalkRequest) => {
      const from = stateRef.current.name;
      if (inFlight.current || (from !== 'CONFIGURING' && from !== 'ERROR')) return;
      inFlight.current = true;
      const myRun = ++runId.current;
      const ctrl = new AbortController();
      controller.current = ctrl;
      dispatch({ type: 'SUBMIT', request });

      api
        .planWalk(request, { signal: ctrl.signal })
        .then((result) => {
          if (myRun !== runId.current) return;
          inFlight.current = false;
          dispatch({ type: 'SUCCEEDED', result });
        })
        .catch((err: unknown) => {
          if (myRun !== runId.current) return;
          inFlight.current = false;
          dispatch({ type: 'FAILED', error: err instanceof ApiError ? err : new ApiError('network') });
        });
    },
    [api],
  );

  const cancel = useCallback(() => {
    abortCurrent();
    dispatch({ type: 'CANCEL' });
  }, [abortCurrent]);

  return {
    state,
    start: () => dispatch({ type: 'START' }),
    submit,
    cancel,
    confirmReady: () => dispatch({ type: 'CONFIRM_READY' }),
    backToPlan: () => dispatch({ type: 'BACK_TO_PLAN' }),
    // The start time is read once, here. A repeated click is dropped by the reducer (not READY_TO_WALK any more).
    startWalk: () => dispatch({ type: 'START_WALK', now: clock.now() }),
    requestExit: () => dispatch({ type: 'REQUEST_EXIT' }),
    keepWalking: () => dispatch({ type: 'KEEP_WALKING' }),
    confirmExit: () => dispatch({ type: 'CONFIRM_EXIT' }),
    finishWalk: () => dispatch({ type: 'FINISH_WALK' }),
    edit: () => dispatch({ type: 'EDIT' }),
    reset: () => dispatch({ type: 'RESET' }),
  };
}
