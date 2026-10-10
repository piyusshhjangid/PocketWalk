import { StepList } from '../components/StepList';
import { daylightLine, energyLabel, minutesLabel, weatherLine } from '../app/copy';
import type { WalkRequest, WalkResult } from '../types/walk';

interface Props {
  request: WalkRequest;
  result: WalkResult;
  onReady: () => void;
  onChange: () => void;
}

export function PlanPage({ request, result, onReady, onChange }: Props) {
  const { plan, meta } = result;
  const outdoors = [weatherLine(meta.context), daylightLine(meta.context)].filter((s): s is string => s !== null);

  return (
    <main className="screen">
      <p className="kicker">Your walk</p>
      <p className="facts">
        {minutesLabel(request.minutes)}
        <span aria-hidden="true"> · </span>
        <span className="visually-hidden">, </span>
        {energyLabel(request.energy)}
      </p>
      <h1 className="title title--plan" tabIndex={-1} data-screen-heading>
        {plan.title}
      </h1>
      {outdoors.length > 0 && <p className="outdoors">{outdoors.join('. ')}.</p>}

      <h2 className="visually-hidden">Steps</h2>
      <StepList steps={plan.steps} />

      <section className="notice" aria-labelledby="notice-label">
        <h2 id="notice-label" className="notice__label">
          Something to notice
        </h2>
        <p className="notice__text">{plan.notice}</p>
      </section>

      {meta.planner === 'fallback' && <p className="hint hint--plan">A simple ready-made walk.</p>}

      <div className="actions">
        <button type="button" className="btn btn--primary btn--block" onClick={onReady}>
          I&rsquo;m ready
        </button>
        <button type="button" className="btn btn--text" onClick={onChange}>
          Change walk
        </button>
      </div>
    </main>
  );
}
