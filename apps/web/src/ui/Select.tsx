import { useId } from 'react';
import type { ComponentProps } from 'react';
import { FormField, controlState, fieldA11y } from './FormField';
import type { FieldLabel } from './FormField';

type SelectProps = Omit<ComponentProps<'select'>, 'className' | 'multiple' | 'size'> & FieldLabel;

export function Select({ id, label, hint, error, ...props }: SelectProps) {
  const uid = useId();
  const inputId = id ?? uid;
  return (
    <FormField id={inputId} label={label} hint={hint} error={error} className="text-13">
      <select
        {...props}
        {...fieldA11y(inputId, { label, hint, error }, props['aria-describedby'])}
        id={inputId}
        className={`${controlState} rounded-8 border border-control bg-surface px-10px py-7px`}
      />
    </FormField>
  );
}
