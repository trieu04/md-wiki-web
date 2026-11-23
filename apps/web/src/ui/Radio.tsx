import type { ComponentProps, ReactNode } from 'react';

type RadioProps = Omit<ComponentProps<'input'>, 'type' | 'className' | 'size'> & {
  label: ReactNode;
  name: string;
  variant?: 'filter' | 'form';
};

export function Radio({ label, variant = 'filter', disabled, ...props }: RadioProps) {
  return (
    <label
      className={`flex gap-10px ${variant === 'filter' ? 'items-center text-13' : 'items-start'} ${disabled ? 'cursor-not-allowed bg-canvas text-muted' : ''}`}
    >
      <input
        {...props}
        type="radio"
        disabled={disabled}
        className={variant === 'form' ? 'mt-3px' : ''}
      />
      <span>{label}</span>
    </label>
  );
}
