import type { ComponentPropsWithoutRef } from 'react';

type PillToggleProps = Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'aria-pressed'> & {
  pressed: boolean;
  size?: 'scope' | 'sort';
};

/** A native toggle button. The parent controls selection and group naming. */
export function PillToggle({ pressed, size = 'scope', className, ...props }: PillToggleProps) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={pressed}
      className={`rounded-7 border px-10px text-13 leading-control text-primary enabled:hover:bg-nav-current enabled:active:bg-nav-current disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg ${size === 'sort' ? 'py-6px' : 'py-5px'} ${pressed ? 'border-accent bg-selected font-semibold' : 'border-control bg-surface font-medium'} ${className ?? ''}`}
    />
  );
}
