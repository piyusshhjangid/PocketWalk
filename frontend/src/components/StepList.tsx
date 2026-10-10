import type { WalkStep } from '../types/walk';

/** Renders model-written text as plain text children. React escapes it; there is no raw-HTML path. */
export function StepList({ steps, compact = false }: { steps: WalkStep[]; compact?: boolean }) {
  return (
    <ol className={compact ? 'steps steps--compact' : 'steps'}>
      {steps.map((s, i) => (
        <li key={i} className="steps__item">
          <span className="steps__time">{s.minutes} min</span>
          <span className="steps__text">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}
