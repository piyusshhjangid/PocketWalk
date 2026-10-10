import { useEffect, useState } from 'react';

interface Props {
  onCancel: () => void;
}

/**
 * Cancel appears after a short delay. The button that starts a walk sits where Cancel would be, so a
 * quick double-tap on "Plan my walk" or "Try again" would otherwise land on Cancel and abort the very
 * request it just started (seen in browser QA). Its space is reserved, so nothing jumps when it shows.
 */
export const CANCEL_DELAY_MS = 1500;

export function GeneratingPage({ onCancel }: Props) {
  const [canCancel, setCanCancel] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCanCancel(true), CANCEL_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="screen screen--center">
      <div role="status" aria-live="polite" className="generating">
        <svg className="generating__path" viewBox="0 0 120 40" aria-hidden="true" focusable="false">
          <path d="M4 30 C24 30 26 10 48 14 S80 32 96 16 S110 8 116 8" />
        </svg>
        <h1 className="title" tabIndex={-1} data-screen-heading>
          Preparing your walk&hellip;
        </h1>
        <p className="lead">One moment.</p>
      </div>
      <div className="generating__escape">
        {canCancel && (
          <button type="button" className="btn btn--text" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </main>
  );
}
