import { useId } from 'react';
import type { ComponentProps } from 'react';
import { canvasControlState, controlState } from './FormField';

type SearchInputProps = Omit<ComponentProps<'input'>, 'size' | 'type'> & {
  size: 'topbar' | 'home';
  label: string;
  /** Render the top-bar field as a GET search form with this destination. */
  action?: string;
  formLabel?: string;
};

export function SearchInput({
  id,
  label,
  size,
  className = '',
  disabled,
  action,
  formLabel,
  ...props
}: SearchInputProps) {
  const uid = useId();
  const inputId = id ?? uid;
  const field = (
    <>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        type="search"
        disabled={disabled}
        className={`min-w-0 flex-auto ${
          size === 'home'
            ? `${controlState} h-home-control rounded-10 border border-input-strong bg-surface px-16px text-16 ${className}`
            : `${canvasControlState} bg-transparent px-2px py-mark-x leading-control outline-offset-4`
        }`}
      />
    </>
  );
  if (size === 'home') return field;

  const Wrapper = action ? 'form' : 'div';
  return (
    <Wrapper
      action={action}
      role={action ? 'search' : undefined}
      aria-label={action ? formLabel : undefined}
      className={`flex h-topbar-search min-w-0 max-w-search-max flex-auto basis-search-basis items-center gap-8px rounded-9 border border-control bg-canvas px-10px ${className}`}
    >
      <svg
        className="size-16px shrink-0 text-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="var(--stroke-control-icon)"
        aria-hidden="true"
      >
        <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5 21 21" />
      </svg>
      {field}
      <span className="text-12 leading-control text-muted" aria-hidden="true">
        ⌘K
      </span>
    </Wrapper>
  );
}
