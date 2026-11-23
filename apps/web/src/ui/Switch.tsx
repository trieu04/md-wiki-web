import { useState } from 'react';

type SwitchProps = {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
};

export function Switch({
  label,
  checked,
  defaultChecked = false,
  onChange,
  disabled,
}: SwitchProps) {
  const [local, setLocal] = useState(defaultChecked);
  const on = checked ?? local;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-12px py-6px text-left text-13 leading-control disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg"
      onClick={() => {
        if (checked == null) setLocal(!on);
        onChange?.(!on);
      }}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`flex h-count w-switch-track shrink-0 rounded-10 p-2px ${on ? 'justify-end bg-accent' : 'justify-start bg-trust-none-bar'}`}
      >
        <span className="size-16px rounded-8 bg-surface" />
      </span>
    </button>
  );
}
