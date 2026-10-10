import { useId } from 'react';

interface Option<T extends string | number> {
  value: T;
  label: string;
  hint: string;
}

interface Props<T extends string | number> {
  legend: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Native radio group: arrow keys, one tab stop and screen-reader semantics come from the browser. */
export function ChoiceGroup<T extends string | number>({ legend, options, value, onChange, disabled }: Props<T>) {
  const name = useId();
  return (
    <fieldset className="choice" disabled={disabled}>
      <legend className="field-label">{legend}</legend>
      <div className="choice__row">
        {options.map((o) => (
          <label key={o.value} className="choice__opt">
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span className="choice__face">
              <span className="choice__label">{o.label}</span>
              <span className="choice__hint">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
