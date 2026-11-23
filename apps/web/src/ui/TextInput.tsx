import { useId } from 'react';
import type { ComponentProps } from 'react';
import { FormField, controlState, fieldA11y } from './FormField';
import type { FieldLabel } from './FormField';

type TextInputProps = Omit<ComponentProps<'input'>, 'type' | 'className'> &
  FieldLabel & {
    type?: 'text' | 'email' | 'password' | 'url' | 'tel';
  };

export function TextInput({ id, label, hint, error, type = 'text', ...props }: TextInputProps) {
  const uid = useId();
  const inputId = id ?? uid;
  return (
    <FormField id={inputId} label={label} hint={hint} error={error}>
      <input
        {...props}
        {...fieldA11y(inputId, { label, hint, error }, props['aria-describedby'])}
        id={inputId}
        type={type}
        className={`${controlState} rounded-8 border border-control bg-surface px-10px py-8px`}
      />
    </FormField>
  );
}
