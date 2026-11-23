import type { ComponentPropsWithoutRef } from 'react';

const variants = {
  primary:
    'rounded-8 bg-accent px-16px py-10px text-surface font-semibold enabled:hover:bg-accent-hover enabled:active:bg-accent-hover',
  'primary-home':
    'h-home-control rounded-10 bg-accent px-20px text-surface font-semibold enabled:hover:bg-accent-hover enabled:active:bg-accent-hover',
  secondary:
    'rounded-8 border border-control bg-surface px-12px py-7px font-medium text-native-button enabled:hover:bg-nav-current enabled:active:bg-nav-current',
  'secondary-compact':
    'rounded-7 border border-control bg-surface px-12px py-6px text-13 font-medium text-native-button enabled:hover:bg-nav-current enabled:active:bg-nav-current',
  link: 'bg-transparent p-0 text-13 font-medium text-accent',
} as const;

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: keyof typeof variants;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-busy={loading || props['aria-busy']}
      disabled={loading || disabled}
      className={`inline-flex items-center justify-center leading-control disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg ${variants[variant]} ${className ?? ''}`}
    />
  );
}
