import { useId, useState, type FormEvent } from 'react';
import { ChoiceGroup } from '../components/ChoiceGroup';
import type { WalkDraft } from '../app/walkFlow';
import { ENERGY_OPTIONS, MINUTE_OPTIONS, validateCity } from '../app/copy';
import type { WalkRequest } from '../types/walk';

interface Props {
  initial: WalkDraft;
  onSubmit: (request: WalkRequest) => void;
  onBack: () => void;
}

export function ConfigurePage({ initial, onSubmit, onBack }: Props) {
  const [draft, setDraft] = useState<WalkDraft>(initial);
  const [cityError, setCityError] = useState<string | null>(null);
  const cityId = useId();
  const hintId = `${cityId}-hint`;
  const errorId = `${cityId}-error`;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateCity(draft.city);
    setCityError(problem);
    if (problem) return;
    const city = draft.city.trim();
    onSubmit({ minutes: draft.minutes, energy: draft.energy, ...(city ? { location: { city } } : {}) });
  }

  return (
    <main className="screen">
      <button type="button" className="btn btn--text back" onClick={onBack}>
        <span aria-hidden="true">&larr;</span> Back
      </button>
      <h1 className="title" tabIndex={-1} data-screen-heading>
        Choose your walk
      </h1>
      <form className="form" onSubmit={handleSubmit} noValidate>
        <ChoiceGroup legend="How long?" options={MINUTE_OPTIONS} value={draft.minutes} onChange={(minutes) => setDraft({ ...draft, minutes })} />
        <ChoiceGroup legend="How does it feel today?" options={ENERGY_OPTIONS} value={draft.energy} onChange={(energy) => setDraft({ ...draft, energy })} />
        <div className="field">
          <label className="field-label" htmlFor={cityId}>
            City <span className="field-optional">(optional)</span>
          </label>
          <input
            id={cityId}
            className="input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={80}
            value={draft.city}
            aria-invalid={cityError ? true : undefined}
            aria-describedby={cityError ? `${hintId} ${errorId}` : hintId}
            onChange={(e) => {
              setDraft({ ...draft, city: e.target.value });
              if (cityError) setCityError(null);
            }}
          />
          <p id={hintId} className="hint">
            Used once for a weather and daylight check. Not saved.
          </p>
          {cityError && (
            <p id={errorId} className="field-error" role="alert">
              {cityError}
            </p>
          )}
        </div>
        <button type="submit" className="btn btn--primary btn--block">
          Plan my walk
        </button>
      </form>
    </main>
  );
}
