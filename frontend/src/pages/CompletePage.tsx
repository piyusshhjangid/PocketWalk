import { minutesLabel } from '../app/copy';
import type { WalkRequest } from '../types/walk';

/** The whole reward is that the walk happened: no scores, streaks, history or sharing. */
export function CompletePage({ request, onDone }: { request: WalkRequest; onDone: () => void }) {
  return (
    <main className="screen screen--center">
      <h1 className="display" tabIndex={-1} data-screen-heading>
        Walk complete.
      </h1>
      <p className="tagline">Nice.</p>
      <p className="lead">You spent {minutesLabel(request.minutes)} outside.</p>
      <div className="actions">
        <button type="button" className="btn btn--primary btn--block" onClick={onDone}>
          Done
        </button>
      </div>
    </main>
  );
}
