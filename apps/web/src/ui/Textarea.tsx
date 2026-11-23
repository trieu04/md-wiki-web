import { useId } from 'react';
import type { ComponentProps } from 'react';
import { FormField, controlState, fieldA11y } from './FormField';
import type { FieldLabel } from './FormField';

type TextareaProps = Omit<ComponentProps<'textarea'>, 'className'> &
  FieldLabel & {
    variant?: 'default' | 'compact' | 'excerpt';
  };

export function Textarea({
  id,
  label,
  hint,
  error,
  variant = 'default',
  rows = 2,
  ...props
}: TextareaProps) {
  const uid = useId();
  const inputId = id ?? uid;
  return (
    <FormField
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      gap={variant === 'compact' ? 'gap-10px' : 'gap-4px'}
      className={variant === 'compact' ? 'text-13' : ''}
    >
      <textarea
        {...props}
        {...fieldA11y(inputId, { label, hint, error }, props['aria-describedby'])}
        id={inputId}
        rows={rows}
        className={`${controlState} resize-y rounded-8 border border-control bg-surface px-10px py-8px ${variant === 'excerpt' ? 'font-content text-15 leading-control' : ''}`}
      />
    </FormField>
  );
}
