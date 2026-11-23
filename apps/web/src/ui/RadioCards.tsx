import { useId } from 'react';
import type { ReactNode } from 'react';

export type RadioCardOption = {
  value: string;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
};

type RadioCardsProps = {
  label: string;
  options: readonly RadioCardOption[];
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  variant?: 'trust' | 'conflict' | 'decision';
};

const styles = {
  trust: 'px-12px py-9px text-native-control',
  conflict: 'px-12px py-10px text-13',
  decision: 'px-10px py-8px text-13',
};

export function RadioCards({
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled,
  variant = 'trust',
}: RadioCardsProps) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-6px">
      {options.map((option, index) => {
        const optionId = `${id}-${String(index)}`;
        return (
          <label key={option.value} className="group relative block">
            <input
              type="radio"
              className="peer sr-only"
              name={name ?? id}
              value={option.value}
              checked={value == null ? undefined : value === option.value}
              defaultChecked={
                value == null && defaultValue != null ? defaultValue === option.value : undefined
              }
              onChange={
                onChange
                  ? () => {
                      onChange(option.value);
                    }
                  : undefined
              }
              disabled={disabled || option.disabled}
              aria-labelledby={`${optionId}-label`}
              aria-describedby={option.description != null ? `${optionId}-description` : undefined}
            />
            <span
              className={`flex cursor-pointer items-start gap-10px rounded-8 border border-edge bg-surface text-left leading-control peer-checked:border-accent peer-checked:bg-selected peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:bg-canvas peer-disabled:text-muted ${styles[variant]}`}
            >
              <span
                aria-hidden="true"
                className={`size-14px shrink-0 rounded-7 border-choice border-placeholder group-has-checked:border-4 group-has-checked:border-accent ${variant === 'trust' ? 'mt-3px' : 'mt-2px'}`}
              />
              <span className={variant === 'decision' ? '' : 'flex flex-col'}>
                <strong id={`${optionId}-label`} className="font-semibold">
                  {option.label}
                </strong>
                {option.description != null && (
                  <>
                    {variant === 'decision' && ' '}
                    <span id={`${optionId}-description`} className="text-13 text-muted">
                      {option.description}
                    </span>
                  </>
                )}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
