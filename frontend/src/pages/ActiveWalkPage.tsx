import { useEffect, useMemo, useRef, useState } from 'react';
import { endsAt, elapsedMs, formatRemaining, INTRO_MS, isFinished, remainingMs, spokenRemaining, stepIndexAt, type WalkTiming } from '../app/walkTimer';
import { useNow } from '../hooks/useNow';
import type { Clock } from '../time/clock';
import type { WalkPlan } from '../types/walk';

interface Props {
  plan: WalkPlan;
  startedAt: number;
  durationMs: number;
  clock: Clock;
  confirmingExit: boolean;
  onFinished: () => void;
  onRequestExit: () => void;
  onKeepWalking: () => void;
  onConfirmExit: () => void;
}

/**
 * The phone-down screen. It is deliberately the quietest screen in the app: one large instruction,
 * the time left, and a small way out. Nothing on it asks to be tapped, and the walk does not need
 * anyone to be looking at it. The same component stays mounted while the exit question is open, so
 * the timer never pauses or restarts.
 */
export function ActiveWalkPage({ plan, startedAt, durationMs, clock, confirmingExit, onFinished, onRequestExit, onKeepWalking, onConfirmExit }: Props) {
  const timing = useMemo<WalkTiming>(() => ({ startedAt, durationMs }), [startedAt, durationMs]);
  const now = useNow(clock, endsAt(timing));
  const remaining = remainingMs(timing, now);
  const elapsed = elapsedMs(timing, now);
  const intro = elapsed < INTRO_MS;
  const stepIndex = stepIndexAt(plan.steps, elapsed);
  const step = plan.steps[stepIndex];

  // Completion fires once: the ref covers the gap before the flow state changes, the reducer ignores repeats.
  const finished = useRef(false);
  useEffect(() => {
    if (finished.current || !isFinished(timing, now)) return;
    finished.current = true;
    onFinished();
  }, [now, timing, onFinished]);

  // Screen-reader announcements are for meaningful changes only: started, each new step. Never the clock.
  const announceKey = intro ? -1 : stepIndex;
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(announceKey === -1 ? 'Walk started. Put your phone away.' : `Step ${announceKey + 1} of ${plan.steps.length}. ${plan.steps[announceKey]?.text ?? ''}`);
  }, [announceKey, plan.steps]);

  // Focus: into the exit question when it opens, back to the exit control when it closes.
  const exitButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirmingExit) keepButton.current?.focus();
    else if (wasConfirming.current) exitButton.current?.focus();
    wasConfirming.current = confirmingExit;
  }, [confirmingExit]);

  useEffect(() => {
    if (!confirmingExit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKeepWalking();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmingExit, onKeepWalking]);

  return (
    <main className="screen walk">
      <p role="status" className="visually-hidden">
        {announcement}
      </p>

      <div className="walk__content" inert={confirmingExit}>
        <div className="walk__body">
          <h1 className="walk__line" tabIndex={-1} {...(confirmingExit ? {} : { 'data-screen-heading': true })}>
            {intro ? (
              <>
                <span className="walk__intro-lead">You&rsquo;re ready.</span>
                <span className="walk__intro-line">Put your phone away.</span>
              </>
            ) : (
              step?.text
            )}
          </h1>
          {!intro && <p className="walk__notice">{plan.notice}</p>}
        </div>

        <div className="walk__foot">
          <div className="walk__time" role="timer">
            <span aria-hidden="true">{formatRemaining(remaining)}</span>
            <span className="visually-hidden">{spokenRemaining(remaining)}</span>
          </div>
          {plan.steps.length > 1 && (
            <ol className="walk__dots" aria-hidden="true">
              {plan.steps.map((_, i) => (
                <li key={i} className={i === stepIndex && !intro ? 'walk__dot walk__dot--now' : i < stepIndex ? 'walk__dot walk__dot--done' : 'walk__dot'} />
              ))}
            </ol>
          )}
          <button ref={exitButton} type="button" className="walk__exit" onClick={onRequestExit}>
            Exit walk
          </button>
        </div>
      </div>

      {confirmingExit && (
        <div className="walk__confirm" role="alertdialog" aria-modal="true" aria-labelledby="exit-title" aria-describedby="exit-body">
          <h2 id="exit-title" className="walk__confirm-title" tabIndex={-1} data-screen-heading>
            End this walk?
          </h2>
          <p id="exit-body" className="walk__confirm-body">
            You&rsquo;ll go back to your plan. Your walk is still going until you decide.
          </p>
          <div className="actions">
            <button ref={keepButton} type="button" className="btn btn--light btn--block" onClick={onKeepWalking}>
              Keep walking
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={onConfirmExit}>
              End walk
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
