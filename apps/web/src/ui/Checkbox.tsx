import type { ComponentProps, ReactNode } from 'react';

type CheckboxProps = Omit<ComponentProps<'input'>, 'type' | 'className' | 'size'> & {
  label: string;
  icon?: ReactNode;
  count?: number;
};

export function Checkbox({ label, icon, count, disabled, ...props }: CheckboxProps) {
  return (
    <label
      className={`flex items-center gap-10px px-4px py-7px text-13 leading-control [&>svg]:shrink ${disabled ? 'cursor-not-allowed bg-canvas text-muted' : 'cursor-pointer'}`}
    >
      <span className="relative inline-flex h-16px w-16px items-center justify-center rounded-4 border-choice border-placeholder bg-surface has-checked:border-accent has-checked:bg-accent has-disabled:bg-canvas has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
        <input
          {...props}
          type="checkbox"
          disabled={disabled}
          className="peer absolute inset-0 size-full appearance-none focus-visible:outline-none"
        />
        <svg
          className="pointer-events-none relative invisible size-10px text-surface peer-checked:visible peer-disabled:text-muted"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M2 5.2 4.1 7.2 8 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="var(--stroke-checkbox)"
          />
        </svg>
      </span>
      {icon}
      <span className="flex-auto">{label}</span>
      {count != null && <span className="text-muted">{count}</span>}
    </label>
  );
}
