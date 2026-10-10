import { useEffect, useRef } from 'react';
import { walkApi, type WalkApi } from '../api/walkApi';
import { useWalkFlow } from '../hooks/useWalkFlow';
import { systemClock, type Clock } from '../time/clock';
import { ActiveWalkPage } from '../pages/ActiveWalkPage';
import { CompletePage } from '../pages/CompletePage';
import { ConfigurePage } from '../pages/ConfigurePage';
import { ErrorPage } from '../pages/ErrorPage';
import { GeneratingPage } from '../pages/GeneratingPage';
import { HomePage } from '../pages/HomePage';
import { PlanPage } from '../pages/PlanPage';
import { ReadyPage } from '../pages/ReadyPage';

export function App({ api = walkApi, clock = systemClock }: { api?: WalkApi; clock?: Clock }) {
  const flow = useWalkFlow(api, clock);
  const { state } = flow;

  // Move focus to the new screen's heading when the screen changes (not on first load), so keyboard
  // and screen-reader users land at the top of what just appeared.
  const first = useRef(true);
  const previous = useRef(state.name);
  useEffect(() => {
    const from = previous.current;
    previous.current = state.name;
    if (first.current) {
      first.current = false;
      return;
    }
    // Opening/closing the exit question stays on the same screen; ActiveWalkPage manages its own focus.
    const walking = (n: string) => n === 'WALK_ACTIVE' || n === 'EXIT_CONFIRMATION';
    if (walking(from) && walking(state.name)) return;
    document.querySelector<HTMLElement>('[data-screen-heading]')?.focus();
    window.scrollTo(0, 0);
  }, [state.name]);

  switch (state.name) {
    case 'HOME':
      return <HomePage onStart={flow.start} />;
    case 'CONFIGURING':
      return <ConfigurePage initial={state.draft} onSubmit={flow.submit} onBack={flow.reset} />;
    case 'GENERATING':
      return <GeneratingPage onCancel={flow.cancel} />;
    case 'PLAN_READY':
      return <PlanPage request={state.request} result={state.result} onReady={flow.confirmReady} onChange={flow.edit} />;
    case 'READY_TO_WALK':
      return <ReadyPage request={state.request} result={state.result} onStart={flow.startWalk} onBack={flow.backToPlan} onNewWalk={flow.edit} />;
    case 'WALK_ACTIVE':
    case 'EXIT_CONFIRMATION':
      return (
        <ActiveWalkPage
          plan={state.result.plan}
          startedAt={state.startedAt}
          durationMs={state.durationMs}
          clock={clock}
          confirmingExit={state.name === 'EXIT_CONFIRMATION'}
          onFinished={flow.finishWalk}
          onRequestExit={flow.requestExit}
          onKeepWalking={flow.keepWalking}
          onConfirmExit={flow.confirmExit}
        />
      );
    case 'WALK_COMPLETE':
      return <CompletePage request={state.request} onDone={flow.reset} />;
    case 'ERROR':
      return <ErrorPage error={state.error} request={state.request} onRetry={() => flow.submit(state.request)} onChange={flow.edit} />;
  }
}
