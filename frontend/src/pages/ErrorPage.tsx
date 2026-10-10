import type { ApiError } from '../api/apiError';
import { errorCopy } from '../app/copy';
import type { WalkRequest } from '../types/walk';

interface Props {
  error: ApiError;
  request: WalkRequest;
  onRetry: () => void;
  onChange: () => void;
}

export function ErrorPage({ error, request, onRetry, onChange }: Props) {
  const copy = errorCopy(error, request);
  return (
    <main className="screen screen--center">
      <div role="alert" className="problem">
        <h1 className="title" tabIndex={-1} data-screen-heading>
          {copy.title}
        </h1>
        <p className="lead">{copy.body}</p>
      </div>
      <div className="actions">
        {error.retryable && (
          <button type="button" className="btn btn--primary btn--block" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className={error.retryable ? 'btn btn--text' : 'btn btn--primary btn--block'} onClick={onChange}>
          Change walk
        </button>
      </div>
    </main>
  );
}
