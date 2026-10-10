import { StepList } from '../components/StepList';
import { minutesLabel } from '../app/copy';
import type { WalkRequest, WalkResult } from '../types/walk';

interface Props {
  request: WalkRequest;
  result: WalkResult;
  onStart: () => void;
  onBack: () => void;
  onNewWalk: () => void;
}

/** The last screen that wants to be read. One obvious action: start, and the phone goes down. */
export function ReadyPage({ request, result, onStart, onBack, onNewWalk }: Props) {
  return (
    <main className="screen screen--center">
      <h1 className="display" tabIndex={-1} data-screen-heading>
        Ready?
      </h1>
      <p className="lead">Your plan is set. {minutesLabel(request.minutes)}, no rush.</p>
      <div className="glance">
        <p className="glance__title">{result.plan.title}</p>
        <StepList steps={result.plan.steps} compact />
      </div>
      <div className="actions">
        <button type="button" className="btn btn--primary btn--block" onClick={onStart}>
          Start walking
        </button>
        <button type="button" className="btn btn--text" onClick={onBack}>
          Back to the plan
        </button>
        <button type="button" className="btn btn--text" onClick={onNewWalk}>
          Plan another walk
        </button>
      </div>
    </main>
  );
}
