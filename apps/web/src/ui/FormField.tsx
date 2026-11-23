import type { ReactNode } from 'react';

export type FieldLabel = {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
};

const baseControlState =
  'text-primary disabled:bg-canvas disabled:text-muted disabled:cursor-not-allowed';
export const controlState = `${baseControlState} placeholder:text-native-placeholder`;
export const canvasControlState = `${baseControlState} placeholder:text-muted`;

export function fieldA11y(id: string, { hint, error }: FieldLabel, describedBy?: string) {
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby':
      [describedBy, hint != null ? `${id}-hint` : '', error ? `${id}-error` : '']
        .filter(Boolean)
        .join(' ') || undefined,
  };
}

export function FormField({
  id,
  label,
  hint,
  error,
  children,
  className = '',
  gap = 'gap-4px',
}: FieldLabel & {
  id: string;
  children: ReactNode;
  className?: string;
  gap?: 'gap-4px' | 'gap-10px';
}) {
  return (
    <div className={`flex min-w-0 flex-col ${gap} ${className}`}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {children}
      {hint != null && (
        <p id={`${id}-hint`} className="text-12 text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-12 text-trust-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
